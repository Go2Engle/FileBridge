
<div align="center">
  <img src="images/FileBridgeLogo.png" alt="FileBridge Logo" width="600" />
</div>

# FileBridge

A self-hosted web application for automated file transfer scheduling and monitoring. FileBridge connects your SFTP and SMB/CIFS storage systems through a modern dashboard, letting you define transfer jobs with cron scheduling, glob filtering, archive extraction, and comprehensive audit logging — all packaged as a single lightweight container.

---

## Features

### Transfer Engine
- **Multi-protocol support** — SFTP and SMB/CIFS with a pluggable provider interface for future expansion (S3, Azure Blob, etc.)
- **Cron-based scheduling** — Full cron expression support with preset shortcuts (every N minutes, daily, weekdays)
- **Manual execution** — Trigger any job on-demand with Run Now
- **Glob file filtering** — Transfer only the files you need (e.g. `*.csv`, `report_*.xlsx`)
- **Post-transfer actions** — Retain, delete, or move source files after transfer
- **Archive extraction** — Automatically extract ZIP, TAR, TAR.GZ, and TGZ archives at the destination
- **Overwrite control** — Skip files that already exist at the destination or overwrite them
- **Hidden file filtering** — Optionally skip dotfiles and hidden entries
- **Concurrent run protection** — Prevents the same job from running twice simultaneously
- **Automatic retry logic** — SMB operations retry on stale sessions, sharing violations, and transient errors

### Dashboard & Analytics
- **KPI cards** — Files transferred (24h / 7d / all-time), data volume, success rate, active jobs
- **7-day rolling chart** — Visual trend of transfer volume and file counts
- **Job status list** — At-a-glance view of all jobs and their current state
- **Activity feed** — Recent file-level transfer log with pagination

### Connection Management
- **SFTP connections** — Username/password or SSH private key authentication
- **SMB/CIFS connections** — NTLMv2 authentication with optional domain, works with NAS devices and Windows shares
- **Built-in file browser** — Browse remote file systems directly from the UI when configuring jobs
- **Referential integrity** — Connections in use by jobs cannot be deleted

### Job Management
- **Full CRUD** — Create, edit, enable/disable, and delete transfer jobs
- **Status tracking** — Active, inactive, running, and error states with tooltips showing last error
- **Auto-refresh** — Job list updates every 10 seconds to reflect running state

### Audit & Logging
- **Per-file transfer logs** — Every file touched is recorded with source/destination paths, size, timestamp, and status
- **Per-execution run records** — Summary of each job execution with file count, byte count, and duration
- **Searchable log viewer** — Filter by file name, status (success/failure), or job
- **Paginated results** — Handles large log volumes efficiently

### Security & Authorization
- **Azure AD SSO** — Enterprise single sign-on via Microsoft Entra ID (Azure AD)
- **Email-based access control** — Restrict access to a comma-separated list of allowed email addresses
- **Group-based access control** — Restrict access by Azure AD group object IDs
- **Dev bypass mode** — Skip authentication during local development

### Notifications (UI Ready)
- **Email alerts** — SMTP configuration for failure notifications
- **Microsoft Teams** — Webhook integration for Teams channel alerts
- **Alert rules** — Notify on failure or after N consecutive errors

### UI/UX
- **Dark / Light mode** — System-aware theme with manual toggle
- **Responsive sidebar layout** — Persistent navigation with user info and sign-out
- **Toast notifications** — Non-blocking feedback for all actions
- **Loading skeletons** — Smooth loading states throughout
- **Cron description parser** — Human-readable display of cron expressions (e.g. "Every day at 8:00 AM")

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Authentication | NextAuth v5 (Auth.js) + Azure AD |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| UI Components | shadcn/ui (new-york style) |
| Styling | Tailwind CSS v4 |
| State Management | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| SFTP | ssh2-sftp-client |
| SMB/CIFS | v9u-smb2 (NTLMv2-capable) |
| Scheduler | node-cron |
| Icons | Lucide React |
| Notifications | Sonner (toasts) |

