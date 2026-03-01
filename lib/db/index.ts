import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";
import { encrypt, decrypt } from "../crypto";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "data", "filebridge.db");

// During `next build`, Next.js statically analyses every API route by
// importing its module in parallel worker processes. Each worker would open
// the same SQLite file concurrently, causing SQLITE_BUSY errors. Use an
// in-memory database as a harmless stand-in — it is never actually queried
// during the build phase itself.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

if (!isBuildPhase) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const sqlite = new Database(isBuildPhase ? ":memory:" : DB_PATH);

// Performance and reliability pragmas
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("synchronous = NORMAL");

// Initialize schema on first run
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK(protocol IN ('sftp', 'smb', 'azure-blob', 'local')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    credentials TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_connection_id INTEGER NOT NULL REFERENCES connections(id),
    source_path TEXT NOT NULL,
    destination_connection_id INTEGER NOT NULL REFERENCES connections(id),
    destination_path TEXT NOT NULL,
    file_filter TEXT NOT NULL DEFAULT '*',
    schedule TEXT NOT NULL,
    post_transfer_action TEXT NOT NULL DEFAULT 'retain' CHECK(post_transfer_action IN ('retain', 'delete', 'move')),
    move_path TEXT,
    overwrite_existing INTEGER NOT NULL DEFAULT 0,
    skip_hidden_files INTEGER NOT NULL DEFAULT 1,
    extract_archives INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'running', 'error')),
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'running')),
    error_message TEXT,
    files_transferred INTEGER NOT NULL DEFAULT 0,
    bytes_transferred INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transfer_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    job_run_id INTEGER NOT NULL REFERENCES job_runs(id),
    file_name TEXT NOT NULL,
    source_path TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    transferred_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
    is_local INTEGER NOT NULL DEFAULT 1,
    sso_provider TEXT,
    sso_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'execute', 'login', 'logout', 'settings_change')),
    resource TEXT NOT NULL CHECK(resource IN ('connection', 'job', 'settings', 'job_run', 'auth', 'user')),
    resource_id INTEGER,
    resource_name TEXT,
    ip_address TEXT,
    details TEXT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS hooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK(type IN ('webhook', 'shell')),
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS job_hooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    hook_id INTEGER NOT NULL REFERENCES hooks(id) ON DELETE CASCADE,
    trigger TEXT NOT NULL CHECK(trigger IN ('pre_job', 'post_job')),
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS hook_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    job_run_id INTEGER NOT NULL REFERENCES job_runs(id),
    hook_id INTEGER,
    hook_name TEXT NOT NULL,
    hook_type TEXT NOT NULL,
    trigger TEXT NOT NULL CHECK(trigger IN ('pre_job', 'post_job')),
    status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
    duration_ms INTEGER,
    output TEXT,
    error_message TEXT,
    executed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Performance indexes
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id);
  CREATE INDEX IF NOT EXISTS idx_transfer_logs_job_id ON transfer_logs(job_id);
  CREATE INDEX IF NOT EXISTS idx_transfer_logs_status ON transfer_logs(status);
  CREATE INDEX IF NOT EXISTS idx_transfer_logs_transferred_at ON transfer_logs(transferred_at);
  CREATE INDEX IF NOT EXISTS idx_transfer_logs_job_run_id_status ON transfer_logs(job_run_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_sso ON users(sso_provider, sso_id);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
  CREATE INDEX IF NOT EXISTS idx_job_hooks_job_id ON job_hooks(job_id);
  CREATE INDEX IF NOT EXISTS idx_hook_runs_job_run_id ON hook_runs(job_run_id);
`);

// Lightweight migrations for columns added after initial release.
// ALTER TABLE … ADD COLUMN is a no-op if the column already exists in SQLite,
// but the statement itself will throw — so we catch and ignore.
const migrations = [
  `ALTER TABLE jobs ADD COLUMN overwrite_existing INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE jobs ADD COLUMN skip_hidden_files INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE jobs ADD COLUMN extract_archives INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE job_runs ADD COLUMN total_files INTEGER`,
  `ALTER TABLE job_runs ADD COLUMN current_file TEXT`,
  `ALTER TABLE jobs ADD COLUMN delta_sync INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE job_runs ADD COLUMN total_bytes INTEGER`,
  `ALTER TABLE job_runs ADD COLUMN current_file_size INTEGER`,
  `ALTER TABLE job_runs ADD COLUMN current_file_bytes_transferred INTEGER`,
];

for (const sql of migrations) {
  try {
    sqlite.exec(sql);
  } catch {
    // Column already exists — safe to ignore
  }
}

// Migrate: update audit_logs CHECK constraints for new action/resource values.
const auditDef = sqlite
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'")
  .get() as { sql: string } | undefined;
if (auditDef && !auditDef.sql.includes("'user'")) {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE audit_logs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'execute', 'login', 'logout', 'settings_change')),
      resource TEXT NOT NULL CHECK(resource IN ('connection', 'job', 'settings', 'job_run', 'auth', 'user')),
      resource_id INTEGER,
      resource_name TEXT,
      ip_address TEXT,
      details TEXT,
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO audit_logs_new SELECT * FROM audit_logs;
    DROP TABLE audit_logs;
    ALTER TABLE audit_logs_new RENAME TO audit_logs;
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource);
  `);
  sqlite.pragma("foreign_keys = ON");
}

