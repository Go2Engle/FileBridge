# Architecture

This document describes FileBridge's system architecture, component interactions, data models, and key design decisions.

---

## High-Level Overview

```
                    ┌─────────────────────────────────────┐
                    │          Browser (React)             │
                    │  Dashboard │ Jobs │ Connections │ …  │
                    └──────────────────┬──────────────────┘
                                       │ TanStack Query (HTTP/JSON)
                    ┌──────────────────▼──────────────────┐
                    │       Next.js API Routes             │
                    │   /api/jobs  /api/connections  …     │
                    └──────┬───────────────┬──────────────┘
                           │               │
              ┌────────────▼───┐   ┌───────▼────────────────────┐
              │ SQLite (Drizzle)│   │     Storage Providers      │
              │ jobs, runs, logs│   │  SFTP │ SMB │ Azure Blob   │
              └────────────────┘   └────────────────────────────┘
                           │
              ┌────────────▼───────────────┐
              │   Scheduler (node-cron)     │
              │   → Transfer Engine         │
              │   → Audit Logging           │
              └────────────────────────────┘
```

FileBridge is a **monolithic Next.js application** — the UI, API, scheduler, and transfer engine all run in the same Node.js process. This keeps deployment simple (single container, single port) at the cost of limiting horizontal scalability (which is on the roadmap via Redis-backed queues).

---

## Request Lifecycle

### Browser → API Request

1. Browser sends an HTTP request (via TanStack Query)
2. `middleware.ts` runs (Edge runtime):
   - Generates or propagates `X-Request-ID` UUID
   - Validates the NextAuth session cookie
   - Redirects to `/api/auth/signin` if unauthenticated
3. The matching Next.js API route handler runs (Node.js runtime)
4. Handler reads/writes the SQLite database via Drizzle ORM
5. Handler may interact with storage providers (for connection testing, file browsing)
6. Handler logs an audit event if the action is auditable
7. Response is returned as JSON

### Scheduler → Transfer Engine

1. At server startup, `instrumentation.ts` calls `initializeScheduler()` and `initializeBackupScheduler()`
2. The scheduler queries the DB for all `active` jobs and registers a `node-cron` task for each
3. When a cron trigger fires, the task re-checks the job's status in the DB (guard against stale in-memory state)
4. If still active, `runJob(jobId)` is called on the transfer engine
5. The engine runs the full transfer flow (see [Transfer Engine](Transfer-Engine))
6. Results are written to `job_runs` and `transfer_logs`
7. The scheduler writes an audit event for the execution

---

## Project Structure