---

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm, yarn, or pnpm

### Installation

```bash
git clone https://github.com/your-org/filebridge.git
cd filebridge
npm install
```

### Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env.local
```

#### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AZURE_AD_CLIENT_ID` | Yes* | Azure AD application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | Yes* | Azure AD client secret |
| `AZURE_AD_TENANT_ID` | Yes* | Azure AD tenant (directory) ID |
| `AUTH_SECRET` | Yes | NextAuth secret — generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Yes | Application URL (e.g. `http://localhost:3000`) |
| `ALLOWED_EMAILS` | No | Comma-separated email addresses allowed to sign in |
| `ALLOWED_GROUP_IDS` | No | Comma-separated Azure AD group object IDs |
| `DATABASE_PATH` | No | SQLite database path (default: `./data/filebridge.db`) |
| `NODE_OPTIONS` | Auto | Set to `--openssl-legacy-provider` for SMB NTLMv2 support — the npm scripts handle this automatically |
| `AUTH_BYPASS_DEV` | No | Set to `true` for local dev without Azure AD |
| `NEXT_PUBLIC_AUTH_BYPASS_DEV` | No | Client-side companion to `AUTH_BYPASS_DEV` |

*Not required when using dev auth bypass mode.

#### Development Without Azure AD

To run locally without configuring Azure AD, create a `.env` or `.env.local` with:

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
AUTH_SECRET=any-random-string-for-dev
NEXTAUTH_URL=http://localhost:3000
```

### Running

```bash
# Development (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Database

The SQLite database is automatically created at `data/filebridge.db` on first startup. No manual migration steps are required — the schema initializes itself with `CREATE TABLE IF NOT EXISTS` and lightweight column migrations run automatically.

To inspect the database with Drizzle Studio:

```bash
npm run db:studio
```

---

## Architecture

### High-Level Overview

```
                    ┌─────────────────────────────────────┐
                    │          Browser (React)             │
                    │  Dashboard │ Jobs │ Connections │ …  │
                    └──────────────────┬──────────────────┘
                                       │ TanStack Query
                    ┌──────────────────▼──────────────────┐
                    │       Next.js API Routes             │
                    │   /api/jobs  /api/connections  …     │
                    └──────┬───────────────┬──────────────┘
                           │               │
              ┌────────────▼───┐   ┌───────▼────────────┐
              │  SQLite (Drizzle) │   │  Storage Providers │
              │  jobs, runs, logs │   │  SFTP │ SMB │ … │
              └────────────────┘   └────────────────────┘
                           │
              ┌────────────▼───────────────┐
              │   Scheduler (node-cron)     │
              │   → Transfer Engine         │
              │   → Audit Logging           │
              └────────────────────────────┘
```

### Project Structure

```
app/
  page.tsx                          # Redirects to /dashboard
  layout.tsx                        # Root layout (providers, theme, fonts)
  (dashboard)/
    layout.tsx                      # Sidebar + AuthGuard wrapper
    dashboard/page.tsx              # KPIs, charts, activity feed
    connections/page.tsx            # Connection management
    jobs/page.tsx                   # Job management
    logs/page.tsx                   # Transfer audit log
    settings/page.tsx               # Notification settings
  api/
    auth/[...nextauth]/route.ts     # NextAuth handlers
    connections/                     # CRUD + file browser
    jobs/                           # CRUD + run trigger + run history
    logs/route.ts                   # Paginated log queries
    dashboard/stats/route.ts        # KPI + chart data
    settings/route.ts               # Notification config

components/
  auth-guard.tsx                    # Auth wrapper with dev bypass
  sidebar.tsx                       # Navigation sidebar
  providers.tsx                     # TanStack Query provider
  connections/                      # ConnectionList, ConnectionForm
  jobs/                             # JobList, JobForm
  logs/                             # LogTable
  dashboard/                        # StatsCards, TransferChart, ActivityFeed, JobStatusList
  settings/                         # NotificationSettings
  ui/                               # shadcn/ui + FolderBrowser

lib/
  auth/                             # NextAuth config + session helpers
  db/                               # Drizzle schema + SQLite init
  storage/
    interface.ts                    # StorageProvider interface + FileInfo type
    sftp.ts                         # SFTP implementation
    smb.ts                          # SMB/CIFS implementation
    registry.ts                     # Provider factory
  transfer/engine.ts                # Core transfer orchestration
  scheduler/index.ts                # Cron scheduling manager

middleware.ts                       # Auth middleware for all routes
instrumentation.ts                  # Scheduler init on server startup
```