// Migrate: update protocol CHECK constraint to include 'azure-blob'.
// SQLite doesn't support ALTER COLUMN, so we must recreate the connections table.
// The check against sqlite_master ensures this only runs once on existing databases.
const connDef = sqlite
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='connections'")
  .get() as { sql: string } | undefined;
if (connDef && !connDef.sql.includes("'azure-blob'")) {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE connections_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol IN ('sftp', 'smb', 'azure-blob', 'local')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      credentials TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO connections_new SELECT * FROM connections;
    DROP TABLE connections;
    ALTER TABLE connections_new RENAME TO connections;
  `);
  sqlite.pragma("foreign_keys = ON");
}

// Migrate: update protocol CHECK constraint to include 'local'.
const connDef2 = sqlite
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='connections'")
  .get() as { sql: string } | undefined;
if (connDef2 && !connDef2.sql.includes("'local'")) {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE connections_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol IN ('sftp', 'smb', 'azure-blob', 'local')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      credentials TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO connections_new SELECT * FROM connections;
    DROP TABLE connections;
    ALTER TABLE connections_new RENAME TO connections;
  `);
  sqlite.pragma("foreign_keys = ON");
}

// One-time cleanup: remove spurious transfer log entries created when
// directories (e.g. move folders) were accidentally listed as files.
sqlite.exec(
  `DELETE FROM transfer_logs WHERE file_size = 0 AND file_name NOT LIKE '%.%'`
);

// Migrate: encrypt any plaintext JSON credentials that pre-date field-level encryption.
// Plain JSON starts with '{'; our encrypted format is base64:base64:base64.
// This runs once per startup — already-encrypted rows are skipped.
if (!isBuildPhase) {
  try {
    const credRows = sqlite
      .prepare("SELECT id, credentials FROM connections")
      .all() as Array<{ id: number; credentials: string }>;
    const updateStmt = sqlite.prepare(
      "UPDATE connections SET credentials = ? WHERE id = ?"
    );
    for (const row of credRows) {
      if (row.credentials && row.credentials.trimStart().startsWith("{")) {
        updateStmt.run(encrypt(row.credentials), row.id);
      }
    }
  } catch (err) {
    // Likely AUTH_SECRET is not configured. Credentials stay plaintext until it is.
    console.warn(
      "[FileBridge] Could not encrypt connection credentials at startup:",
      err instanceof Error ? err.message : err
    );
  }
}

// Migrate: update hooks table CHECK constraint to include 'email' type.
const hooksDef = sqlite
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='hooks'")
  .get() as { sql: string } | undefined;
if (hooksDef && !hooksDef.sql.includes("'email'")) {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE hooks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('webhook', 'shell', 'email')),
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO hooks_new SELECT * FROM hooks;
    DROP TABLE hooks;
    ALTER TABLE hooks_new RENAME TO hooks;
  `);
  sqlite.pragma("foreign_keys = ON");
}

// Migrate: encrypt hook configs at rest.
// Handles legacy plaintext JSON and the old per-field __secret: format.
if (!isBuildPhase) {
  try {
    const hookRows = sqlite
      .prepare("SELECT id, config FROM hooks")
      .all() as Array<{ id: number; config: string }>;
    const updateHookConfig = sqlite.prepare(
      "UPDATE hooks SET config = ? WHERE id = ?"
    );

    function stripSecretPrefixes(obj: unknown): unknown {
      if (typeof obj === "string") {
        if (obj.startsWith("__secret:")) {
          try { return decrypt(obj.slice(9)); } catch { return obj; }
        }
        return obj;
      }
      if (Array.isArray(obj)) return obj.map(stripSecretPrefixes);
      if (obj !== null && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          result[k] = stripSecretPrefixes(v);
        }
        return result;
      }
      return obj;
    }

    for (const row of hookRows) {
      if (!row.config.startsWith("enc:")) {
        try {
          const parsed = JSON.parse(row.config);
          const stripped = stripSecretPrefixes(parsed);
          updateHookConfig.run("enc:" + encrypt(JSON.stringify(stripped)), row.id);
        } catch { /* skip malformed configs */ }
      }
    }
  } catch (err) {
    console.warn(
      "[FileBridge] Could not encrypt hook configs at startup:",
      err instanceof Error ? err.message : err
    );
  }
}

export const db = drizzle(sqlite, { schema });

// Export the raw better-sqlite3 instance for low-level operations (e.g. backup restore)
export { sqlite };
