import { db } from "@/lib/db";
import { jobs, jobRuns, transferLogs, connections } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createStorageProvider } from "@/lib/storage/registry";
import { globToRegex } from "@/lib/storage/interface";
import path from "path";
import { gunzipSync } from "zlib";
import AdmZip from "adm-zip";
import * as tar from "tar-stream";

interface ExtractedFile {
  name: string;
  content: Buffer;
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
    return Promise.resolve(extractZip(content));
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return extractTar(gunzipSync(content));
  }
  if (lower.endsWith(".tar")) {
    return extractTar(content);
  }
  return Promise.resolve(null);
}

function extractZip(content: Buffer): ExtractedFile[] {
  const zip = new AdmZip(content);
  const entries: ExtractedFile[] = [];
  for (const entry of zip.getEntries()) {
    // Skip directories
    if (entry.isDirectory) continue;
    const data = entry.getData();
    // Use only the base filename (flatten nested paths)
    const name = path.posix.basename(entry.entryName);
    if (name) entries.push({ name, content: data });
  }
  return entries;
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
}

export interface DryRunResult {
  jobId: number;
  jobName: string;
  sourcePath: string;
  destinationPath: string;
  fileFilter: string;
  files: DryRunFile[];
  /** All files visible in the source directory (after hidden/move-folder exclusions). */
  totalInSource: number;
  /** Files that match the job's file filter. */
  totalMatched: number;
  wouldTransfer: number;
  wouldSkip: number;
  /** Files excluded because they don't match the file filter. */
  skippedByFilter: number;
  /** Files excluded because they already exist at the destination (overwrite disabled, delta sync off). */
  skippedByExists: number;
  /** Files excluded because the destination copy is the same age or newer (delta sync enabled). */
  skippedByDelta: number;
  totalBytes: number;
}

