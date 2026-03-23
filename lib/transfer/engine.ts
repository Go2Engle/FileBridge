import { db } from "@/lib/db";
import { jobs, jobRuns, transferLogs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getConnection } from "@/lib/db/connections";
import { getJobHooksWithDetail } from "@/lib/db/hooks";
import { executeHooks } from "@/lib/hooks/executor";
import { createStorageProvider } from "@/lib/storage/registry";
import { globToRegex } from "@/lib/storage/interface";
import path from "path";
import { Readable, Transform } from "stream";
import { gunzipSync } from "zlib";
import yauzl from "yauzl";
import * as tar from "tar-stream";
import { createLogger, withJobContext } from "@/lib/logger";
import { getPgpKey } from "@/lib/db/pgp-keys";
import {
  encryptStream as pgpEncryptStream,
  decryptStream as pgpDecryptStream,
  encryptBuffer as pgpEncryptBuffer,
  decryptBuffer as pgpDecryptBuffer,
  stripPgpExtension,
} from "@/lib/pgp";

const log = createLogger("engine");

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

interface ExtractedFile {
  name: string;
  content: Buffer;
}

interface SourceFileResult {
  srcFilePath: string;
  fileName: string;
  transferSuccess: boolean;
}

const ARCHIVE_EXTENSIONS = [".zip", ".tar", ".tar.gz", ".tgz"];

/** Check if an error indicates the path is a directory, not a file. */
function isDirectoryError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("is_a_directory") ||
    msg.includes("is a directory") ||
    msg.includes("eisdir")
  );
}

function isArchive(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function verifySourceFileDeleted(source: ReturnType<typeof createStorageProvider>, srcFilePath: string): Promise<void> {
  const parentPath = path.posix.dirname(srcFilePath);
  const fileName = path.posix.basename(srcFilePath);
  const maxAttempts = 30;
  const pollIntervalMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const files = await source.listFiles(parentPath);
      const stillExists = files.some((f) => f.name === fileName);
      if (!stillExists) {
        log.info("Source delete confirmed", { srcPath: srcFilePath, attempt });
        return;
      }
    } catch (err) {
      log.warn("Delete verification list failed — retrying", {
        srcPath: srcFilePath,
        attempt,
        error: err,
      });
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  throw new Error(`Source file still present after delete verification window: ${srcFilePath}`);
}

async function deleteSourceAndConfirm(source: ReturnType<typeof createStorageProvider>, srcFilePath: string): Promise<void> {
  await source.deleteFile(srcFilePath);
  await verifySourceFileDeleted(source, srcFilePath);
}

async function verifyDestinationFileSize(
  dest: ReturnType<typeof createStorageProvider>,
  dstFilePath: string,
  expectedSize: number,
  destinationProtocol?: string
): Promise<void> {
  const parentPath = path.posix.dirname(dstFilePath);
  const fileName = path.posix.basename(dstFilePath);
  const isSmbDestination = destinationProtocol === "smb";
  const maxAttempts = isSmbDestination ? 10 : 5;
  const pollIntervalMs = isSmbDestination ? 1000 : 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const files = await dest.listFiles(parentPath);
      const uploaded = files.find((f) => f.name === fileName);
      if (uploaded && uploaded.size === expectedSize) {
        return;
      }
      if (uploaded) {
        log.warn("Destination file size mismatch", {
          dstPath: dstFilePath,
          expectedSize,
          actualSize: uploaded.size,
          attempt,
        });
      }
    } catch (err) {
      log.warn("Destination size verification list failed — retrying", {
        dstPath: dstFilePath,
        expectedSize,
        attempt,
        error: err,
      });
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  throw new Error(`Destination file size verification failed: ${dstFilePath}`);
}

/**
 * Verify multiple destination files in a single directory using one listFiles
 * call per poll attempt instead of one per file.
 */
async function verifyDestinationFileSizesBatch(
  dest: ReturnType<typeof createStorageProvider>,
  entries: { dstFilePath: string; expectedSize: number }[],
  destinationProtocol?: string
): Promise<Map<string, Error>> {
  if (entries.length === 0) return new Map();

  // All entries share the same parent directory (archive extraction target)
  const parentPath = path.posix.dirname(entries[0].dstFilePath);
  const isSmbDestination = destinationProtocol === "smb";
  const maxAttempts = isSmbDestination ? 10 : 5;
  const pollIntervalMs = isSmbDestination ? 1000 : 500;

  const pending = new Map<string, { dstFilePath: string; expectedSize: number }>();
  for (const e of entries) {
    const base = path.posix.basename(e.dstFilePath);
    if (pending.has(base)) {
      throw new Error(`Duplicate basename in batch verification: "${base}" (paths: ${pending.get(base)!.dstFilePath}, ${e.dstFilePath})`);
    }
    pending.set(base, e);
  }
  const errors = new Map<string, Error>();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const files = await dest.listFiles(parentPath);
      const fileMap = new Map(files.map((f) => [f.name, f]));

      for (const [fileName, entry] of [...pending]) {
        const uploaded = fileMap.get(fileName);
        if (uploaded && uploaded.size === entry.expectedSize) {
          pending.delete(fileName);
        } else if (uploaded) {
          log.warn("Destination file size mismatch", {
            dstPath: entry.dstFilePath,
            expectedSize: entry.expectedSize,
            actualSize: uploaded.size,
            attempt,
          });
        }
      }
    } catch (err) {
      log.warn("Destination size verification list failed — retrying", {
        parentPath,
        pendingCount: pending.size,
        attempt,
        error: err,
      });
    }

    if (pending.size === 0) return errors;

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }

  // Any still-pending entries are failures
  for (const [, entry] of pending) {
    errors.set(entry.dstFilePath, new Error(`Destination file size verification failed: ${entry.dstFilePath}`));
  }
  return errors;
}

