# Configuration

FileBridge is configured entirely through environment variables. The application validates all required variables at startup and exits immediately with a clear error message if any are missing or invalid.

---

## Environment Variables

### Authentication

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | **Yes** | NextAuth secret key. Generate with `openssl rand -base64 32`. Must be at least 1 character. |
| `NEXTAUTH_URL` | Yes (prod) | Full URL where the app is hosted (e.g. `https://filebridge.example.com`). Required in production. |
| `AZURE_AD_CLIENT_ID` | Yes* | Azure AD application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | Yes* | Azure AD client secret |
| `AZURE_AD_TENANT_ID` | Yes* | Azure AD tenant (directory) ID |
| `AUTH_BYPASS_DEV` | No | Set to `true` to skip Azure AD in local development. **Never use in production.** |
| `NEXT_PUBLIC_AUTH_BYPASS_DEV` | No | Client-side companion to `AUTH_BYPASS_DEV`. Must match. |

*Not required when `AUTH_BYPASS_DEV=true`.

### Access Control

| Variable | Required | Description |
|---|---|---|
| `ALLOWED_EMAILS` | No | Comma-separated list of email addresses permitted to sign in. If unset, any authenticated Azure AD user is allowed. |
| `ALLOWED_GROUP_IDS` | No | Comma-separated Azure AD group object IDs. Users must be a member of at least one group to access the app. |

### Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_PATH` | No | `./data/filebridge.db` | Absolute or relative path to the SQLite database file. The directory is created automatically. |

### Logging

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | No | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

### Runtime

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_OPTIONS` | Auto | — | Set to `--openssl-legacy-provider` for SMB NTLMv2 support. The npm scripts handle this automatically. |
| `NODE_ENV` | Auto | — | Set by Next.js. Values: `development`, `production`, `test`. |

---

## Startup Validation

FileBridge uses a Zod schema (`lib/env.ts`) to validate environment variables at startup, before the scheduler or any other subsystem initializes. If validation fails, the process exits with a non-zero status and logs the specific missing or invalid variables:

```
ERROR [env] Invalid environment configuration — server cannot start
  - AZURE_AD_CLIENT_ID: AZURE_AD_CLIENT_ID is required
  - AUTH_SECRET: AUTH_SECRET is required
```

This fail-fast approach prevents mysterious runtime failures deep in request handling.

---

## Example .env Files

### Local Development (Dev Bypass)

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
AUTH_SECRET=dev-only-secret-not-for-production
NEXTAUTH_URL=http://localhost:3000
LOG_LEVEL=debug
```

### Local Development (With Azure AD)

```env
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000

AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_CLIENT_SECRET=your-secret-value
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

ALLOWED_EMAILS=alice@example.com,bob@example.com
```

### Production

```env
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://filebridge.example.com

AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_CLIENT_SECRET=your-secret-value
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

ALLOWED_GROUP_IDS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

DATABASE_PATH=/app/data/filebridge.db
LOG_LEVEL=info
```

---

## Application Settings (In-App)

Some settings are stored in the database and configured through the **Settings** page in the UI:

### Notification Settings

Configured at **Settings → Notifications**:

| Setting | Description |
|---|---|
| SMTP host / port / user / password / from / to | Email alert delivery via SMTP |
| Teams webhook URL | Microsoft Teams channel alert integration |
| Alert on failure | Trigger notification when a job fails |
| Alert after N consecutive errors | Escalation threshold |

### Backup Settings

Configured at **Settings → Database Backups**:

| Setting | Description |
|---|---|
| Enable scheduled backups | Toggle automatic backups on/off |
| Cron schedule | When to run backups (default: `0 2 * * *` — 2:00 AM daily) |
| Local backup path | Directory where backup `.db` files are stored |
| Retention count | How many backups to keep (default: 7) |

See [Database Backups](Database-Backups) for full details.
