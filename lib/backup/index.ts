import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import cron from "node-cron";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "data", "filebridge.db");

const BACKUP_SETTINGS_KEY = "backup";
const BACKUP_FILENAME_PREFIX = "filebridge-";

export interface BackupConfig {
  enabled: boolean;
  schedule: string;
  localPath: string;
  retentionCount: number;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  enabled: false,
  schedule: "0 2 * * *",
  localPath: path.join(process.cwd(), "data", "backups"),
  retentionCount: 7,
};

export interface BackupResult {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
  integrity: "ok" | "failed";
}

export interface BackupEntry {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

let backupTask: cron.ScheduledTask | null = null;

export async function getBackupConfig(): Promise<BackupConfig> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, BACKUP_SETTINGS_KEY),
  });
  if (!row || !row.value) return { ...DEFAULT_BACKUP_CONFIG };
  return { ...DEFAULT_BACKUP_CONFIG, ...(row.value as Partial<BackupConfig>) };
}

export async function saveBackupConfig(config: BackupConfig): Promise<void> {
  await db
    .insert(settings)
    .values({ key: BACKUP_SETTINGS_KEY, value: config as unknown as Record<string, unknown> })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: config as unknown as Record<string, unknown> },
    });
}

export async function runBackup(config?: BackupConfig): Promise<BackupResult> {
  const cfg = config ?? (await getBackupConfig());

  fs.mkdirSync(cfg.localPath, { recursive: true });

  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const filename = `${BACKUP_FILENAME_PREFIX}${timestamp}.db`;
  const destPath = path.join(cfg.localPath, filename);

  // Use better-sqlite3's online backup API for a consistent snapshot
  const source = new Database(DB_PATH, { readonly: true });
  try {
    await source.backup(destPath);
  } finally {
    source.close();
  }

  // Verify integrity of the backup
  let integrity: "ok" | "failed" = "failed";
  const verify = new Database(destPath, { readonly: true });
  try {
    const result = verify.pragma("integrity_check") as Array<{
      integrity_check: string;
    }>;
    if (result[0]?.integrity_check === "ok") {
      integrity = "ok";
    }
  } finally {
    verify.close();
  }

  if (integrity === "failed") {
    fs.unlinkSync(destPath);
    throw new Error("Backup integrity check failed — backup file removed");
  }

  // Prune old backups beyond the retention count
  pruneBackups(cfg.localPath, cfg.retentionCount);

  const sizeBytes = fs.statSync(destPath).size;
  return {
    filename,
    path: destPath,
    sizeBytes,
    createdAt: now.toISOString(),
    integrity,
  };
}

export function listBackups(localPath: string): BackupEntry[] {
  if (!fs.existsSync(localPath)) return [];
  return fs
    .readdirSync(localPath)
    .filter(
      (f) => f.startsWith(BACKUP_FILENAME_PREFIX) && f.endsWith(".db")
    )
    .sort()
    .reverse()
    .map((filename) => {
      const fullPath = path.join(localPath, filename);
      const stat = fs.statSync(fullPath);
      // Parse timestamp from filename: filebridge-2026-02-22T02-00-00-000Z.db
      const ts = filename
        .replace(BACKUP_FILENAME_PREFIX, "")
        .replace(".db", "")
        .replace(
          /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
          "$1:$2:$3.$4Z"
        );
      return {
        filename,
        path: fullPath,
        sizeBytes: stat.size,
        createdAt: ts || stat.birthtime.toISOString(),
      };
    });
}

function pruneBackups(localPath: string, retentionCount: number): void {
  if (!fs.existsSync(localPath)) return;
  const files = fs
    .readdirSync(localPath)
    .filter((f) => f.startsWith(BACKUP_FILENAME_PREFIX) && f.endsWith(".db"))
    .sort(); // oldest first (lexicographic sort works with ISO timestamps)

  while (files.length > retentionCount) {
    const oldest = files.shift()!;
    try {
      fs.unlinkSync(path.join(localPath, oldest));
      console.log(`[Backup] Pruned old backup: ${oldest}`);
    } catch (err) {
      console.error(`[Backup] Failed to prune ${oldest}:`, err);
    }
  }
}

export async function initializeBackupScheduler(): Promise<void> {
  const config = await getBackupConfig();

  if (backupTask) {
    backupTask.stop();
    backupTask = null;
  }

  if (!config.enabled) {
    console.log("[Backup] Scheduled backups disabled — skipping");
    return;
  }

  if (!cron.validate(config.schedule)) {
    console.error(
      `[Backup] Invalid cron expression: "${config.schedule}" — backups not scheduled`
    );
    return;
  }

  backupTask = cron.schedule(config.schedule, async () => {
    console.log("[Backup] Starting scheduled backup...");
    try {
      const result = await runBackup(config);
      console.log(
        `[Backup] Completed: ${result.filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`
      );
    } catch (err) {
      console.error("[Backup] Scheduled backup failed:", err);
    }
  });

  console.log(`[Backup] Scheduled: "${config.schedule}"`);
}

export function stopBackupScheduler(): void {
  if (backupTask) {
    backupTask.stop();
    backupTask = null;
    console.log("[Backup] Scheduler stopped");
  }
}
