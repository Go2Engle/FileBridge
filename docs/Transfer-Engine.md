# Transfer Engine

The transfer engine (`lib/transfer/engine.ts`) is the core of FileBridge. It orchestrates every file-level operation for a job run: listing files, applying filters, downloading, extracting, uploading, post-transfer actions, and recording audit logs.

---

## Execution Flow

When a job is triggered (scheduled or manual), the engine executes these steps in order:

```
1. Load job from database
2. Check concurrent run guard (skip if already running)
3. Save pre-run status (active / inactive) for post-run restoration
4. Load source and destination connection configs
5. Insert job_runs record with status = "running"
6. Mark job status = "running" in jobs table
7. Connect to source storage provider
8. Connect to destination storage provider
9. List source files (with glob filter applied by the provider)
10. Filter out hidden files (if skipHiddenFiles = true)
11. Filter out the move subfolder (if post-action = "move" and movePath ⊂ sourcePath)
12. Update job_runs.totalFiles
13. (Optional) List destination files for overwrite-check / delta-sync
14. For each source file:
    a. Update job_runs.currentFile
    b. Compute output filename (strip/add .pgp extension based on PGP config)
    c. Delta sync check → skip if destination is same age or newer
    d. Overwrite check → skip if exists and overwrite = false
    e. Download file from source (streamed — not buffered in memory)
    f. If PGP decrypt enabled → apply decryption to stream/buffer
    g. If extractArchives → buffer and extract archive, upload each entry individually
    h. If PGP encrypt enabled → apply encryption to stream/buffer before upload
    i. Else → stream directly to destination (delete existing first if overwrite/delta)
    j. Apply post-transfer action (retain / delete / move)
    h. Insert transfer_logs record (success or failure)
    i. Increment filesTransferred + bytesTransferred counters
15. Disconnect both providers
16. Update job_runs: status = "success", final counts, completedAt
17. Restore job status (active or inactive — not "error")
```

If any uncaught error occurs during steps 7–17, the engine catches it, updates `job_runs` to `failure`, sets `jobs.status` to `error` (or `inactive` if it was inactive before), and re-throws.

---

## File Listing and Filtering

The engine calls `source.listFiles(sourcePath, fileFilter)`. Each storage provider applies the glob filter internally using `globToRegex()` from `lib/storage/interface.ts`.

The glob filter supports:
- `*` — matches any sequence of characters
- `?` — matches exactly one character
- Multiple patterns separated by commas: `*.csv, *.txt`
- Case-insensitive matching
- Empty string = match all files

**Hidden file filtering** is a separate layer applied after the provider returns its list. Any file whose name starts with `.` is excluded when `skipHiddenFiles = true`.

---

## Overwrite Behavior

| `overwriteExisting` | `deltaSync` | File exists at dest | Behavior |
|---|---|---|---|
| false | false | No | Transfer the file |
| false | false | Yes | Skip (logged, not transferred) |
| true | false | No | Transfer the file |
| true | false | Yes | Delete dest file, then upload |
| false | true | No | Transfer the file |
| false | true | Yes, dest is newer | Skip |
| false | true | Yes, source is newer | Delete dest file, then upload |

Delta sync implicitly enables overwrite for files that pass the timestamp check. The destination file is deleted before uploading to avoid SMB `STATUS_OBJECT_NAME_COLLISION` errors.

---

## Archive Extraction

When `extractArchives = true` and a file is recognized as an archive:

1. The archive is downloaded from the source and buffered in memory (archives cannot be streamed because ZIP requires random access and TAR requires sequential parsing of the full file)
2. The engine extracts all file entries (directories are skipped)
3. Nested paths within the archive are **flattened** — files land directly in `destinationPath`
4. Each extracted entry is uploaded individually
5. A `transfer_logs` entry is written for each extracted entry, using a virtual source path `archive.zip!entry.csv`
6. The original archive file is **not** uploaded to the destination
7. The post-transfer action (retain/delete/move) is applied to the **original archive** on the source

Supported formats:
- `.zip` — via `yauzl`
- `.tar` — via `tar-stream`
- `.tar.gz` and `.tgz` — via `tar-stream` + Node.js built-in `zlib.gunzipSync`

If extraction returns no entries (empty archive), the engine falls through and transfers the archive as-is.

### Limitation: Delta Sync + Archive Extraction

These two features are incompatible. When both are enabled:
- Delta sync is silently ignored for archive files
- All archives are downloaded and extracted on every run
- This is because the source listing only shows the archive filename; individual entry timestamps can't be checked without downloading and unpacking first

---

## Delta Sync

Delta sync compares `modifiedAt` timestamps between source and destination files.

The destination is listed once before the per-file loop and cached in a `Map<string, Date>`. This avoids one network round-trip per file.

