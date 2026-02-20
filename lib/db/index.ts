import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "data", "filebridge.db");

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);

// Performance and reliability pragmas
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("synchronous = NORMAL");

// Initialize schema on first run
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK(protocol IN ('sftp', 'smb')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    credentials TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
`);

// Lightweight migrations for columns added after initial release.
// ALTER TABLE … ADD COLUMN is a no-op if the column already exists in SQLite,
// but the statement itself will throw — so we catch and ignore.
const migrations = [
  `ALTER TABLE jobs ADD COLUMN overwrite_existing INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE jobs ADD COLUMN skip_hidden_files INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE jobs ADD COLUMN extract_archives INTEGER NOT NULL DEFAULT 0`,
];

for (const sql of migrations) {
  try {
    sqlite.exec(sql);
  } catch {
    // Column already exists — safe to ignore
  }
}

// One-time cleanup: remove spurious transfer log entries created when
// directories (e.g. move folders) were accidentally listed as files.
sqlite.exec(
  `DELETE FROM transfer_logs WHERE file_size = 0 AND file_name NOT LIKE '%.%'`
);

export const db = drizzle(sqlite, { schema });