/**
 * WARNING: Delta sync does not apply to archive extraction.
 * When extractArchives is enabled, files land at the destination under their
 * extracted names (e.g. "report.csv"), not the archive name ("data.zip").
 * The source listing only exposes the archive file itself, so there is no way
 * to compare individual entry timestamps against the destination without first
 * downloading and unpacking the archive — which defeats the purpose of delta sync.
 * When both options are enabled together, delta sync is silently ignored for
 * archive files and all archives will be downloaded and extracted on every run.
 */
function extractArchive(fileName: string, content: Buffer): Promise<ExtractedFile[] | null> {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".zip")) {
    return extractZip(content);
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return extractTar(gunzipSync(content));
  }
  if (lower.endsWith(".tar")) {
    return extractTar(content);
  }
  return Promise.resolve(null);
}

function extractZip(content: Buffer): Promise<ExtractedFile[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(content, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const entries: ExtractedFile[] = [];
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        // Skip directories
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr) return reject(streamErr);
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            const name = path.posix.basename(entry.fileName);
            if (name) entries.push({ name, content: Buffer.concat(chunks) });
            zipfile.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zipfile.on("end", () => resolve(entries));
      zipfile.on("error", reject);
    });
  });
}

function extractTar(content: Buffer): Promise<ExtractedFile[]> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const entries: ExtractedFile[] = [];

    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        // Skip directories
        if (header.type === "file") {
          const name = path.posix.basename(header.name);
          if (name) entries.push({ name, content: Buffer.concat(chunks) });
        }
        next();
      });
      stream.resume();
    });

    extract.on("finish", () => resolve(entries));
    extract.on("error", reject);

    extract.end(content);
  });
}

export interface DryRunFile {
  name: string;
  size: number;
  modifiedAt: string | null;
  wouldSkip: boolean;
  /**
   * Why the file is skipped, or null if it will be transferred.
   * - "filter"  — does not match the job's file filter
   * - "exists"  — already exists at destination and overwrite is disabled
   * - "delta"   — destination file is same age or newer (delta sync enabled)
   */
  skipReason: "filter" | "exists" | "delta" | null;
  /** What happens to the source file after a successful transfer. */
  postAction: "retain" | "delete" | "move";
  /** Full destination path when postAction is "move". */
  moveDest: string | null;
  /** True if the file is a recognized archive type. */
  isArchive: boolean;
  /** True when extractArchives is enabled and isArchive is true — contents will be extracted rather than the archive transferred as-is. */
  wouldExtract: boolean;
  /**
   * True when wouldExtract is true and archiveEntryFilter is non-empty.
   * In this case the reported size is the compressed archive size, not the sum of
   * matching entry sizes — counts and bytes in the dry-run summary are approximate.
   */
  entryFilterApplied: boolean;
  /** True when PGP decryption will be applied to this file. */
  wouldDecrypt: boolean;
  /** True when PGP encryption will be applied before upload. */
  wouldEncrypt: boolean;
  /** The output filename at destination (after PGP extension changes). */
  outputFileName: string;
}

export interface DryRunResult {
  jobId: number;
  jobName: string;
  sourcePath: string;
  destinationPath: string;
  fileFilter: string;
  archiveEntryFilter: string;
  files: DryRunFile[];
  /** All files visible in the source directory (after hidden/move-folder exclusions). */
  totalInSource: number;
  /** Files that match the job's file filter. */
  totalMatched: number;
  /**
   * Number of files (or archives) that would be transferred.
   * When archiveEntryFilter is set this counts each archive as 1 regardless of
   * how many entries it contains — the real number of uploaded files may be lower.
   */
  wouldTransfer: number;
  wouldSkip: number;
  /** Files excluded because they don't match the file filter. */
  skippedByFilter: number;
  /** Files excluded because they already exist at the destination (overwrite disabled, delta sync off). */
  skippedByExists: number;
  /** Files excluded because the destination copy is the same age or newer (delta sync enabled). */
  skippedByDelta: number;
  /**
   * Sum of source-file sizes for files that would be transferred.
   * For archives with entryFilterApplied this is the compressed archive size, not
   * the sum of matching entry sizes — treat as an upper bound.
   */
  totalBytes: number;
}