```
app/
├── page.tsx                          # Redirects to /dashboard
├── layout.tsx                        # Root layout (TanStack Query provider, theme, fonts)
├── (dashboard)/
│   ├── layout.tsx                    # Sidebar + AuthGuard wrapper
│   ├── dashboard/page.tsx            # KPIs, charts, activity feed
│   ├── connections/page.tsx          # Connection management
│   ├── jobs/page.tsx                 # Job management
│   ├── logs/page.tsx                 # Transfer audit log
│   ├── audit-logs/page.tsx           # Security audit log
│   └── settings/page.tsx            # Notification + backup settings
└── api/
    ├── auth/[...nextauth]/route.ts   # NextAuth handlers
    ├── connections/                   # CRUD, test, browse
    ├── jobs/                         # CRUD, run, dry-run, run history
    ├── logs/route.ts                 # Paginated transfer logs
    ├── audit-logs/route.ts           # Paginated audit logs
    ├── dashboard/stats/route.ts      # KPI + chart data
    ├── settings/route.ts             # Notification config
    ├── backup/                       # run, list, restore
    └── health/route.ts               # Liveness/readiness probe

components/
├── auth-guard.tsx                    # Auth wrapper with dev bypass
├── sidebar.tsx                       # Navigation sidebar
├── providers.tsx                     # TanStack Query + theme providers
├── connections/                      # ConnectionList, ConnectionForm
├── jobs/                             # JobList, JobForm, JobDetailSheet
├── logs/                             # LogTable
├── audit-logs/                       # AuditLogTable
├── dashboard/                        # StatsCards, TransferChart, ActivityFeed, JobStatusList
├── settings/                         # NotificationSettings, BackupSettings
└── ui/                               # shadcn/ui primitives + FolderBrowser

lib/
├── auth/                             # NextAuth config + session helpers
│   ├── config.ts                     # Provider, callbacks, access control
│   ├── index.ts                      # Node.js runtime auth export
│   └── edge.ts                       # Edge runtime auth export (middleware)
├── db/
│   ├── schema.ts                     # Drizzle table definitions + TypeScript types
│   └── index.ts                      # SQLite connection + schema init
├── storage/
│   ├── interface.ts                  # StorageProvider interface, FileInfo type, globToRegex
│   ├── sftp.ts                       # SSH2 SFTP implementation
│   ├── smb.ts                        # v9u-smb2 NTLMv2 implementation
│   ├── azure-blob.ts                 # @azure/storage-blob implementation
│   └── registry.ts                   # Provider factory (protocol → class)
├── transfer/
│   └── engine.ts                     # Core transfer orchestration + dry run
├── scheduler/
│   └── index.ts                      # node-cron job scheduling
├── backup/
│   └── index.ts                      # SQLite backup, restore, pruning
├── audit.ts                          # Audit log writer, diffChanges, IP extraction
├── logger.ts                         # pino structured logger + context propagation
├── env.ts                            # Zod env validation (fail-fast startup)
└── utils.ts                          # Shared utilities (cn, etc.)

middleware.ts                         # Auth + request ID injection (Edge runtime)
instrumentation.ts                    # Scheduler init on Node.js server startup
```

---

## Database Schema

FileBridge uses a SQLite database managed by Drizzle ORM. The schema auto-initializes on startup.

### `connections`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Display name |
| `protocol` | TEXT | `sftp`, `smb`, `azure-blob` |
| `host` | TEXT | Server hostname or IP |
| `port` | INTEGER | Server port |
| `credentials` | TEXT (JSON) | Auth credentials — never returned in list APIs |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `jobs`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Display name |
| `source_connection_id` | INTEGER FK | References `connections.id` |
| `source_path` | TEXT | Remote path to read from |
| `destination_connection_id` | INTEGER FK | References `connections.id` |
| `destination_path` | TEXT | Remote path to write to |
| `file_filter` | TEXT | Glob pattern (empty = all) |
| `schedule` | TEXT | Cron expression |
| `post_transfer_action` | TEXT | `retain`, `delete`, `move` |
| `move_path` | TEXT | Target path when action is `move` |
| `overwrite_existing` | INTEGER (bool) | Default false |
| `skip_hidden_files` | INTEGER (bool) | Default true |
| `extract_archives` | INTEGER (bool) | Default false |
| `delta_sync` | INTEGER (bool) | Default false |
| `status` | TEXT | `active`, `inactive`, `running`, `error` |
| `last_run_at` | TEXT | ISO timestamp |
| `next_run_at` | TEXT | ISO timestamp |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `job_runs`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `job_id` | INTEGER FK | References `jobs.id` |
| `started_at` | TEXT | ISO timestamp |
| `completed_at` | TEXT | ISO timestamp (null while running) |
| `status` | TEXT | `running`, `success`, `failure` |
| `error_message` | TEXT | Set on failure |
| `files_transferred` | INTEGER | Incremented in real time |
| `bytes_transferred` | INTEGER | Incremented in real time |
| `total_files` | INTEGER | Set after listing (for progress %) |
| `current_file` | TEXT | Updated per-file (for live progress) |

### `transfer_logs`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `job_id` | INTEGER FK | References `jobs.id` |
| `job_run_id` | INTEGER FK | References `job_runs.id` |
| `file_name` | TEXT | File name only |
| `source_path` | TEXT | Full source path |
| `destination_path` | TEXT | Full destination path |
| `file_size` | INTEGER | Bytes |
| `transferred_at` | TEXT | ISO timestamp |
| `status` | TEXT | `success`, `failure` |
| `error_message` | TEXT | Set on failure |