### Database Schema

| Table | Purpose |
|---|---|
| `connections` | Storage connection profiles (SFTP/SMB credentials as JSON) |
| `jobs` | Transfer job definitions (schedule, paths, filters, options) |
| `job_runs` | Per-execution records (status, file/byte counts, timing) |
| `transfer_logs` | Per-file audit trail (source, dest, size, status, errors) |
| `settings` | Key-value store for app configuration |

### Storage Provider Interface

All storage backends implement the `StorageProvider` interface:

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
```

### Transfer Engine Flow

1. Load job + connection configs from database
2. Skip if job is already running (concurrent run protection)
3. Create a `job_runs` record with status `running`
4. Connect to source and destination providers
5. List source files, apply glob filter + hidden file filter
6. For each file:
   - Download from source
   - Extract if archive extraction is enabled (ZIP/TAR/TGZ)
   - Upload to destination (skip if exists and overwrite is off)
   - Apply post-transfer action (retain / delete / move)
   - Write `transfer_logs` entry
7. Update `job_runs` with final status, file count, byte count
8. Disconnect both providers

---

## Extending FileBridge

### Adding a New Storage Provider

FileBridge is designed for easy protocol expansion. To add a new backend (e.g. AWS S3, Azure Blob, FTP):

1. **Create the provider** — Add a new file in `lib/storage/` (e.g. `s3.ts`) that implements the `StorageProvider` interface
2. **Define credentials** — Create a typed credentials interface for the protocol's auth requirements
3. **Register it** — Add a new `case` in `lib/storage/registry.ts` to instantiate your provider
4. **Update the schema** — Add the protocol value to the `protocol` enum in `lib/db/schema.ts`
5. **Update the UI** — Add the protocol option and credential fields in the connection form component

No changes to the transfer engine, scheduler, or any other core system are required.

### Adding New Post-Transfer Actions

The `postTransferAction` field on jobs supports extensible values. To add a new action (e.g. "archive", "encrypt"):

1. Add the new value to the enum in `lib/db/schema.ts`
2. Handle the new case in the transfer engine (`lib/transfer/engine.ts`)
3. Add the option to the job form UI

### Adding Notification Channels

The settings system uses a flexible key-value store. The notification settings UI already supports email (SMTP) and Microsoft Teams webhooks. To add new channels:

1. Extend the settings schema in the API route
2. Add the UI tab in the notification settings component
3. Implement the notification dispatch in the transfer engine's error handling

---

## Docker Deployment

FileBridge is configured for standalone output, making it container-ready:

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--openssl-legacy-provider
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t filebridge .
docker run -d \
  -p 3000:3000 \
  -v filebridge-data:/app/data \
  --env-file .env.production \
  filebridge
```

The SQLite database persists in the `/app/data` volume mount.

---

## Roadmap

- [ ] Cloud storage providers (AWS S3, Azure Blob Storage, Google Cloud Storage)
- [ ] File content transformation pipeline (encryption, compression, encoding)
- [ ] Notification dispatch engine (email + Teams webhook delivery)
- [ ] Multi-user role-based access control (admin / operator / viewer)
- [ ] Job dependency chains (run Job B after Job A succeeds)
- [ ] Bandwidth throttling and transfer rate limits
- [ ] Webhook triggers (start a job via HTTP POST)
- [ ] Transfer resume / checkpointing for large files
- [ ] Health check endpoint for container orchestration
- [ ] Prometheus metrics export

---

## License

Private — internal use only.
