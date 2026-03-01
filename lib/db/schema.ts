import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  protocol: text("protocol", { enum: ["sftp", "smb", "azure-blob", "local"] }).notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  credentials: text("credentials").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sourceConnectionId: integer("source_connection_id")
    .notNull()
    .references(() => connections.id),
  sourcePath: text("source_path").notNull(),
  destinationConnectionId: integer("destination_connection_id")
    .notNull()
    .references(() => connections.id),
  destinationPath: text("destination_path").notNull(),
  fileFilter: text("file_filter").notNull().default(""),
  schedule: text("schedule").notNull(),
  postTransferAction: text("post_transfer_action", {
    enum: ["retain", "delete", "move"],
  })
    .notNull()
    .default("retain"),
  movePath: text("move_path"),
  overwriteExisting: integer("overwrite_existing", { mode: "boolean" })
    .notNull()
    .default(false),
  skipHiddenFiles: integer("skip_hidden_files", { mode: "boolean" })
    .notNull()
    .default(true),
  extractArchives: integer("extract_archives", { mode: "boolean" })
    .notNull()
    .default(false),
  deltaSync: integer("delta_sync", { mode: "boolean" })
    .notNull()
    .default(false),
  status: text("status", {
    enum: ["active", "inactive", "running", "error"],
  })
    .notNull()
    .default("inactive"),
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const jobRuns = sqliteTable("job_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobs.id),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status", { enum: ["success", "failure", "running"] }).notNull(),
  errorMessage: text("error_message"),
  filesTransferred: integer("files_transferred").notNull().default(0),
  bytesTransferred: integer("bytes_transferred").notNull().default(0),
  totalFiles: integer("total_files"),
  totalBytes: integer("total_bytes"),
  currentFile: text("current_file"),
  currentFileSize: integer("current_file_size"),
  currentFileBytesTransferred: integer("current_file_bytes_transferred"),
});

export const transferLogs = sqliteTable("transfer_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobs.id),
  jobRunId: integer("job_run_id")
    .notNull()
    .references(() => jobRuns.id),
  fileName: text("file_name").notNull(),
  sourcePath: text("source_path").notNull(),
  destinationPath: text("destination_path").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  transferredAt: text("transferred_at").notNull(),
  status: text("status", { enum: ["success", "failure"] }).notNull(),
  errorMessage: text("error_message"),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value", { mode: "json" }),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["admin", "viewer"] }).notNull().default("viewer"),
  isLocal: integer("is_local", { mode: "boolean" }).notNull().default(true),
  ssoProvider: text("sso_provider"),
  ssoId: text("sso_id"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  lastLoginAt: text("last_login_at"),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  action: text("action", {
    enum: ["create", "update", "delete", "execute", "login", "logout", "settings_change"],
  }).notNull(),
  resource: text("resource", {
    enum: ["connection", "job", "settings", "job_run", "auth", "user"],
  }).notNull(),
  resourceId: integer("resource_id"),
  resourceName: text("resource_name"),
  ipAddress: text("ip_address"),
  details: text("details", { mode: "json" }).$type<Record<string, unknown>>(),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const hooks = sqliteTable("hooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type", { enum: ["webhook", "shell"] }).notNull(),
  config: text("config").notNull(), // JSON stored as plain text
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

export const jobHooks = sqliteTable("job_hooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  hookId: integer("hook_id")
    .notNull()
    .references(() => hooks.id, { onDelete: "cascade" }),
  trigger: text("trigger", { enum: ["pre_job", "post_job"] }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const hookRuns = sqliteTable("hook_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobs.id),
  jobRunId: integer("job_run_id")
    .notNull()
    .references(() => jobRuns.id),
  hookId: integer("hook_id"), // nullable — hook may be deleted later
  hookName: text("hook_name").notNull(),
  hookType: text("hook_type").notNull(),
  trigger: text("trigger", { enum: ["pre_job", "post_job"] }).notNull(),
  status: text("status", { enum: ["success", "failure"] }).notNull(),
  durationMs: integer("duration_ms"),
  output: text("output"), // response body / stdout (truncated to 4KB)
  errorMessage: text("error_message"),
  executedAt: text("executed_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

// Hook config type interfaces
export interface WebhookConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body?: string; // template with {{job_id}}, {{job_name}}, {{trigger}}, {{status}}, etc.
  timeoutMs?: number; // default 10000
}

export interface ShellConfig {
  command: string;
  timeoutMs?: number; // default 30000
  workingDir?: string;
}

export type Connection = typeof connections.$inferSelect;
export type NewConnection = typeof connections.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
export type TransferLog = typeof transferLogs.$inferSelect;
export type NewTransferLog = typeof transferLogs.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type Hook = typeof hooks.$inferSelect;
export type NewHook = typeof hooks.$inferInsert;
export type JobHook = typeof jobHooks.$inferSelect;
export type HookRun = typeof hookRuns.$inferSelect;
