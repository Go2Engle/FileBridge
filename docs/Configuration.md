# Configuration

FileBridge is configured through a small set of environment variables. SSO providers, users, and most application settings are managed through the admin UI rather than environment variables.

---

## Environment Variables

### Authentication

| Variable | Required | Description |
|---|---|---|
| `AUTH_SECRET` | **Yes** | NextAuth secret key. Generate with `openssl rand -base64 32`. Also used to encrypt SSO client secrets at rest. |
| `NEXTAUTH_URL` | Yes (prod) | Full URL where the app is hosted (e.g. `https://filebridge.example.com`). Required in production. |
| `AUTH_BYPASS_DEV` | No | Set to `true` to skip authentication in local development. **Never use in production.** |
| `NEXT_PUBLIC_AUTH_BYPASS_DEV` | No | Client-side companion to `AUTH_BYPASS_DEV`. Must match. |

> **Note**: SSO provider credentials (Azure AD Client ID/Secret, GitHub Client ID/Secret) are configured via the **Admin → Authentication** UI and stored encrypted in the database. No SSO-related environment variables are needed.

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

FileBridge uses a Zod schema (`lib/env.ts`) to validate environment variables at startup. The only mandatory variable is `AUTH_SECRET`. If validation fails, the process exits with a non-zero status and logs the specific missing or invalid variables:

```
ERROR [env] Invalid environment configuration — server cannot start
  - AUTH_SECRET: AUTH_SECRET is required
```

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

### Local Development (With Local Auth)

```env
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
```

On first launch, the setup wizard will create your admin account. No additional configuration needed.

### Production

```env
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://filebridge.example.com

DATABASE_PATH=/app/data/filebridge.db
LOG_LEVEL=info
```

SSO providers are configured via the admin UI after setup. See [Authentication](Authentication) for details.

---

## Application Settings (In-App)

Most settings are stored in the database and configured through the web UI:

### User Management

Configured at **Admin → Users**:

| Setting | Description |
|---|---|
| User accounts | Create, edit, deactivate, and delete local and SSO user accounts |
| Roles | Assign Administrator or Viewer roles |

### SSO Configuration

Configured at **Admin → Authentication**:

| Setting | Description |
|---|---|
| Azure AD | Client ID, Client Secret, Tenant ID |
| GitHub | Client ID, Client Secret |
| Enable/Disable | Toggle individual providers on the login page |

### Notification Settings

Configured at **Settings → Notifications**:

| Setting | Description |
|---|---|
| SMTP host / port / user / password / from / to | Email alert delivery via SMTP |
| Teams webhook URL | Microsoft Teams channel alert integration |
| Alert on failure | Trigger notification when a job fails |
| Alert after N consecutive errors | Escalation threshold |

### Timezone Settings

Configured at **Settings → Timezone**:

| Setting | Description |
|---|---|
| Timezone | IANA timezone identifier used for all cron job scheduling (e.g. `America/New_York`, `Europe/London`, `UTC`) |

Defaults to `UTC` if not configured. Changing the timezone immediately reschedules all active jobs. Invalid IANA identifiers are rejected with a validation error.

### Backup Settings

Configured at **Settings → Database Backups**:

| Setting | Description |
|---|---|
| Enable scheduled backups | Toggle automatic backups on/off |
| Cron schedule | When to run backups (default: `0 2 * * *` — 2:00 AM daily) |
| Local backup path | Directory where backup `.db` files are stored |
| Retention count | How many backups to keep (default: 7) |

See [Database Backups](Database-Backups) for full details.
