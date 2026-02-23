# Health Check

FileBridge exposes a health check endpoint at `GET /api/health` for use with container orchestration systems (Kubernetes, ECS, Docker Swarm) and uptime monitoring tools.

---

## Endpoint

```
GET /api/health
```

**Authentication**: None required — this is a public endpoint. This is necessary so Kubernetes liveness and readiness probes can check health without needing to manage session cookies or tokens.

---

## Response

### Healthy (HTTP 200)

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

### Degraded (HTTP 503)

Returned when one or more checks fail:

```json
{
  "status": "degraded",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": { "status": "error", "error": "SQLITE_IOERR: disk I/O error" },
    "scheduler": { "status": "ok", "scheduledJobs": 0 }
  }
}
```

---

## Response Fields

| Field | Description |
|---|---|
| `status` | `"ok"` if all checks pass, `"degraded"` if any check fails |
| `version` | Application version from `package.json` |
| `uptime` | Process uptime in seconds |
| `checks.database.status` | `"ok"` or `"error"` |
| `checks.database.error` | Error message when status is `"error"` |
| `checks.scheduler.status` | `"ok"` or `"error"` |
| `checks.scheduler.scheduledJobs` | Number of active cron jobs registered in the scheduler |

---

## Checks Performed

### Database

Executes `SELECT 1` via Drizzle ORM to verify the SQLite connection is live and the database file is accessible. Fails if the file is locked, corrupt, or the disk is unavailable.

### Scheduler

Calls `getScheduledJobIds()` to verify the scheduler module is loaded and accessible. Returns the count of currently registered cron tasks. Note: 0 scheduled jobs is not itself an error — it means no jobs are currently set to `active`.

---

## Kubernetes Configuration

### Liveness Probe

A liveness probe restarts the container if the app becomes unresponsive (e.g. deadlocked):

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3
```

### Readiness Probe

A readiness probe removes the pod from load balancer rotation if the app is not ready to serve traffic:

```yaml
readinessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
```

### Full Deployment Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: filebridge
spec:
  replicas: 1
  selector:
    matchLabels:
      app: filebridge
  template:
    metadata:
      labels:
        app: filebridge
    spec:
      containers:
        - name: filebridge
          image: your-registry/filebridge:latest
          ports:
            - containerPort: 3000
          env:
            - name: NODE_OPTIONS
              value: "--openssl-legacy-provider"
          envFrom:
            - secretRef:
                name: filebridge-secrets
          volumeMounts:
            - name: data
              mountPath: /app/data
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: filebridge-data-pvc
```

---

## Docker Compose HEALTHCHECK

```yaml
services:
  filebridge:
    image: filebridge:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

---

## External Monitoring

You can poll `/api/health` from any uptime monitoring tool (UptimeRobot, Pingdom, Datadog Synthetics, etc.):

- Monitor URL: `https://your-domain.com/api/health`
- Expected status code: `200`
- Optional content check: `"status":"ok"`
- Check interval: 30–60 seconds recommended