export async function dryRunJob(jobId: number): Promise<DryRunResult> {
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) throw new Error(`Job ${jobId} not found`);

  const srcConn = await db.query.connections.findFirst({
    where: eq(connections.id, job.sourceConnectionId),
  });
  const dstConn = await db.query.connections.findFirst({
    where: eq(connections.id, job.destinationConnectionId),
  });
  if (!srcConn) throw new Error(`Source connection ${job.sourceConnectionId} not found`);
  if (!dstConn) throw new Error(`Destination connection ${job.destinationConnectionId} not found`);

  const source = createStorageProvider(srcConn as Parameters<typeof createStorageProvider>[0]);
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
    let destFileTimes: Map<string, Date> = new Map();
    if (!job.overwriteExisting || job.deltaSync) {
      const dest = createStorageProvider(dstConn as Parameters<typeof createStorageProvider>[0]);
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
      const fileIsArchive = isArchive(f.name);

      let skipReason: DryRunFile["skipReason"] = null;
      if (!matchesFilter) {
        skipReason = "filter";
      } else if (job.deltaSync && existingDestFiles.has(f.name)) {
        // Delta sync: skip if destination is same age or newer than source.
        const destTime = destFileTimes.get(f.name);
        if (destTime && destTime >= f.modifiedAt) {
          skipReason = "delta";
        }
        // If source is newer, fall through → will transfer (skipReason stays null).
      } else if (!job.overwriteExisting && !job.deltaSync && existingDestFiles.has(f.name)) {
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
  console.log(`[Engine] ▶ Starting job ${jobId}`);

  // Load job
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) {
    console.error(`[Engine] Job ${jobId} not found in database`);
    throw new Error(`Job ${jobId} not found`);
  }
  console.log(`[Engine] Job ${jobId} "${job.name}" — status: ${job.status}, schedule: ${job.schedule}`);

  // Prevent concurrent runs
  if (job.status === "running") {
    console.log(`[Engine] Job ${jobId} is already running — skipping`);
    return;
  }

  // Load connections
  const srcConn = await db.query.connections.findFirst({
    where: eq(connections.id, job.sourceConnectionId),
  });
  const dstConn = await db.query.connections.findFirst({
    where: eq(connections.id, job.destinationConnectionId),
  });

  if (!srcConn) {
    throw new Error(`Source connection ${job.sourceConnectionId} not found for job ${jobId}`);
  }
  if (!dstConn) {
    throw new Error(`Destination connection ${job.destinationConnectionId} not found for job ${jobId}`);
  }
  console.log(`[Engine] Job ${jobId}: src="${srcConn.name}" (${srcConn.protocol}://${srcConn.host}:${srcConn.port}${job.sourcePath}) → dst="${dstConn.name}" (${dstConn.protocol}://${dstConn.host}:${dstConn.port}${job.destinationPath})`);

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
  console.log(`[Engine] Job ${jobId}: created run #${run.id}`);

  // Mark job as running
  await db
    .update(jobs)
    .set({ status: "running", updatedAt: new Date().toISOString() })
    .where(eq(jobs.id, jobId));

  const source = createStorageProvider(srcConn as Parameters<typeof createStorageProvider>[0]);
  const dest = createStorageProvider(dstConn as Parameters<typeof createStorageProvider>[0]);

  try {
    console.log(`[Engine] Job ${jobId}: connecting to source (${srcConn.protocol})...`);
    await source.connect();
    console.log(`[Engine] Job ${jobId}: source connected`);

    console.log(`[Engine] Job ${jobId}: connecting to destination (${dstConn.protocol})...`);
    await dest.connect();
    console.log(`[Engine] Job ${jobId}: destination connected`);

    console.log(`[Engine] Job ${jobId}: listing files at "${job.sourcePath}" with filter "${job.fileFilter}"...`);
    let files = await source.listFiles(job.sourcePath, job.fileFilter);
    console.log(`[Engine] Job ${jobId}: found ${files.length} file(s) matching "${job.fileFilter}"`);

    // Filter hidden files (names starting with ".")
    if (job.skipHiddenFiles) {
      const before = files.length;
      files = files.filter((f) => !f.name.startsWith("."));
      if (before !== files.length) {
        console.log(`[Engine] Job ${jobId}: skipped ${before - files.length} hidden file(s)`);
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
            console.log(`[Engine] Job ${jobId}: filtered out move folder "${relSegment}" from source listing`);
          }
        }
      }
    }

    if (files.length > 0) {
      console.log(`[Engine] Job ${jobId}: files to transfer:`, files.map((f) => `${f.name} (${f.size}B)`).join(", "));
    }

    // Update totalFiles on the run so the UI can show progress
    await db
      .update(jobRuns)
      .set({ totalFiles: files.length })
      .where(eq(jobRuns.id, run.id));

    // Build a set of existing destination file names so we can skip duplicates
    // without downloading first (avoids unnecessary network I/O).
    // For delta sync we also track modifiedAt to compare timestamps.
    let existingDestFiles: Set<string> | null = null;
    let destFileTimes: Map<string, Date> = new Map();
    if (!job.overwriteExisting || job.deltaSync) {
      try {
        const destListing = await dest.listFiles(job.destinationPath);
        existingDestFiles = new Set(destListing.map((f) => f.name));
        if (job.deltaSync) {
          for (const f of destListing) destFileTimes.set(f.name, f.modifiedAt);
        }
        console.log(`[Engine] Job ${jobId}: ${existingDestFiles.size} file(s) already at destination`);
      } catch {
        // Destination dir may not exist yet — that's fine, nothing to skip
        existingDestFiles = new Set();
      }
    }

    let filesTransferred = 0;
    let bytesTransferred = 0;
    let filesSkipped = 0;

    for (const file of files) {
      const srcFilePath = path.posix.join(job.sourcePath, file.name);
      const dstFilePath = path.posix.join(job.destinationPath, file.name);

      // Update currentFile so the UI shows what's being processed
      await db
        .update(jobRuns)
        .set({ currentFile: file.name })
        .where(eq(jobRuns.id, run.id));

      // Delta sync: skip if destination file is the same age or newer than the source.
      if (job.deltaSync && existingDestFiles?.has(file.name)) {
        const destTime = destFileTimes.get(file.name);
        if (destTime && destTime >= file.modifiedAt) {
          console.log(`[Engine] Job ${jobId}: skipping "${file.name}" — destination is up to date (src: ${file.modifiedAt.toISOString()}, dst: ${destTime.toISOString()})`);
          filesSkipped++;
          continue;
        }
        console.log(`[Engine] Job ${jobId}: "${file.name}" — source is newer, transferring (src: ${file.modifiedAt.toISOString()}, dst: ${destFileTimes.get(file.name)?.toISOString() ?? "n/a"})`);
      }

      // Skip files that already exist at destination (when overwrite is off and delta sync is off)
      if (!job.deltaSync && existingDestFiles?.has(file.name)) {
        console.log(`[Engine] Job ${jobId}: skipping "${file.name}" — already exists at destination`);
        filesSkipped++;
        continue;
      }

      console.log(`[Engine] Job ${jobId}: transferring "${file.name}" (${file.size}B)...`);

      try {
        const content = await source.downloadFile(srcFilePath);
        const actualSize = content.length;
        console.log(`[Engine] Job ${jobId}: downloaded "${file.name}" (${actualSize}B)`);

        // Archive extraction: if enabled and file is an archive, extract and upload individual files
        if (job.extractArchives && isArchive(file.name)) {
          const extracted = await extractArchive(file.name, content);
          if (extracted && extracted.length > 0) {
            console.log(`[Engine] Job ${jobId}: extracted ${extracted.length} file(s) from "${file.name}"`);

            for (const entry of extracted) {
              const entryDstPath = path.posix.join(job.destinationPath, entry.name);

              // Skip existing files at destination (when overwrite is off)
              if (existingDestFiles?.has(entry.name)) {
                console.log(`[Engine] Job ${jobId}: skipping extracted "${entry.name}" — already exists at destination`);
                filesSkipped++;
                continue;
              }

              try {
                // If overwrite is enabled, delete existing destination file first
                if (job.overwriteExisting) {
                  try {
                    await dest.deleteFile(entryDstPath);
                  } catch {
                    // File doesn't exist yet — that's fine
                  }
                }

                await dest.uploadFile(entry.content, entryDstPath);
                console.log(`[Engine] Job ${jobId}: uploaded extracted "${entry.name}" → "${entryDstPath}"`);

                await db.insert(transferLogs).values({
                  jobId,
                  jobRunId: run.id,
                  fileName: entry.name,
                  sourcePath: `${srcFilePath}!${entry.name}`,
                  destinationPath: entryDstPath,
                  fileSize: entry.content.length,
                  transferredAt: new Date().toISOString(),
                  status: "success",
                });

                filesTransferred++;
                bytesTransferred += entry.content.length;
                await db
                  .update(jobRuns)
                  .set({ filesTransferred, bytesTransferred })
                  .where(eq(jobRuns.id, run.id));
              } catch (entryError) {
                console.error(`[Engine] Job ${jobId}: FAILED to upload extracted "${entry.name}":`, entryError);
                await db.insert(transferLogs).values({
                  jobId,
                  jobRunId: run.id,
                  fileName: entry.name,
                  sourcePath: `${srcFilePath}!${entry.name}`,
                  destinationPath: entryDstPath,
                  fileSize: 0,
                  transferredAt: new Date().toISOString(),
                  status: "failure",
                  errorMessage: entryError instanceof Error ? entryError.message : "Unknown error",
                });
              }
            }

            // Post-transfer action applies to the original archive
            try {
              if (job.postTransferAction === "delete") {
                console.log(`[Engine] Job ${jobId}: deleting source archive "${srcFilePath}"`);
                await source.deleteFile(srcFilePath);
              } else if (job.postTransferAction === "move" && job.movePath) {
                const moveDest = path.posix.join(job.movePath, file.name);
                console.log(`[Engine] Job ${jobId}: moving source archive "${srcFilePath}" → "${moveDest}"`);
                await source.moveFile(srcFilePath, moveDest);
              }
            } catch (postErr) {
              console.error(`[Engine] Job ${jobId}: post-transfer action failed for archive "${file.name}":`, postErr);
            }

            continue; // Skip normal upload — we already handled this file
          }
          // If extraction returned null or empty, fall through to normal transfer
          console.log(`[Engine] Job ${jobId}: "${file.name}" matched archive extension but extraction yielded no files, transferring as-is`);
        }

        // Normal transfer (non-archive or extraction not enabled)
        console.log(`[Engine] Job ${jobId}: uploading "${file.name}"...`);

        // Delete existing destination file first when overwrite is enabled, or when
        // delta sync is replacing a file that passed the timestamp check (source is newer).
        // SMB writeFile fails with STATUS_OBJECT_NAME_COLLISION on existing files.
        if (job.overwriteExisting || job.deltaSync) {
          try {
            await dest.deleteFile(dstFilePath);
            console.log(`[Engine] Job ${jobId}: deleted existing "${dstFilePath}" (overwrite enabled)`);
          } catch {
            // File doesn't exist yet — that's fine
          }
        }

        await dest.uploadFile(content, dstFilePath);
        console.log(`[Engine] Job ${jobId}: uploaded "${file.name}" → "${dstFilePath}"`);

        // Log success
        await db.insert(transferLogs).values({
          jobId,
          jobRunId: run.id,
          fileName: file.name,
          sourcePath: srcFilePath,
          destinationPath: dstFilePath,
          fileSize: actualSize,
          transferredAt: new Date().toISOString(),
          status: "success",
        });

        // Post-transfer action
        try {
          if (job.postTransferAction === "delete") {
            console.log(`[Engine] Job ${jobId}: deleting source "${srcFilePath}"`);
            await source.deleteFile(srcFilePath);
          } else if (job.postTransferAction === "move" && job.movePath) {
            const moveDest = path.posix.join(job.movePath, file.name);
            console.log(`[Engine] Job ${jobId}: moving source "${srcFilePath}" → "${moveDest}"`);
            await source.moveFile(srcFilePath, moveDest);
          }
        } catch (postErr) {
          console.error(`[Engine] Job ${jobId}: post-transfer action failed for "${file.name}":`, postErr);
        }

        filesTransferred++;
        bytesTransferred += actualSize;
        await db
          .update(jobRuns)
          .set({ filesTransferred, bytesTransferred })
          .where(eq(jobRuns.id, run.id));
      } catch (fileError) {
        // Skip directories that slipped through the listing filter
        if (isDirectoryError(fileError)) {
          console.log(`[Engine] Job ${jobId}: skipping "${file.name}" — is a directory, not a file`);
          filesSkipped++;
          continue;
        }
        console.error(`[Engine] Job ${jobId}: FAILED to transfer "${file.name}":`, fileError);
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
      }
    }

    console.log(`[Engine] Job ${jobId}: disconnecting...`);
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
      })
      .where(eq(jobRuns.id, run.id));

    await db
      .update(jobs)
      .set({
        status: "active",
        lastRunAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(jobs.id, jobId));

    console.log(
      `[Engine] ✓ Job ${jobId} completed: ${filesTransferred} transferred, ${filesSkipped} skipped, ${bytesTransferred} bytes`
    );
  } catch (error) {
    console.error(`[Engine] ✗ Job ${jobId} FAILED:`, error);

    try {
      await source.disconnect();
      await dest.disconnect();
    } catch {}

    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await db
      .update(jobRuns)
      .set({
        completedAt: new Date().toISOString(),
        status: "failure",
        errorMessage,
        currentFile: null,
      })
      .where(eq(jobRuns.id, run.id));

    await db
      .update(jobs)
      .set({ status: "error", updatedAt: new Date().toISOString() })
      .where(eq(jobs.id, jobId));

    throw error;
  }
}
