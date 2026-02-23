# API Reference

All API routes are under `/api/` and require authentication unless noted. Authentication is validated via the NextAuth session cookie.

---

## Connections

### `GET /api/connections`

Returns all saved connections. The `credentials` field is **never** returned — only `username` is included for display.

**Response**
```json
[
  {
    "id": 1,
    "name": "Production SFTP",
    "protocol": "sftp",
    "host": "sftp.example.com",
    "port": 22,
    "username": "transfer_user",
    "createdAt": "2026-01-15T09:00:00.000Z",
    "updatedAt": "2026-01-15T09:00:00.000Z"
  }
]
```

---

### `POST /api/connections`

Creates a new connection.

**Request Body**
```json
{
  "name": "My SFTP Server",
  "protocol": "sftp",
  "host": "sftp.example.com",
  "port": 22,
  "credentials": {
    "username": "alice",
    "password": "secret"
  }
}
```

**Response**: Created connection (without credentials).

---

### `GET /api/connections/[id]`

Returns a single connection **including** credentials. Used by the edit form. Requires authentication.

---

### `PUT /api/connections/[id]`

Updates an existing connection. Accepts the same body as `POST /api/connections`.

---

### `DELETE /api/connections/[id]`

Deletes a connection. Returns `409 Conflict` if any job references this connection.

---

### `POST /api/connections/[id]/test`

Tests a saved connection's reachability and authentication.

**Response**
```json
{ "success": true, "message": "Connected successfully" }
// or
{ "success": false, "message": "Connection refused: ECONNREFUSED" }
```

---

### `POST /api/connections/test`

Tests connection values from a form (unsaved). Accepts the same body as `POST /api/connections`.

---

### `GET /api/connections/[id]/browse?path=/some/path`

Lists the contents of a remote directory for the file browser UI.

**Query Parameters**
- `path` (string) — the remote path to list

**Response**
```json
[
  { "name": "incoming", "isDirectory": true, "size": 0, "modifiedAt": "..." },
  { "name": "report.csv", "isDirectory": false, "size": 4096, "modifiedAt": "..." }
]
```

---

## Jobs

### `GET /api/jobs`

Returns all jobs with their current status.

---

### `POST /api/jobs`

Creates a new job.

**Request Body**
```json
{
  "name": "Daily Report Transfer",
  "sourceConnectionId": 1,
  "sourcePath": "/data/reports",
  "destinationConnectionId": 2,
  "destinationPath": "/archive/reports",
  "fileFilter": "*.csv",
  "schedule": "0 6 * * *",
  "postTransferAction": "move",
  "movePath": "/data/processed",
  "overwriteExisting": false,
  "skipHiddenFiles": true,
  "extractArchives": false,
  "deltaSync": false,
  "status": "active"
}
```

---

### `GET /api/jobs/[id]`

Returns a single job.

---

### `PUT /api/jobs/[id]`

Updates a job. Accepts the same body as `POST /api/jobs`. When `status` changes to `active`, the scheduler automatically registers the new cron schedule.

---

### `DELETE /api/jobs/[id]`

Deletes a job and all associated `job_runs` and `transfer_logs` records.

---

### `POST /api/jobs/[id]/run`

Triggers an immediate execution of the job.

**Request Body**
```json
{ "dryRun": false }
```