export async function dryRunJob(jobId: number): Promise<DryRunResult> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new Error(`Job ${jobId} not found`);

  const srcConn = getConnection(job.sourceConnectionId);
  const dstConn = getConnection(job.destinationConnectionId);
  if (!srcConn) throw new Error(`Source connection ${job.sourceConnectionId} not found`);
  if (!dstConn) throw new Error(`Destination connection ${job.destinationConnectionId} not found`);

  const source = createStorageProvider(srcConn);
  await source.connect();

  try {
    // List ALL files (no filter) so non-matching files appear as "filtered" in the preview.
    let allFiles = await source.listFiles(job.sourcePath);

    // Apply the same pre-filter exclusions as runJob (hidden files, move subfolder).
    if (job.skipHiddenFiles) {
      allFiles = allFiles.filter((f) => !f.name.startsWith("."));
    }

    if (job.postTransferAction === "move" && job.movePath) {
      const srcNorm = job.sourcePath.replace(/\/+$/, "") + "/";
      const moveNorm = job.movePath.replace(/\/+$/, "");
      if (moveNorm.startsWith(srcNorm)) {
        const relSegment = moveNorm.slice(srcNorm.length).split("/")[0];
        if (relSegment) {
          allFiles = allFiles.filter((f) => f.name !== relSegment);
        }
      }
    }

    // Apply the job's file filter manually so we can mark non-matching files as "filtered".
    const filterRegex = globToRegex(job.fileFilter);
    const matchingNames = new Set(
      allFiles.filter((f) => filterRegex.test(f.name)).map((f) => f.name)
    );

    // Check destination for existing files when overwrite is disabled or delta sync is on.
    // For delta sync we also need modifiedAt to compare timestamps.
    let existingDestFiles: Set<string> = new Set();
    const destFileTimes: Map<string, Date> = new Map();
    if (!job.overwriteExisting || job.deltaSync) {
      const dest = createStorageProvider(dstConn);
      try {
        await dest.connect();
        const destListing = await dest.listFiles(job.destinationPath);
        existingDestFiles = new Set(destListing.map((f) => f.name));
        if (job.deltaSync) {
          for (const f of destListing) destFileTimes.set(f.name, f.modifiedAt);
        }
        await dest.disconnect();
      } catch {
        // Destination dir may not exist yet — nothing to skip
      }
    }

    const dryRunFiles: DryRunFile[] = allFiles.map((f) => {
      const matchesFilter = matchingNames.has(f.name);
      const wouldDecrypt = !!job.pgpDecrypt && !!job.pgpDecryptKeyId;
      const wouldEncrypt = !!job.pgpEncrypt && !!job.pgpEncryptKeyId;

      // Compute the output filename
      let outName = f.name;
      if (wouldDecrypt) outName = stripPgpExtension(outName);
      if (wouldEncrypt) outName = outName + ".pgp";

      const archiveCheckName = wouldDecrypt ? stripPgpExtension(f.name) : f.name;
      const fileIsArchive = isArchive(archiveCheckName);

      let skipReason: DryRunFile["skipReason"] = null;
      if (!matchesFilter) {
        skipReason = "filter";
      } else if (job.deltaSync && existingDestFiles.has(outName)) {
        const destTime = destFileTimes.get(outName);
        if (destTime && destTime >= f.modifiedAt) {
          skipReason = "delta";
        }
      } else if (!job.overwriteExisting && !job.deltaSync && existingDestFiles.has(outName)) {
        skipReason = "exists";
      }

      const wouldSkip = skipReason !== null;
      const moveDest =
        !wouldSkip && job.postTransferAction === "move" && job.movePath
          ? path.posix.join(job.movePath, f.name)
          : null;

      return {
        name: f.name,
        size: f.size,
        modifiedAt: f.modifiedAt.toISOString(),
        wouldSkip,
        skipReason,
        postAction: job.postTransferAction,
        moveDest,
        isArchive: fileIsArchive,
        wouldExtract: !wouldSkip && job.extractArchives && fileIsArchive,
        entryFilterApplied: !wouldSkip && job.extractArchives && fileIsArchive && !!(job.archiveEntryFilter ?? ""),
        wouldDecrypt: !wouldSkip && wouldDecrypt,
        wouldEncrypt: !wouldSkip && wouldEncrypt,
        outputFileName: outName,
      };
    });

    const skippedByFilter = dryRunFiles.filter((f) => f.skipReason === "filter").length;
    const skippedByExists = dryRunFiles.filter((f) => f.skipReason === "exists").length;
    const skippedByDelta = dryRunFiles.filter((f) => f.skipReason === "delta").length;
    const wouldSkipCount = skippedByFilter + skippedByExists + skippedByDelta;
    const wouldTransfer = dryRunFiles.length - wouldSkipCount;
    const totalBytes = dryRunFiles
      .filter((f) => !f.wouldSkip)
      .reduce((sum, f) => sum + f.size, 0);

    return {
      jobId: job.id,
      jobName: job.name,
      sourcePath: job.sourcePath,
      destinationPath: job.destinationPath,
      fileFilter: job.fileFilter,
      archiveEntryFilter: job.archiveEntryFilter ?? "",
      files: dryRunFiles,
      totalInSource: allFiles.length,
      totalMatched: matchingNames.size,
      wouldTransfer,
      wouldSkip: wouldSkipCount,
      skippedByFilter,
      skippedByExists,
      skippedByDelta,
      totalBytes,
    };
  } finally {
    await source.disconnect();
  }
}