Decision logic (per file):
```
if deltaSync && file exists at dest:
    if destModifiedAt >= srcModifiedAt → skip (destination is up to date)
    else → transfer (source is newer)
else if !overwriteExisting && file exists at dest:
    skip
else:
    transfer
```

---

## PGP Encryption / Decryption

When PGP is configured on a job, the engine applies transforms inline during the transfer pipeline.

### Streaming Path (non-archive files)

```
Source → Download stream → [PGP Decrypt] → byte tracker → [PGP Encrypt] → Upload stream → Destination
```

- The byte tracker sits between decrypt and encrypt to count plaintext bytes
- `uploadSizeHint` is set to `undefined` when PGP transforms are active (encrypted size is unknown)
- The SMB provider handles unknown-size uploads by buffering to determine actual size before writing

### Archive Path (when extractArchives is enabled)

```
Source → Download → Buffer → [PGP Decrypt buffer] → Extract archive → For each entry: [PGP Encrypt buffer] → Upload
```

- The full archive is buffered into memory (required for extraction)
- Decryption is applied to the entire archive buffer before extraction
- Encryption is applied to each extracted entry individually

### Filename Handling

- **Decrypt**: strips `.pgp`, `.gpg`, or `.asc` extension from the source filename
- **Encrypt**: appends `.pgp` to the filename
- Delta sync and overwrite checks use the **output filename** (after extension changes)

### Progress Tracking with PGP

When PGP transforms are active, the source file size doesn't match the transferred bytes. The engine sets `currentFileSize` to `null` so the UI shows indeterminate progress for individual files. Overall job-level counters (`filesTransferred`, `bytesTransferred`) remain accurate.

See [PGP Encryption](PGP-Keys) for key management and job configuration details.

---

## Post-Transfer Actions

Applied after a successful upload (or archive extraction):

| Action | What happens |
|---|---|
| `retain` | Nothing — the source file is left in place |
| `delete` | `source.deleteFile(srcPath)` is called |
| `move` | `source.moveFile(srcPath, movePath + "/" + filename)` is called |

Post-transfer action failures are caught and logged but do **not** fail the overall file transfer — the `transfer_logs` entry is still recorded as `success`.

---

## Progress Tracking

The engine updates `job_runs` records in real time so the UI can show progress:

- `job_runs.totalFiles` — set once after listing (before the per-file loop)
- `job_runs.currentFile` — updated before each file starts downloading
- `job_runs.filesTransferred` and `job_runs.bytesTransferred` — incremented after each successful upload
- `job_runs.currentFile` — set to `null` when the run completes or fails

The Jobs page auto-refreshes every 10 seconds to surface these updates.

---

## Dry Run

The `dryRunJob(jobId)` function performs all the same logic as `runJob` except:

- **No files are transferred, deleted, or moved**
- Both source and destination are connected read-only (list operations only)
- Returns a `DryRunResult` object describing what would happen

### DryRunResult Structure

```ts
{
  jobId: number;
  jobName: string;
  sourcePath: string;
  destinationPath: string;
  fileFilter: string;
  files: DryRunFile[];        // One entry per source file
  totalInSource: number;      // All files visible in source dir
  totalMatched: number;       // Files matching the filter
  wouldTransfer: number;      // Files that would be uploaded
  wouldSkip: number;          // Files that would be skipped (all reasons)
  skippedByFilter: number;    // Skipped because they don't match the filter
  skippedByExists: number;    // Skipped because they exist and overwrite is off
  skippedByDelta: number;     // Skipped because destination is same age or newer
  totalBytes: number;         // Bytes that would be transferred
}
```

### DryRunFile Structure

```ts
{
  name: string;
  size: number;
  modifiedAt: string;         // ISO timestamp
  wouldSkip: boolean;
  skipReason: "filter" | "exists" | "delta" | null;
  postAction: "retain" | "delete" | "move";
  moveDest: string | null;    // Full path if postAction = "move"
  isArchive: boolean;
  wouldExtract: boolean;      // true if extractArchives + isArchive
  wouldDecrypt: boolean;      // true if PGP decrypt enabled for this file
  wouldEncrypt: boolean;      // true if PGP encrypt enabled for this file
  outputFileName: string;     // Destination filename (after PGP extension changes)
}
```

---

## Error Handling

Per-file errors are caught individually. A failed file is:
1. Recorded in `transfer_logs` with `status = "failure"` and the error message
2. Counted as skipped (not in `filesTransferred`)
3. Does **not** abort the rest of the run — other files continue processing

A connection-level error (e.g. can't connect to source) aborts the entire run and marks the `job_runs` record as `failure`.

Directory entries that slip through the listing filter (e.g. when a storage provider returns mixed files and directories) are detected by error message pattern and silently skipped.
