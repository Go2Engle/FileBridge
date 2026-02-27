# Jobs

A **job** is the core unit of FileBridge. Each job defines a source, a destination, a schedule, and a set of rules for how files should be transferred.

---

## Job Fields

### Basic Configuration

| Field | Description |
|---|---|
| **Name** | Display name for the job |
| **Source Connection** | The connection to read files from |
| **Source Path** | Directory on the source to scan (e.g. `/data/incoming`) |
| **Destination Connection** | The connection to write files to |
| **Destination Path** | Directory on the destination to write to (e.g. `/archive/received`) |

### Schedule

Jobs run on a **cron expression**. The UI provides preset shortcuts as well as a free-form cron input:

| Preset | Cron | Description |
|---|---|---|
| Every 5 minutes | `*/5 * * * *` | |
| Every 15 minutes | `*/15 * * * *` | |
| Every 30 minutes | `*/30 * * * *` | |
| Every hour | `0 * * * *` | |
| Every 6 hours | `0 */6 * * *` | |
| Every day at midnight | `0 0 * * *` | |
| Weekdays at 8 AM | `0 8 * * 1-5` | |
| Custom | any valid cron | 5-field cron expression |

The UI shows a human-readable description of the cron expression (e.g. "Every day at 8:00 AM").

Cron expressions run in the **configured system timezone** (set under **Settings → Timezone**). This defaults to `UTC` if not configured. Changing the timezone immediately reschedules all active jobs. See [Configuration](Configuration#application-settings-in-app) for details.

### File Filtering

| Field | Description |
|---|---|
| **File Filter** | Glob pattern(s) to match files. Empty = match all. Comma-separated for multiple patterns. |

Examples:
- `*.csv` — only CSV files
- `report_*.xlsx` — Excel files starting with `report_`
- `*.csv, *.txt` — CSV or TXT files
- `data_??.json` — JSON files with exactly two characters after `data_`

The filter is case-insensitive and applies to file **names only** (not paths). See the `globToRegex` function in `lib/storage/interface.ts` for the exact matching rules.

### Transfer Options

| Field | Default | Description |
|---|---|---|
| **Overwrite Existing** | Off | When on, files that already exist at the destination are replaced. When off, they are skipped. |
| **Skip Hidden Files** | On | Skips files and directories whose names start with `.` (dotfiles) |
| **Extract Archives** | Off | Automatically extracts ZIP, TAR, TAR.GZ, and TGZ archives at the destination |
| **Delta Sync** | Off | Only transfers files where the source is newer than the destination copy |

### Post-Transfer Action

Controls what happens to the **source file** after a successful transfer:

| Action | Description |
|---|---|
| **Retain** | Leave the source file in place (default) |
| **Delete** | Delete the source file after transferring |
| **Move** | Move the source file to a specified folder on the source system |

When **Move** is selected, a **Move Path** field appears. This is the destination folder on the source connection (e.g. `/data/processed`).

> **Tip**: If the move path is a subdirectory of the source path (e.g. source = `/data`, move path = `/data/processed`), FileBridge automatically excludes the `processed` subdirectory from the file listing to prevent an infinite loop.

---

## Job Statuses

| Status | Description |
|---|---|
| `active` | The job is scheduled and will run at its next cron trigger |
| `inactive` | The job is disabled — it will not run on schedule (manual runs still work) |
| `running` | The job is currently executing |
| `error` | The last run failed — the job will still run on its next schedule trigger |

Jobs that were `inactive` before a manual **Run Now** return to `inactive` after completion (not `active`). This prevents accidentally re-enabling disabled jobs.

If the server crashes while a job is in `running` state, the scheduler resets those jobs to `error` on the next startup.

---

## Running a Job

### Scheduled Execution

Active jobs run automatically at the time defined by their cron expression. The scheduler (node-cron) is initialized at server startup via `instrumentation.ts`.

### Manual Execution (Run Now)

Any job can be triggered immediately from the Jobs page by clicking **Run Now**. This executes the job regardless of its schedule and regardless of whether it's active or inactive.

### Concurrent Run Protection

If a job is already `running`, a second trigger (scheduled or manual) is ignored. This prevents overlapping executions of the same job.

---

## Dry Run

Before executing a job for real, you can preview what it would do using **Dry Run**:

1. Click the dropdown arrow next to **Run Now**
2. Select **Dry Run**
3. A modal displays a per-file preview

The dry run report shows:
- Every file visible in the source directory
- Which files match the file filter
- Which files would be skipped (and why: `filter`, `exists`, or `delta`)
- Which files would be transferred
- Which files are archives (and would be extracted)
- File sizes and total bytes that would be transferred
- Post-transfer action for each file

The dry run connects to both the source and destination to get accurate skip/delta information, but never uploads, downloads persistently, or modifies any files.

See [Transfer Engine](Transfer-Engine#dry-run) for the detailed logic.

---

## Archive Extraction

When **Extract Archives** is enabled, FileBridge intercepts archive files during transfer and extracts their contents to the destination instead of copying the archive itself.

Supported formats:
- `.zip` — via `yauzl`
- `.tar` — via `tar-stream`
- `.tar.gz` / `.tgz` — via `tar-stream` + Node.js `zlib`

All nested directory paths within the archive are flattened — files are extracted directly into the destination path.

> **Warning**: Delta sync and archive extraction cannot be used together reliably. When both are enabled, delta sync is silently ignored for archive files. All archives are always downloaded and extracted on every run because the source listing only exposes the archive file, not its contents, making timestamp comparison impossible without fully downloading the archive first.

---

## Delta Sync

When **Delta Sync** is enabled, FileBridge compares the `modifiedAt` timestamp of each source file against the corresponding destination file:

- If the **source is newer** than the destination → the file is transferred (overwriting the destination)
- If the **destination is the same age or newer** → the file is skipped

Delta sync implicitly enables overwrite behavior for files that do pass the timestamp check. The destination file is deleted before re-uploading to avoid conflicts on SMB shares.

---

## Job Run History

Every job execution creates a **job run** record with:
- Start and completion timestamps
- Final status (`success` or `failure`)
- Files transferred and bytes transferred
- Error message (if failed)
- Real-time `currentFile` field (updated as each file is processed)

Click a job in the Jobs list to view its run history in a detail panel. The job detail also shows the last error message inline via a tooltip.

## Job Logs Panel

The job detail sheet includes an embedded transfer log viewer. For the selected job you can:
- Search logs by file name (partial match)
- Filter by status: All, Success, or Failed
- See the full source and destination paths with file sizes and timestamps
- Auto-refresh to monitor a job that is currently running

The panel fetches from `GET /api/logs?jobId=<id>` and supports real-time filtering without a full page reload.

## Next Run Time

Active jobs display a **Next Run** timestamp in the jobs list, showing when the job will next fire based on its cron expression and the configured system timezone. This field is `null` for inactive or error-state jobs.

---

## Auto-Refresh

The Jobs page auto-refreshes every **10 seconds** to reflect running state. You can see when a job transitions from `running` back to `active` or `error` after execution completes.