export async function runJob(jobId: number): Promise<void> {
  log.info("Starting job", { jobId });

  // Load job
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) {
    log.error("Job not found in database", { jobId });
    throw new Error(`Job ${jobId} not found`);
  }
  log.info("Job loaded", { jobId, jobName: job.name, status: job.status, schedule: job.schedule });

  // Prevent concurrent runs
  if (job.status === "running") {
    log.info("Job already running — skipping", { jobId });
    return;
  }

  // Remember the pre-run status so a manual run of an inactive job doesn't
  // silently re-enable it when the run completes.
  const previousStatus = job.status;

  // Load connections
  const srcConn = getConnection(job.sourceConnectionId);
  const dstConn = getConnection(job.destinationConnectionId);

  if (!srcConn) {
    throw new Error(`Source connection ${job.sourceConnectionId} not found for job ${jobId}`);
  }
  if (!dstConn) {
    throw new Error(`Destination connection ${job.destinationConnectionId} not found for job ${jobId}`);
  }
  log.info("Connections resolved", {
    jobId,
    src: { name: srcConn.name, protocol: srcConn.protocol, host: srcConn.host, port: srcConn.port, path: job.sourcePath },
    dst: { name: dstConn.name, protocol: dstConn.protocol, host: dstConn.host, port: dstConn.port, path: job.destinationPath },
  });

  // Create job run record
  const [run] = await db
    .insert(jobRuns)
    .values({
      jobId,
      startedAt: new Date().toISOString(),
      status: "running",
      filesTransferred: 0,
      bytesTransferred: 0,
    })
    .returning();

  // From here on, all log lines will automatically include jobId + runId
  return withJobContext(jobId, run.id, async () => {
    log.info("Job run created", { runId: run.id });

    // Mark job as running
    await db
      .update(jobs)
      .set({ status: "running", updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, jobId));

    const source = createStorageProvider(srcConn);
    const dest = createStorageProvider(dstConn);

    try {
      log.info("Connecting to source", { protocol: srcConn.protocol });
      await source.connect();
      log.info("Source connected");

      log.info("Connecting to destination", { protocol: dstConn.protocol });
      await dest.connect();
      log.info("Destination connected");

      // Run pre-job hooks before any files are transferred
      const preHooks = getJobHooksWithDetail(jobId, "pre_job");
      if (preHooks.length > 0) {
        log.info("Running pre-job hooks", { count: preHooks.length });
        await executeHooks(preHooks, { jobId, jobName: job.name, runId: run.id, trigger: "pre_job" }, run.id);
        log.info("Pre-job hooks completed");
      }

      // Load PGP keys if configured
      let pgpEncryptPublicKey: string | undefined;
      let pgpDecryptPrivateKey: string | undefined;
      let pgpDecryptPassphrase: string | undefined;

      if (job.pgpEncrypt && job.pgpEncryptKeyId) {
        const key = getPgpKey(job.pgpEncryptKeyId);
        if (!key) throw new Error(`PGP encrypt key ${job.pgpEncryptKeyId} not found`);
        pgpEncryptPublicKey = key.publicKey;
        log.info("PGP encryption enabled", { keyName: key.name, keyId: key.id });
      }

      if (job.pgpDecrypt && job.pgpDecryptKeyId) {
        const key = getPgpKey(job.pgpDecryptKeyId);
        if (!key) throw new Error(`PGP decrypt key ${job.pgpDecryptKeyId} not found`);
        if (!key.privateKey) throw new Error(`PGP key "${key.name}" has no private key for decryption`);
        pgpDecryptPrivateKey = key.privateKey;
        pgpDecryptPassphrase = key.passphrase ?? undefined;
        log.info("PGP decryption enabled", { keyName: key.name, keyId: key.id });
      }

      log.info("Listing source files", { sourcePath: job.sourcePath, fileFilter: job.fileFilter });
      let files = await source.listFiles(job.sourcePath, job.fileFilter);
      log.info("Source files listed", { fileCount: files.length, fileFilter: job.fileFilter });

      // Filter hidden files (names starting with ".")
      if (job.skipHiddenFiles) {
        const before = files.length;
        files = files.filter((f) => !f.name.startsWith("."));
        if (before !== files.length) {
          log.info("Hidden files skipped", { skipped: before - files.length });
        }
      }

      // Filter out entries that match the move folder when it's a subdirectory
      // of the source path (e.g. source=/data, movePath=/data/processed →
      // skip the "processed" entry that readdir returns as a directory name).
      if (job.postTransferAction === "move" && job.movePath) {
        const srcNorm = job.sourcePath.replace(/\/+$/, "") + "/";
        const moveNorm = job.movePath.replace(/\/+$/, "");
        if (moveNorm.startsWith(srcNorm)) {
          const relSegment = moveNorm.slice(srcNorm.length).split("/")[0];
          if (relSegment) {
            const before = files.length;
            files = files.filter((f) => f.name !== relSegment);
            if (before !== files.length) {
              log.info("Move folder filtered from source listing", { folder: relSegment });
            }
          }
        }
      }

      if (files.length > 0) {
        log.debug("Files to transfer", { files: files.map((f) => ({ name: f.name, size: f.size })) });
      }

      // Update totalFiles + totalBytes so the UI can show progress
      const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
      await db
        .update(jobRuns)
        .set({ totalFiles: files.length, totalBytes })
        .where(eq(jobRuns.id, run.id));

      // Build a set of existing destination file names so we can skip duplicates
      // without downloading first (avoids unnecessary network I/O).
      // For delta sync we also track modifiedAt to compare timestamps.
      let existingDestFiles: Set<string> | null = null;
      const destFileTimes: Map<string, Date> = new Map();
      if (!job.overwriteExisting || job.deltaSync) {
        try {
          const destListing = await dest.listFiles(job.destinationPath);
          existingDestFiles = new Set(destListing.map((f) => f.name));
          if (job.deltaSync) {
            for (const f of destListing) destFileTimes.set(f.name, f.modifiedAt);
          }
          log.info("Destination files listed", { existingCount: existingDestFiles.size });
        } catch {
          // Destination dir may not exist yet — that's fine, nothing to skip
          existingDestFiles = new Set();
        }
      }

      let filesTransferred = 0;
      let bytesTransferred = 0;
      let filesSkipped = 0;
      const sourceFileResults: SourceFileResult[] = [];

      for (const file of files) {
        const srcFilePath = path.posix.join(job.sourcePath, file.name);

        // Compute the output filename based on PGP settings
        let outputFileName = file.name;
        if (pgpDecryptPrivateKey) {
          outputFileName = stripPgpExtension(outputFileName);
        }
        if (pgpEncryptPublicKey) {
          outputFileName = outputFileName + ".pgp";
        }
        const dstFilePath = path.posix.join(job.destinationPath, outputFileName);

        // Update currentFile and clear stale per-file progress from previous file
        await db
          .update(jobRuns)
          .set({ currentFile: file.name, currentFileSize: null, currentFileBytesTransferred: null })
          .where(eq(jobRuns.id, run.id));

        // Delta sync: skip if destination file is the same age or newer than the source.
        // Use outputFileName to check since PGP may change the extension.
        if (job.deltaSync && existingDestFiles?.has(outputFileName)) {
          const destTime = destFileTimes.get(outputFileName);
          if (destTime && destTime >= file.modifiedAt) {
            log.info("Skipping file — destination up to date", {
              fileName: file.name,
              outputFileName,
              srcModified: file.modifiedAt.toISOString(),
              dstModified: destTime.toISOString(),
            });
            filesSkipped++;
            continue;
          }
          log.info("File source is newer — transferring", {
            fileName: file.name,
            srcModified: file.modifiedAt.toISOString(),
            dstModified: destFileTimes.get(outputFileName)?.toISOString() ?? "n/a",
          });
        }

        // Skip files that already exist at destination (when overwrite is off and delta sync is off)
        if (!job.deltaSync && existingDestFiles?.has(outputFileName)) {
          log.info("Skipping file — already exists at destination", { fileName: file.name });
          filesSkipped++;
          continue;
        }

        log.info("Transferring file", { fileName: file.name, fileSize: file.size });

        const maxTransferAttempts = 3;
        let fileHandled = false;
        let directorySkipped = false;
        for (let transferAttempt = 1; transferAttempt <= maxTransferAttempts; transferAttempt++) {
          try {
          // ── Archive path: buffer the stream so we can extract entries ─────────
          // When PGP decrypt is enabled, check if the decrypted name is an archive
          const archiveCheckName = pgpDecryptPrivateKey ? stripPgpExtension(file.name) : file.name;
          if (job.extractArchives && isArchive(archiveCheckName)) {
            const srcStream = await source.downloadFile(srcFilePath);
            let content = await streamToBuffer(srcStream);
            const actualSize = content.length;
            log.info("Archive downloaded", { fileName: file.name, actualSize });

            // Decrypt before extraction if PGP decrypt is enabled
            if (pgpDecryptPrivateKey) {
              log.info("Decrypting archive before extraction", { fileName: file.name });
              content = await pgpDecryptBuffer(content, pgpDecryptPrivateKey, pgpDecryptPassphrase);
              log.info("Archive decrypted", { decryptedSize: content.length });
            }

            const extracted = await extractArchive(archiveCheckName, content);
            if (extracted && extracted.length > 0) {
              log.info("Archive extracted", { archiveName: file.name, entryCount: extracted.length });

              const entryFilterRegex = globToRegex(job.archiveEntryFilter ?? "");

              // ── Phase 1: Prepare entries (filter, encrypt, skip) ───────────────
              interface PreparedEntry {
                entry: ExtractedFile;
                content: Buffer;
                outputName: string;
                dstPath: string;
              }
              const toUpload: PreparedEntry[] = [];

              for (const entry of extracted) {
                if (!entryFilterRegex.test(entry.name)) {
                  log.info("Skipping extracted entry — filtered by archiveEntryFilter", { entryName: entry.name });
                  filesSkipped++;
                  continue;
                }

                let entryContent = entry.content;
                let entryOutputName = entry.name;
                if (pgpEncryptPublicKey) {
                  entryContent = await pgpEncryptBuffer(entry.content, pgpEncryptPublicKey);
                  entryOutputName = entry.name + ".pgp";
                }
                const entryDstPath = path.posix.join(job.destinationPath, entryOutputName);

                if (existingDestFiles?.has(entryOutputName)) {
                  log.info("Skipping extracted entry — already exists", { entryName: entryOutputName });
                  filesSkipped++;
                  continue;
                }

                toUpload.push({ entry, content: entryContent, outputName: entryOutputName, dstPath: entryDstPath });
              }

              // ── Phase 2: Upload entries in batches, then bulk-verify per batch ──
              const ENTRY_UPLOAD_CONCURRENCY = 4;
              const uploadResults: { outputName: string; bytes: number; srcEntry: string; dstPath: string; error?: Error }[] = [];

              for (let i = 0; i < toUpload.length; i += ENTRY_UPLOAD_CONCURRENCY) {
                const batch = toUpload.slice(i, i + ENTRY_UPLOAD_CONCURRENCY);

                // Upload all entries in the batch concurrently
                const batchUploaded = await Promise.all(
                  batch.map(async ({ entry, content: entryContent, outputName: entryOutputName, dstPath: entryDstPath }) => {
                    try {
                      if (job.overwriteExisting) {
                        try { await dest.deleteFile(entryDstPath); } catch { /* doesn't exist */ }
                      }
                      await dest.uploadFile(Readable.from(entryContent), entryDstPath, entryContent.length);
                      return { outputName: entryOutputName, bytes: entryContent.length, srcEntry: entry.name, dstPath: entryDstPath };
                    } catch (entryError) {
                      log.error("Failed to upload extracted entry", { entryName: entryOutputName, error: entryError });
                      return { outputName: entryOutputName, bytes: 0, srcEntry: entry.name, dstPath: entryDstPath, error: entryError instanceof Error ? entryError : new Error(String(entryError)) };
                    }
                  })
                );

                // Bulk-verify all successful uploads in this batch with a single listFiles poll loop
                const successfulUploads = batchUploaded.filter((r) => !r.error);
                const verifyErrors = await verifyDestinationFileSizesBatch(
                  dest,
                  successfulUploads.map((r) => ({ dstFilePath: r.dstPath, expectedSize: r.bytes })),
                  dstConn.protocol,
                );

                for (const result of batchUploaded) {
                  const verifyErr = verifyErrors.get(result.dstPath);
                  if (verifyErr) {
                    log.error("Failed to verify extracted entry", { entryName: result.outputName, error: verifyErr });
                    uploadResults.push({ ...result, bytes: 0, error: verifyErr });
                  } else if (result.error) {
                    uploadResults.push(result);
                  } else {
                    log.info("Extracted entry uploaded and verified", { entryName: result.outputName, dstPath: result.dstPath });
                    uploadResults.push(result);
                  }
                }
              }

              const successResults = uploadResults.filter((r) => !r.error);
              const failedResults = uploadResults.filter((r) => r.error);

              // ── Phase 4: Log results and update counters ──────────────────────
              for (const result of uploadResults) {
                if (!result.error) {
                  await db.insert(transferLogs).values({
                    jobId,
                    jobRunId: run.id,
                    fileName: result.outputName,
                    sourcePath: `${srcFilePath}!${result.srcEntry}`,
                    destinationPath: result.dstPath,
                    fileSize: result.bytes,
                    transferredAt: new Date().toISOString(),
                    status: "success",
                  });
                  filesTransferred++;
                  bytesTransferred += result.bytes;
                } else {
                  await db.insert(transferLogs).values({
                    jobId,
                    jobRunId: run.id,
                    fileName: result.outputName,
                    sourcePath: `${srcFilePath}!${result.srcEntry}`,
                    destinationPath: result.dstPath,
                    fileSize: 0,
                    transferredAt: new Date().toISOString(),
                    status: "failure",
                    errorMessage: result.error.message,
                  });
                }
              }
              if (successResults.length > 0) {
                await db
                  .update(jobRuns)
                  .set({ filesTransferred, bytesTransferred })
                  .where(eq(jobRuns.id, run.id));
              }

              // If any entries failed, throw so the outer retry loop can retry
              if (failedResults.length > 0) {
                const failedNames = failedResults.map((r) => r.outputName).join(", ");
                throw new Error(`Failed to upload/verify ${failedResults.length} archive entries: ${failedNames}`);
              }

              sourceFileResults.push({ srcFilePath, fileName: file.name, transferSuccess: true });

              fileHandled = true;
              break;
            }
            // Archive yielded no entries — upload as-is (fall through using buffered content)
            log.info("Archive yielded no entries — transferring as-is", { fileName: file.name });

            // Apply PGP encryption if enabled
            let uploadContent = content;
            if (pgpEncryptPublicKey) {
              uploadContent = await pgpEncryptBuffer(content, pgpEncryptPublicKey);
            }
            const uploadSize = uploadContent.length;

            if (job.overwriteExisting || job.deltaSync) {
              try {
                await dest.deleteFile(dstFilePath);
                log.debug("Deleted existing destination file", { dstPath: dstFilePath });
              } catch {
                // File doesn't exist yet — that's fine
              }
            }

            await dest.uploadFile(Readable.from(uploadContent), dstFilePath, uploadSize);
            await verifyDestinationFileSize(dest, dstFilePath, uploadSize, dstConn.protocol);
            log.info("File uploaded", { fileName: outputFileName, dstPath: dstFilePath });

            await db.insert(transferLogs).values({
              jobId,
              jobRunId: run.id,
              fileName: outputFileName,
              sourcePath: srcFilePath,
              destinationPath: dstFilePath,
              fileSize: uploadSize,
              transferredAt: new Date().toISOString(),
              status: "success",
            });

            filesTransferred++;
            bytesTransferred += uploadSize;
            await db
              .update(jobRuns)
              .set({ filesTransferred, bytesTransferred })
              .where(eq(jobRuns.id, run.id));

            sourceFileResults.push({ srcFilePath, fileName: file.name, transferSuccess: true });

            fileHandled = true;
            break;
          } else {
            // ── Streaming path: pipe directly from source to destination ─────────
            const fileSize = file.size;
            const hasPgpDecrypt = !!pgpDecryptPrivateKey;
            const hasPgpEncrypt = !!pgpEncryptPublicKey;
            log.info("Streaming file", { fileName: file.name, expectedSize: fileSize, pgpDecrypt: hasPgpDecrypt, pgpEncrypt: hasPgpEncrypt });

            // Record the file size so the UI can show a per-file progress bar.
            // When PGP transforms are active, the actual bytes flowing will differ from
            // the source file size — set currentFileSize to null for indeterminate progress.
            await db
              .update(jobRuns)
              .set({
                currentFileSize: (hasPgpDecrypt || hasPgpEncrypt) ? null : fileSize,
                currentFileBytesTransferred: 0,
              })
              .where(eq(jobRuns.id, run.id));

            // Delete existing destination file BEFORE creating the download stream
            // to avoid a race where data flows through the tracker before the
            // upload consumer attaches.
            if (job.overwriteExisting || job.deltaSync) {
              try {
                await dest.deleteFile(dstFilePath);
                log.debug("Deleted existing destination file", { dstPath: dstFilePath });
              } catch {
                // File doesn't exist yet — that's fine
              }
            }

            let srcStream: Readable = await source.downloadFile(srcFilePath, fileSize);

            // Apply PGP decryption to the stream if configured
            if (pgpDecryptPrivateKey) {
              log.info("Applying PGP decryption to stream", { fileName: file.name });
              srcStream = await pgpDecryptStream(srcStream, pgpDecryptPrivateKey, pgpDecryptPassphrase);
            }

            // Transform counts bytes inside _transform — stays paused until the
            // consumer (uploadFile) starts pulling, so no data is lost.
            // Tracker is placed between decrypt and encrypt so it counts plaintext bytes.
            let currentBytes = 0;
            const tracker = new Transform({
              transform(chunk, _encoding, callback) {
                currentBytes += chunk.length;
                callback(null, chunk);
              },
            });
            srcStream.pipe(tracker);
            // Propagate errors bidirectionally
            srcStream.on("error", (err) => tracker.destroy(err));
            tracker.on("error", () => { if (!srcStream.destroyed) srcStream.destroy(); });

            // Apply PGP encryption to the stream if configured
            let uploadStream: Readable = tracker;
            let uploadSizeHint: number | undefined = fileSize;
            if (pgpEncryptPublicKey) {
              log.info("Applying PGP encryption to stream", { fileName: file.name });
              uploadStream = await pgpEncryptStream(tracker, pgpEncryptPublicKey);
              uploadSizeHint = undefined; // Encrypted size unknown
            }
            if (hasPgpDecrypt && !hasPgpEncrypt) {
              // Decrypted size is unknown too
              uploadSizeHint = undefined;
            }

            // Flush byte count to DB every 500 ms — throttled to avoid DB overload
            const progressInterval = setInterval(() => {
              db.update(jobRuns)
                .set({ currentFileBytesTransferred: currentBytes })
                .where(eq(jobRuns.id, run.id))
                .catch(() => {});
            }, 500);

            try {
              await dest.uploadFile(uploadStream, dstFilePath, uploadSizeHint);
            } finally {
              clearInterval(progressInterval);
              // Write final byte count (interval may not have fired for the last chunk)
              await db
                .update(jobRuns)
                .set({ currentFileBytesTransferred: currentBytes })
                .where(eq(jobRuns.id, run.id));
            }

            // When PGP transforms are active, skip the byte mismatch check since
            // encryption/decryption changes the byte count. PGP itself provides
            // integrity verification.
            if (!hasPgpDecrypt && !hasPgpEncrypt) {
              if (currentBytes !== fileSize) {
                throw new Error(`Stream byte mismatch for ${file.name}: expected ${fileSize}, transferred ${currentBytes}`);
              }
              await verifyDestinationFileSize(dest, dstFilePath, fileSize, dstConn.protocol);
            }
            log.info("File uploaded", { fileName: outputFileName, dstPath: dstFilePath, plaintextBytes: currentBytes });

            // Log success
            await db.insert(transferLogs).values({
              jobId,
              jobRunId: run.id,
              fileName: outputFileName,
              sourcePath: srcFilePath,
              destinationPath: dstFilePath,
              fileSize: currentBytes,
              transferredAt: new Date().toISOString(),
              status: "success",
            });

            filesTransferred++;
            bytesTransferred += currentBytes;
            await db
              .update(jobRuns)
              .set({ filesTransferred, bytesTransferred })
              .where(eq(jobRuns.id, run.id));

            sourceFileResults.push({ srcFilePath, fileName: file.name, transferSuccess: true });

            fileHandled = true;
            break;
          }
          } catch (fileError) {
          // Skip directories that slipped through the listing filter
          if (isDirectoryError(fileError)) {
            log.info("Skipping directory entry", { fileName: file.name });
            filesSkipped++;
            directorySkipped = true;
            break;
          }

          log.warn("Transfer attempt failed", {
            fileName: file.name,
            attempt: transferAttempt,
            maxAttempts: maxTransferAttempts,
            error: fileError,
          });

          try {
            await dest.deleteFile(dstFilePath);
            log.warn("Deleted destination file after failed transfer", { fileName: file.name, dstPath: dstFilePath });
          } catch {
            // Best effort cleanup only
          }

          if (transferAttempt >= maxTransferAttempts) {
            log.error("Failed to transfer file", { fileName: file.name, error: fileError });
            await db.insert(transferLogs).values({
              jobId,
              jobRunId: run.id,
              fileName: file.name,
              sourcePath: srcFilePath,
              destinationPath: dstFilePath,
              fileSize: 0,
              transferredAt: new Date().toISOString(),
              status: "failure",
              errorMessage:
                fileError instanceof Error ? fileError.message : "Unknown error",
            });
            sourceFileResults.push({ srcFilePath, fileName: file.name, transferSuccess: false });
          }
          }
        }

        if (directorySkipped) {
          continue;
        }

        if (!fileHandled) {
          continue;
        }
      }

      // ── Deferred post-transfer actions ──────────────────────────────────
      if (job.postTransferAction === "delete" || job.postTransferAction === "move") {
        const successfulFiles = sourceFileResults.filter((r) => r.transferSuccess);
        const failedFiles = sourceFileResults.filter((r) => !r.transferSuccess);

        if (failedFiles.length > 0) {
          log.warn("Retaining source files due to transfer failures", {
            retainedCount: failedFiles.length,
            retainedFiles: failedFiles.map((f) => f.fileName),
          });
        }

        if (successfulFiles.length > 0) {
          log.info("Executing deferred post-transfer actions", {
            action: job.postTransferAction,
            fileCount: successfulFiles.length,
          });
        }

        const postTransferErrors: { fileName: string; error: unknown }[] = [];
        for (const result of successfulFiles) {
          try {
            if (job.postTransferAction === "delete") {
              log.info("Deleting source file", { srcPath: result.srcFilePath });
              await deleteSourceAndConfirm(source, result.srcFilePath);
            } else if (job.postTransferAction === "move" && job.movePath) {
              const moveDest = path.posix.join(job.movePath, result.fileName);
              log.info("Moving source file", { srcPath: result.srcFilePath, dstPath: moveDest });
              await source.moveFile(result.srcFilePath, moveDest);
            }
          } catch (postErr) {
            log.error("Post-transfer action failed", { fileName: result.fileName, error: postErr });
            postTransferErrors.push({ fileName: result.fileName, error: postErr });
          }
        }

        if (postTransferErrors.length > 0) {
          const failedNames = postTransferErrors.map((e) => e.fileName).join(", ");
          throw new Error(`Post-transfer action failed for ${postTransferErrors.length} file(s): ${failedNames}`);
        }
      }

      // Run post-job hooks after all files are transferred
      const postHooks = getJobHooksWithDetail(jobId, "post_job");
      if (postHooks.length > 0) {
        log.info("Running post-job hooks", { count: postHooks.length });
        await executeHooks(postHooks, {
          jobId, jobName: job.name, runId: run.id, trigger: "post_job",
          status: "success", filesTransferred, bytesTransferred,
        }, run.id);
        log.info("Post-job hooks completed");
      }

      log.info("Disconnecting");
      await source.disconnect();
      await dest.disconnect();

      // Complete the job run
      await db
        .update(jobRuns)
        .set({
          completedAt: new Date().toISOString(),
          status: "success",
          filesTransferred,
          bytesTransferred,
          currentFile: null,
          currentFileSize: null,
          currentFileBytesTransferred: null,
        })
        .where(eq(jobRuns.id, run.id));

      await db
        .update(jobs)
        .set({
          status: previousStatus === "inactive" ? "inactive" : "active",
          lastRunAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(jobs.id, jobId));

      log.info("Job completed", { filesTransferred, filesSkipped, bytesTransferred });
    } catch (error) {
      log.error("Job failed", { error });

      try {
        await source.disconnect();
        await dest.disconnect();
      } catch {}

      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Run post-job hooks even on failure (best-effort — failures are logged, not re-thrown)
      const postHooksOnError = getJobHooksWithDetail(jobId, "post_job");
      if (postHooksOnError.length > 0) {
        log.info("Running post-job hooks (failure path)", { count: postHooksOnError.length });
        try {
          await executeHooks(postHooksOnError, {
            jobId, jobName: job.name, runId: run.id, trigger: "post_job",
            status: "failure", errorMessage,
          }, run.id);
        } catch {
          // Already logged inside executeHooks — don't mask the original error
        }
      }

      await db
        .update(jobRuns)
        .set({
          completedAt: new Date().toISOString(),
          status: "failure",
          errorMessage,
          currentFile: null,
          currentFileSize: null,
          currentFileBytesTransferred: null,
        })
        .where(eq(jobRuns.id, run.id));

      await db
        .update(jobs)
        .set({
          status: previousStatus === "inactive" ? "inactive" : "error",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(jobs.id, jobId));

      throw error;
    }
  });
}
