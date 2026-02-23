# Audit Logging

FileBridge maintains a detailed audit trail of all security-relevant actions. Every significant operation — creating or deleting connections, running jobs, changing settings, signing in — is recorded with the user identity, IP address, resource affected, and a structured details payload.

---

## What Gets Logged

| Action | Resource | When |
|---|---|---|
| `create` | `connection` | New connection saved |
| `update` | `connection` | Connection edited |
| `delete` | `connection` | Connection deleted |
| `create` | `job` | New job saved |
| `update` | `job` | Job edited (includes field-level diff) |
| `delete` | `job` | Job deleted |
| `execute` | `job` | Job run triggered (manual or scheduled) |
| `login` | `auth` | User sign-in attempt (success or denied) |
| `settings_change` | `settings` | Notification settings saved |
| `settings_change` | `settings` | Backup settings saved |

---

## Audit Log Fields

Each audit log record contains:

| Field | Description |
|---|---|
| `id` | Auto-increment primary key |
| `userId` | Email address of the user who performed the action (or `"scheduler"` for scheduled runs) |
| `action` | One of: `create`, `update`, `delete`, `execute`, `login`, `settings_change` |
| `resource` | One of: `connection`, `job`, `settings`, `job_run`, `auth` |
| `resourceId` | Database ID of the affected record (nullable) |
| `resourceName` | Human-readable name (e.g. job name, connection name) |
| `ipAddress` | Client IP address extracted from `X-Forwarded-For` or `X-Real-IP` |
| `details` | JSON object with additional context (varies by action) |
| `timestamp` | ISO 8601 timestamp of the event |

---

## Details Payload Examples

### Job Created
```json
{
  "schedule": "0 6 * * *",
  "status": "active",
  "sourceConnectionId": 1,
  "destinationConnectionId": 2
}
```

### Job Updated (with diff)
```json
{
  "changes": {
    "schedule": { "from": "0 6 * * *", "to": "0 8 * * 1-5" },
    "fileFilter": { "from": "", "to": "*.csv" }
  }
}
```

The `diffChanges` function computes a field-level diff between the old and new values. Sensitive fields (`credentials`, timestamps) are excluded from the diff.

### Job Executed (Manual)
```json
{
  "trigger": "manual"
}
```

### Job Executed (Scheduled)
```json
{
  "trigger": "scheduled",
  "schedule": "0 6 * * *"
}
```

### Login (Successful)
```json
{
  "outcome": "success"
}
```

### Login (Denied)
```json
{
  "outcome": "denied"
}
```

### Settings Changed
```json
{
  "key": "notifications",
  "changes": {
    "alertOnFailure": { "from": false, "to": true }
  }
}
```

---

## Viewing the Audit Log

Navigate to **Audit Log** in the sidebar (shield icon). The audit log UI provides:

- **Paginated table** with all audit events
- **Action badges** color-coded by type (create = green, delete = red, execute = blue, etc.)
- **Details tooltip** — hover over a row to see the full JSON details payload
- **Filter by user** — show only actions by a specific user
- **Filter by action** — narrow to creates, deletes, logins, etc.
- **Filter by resource** — show only job events, connection events, etc.

---

## API

### `GET /api/audit-logs`

See [API Reference](API-Reference#audit-logs) for the full query parameter and response documentation.

---

## Database Indexes

The `audit_logs` table has indexes on:
- `timestamp` — for time-range queries
- `user_id` — for per-user filtering
- `resource` — for resource-type filtering

---

## Implementation Details

Audit logging is implemented in `lib/audit.ts`. The `logAudit()` function is **fire-and-forget** — errors writing to the audit table are caught and logged to the structured logger but never interrupt the calling request. This ensures an audit table write failure does not block a user operation.

The IP address is extracted in order of preference:
1. `X-Forwarded-For` (first value, for reverse proxy scenarios)
2. `X-Real-IP`
3. `null` if neither header is present

---

## Correlation with Structured Logs

Audit log entries work alongside the structured log output. The `X-Request-ID` header (set by middleware) appears in structured log lines for the same request, allowing you to correlate:
- The audit log entry (who did what, to what)
- The structured log lines (what actually happened during execution)

For example, a `POST /api/jobs/7/run` request produces:
1. An audit log entry: `{ action: "execute", resource: "job", resourceId: 7 }`
2. A series of structured log lines tagged with `{ requestId: "uuid", jobId: 7, runId: 42 }`