### `settings`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `key` | TEXT UNIQUE | Setting name (e.g. `notifications`, `backup`) |
| `value` | TEXT (JSON) | Setting value as JSON |

### `audit_logs`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `user_id` | TEXT | User email or `"scheduler"` |
| `action` | TEXT | `create`, `update`, `delete`, `execute`, `login`, `settings_change` |
| `resource` | TEXT | `connection`, `job`, `settings`, `job_run`, `auth` |
| `resource_id` | INTEGER | ID of the affected record |
| `resource_name` | TEXT | Human-readable name |
| `ip_address` | TEXT | Client IP |
| `details` | TEXT (JSON) | Structured context |
| `timestamp` | TEXT | ISO timestamp |

### Database Indexes

```sql
-- Performance indexes added for common query patterns
CREATE INDEX transfer_logs_job_id     ON transfer_logs(job_id);
CREATE INDEX transfer_logs_status     ON transfer_logs(status);
CREATE INDEX transfer_logs_time       ON transfer_logs(transferred_at);
CREATE INDEX transfer_logs_run_status ON transfer_logs(job_run_id, status);
CREATE INDEX jobs_status              ON jobs(status);
CREATE INDEX job_runs_job_id          ON job_runs(job_id);
CREATE INDEX audit_logs_timestamp     ON audit_logs(timestamp);
CREATE INDEX audit_logs_user_id       ON audit_logs(user_id);
CREATE INDEX audit_logs_resource      ON audit_logs(resource);
```

---

## Storage Provider Interface

All storage backends implement a common interface (`lib/storage/interface.ts`):

```typescript
interface StorageProvider {
  connect(): Promise<void>
  disconnect(): Promise<void>
  listFiles(path: string, filter?: string): Promise<FileInfo[]>
  listDirectory(path: string): Promise<FileInfo[]>
  downloadFile(remotePath: string): Promise<Buffer>
  uploadFile(content: Buffer, remotePath: string): Promise<void>
  deleteFile(remotePath: string): Promise<void>
  moveFile(sourcePath: string, destinationPath: string): Promise<void>
}

interface FileInfo {
  name: string
  size: number
  modifiedAt: Date
  isDirectory: boolean
}
```

- `listFiles` applies the glob filter and returns only files (no directories)
- `listDirectory` returns everything (files + directories) for the UI file browser

The provider factory in `lib/storage/registry.ts` maps protocol names to concrete classes.

---

## Scheduler Architecture

The scheduler (`lib/scheduler/index.ts`) maintains an in-memory `Map<jobId, ScheduledTask>`. This map is initialized at startup by `instrumentation.ts` and mutated by API routes when jobs are created, updated, or deleted.

**Startup recovery**: On init, any jobs with `status = "running"` (left over from a crashed process) are reset to `"error"`.

**Re-check on trigger**: When a cron task fires, it re-reads the job from the database before running. This guards against stale state in Next.js's module cache, where an API route might have updated the job status in a different module instance.

---

## Key Design Decisions

### Why SQLite?

- Zero infrastructure — no separate database server to manage
- `better-sqlite3` is synchronous, which simplifies the code significantly
- The online backup API provides safe, consistent snapshots without downtime
- For most file transfer workloads, SQLite's concurrency limits are not a bottleneck (jobs run sequentially within each cron slot)
- Migration path to PostgreSQL is on the roadmap for multi-instance deployments

### Why In-Process Scheduler?

- No external queue infrastructure (Redis, RabbitMQ) needed
- Simple deployment as a single container
- Works perfectly for single-instance deployments
- The downside is that horizontal scaling requires a distributed scheduler — planned via BullMQ + Redis

### Why Next.js?

- Unified codebase for UI and API — no separate backend service
- App Router + TypeScript for strong typing throughout
- Server Components for fast initial loads
- Standalone output mode makes Docker images small and self-contained

### Buffer-Based File Transfer

The current implementation downloads entire files into memory (`Buffer`) before uploading. This is simple and works well for typical file sizes (KB to tens of MB). For very large files (hundreds of MB to GB), streaming transfers (piping source stream directly to destination) are planned to avoid memory pressure.
