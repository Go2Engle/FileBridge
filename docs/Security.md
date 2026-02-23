# Security

This page documents FileBridge's current security controls, known gaps, and recommendations for hardening production deployments.

---

## Authentication and Authorization

### Local Authentication

FileBridge uses built-in username/password authentication as the primary login method:

- Passwords are hashed with **bcrypt** (12 salt rounds) before storage
- The first-run setup wizard creates an initial administrator account
- Additional users are created by administrators via the admin UI
- Failed login attempts show a generic error message (no user enumeration)

### SSO (Azure AD, GitHub)

External SSO providers can be configured through the **Admin → Authentication** UI:

- SSO client secrets are **encrypted at rest** using AES-256-GCM with a key derived from `AUTH_SECRET`
- SSO follows a **deny-by-default** model — an administrator must pre-create a user account before that person can sign in via SSO
- Users who authenticate successfully with an SSO provider but have no matching account in FileBridge are denied access

### Role-Based Access Control (RBAC)

FileBridge enforces a two-tier role system:

| Role | Description |
|---|---|
| **Administrator** | Full access — can create/edit/delete connections, jobs, users, and SSO settings |
| **Viewer** | Read-only access — can view connections, jobs, logs, and settings but cannot modify anything |

Roles are enforced at three layers:

| Layer | Mechanism |
|---|---|
| API routes | `requireAuth()` for read operations, `requireRole("admin")` for mutations |
| Middleware | JWT validation (edge runtime — checks token existence) |
| UI components | `useRole()` hook conditionally renders admin-only controls |

### Session Security

- Sessions are JWT-based with a **1-hour max age**
- JWTs are validated on every request via middleware
- Role changes take effect on the user's next login (when the current JWT expires)
- Session cookies use `httpOnly`, `sameSite: lax`, and `secure` (in production) flags

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

### SSO Secret Encryption

SSO provider client secrets are encrypted before being stored in the database:

- **Algorithm**: AES-256-GCM
- **Key derivation**: PBKDF2 from `AUTH_SECRET`
- **Storage format**: Base64-encoded IV + ciphertext + auth tag

If `AUTH_SECRET` is rotated, existing encrypted SSO secrets must be re-configured.

### API Response Stripping

Connection credentials are **never** returned in API responses:

- `GET /api/connections` — returns `username` for display only; no passwords, keys, or tokens
- `POST /api/connections` and `PUT /api/connections/[id]` — response strips credentials
- `GET /api/connections/[id]` — returns full credentials for the edit form (authenticated endpoint only)
- Browse, test, and run endpoints — never return connection data

### Password Handling

- User passwords are hashed with **bcrypt** (12 salt rounds) and never stored in plaintext
- Password hashes are excluded from all API responses (user list, user detail)
- Password reset requires administrator action via the admin UI

### Log Redaction

The pino logger automatically redacts these fields anywhere they appear in a log object (at any nesting depth):

`password`, `privateKey`, `passphrase`, `accountKey`, `connectionString`, `token`, `secret`, `credentials`

These are replaced with `"[REDACTED]"` before the log line is written — they never reach your log aggregation system.

### Database Storage

Connection credentials are stored as JSON in the `connections.credentials` column of the SQLite database. The database file itself is not encrypted at rest.

> **Known Gap**: Field-level encryption for connection credentials at rest is planned (see [Roadmap](Roadmap)). Until implemented, secure the database file with filesystem permissions (`chmod 600 data/filebridge.db`) and restrict access to the host.

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

## Setup Wizard Security

The setup wizard endpoint (`POST /api/setup`) is protected against misuse:

- Guarded by `isFirstRun()` — returns **403 Forbidden** if any users already exist
- Can only be used once; after the first user is created, the endpoint is permanently disabled
- The `/setup` page checks status on load and redirects to `/login` if setup is already complete

---

## Audit Trail

All security-relevant actions are recorded in the `audit_logs` table:

- User sign-ins and sign-outs (success and denied)
- CRUD on connections, jobs, and users (with field-level diffs for updates)
- Job executions (manual and scheduled)
- Settings changes
- IP addresses of all actions

See [Audit Logging](Audit-Logging) for full details.

---

## Known Security Gaps

The following issues are acknowledged and tracked in the [Roadmap](Roadmap):

| Gap | Risk | Status |
|---|---|---|
| Connection credentials not encrypted at rest | If the database file is stolen, connection credentials are readable as JSON | Planned: libsodium field encryption |
| No API input validation (Zod schemas on POST/PUT) | Malformed input could cause unexpected behavior | Planned |
| No rate limiting | Brute-force or DoS possible on API routes (including login) | Planned |
| No CSRF protection | Same-origin policy provides some protection, but no explicit CSRF tokens | Planned |

---

## Production Hardening Checklist

- [ ] Run behind HTTPS (TLS termination at reverse proxy)
- [ ] Use a strong, unique `AUTH_SECRET` (generate with `openssl rand -base64 32`)
- [ ] Complete the setup wizard immediately after first deployment to create the admin account
- [ ] Create user accounts with least-privilege roles (use Viewer for read-only users)
- [ ] Restrict filesystem permissions on `data/filebridge.db` (`chmod 600`)
- [ ] Mount the data volume to reliable, backed-up storage
- [ ] Enable automated database backups in Settings
- [ ] Forward structured logs to a SIEM or log aggregation platform
- [ ] Configure uptime monitoring on `GET /api/health`
- [ ] If using SSO, set expiry alerts for client secrets in your identity provider
- [ ] Review the audit log regularly for unexpected access patterns
- [ ] Keep `AUTH_BYPASS_DEV` unset (or `false`) in all non-development environments

---

## Reporting Security Issues

If you discover a security vulnerability in FileBridge, please report it responsibly to the project maintainers rather than creating a public GitHub issue.
