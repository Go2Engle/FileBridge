# Structured Logging

FileBridge emits structured JSON logs using [pino](https://getpino.io), a high-performance Node.js logger. All log output goes to **stdout** as newline-delimited JSON (NDJSON), making it natively compatible with modern log aggregation platforms.

---

## Log Format

Each log line is a JSON object:

```json
{
  "level": 30,
  "time": "2026-02-22T06:00:01.234Z",
  "service": "filebridge",
  "component": "engine",
  "jobId": 7,
  "runId": 42,
  "msg": "File uploaded",
  "fileName": "report_2026-02-22.csv",
  "dstPath": "/archive/reports/report_2026-02-22.csv"
}
```

### Standard Fields

| Field | Description |
|---|---|
| `level` | Numeric pino level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) |
| `time` | ISO 8601 timestamp |
| `service` | Always `"filebridge"` |
| `component` | Source component: `engine`, `scheduler`, `sftp`, `smb`, `azure-blob`, `audit`, `backup`, `env` |
| `msg` | Human-readable message |

### Context Fields (when present)

| Field | Description |
|---|---|
| `requestId` | UUID from `X-Request-ID` header — correlates all logs for a single HTTP request |
| `jobId` | Database ID of the job being executed |
| `runId` | Database ID of the specific job run |

---

## Log Levels

Control verbosity with the `LOG_LEVEL` environment variable:

| Level | Value | When to use |
|---|---|---|
| `trace` | 10 | Extremely verbose — internal library details |
| `debug` | 20 | Development debugging (file lists, timing) |
| `info` | 30 | **Default** — normal operation events |
| `warn` | 40 | Recoverable issues (backup failed, retry attempt) |
| `error` | 50 | Failures requiring attention |
| `fatal` | 60 | Process-level failures before exit |

```env
LOG_LEVEL=debug   # development
LOG_LEVEL=info    # production (default)
LOG_LEVEL=warn    # production (minimal noise)
```

---

## Sensitive Field Redaction

The following fields are automatically redacted (`[REDACTED]`) from all log output, at any nesting level:

- `password`
- `privateKey`
- `passphrase`
- `accountKey`
- `connectionString`
- `token`
- `secret`
- `credentials`

This prevents credentials from appearing in log aggregation systems, even if a developer accidentally logs a connection object.

---

## Context Propagation

FileBridge uses Node.js `AsyncLocalStorage` to automatically attach correlation context to all log lines within an async call chain — without threading parameters through every function signature.

### Request Context

API route handlers can wrap their logic with `withRequestContext`:

```ts
import { withRequestContext } from "@/lib/logger";

export async function POST(req: Request) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  return withRequestContext(requestId, async () => {
    // All log calls in here automatically include { requestId }
    log.info("Handling request");
  });
}
```

The middleware automatically sets `X-Request-ID` on every incoming request, so the ID is consistent across the full request lifecycle.

### Job Context

The transfer engine wraps each job execution with `withJobContext`:

```ts
import { withJobContext } from "@/lib/logger";

return withJobContext(jobId, run.id, async () => {
  // All log calls from here, including storage providers, automatically include
  // { jobId, runId } — no need to pass them as parameters
  log.info("Connecting to source");
  await source.connect(); // source.connect() also emits logs with jobId + runId
});
```

This means a single log query filtered by `jobId = 7` and `runId = 42` returns the complete story of that execution across every component.

---

## Component Loggers

Each module creates its own named logger:

```ts
import { createLogger } from "@/lib/logger";
const log = createLogger("engine");

log.info("Job started", { jobId: 42 });
log.warn("Retrying after error", { attempt: 2, error: err.message });
log.error("Job failed", { error: err });
```

Components and their logger names:

| Component | Name |
|---|---|
| Transfer engine | `engine` |
| Scheduler | `scheduler` |
| SFTP provider | `sftp` |
| SMB provider | `smb` |
| Azure Blob provider | `azure-blob` |
| Audit writer | `audit` |
| Backup | `backup` |
| Env validator | `env` |

> **Note**: `lib/auth/config.ts` intentionally uses `console.*` instead of pino. The NextAuth config runs in the Edge runtime, which does not support the Node.js `async_hooks` module that pino's context propagation depends on.

---

## Development: Pretty-Printed Logs

In development, use the `dev:pretty` script to pipe logs through `pino-pretty` for colorized, human-readable output:

```bash
npm run dev:pretty
```

Example output:
```
INFO  [engine]        Job started                         jobId=7
INFO  [engine]        Source connected                    jobId=7 runId=42
INFO  [engine]        File uploaded                       jobId=7 runId=42 fileName=report.csv
INFO  [engine]        Job completed                       jobId=7 filesTransferred=12
```

In production, use the raw JSON output and let your log platform handle formatting.

---

## Production: Log Aggregation

FileBridge's stdout NDJSON output is directly ingestable by:

| Platform | How |
|---|---|
| **Datadog** | Datadog Agent's `logs` collection on stdout — zero config needed |
| **Grafana Loki** | Promtail with `pipeline_stages` parsing the JSON |
| **AWS CloudWatch** | CloudWatch Logs agent / ECS log driver (`awslogs`) |
| **Azure Monitor** | Container Insights or Azure Log Analytics with the JSON parser |
| **Elastic (ELK)** | Filebeat with JSON log parsing |
| **Splunk** | Universal Forwarder with JSON source type |

### Example: Docker Compose with Loki

```yaml
services:
  filebridge:
    image: filebridge:latest
    logging:
      driver: json-file
      options:
        max-size: "10m"
```

Then configure Promtail to scrape the Docker json-file log driver and parse the nested JSON `log` field.

### Useful Queries (Loki LogQL)

```logql
# All errors for a specific job
{service="filebridge"} | json | level="error" | jobId=7

# All logs for a specific request
{service="filebridge"} | json | requestId="abc-123"

# SMB retry warnings
{service="filebridge"} | json | component="smb" | level="warn"

# Failed file transfers
{service="filebridge"} | json | component="engine" | msg="Failed to transfer file"
```

---

## Correlating Logs with Audit Events

The `X-Request-ID` UUID ties structured log lines to audit events:

1. A user clicks "Run Now" in the UI → browser sends `POST /api/jobs/7/run`
2. Middleware generates `X-Request-ID: abc-123` and sets it on the response
3. The API handler uses `withRequestContext("abc-123", ...)` so all its log lines include `requestId: "abc-123"`
4. The audit log entry for the execution contains the userId and action
5. Structured logs with `requestId: "abc-123"` contain the full execution detail

Search for `requestId: "abc-123"` in your log platform to get the complete picture.
