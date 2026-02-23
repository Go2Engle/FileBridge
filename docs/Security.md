# Security

This page documents FileBridge's current security controls, known gaps, and recommendations for hardening production deployments.

---

## Authentication and Authorization

### Azure AD SSO

All routes (except `GET /api/health` and the NextAuth callback endpoints) require a valid Azure AD session. Unauthenticated requests are redirected to the Microsoft login page. There is no username/password login — all identity is delegated to Azure AD.

### Access Control

Two optional allow-list mechanisms restrict which authenticated users can access the app:

- **`ALLOWED_EMAILS`** — explicit list of permitted email addresses
- **`ALLOWED_GROUP_IDS`** — users must be a member of at least one specified Azure AD group

Without either setting configured, any user with a valid account in your Azure AD tenant can sign in.

### Dev Bypass

The `AUTH_BYPASS_DEV=true` mode is enforced by checking `NODE_ENV === "development"` in middleware. It cannot be activated in production builds. Do not set this flag in production.

---

## HTTP Security Headers

The following security headers are set on all responses via `next.config.ts`:

| Header | Value |
|---|---|
| `Content-Security-Policy` | Restricts script sources, frame ancestors, and object sources |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (2 years) |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Disables camera, microphone, geolocation |

HSTS ensures browsers always connect over HTTPS after the first visit. Adjust `max-age` if you're not ready for the 2-year commitment.

---

## Credential Handling

### API Response Stripping

Connection credentials are **never** returned in API responses:

- `GET /api/connections` — returns `username` for display only; no passwords, keys, or tokens
- `POST /api/connections` and `PUT /api/connections/[id]` — response strips credentials
- `GET /api/connections/[id]` — returns full credentials for the edit form (authenticated endpoint only)
- Browse, test, and run endpoints — never return connection data

### Log Redaction

The pino logger automatically redacts these fields anywhere they appear in a log object (at any nesting depth):

`password`, `privateKey`, `passphrase`, `accountKey`, `connectionString`, `token`, `secret`, `credentials`

These are replaced with `"[REDACTED]"` before the log line is written — they never reach your log aggregation system.

### Database Storage

Credentials are stored as JSON in the `connections.credentials` column of the SQLite database. The database file itself is not encrypted at rest.

> **Known Gap**: Field-level encryption for credentials at rest is planned (see [Roadmap](Roadmap)). Until implemented, secure the database file with filesystem permissions (`chmod 600 data/filebridge.db`) and restrict access to the host.

---

## Request Correlation

Every HTTP request receives a `X-Request-ID` UUID header (injected by middleware). This ID:

- Is propagated through the request context via `AsyncLocalStorage`
- Appears in all structured log lines emitted during that request
- Is returned in the response header so clients can include it in bug reports

If the client sends an `X-Request-ID` header, that value is used (allowing end-to-end correlation from a frontend trace).

---

## Path Traversal Protection

The backup restore endpoint validates that the requested filename stays within the configured backup directory:

```typescript
const resolvedBackup = path.resolve(backupPath);
const resolvedDir = path.resolve(config.localPath);
if (!resolvedBackup.startsWith(resolvedDir + path.sep)) {
  throw new Error("Invalid backup filename");
}
```

This prevents a malicious request like `{ filename: "../../etc/passwd" }` from reading files outside the backup directory.

---

## Database Integrity

Every backup file is verified with `PRAGMA integrity_check` before being saved or restored. A corrupt backup is deleted immediately rather than stored silently. Restore operations also verify the backup's integrity before making any destructive changes to the live database.

---

## Audit Trail

All security-relevant actions are recorded in the `audit_logs` table:

- User sign-ins (success and denied)
- CRUD on connections and jobs (with field-level diffs for updates)
- Job executions (manual and scheduled)
- Settings changes
- IP addresses of all actions

See [Audit Logging](Audit-Logging) for full details.

---

## Known Security Gaps

The following issues are acknowledged and tracked in the [Roadmap](Roadmap):

| Gap | Risk | Status |
|---|---|---|
| Credentials not encrypted at rest | If the database file is stolen, credentials are readable as JSON | Planned: libsodium field encryption |
| No API input validation (Zod schemas on POST/PUT) | Malformed input could cause unexpected behavior | Planned |
| No rate limiting | Brute-force or DoS possible on API routes | Planned |
| No CSRF protection | Same-origin policy provides some protection, but no explicit CSRF tokens | Planned |
| No RBAC | Any authenticated user has full admin access | Planned: admin / operator / viewer roles |

---

## Production Hardening Checklist

- [ ] Run behind HTTPS (TLS termination at reverse proxy)
- [ ] Set `ALLOWED_EMAILS` or `ALLOWED_GROUP_IDS` to restrict access
- [ ] Rotate `AUTH_SECRET` periodically (generate with `openssl rand -base64 32`)
- [ ] Rotate Azure AD client secrets before expiry
- [ ] Restrict filesystem permissions on `data/filebridge.db` (`chmod 600`)
- [ ] Mount the data volume to reliable, backed-up storage
- [ ] Enable automated database backups in Settings
- [ ] Forward structured logs to a SIEM or log aggregation platform
- [ ] Configure uptime monitoring on `GET /api/health`
- [ ] Set `AZURE_AD_CLIENT_SECRET` expiry alerts in the Azure portal
- [ ] Review the audit log regularly for unexpected access patterns

---

## Reporting Security Issues

If you discover a security vulnerability in FileBridge, please report it responsibly to the project maintainers rather than creating a public GitHub issue.