- `dryRun: false` — Runs the job for real (returns `{ success: true }`)
- `dryRun: true` — Returns a dry run preview (returns `DryRunResult` — see [Transfer Engine](Transfer-Engine#dry-run))

---

### `GET /api/jobs/[id]/runs`

Returns the run history for a job (most recent first).

**Response**
```json
[
  {
    "id": 42,
    "jobId": 7,
    "startedAt": "2026-02-22T06:00:00.000Z",
    "completedAt": "2026-02-22T06:00:03.421Z",
    "status": "success",
    "filesTransferred": 12,
    "bytesTransferred": 524288,
    "totalFiles": 12,
    "currentFile": null,
    "errorMessage": null
  }
]
```

---

## Transfer Logs

### `GET /api/logs`

Returns paginated transfer log entries with optional filters.

**Query Parameters**
| Parameter | Type | Description |
|---|---|---|
| `page` | number | Page number (1-based, default: 1) |
| `limit` | number | Results per page (default: 50) |
| `jobId` | number | Filter by job ID |
| `status` | `success` \| `failure` | Filter by transfer status |
| `search` | string | Filter by filename (partial match) |

**Response**
```json
{
  "logs": [
    {
      "id": 1001,
      "jobId": 7,
      "jobRunId": 42,
      "fileName": "report_2026-02-22.csv",
      "sourcePath": "/data/reports/report_2026-02-22.csv",
      "destinationPath": "/archive/reports/report_2026-02-22.csv",
      "fileSize": 43520,
      "transferredAt": "2026-02-22T06:00:01.234Z",
      "status": "success",
      "errorMessage": null
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

---

## Dashboard

### `GET /api/dashboard/stats`

Returns KPI data and chart data for the dashboard.

**Response**
```json
{
  "kpis": {
    "files24h": 47,
    "files7d": 312,
    "filesAllTime": 5841,
    "bytes24h": 2097152,
    "successRate": 98.7,
    "activeJobs": 6
  },
  "chart": [
    { "date": "2026-02-16", "files": 41, "bytes": 1048576 },
    ...
  ],
  "recentActivity": [...],
  "jobStatuses": [...]
}
```

---

## Settings

### `GET /api/settings`

Returns the current notification settings.

### `PUT /api/settings`

Updates notification settings.

**Request Body**
```json
{
  "notifications": {
    "emailEnabled": true,
    "smtpHost": "smtp.example.com",
    "smtpPort": 587,
    "smtpUser": "alerts@example.com",
    "smtpPassword": "...",
    "smtpFrom": "FileBridge <alerts@example.com>",
    "smtpTo": "ops-team@example.com",
    "teamsWebhookUrl": "https://outlook.office.com/webhook/...",
    "teamsEnabled": false,
    "alertOnFailure": true,
    "alertAfterConsecutiveErrors": 3
  }
}
```

---

## Audit Logs

### `GET /api/audit-logs`

Returns paginated audit log entries.

**Query Parameters**
| Parameter | Type | Description |
|---|---|---|
| `page` | number | Page number (1-based, default: 1) |
| `limit` | number | Results per page (default: 50) |
| `userId` | string | Filter by user email |
| `action` | string | Filter by action: `create`, `update`, `delete`, `execute`, `login`, `settings_change` |
| `resource` | string | Filter by resource: `connection`, `job`, `settings`, `job_run`, `auth` |

**Response**
```json
{
  "logs": [
    {
      "id": 99,
      "userId": "alice@example.com",
      "action": "create",
      "resource": "job",
      "resourceId": 7,
      "resourceName": "Daily Report Transfer",
      "ipAddress": "10.0.0.1",
      "details": { "schedule": "0 6 * * *", "status": "active" },
      "timestamp": "2026-02-22T08:30:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

---

## Backup

### `GET /api/backup/list`

Returns a list of available backup files.

**Response**
```json
[
  {
    "filename": "filebridge-2026-02-22T02-00-00-000Z.db",
    "path": "/app/data/backups/filebridge-2026-02-22T02-00-00-000Z.db",
    "sizeBytes": 204800,
    "createdAt": "2026-02-22T02:00:00.000Z"
  }
]
```

---

### `POST /api/backup/run`

Triggers an immediate database backup.

**Response**
```json
{
  "filename": "filebridge-2026-02-22T10-15-30-000Z.db",
  "path": "/app/data/backups/filebridge-2026-02-22T10-15-30-000Z.db",
  "sizeBytes": 204800,
  "createdAt": "2026-02-22T10:15:30.000Z",
  "integrity": "ok"
}
```

---

### `POST /api/backup/restore`

Restores the database from a backup file.

**Request Body**
```json
{ "filename": "filebridge-2026-02-22T02-00-00-000Z.db" }
```

> **Important**: A safety snapshot is created before the restore. The restore is performed using SQLite's `ATTACH DATABASE` mechanism — no server restart is required. However, any in-flight requests during restore may see inconsistent data.

---

## Health Check

### `GET /api/health`

Public endpoint — **no authentication required**. Returns system health status for liveness/readiness probes.

**Response (200 OK)**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": { "status": "ok" },
    "scheduler": { "status": "ok", "scheduledJobs": 6 }
  }
}
```

**Response (503 Service Unavailable)** — when one or more checks fail:
```json
{
  "status": "degraded",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": { "status": "error", "error": "SQLITE_IOERR" },
    "scheduler": { "status": "ok", "scheduledJobs": 0 }
  }
}
```

See [Health Check](Health-Check) for Kubernetes probe configuration.

---

## Error Responses

All API routes return standard HTTP status codes:

| Status | Meaning |
|---|---|
| `200` | Success |
| `201` | Created |
| `400` | Bad request (invalid input) |
| `401` | Unauthorized (not signed in) |
| `404` | Not found |
| `409` | Conflict (e.g. deleting a connection in use) |
| `500` | Internal server error |

Error responses include a JSON body:
```json
{ "error": "Human-readable error message" }
```
