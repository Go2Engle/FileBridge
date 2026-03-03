---
id: Testing
title: Testing
---

# Testing

FileBridge ships with a full automated test suite covering unit tests, API route tests, component tests, and React hook tests. All tests run with [Vitest](https://vitest.dev/) and are required to pass before any pull request can be merged.

---

## Running Tests

### Prerequisites

Tests require no running database or external service — all dependencies are mocked. The only environment variable needed is `AUTH_SECRET` (used by the crypto tests):

```bash
# One-time: set for the current shell session
export AUTH_SECRET="any-string-works-locally"   # Linux / macOS
$env:AUTH_SECRET = "any-string-works-locally"   # Windows PowerShell
```

### Commands

| Command | Description |
|---|---|
| `npm test` | Run the full suite once (exit 0 on pass — same as CI) |
| `npm run test:watch` | Watch mode — re-runs affected tests on file save |
| `npm run test:coverage` | Run suite and emit an HTML/LCOV coverage report |
| `npm run test:ui` | Open the Vitest browser UI for interactive debugging |
| `npm run lint` | ESLint only |
| `npm run typecheck` | TypeScript `tsc --noEmit` only |
| `npm run ci` | Lint + typecheck + full test suite (mirrors CI exactly) |

Coverage reports are written to `coverage/` and are uploaded as an artifact on every CI run.

---

## Test Structure

All tests live in the `__tests__/` directory, mirroring the structure of the source tree:

```
__tests__/
├── api/                         # API route handler tests
│   ├── audit-logs.test.ts
│   ├── connections.test.ts
│   ├── connections-test.test.ts
│   ├── health.test.ts
│   ├── hooks.test.ts
│   ├── jobs.test.ts
│   ├── pgp-keys.test.ts
│   ├── jobs-dry-run.test.ts
│   ├── jobs-run.test.ts
│   ├── setup.test.ts
│   ├── setup-status.test.ts
│   └── version.test.ts
├── components/                  # React component tests
│   └── theme-toggle.test.tsx
├── hooks/                       # React hook tests
│   ├── use-role.test.tsx
│   └── use-time-format.test.tsx
└── lib/                         # Pure library / utility tests
    ├── audit.test.ts
    ├── crypto.test.ts
    ├── storage/
    │   └── interface.test.ts
    ├── utils.test.ts
    ├── db/
    │   └── connections.test.ts
    ├── pgp/
    │   └── index.test.ts
    └── hooks/
        └── executor.test.ts
```

---

## Coverage by Area

### Library / Pure Logic

#### `lib/utils.ts`
Tests for all four exported helpers:
- **`cn()`** — Tailwind class merging, conditional classes, conflict resolution
- **`formatBytes()`** — SI unit formatting across B / KB / MB / GB / TB, decimal precision
- **`formatDuration()`** — ms / seconds / minutes formatting thresholds
- **`parseDBDate()`** — SQLite UTC timestamp parsing, timezone offset handling

#### `lib/crypto.ts`
Tests for AES-256-GCM field-level encryption:
- Round-trip encrypt → decrypt for simple strings, unicode, special characters, and 4 KB payloads
- Random IV: same input produces different ciphertext on every call
- Correct `iv:tag:data` output format
- Error when `AUTH_SECRET` is missing
- Error when ciphertext is tampered

#### `lib/audit.ts`
Tests for the three pure helper functions:
- **`getIpFromRequest()`** — `x-forwarded-for` (first IP, whitespace trimming), `x-real-ip` fallback, null when absent, preference ordering
- **`getUserId()`** — email, name fallback, `"unknown"` fallback
- **`diffChanges()`** — changed fields, no-change, added keys, removed keys, `skip` list, multiple changed fields

#### `lib/storage/interface.ts`
Tests for `globToRegex()`:
- Empty pattern matches everything
- Single extension (`*.csv`)
- Literal filename
- Prefix wildcard (`report_*`)
- Comma-separated patterns as OR (`*.csv, *.txt`)
- Three or more patterns
- `?` single-character wildcard
- Dot escaping (literal dot vs regex `.`)
- Whitespace trimming in comma-separated patterns
- Empty segments filtered out

#### `lib/db/connections.ts`
Tests for credentials encryption wrappers:
- `encryptCreds` / `decryptCreds` round-trip for simple, complex, and unicode credentials
- Encrypted output is opaque (not parseable as plain JSON, password not visible in plaintext)
- Random IV: different ciphertext per call, both decrypt correctly
- Legacy plaintext JSON fallback (migration guard)
- Invalid input returns `{}` without throwing

#### `lib/hooks/executor.ts`
Tests for the hook execution engine:
- Empty hook list completes silently
- Disabled hooks are skipped (fetch is never called)
- Webhook URL is called with the configured HTTP method
- `{{template}}` variables are interpolated into custom webhook bodies
- Success runs are recorded with `status: "success"` in `hookRuns`
- Non-2xx HTTP responses are recorded as `status: "failure"` and the error is thrown
- Network errors (fetch throws) are recorded and re-thrown
- Invalid config JSON is caught, logged, and thrown
- Multiple hooks execute in order; execution stops at the first failure
- Large response bodies are truncated to 4096 bytes with `[truncated]` marker

#### `lib/pgp/index.ts`
Tests for PGP key generation, metadata parsing, encryption/decryption, and utilities:
- ECC Curve25519 keypair generation produces valid armored keys and fingerprint
- RSA 4096 keypair generation produces valid keys
- Email is embedded in the key's userId when provided
- Expiration is set correctly when `expirationDays > 0`
- Different fingerprints are generated each time
- `parseKeyMetadata()` extracts fingerprint, algorithm, userId, and creation date from public keys
- `parseKeyMetadata()` detects private keys and sets `isPrivate: true`
- Public and private keys from the same keypair share the same fingerprint
- `encryptBuffer()` / `decryptBuffer()` round-trip preserves plaintext exactly
- Binary data (all 256 byte values) survives encryption round-trip
- Same plaintext produces different ciphertext each encryption (random session key)
- Passphrase-protected keys encrypt and decrypt correctly
- `stripPgpExtension()` strips `.pgp`, `.gpg`, and `.asc` extensions (case-insensitive)
- `stripPgpExtension()` returns unchanged filenames without PGP extensions
- `isPgpFile()` identifies PGP file extensions (case-insensitive)
- `isPgpFile()` returns false for non-PGP extensions

---

### API Routes

Each route handler is tested with all collaborators mocked (database, auth, scheduler, transfer engine) so no real SQLite file or network connection is needed.

#### `GET /api/health`
- Returns HTTP 200 and `status: "ok"` when all checks pass
- Returns HTTP 503 and `status: "degraded"` when the database throws
- Scheduler errors do not crash the handler; `checks.scheduler.status` is `"error"`
- Response includes `uptime` and `version` fields
- `checks.scheduler.scheduledJobs` reflects the actual count

#### `GET /api/version`
- `currentVersion` comes from `package.json`
- `updateAvailable: false` when already on latest
- `updateAvailable: true` when a newer GitHub release exists
- `updateAvailable: false` when running a pre-release ahead of the tag
- GitHub API failure is silently absorbed; `latestVersion` is `null`
- Non-200 GitHub API response is handled gracefully
- `releasesUrl` always points to the FileBridge GitHub releases page

#### `GET /api/setup/status`
- Returns `{ needsSetup: true }` when no users exist
- Returns `{ needsSetup: false }` after setup is complete
- Falls back to `{ needsSetup: true }` if the database throws

#### `POST /api/setup`
- Returns HTTP 403 if setup has already been completed
- Returns HTTP 201 with `{ success: true, userId }` on success
- `createUser` is called with the correct role (`"admin"`) and `isLocal: true`
- Validates username: minimum 3 characters, maximum 50 characters, allowed character set (`[a-zA-Z0-9_.-]`)
- Validates password: minimum 8 characters, max 128, must contain lowercase, uppercase, and a digit
- Returns HTTP 400 when passwords do not match
- Returns HTTP 400 for a missing display name
- Returns HTTP 409 when the username is already taken (UNIQUE constraint)
- Returns HTTP 500 on unexpected database errors

#### `GET /api/hooks` · `POST /api/hooks`
- GET returns HTTP 401 without a session
- GET returns the full list of hooks
- POST returns HTTP 401 / 403 for unauthenticated / non-admin callers
- POST validates: name required, name non-empty, type must be `webhook|shell|email`
- POST validates webhook: URL required
- POST validates email: SMTP host, from address, and recipient all required
- POST validates shell: command required and non-whitespace
- POST returns HTTP 201 for all three valid hook types

#### `GET /api/connections` · `POST /api/connections`
- GET returns HTTP 401 without a session
- GET returns the list of connections with credentials stripped
- GET exposes `username` (safe field) from the encrypted credentials object
- GET never exposes the password in any form
- POST returns HTTP 403 for non-admin callers
- POST returns HTTP 201 and strips credentials from the response
- POST returns HTTP 500 on database errors

#### `POST /api/connections/test`
- Returns HTTP 403 for non-admin callers
- Returns HTTP 400 for each missing required field (`protocol`, `host`, `port`, `credentials`)
- Returns `{ success: true }` with item count on successful connection
- Calls connect → listDirectory → disconnect in the correct order
- Returns `{ success: false, error }` (HTTP 200) when the provider connection fails
- Always calls `disconnect()` even when `connect()` fails
- Uses `getWorkingDirectory()` when the provider supports it
- Falls back to `"root"` when `getWorkingDirectory` is not available

#### `GET /api/jobs` · `POST /api/jobs`
- GET returns HTTP 401 without a session
- GET returns the array of jobs
- GET sets `nextRunAt: null` for inactive/error jobs
- GET computes a valid future ISO timestamp for active jobs with a valid cron
- GET returns `nextRunAt: null` when the cron expression is invalid
- POST returns HTTP 403 for non-admin callers
- POST returns HTTP 201 with the created job
- POST defaults `fileFilter` to `""` when omitted
- POST returns HTTP 500 on database errors

#### `POST /api/jobs/[id]/run`
- Returns HTTP 403 for non-admin callers
- Returns HTTP 200 with `{ message: "Job triggered" }`
- Calls `runJob(id)` asynchronously (fire-and-forget)
- Returns HTTP 200 even when the job does not exist in the database

#### `POST /api/jobs/[id]/dry-run`
- Returns HTTP 403 for non-admin callers
- Returns dry-run results (`wouldTransfer`, `skipped`, `totalFiles`, `totalBytes`)
- Returns HTTP 404 when the job is not found
- Returns HTTP 500 on unexpected engine errors
- Passes the correctly typed numeric ID to `dryRunJob()`

#### `GET /api/pgp-keys` · `POST /api/pgp-keys`
- GET returns HTTP 401 without a session
- GET returns the list of all keys (private material stripped)
- GET returns empty array when no keys exist
- POST (generate) returns HTTP 403 for non-admin callers
- POST (generate) returns HTTP 400 when name is missing or blank
- POST (generate) returns HTTP 400 for invalid algorithm
- POST (generate) returns HTTP 400 for invalid action
- POST (generate) returns HTTP 201 with the key (no private material in response)
- POST (import) returns HTTP 400 when public key is missing
- POST (import) returns HTTP 201 for a public-only key

#### `GET /api/pgp-keys/[id]` · `PUT /api/pgp-keys/[id]` · `DELETE /api/pgp-keys/[id]`
- GET returns HTTP 404 for non-existent key
- GET returns the key metadata
- PUT returns HTTP 403 for non-admin callers
- PUT returns HTTP 404 for non-existent key
- PUT returns HTTP 400 when name is empty
- PUT updates name and returns the key (no private material)
- DELETE returns HTTP 403 for non-admin callers
- DELETE returns HTTP 404 for non-existent key
- DELETE returns HTTP 409 when key is used by jobs (with job names)
- DELETE returns HTTP 204 on successful deletion

#### `POST /api/pgp-keys/[id]/rotate`
- Returns HTTP 403 for non-admin callers
- Returns HTTP 404 when source key does not exist
- Returns HTTP 400 when name is missing or algorithm is invalid
- Generates a new key and reassigns all jobs from the old key
- Returns HTTP 201 with `{ newKey, updatedJobCount }`
- Returns `updatedJobCount: 0` when no jobs use the key

#### `GET /api/audit-logs`
- Returns HTTP 401 without a session
- Returns `{ logs, total }` with the correct row count
- Returns empty logs when none exist
- Respects `offset` and `limit` query parameters
- Caps `limit` at 200

---

### React Components

#### `ThemeToggle`
- Renders with an accessible `"Toggle theme"` label
- Opens dropdown with Light / Dark / System items on click
- Calls `setTheme("light")` / `"dark"` / `"system"` on each item click

---

### React Hooks

#### `useRole()`
- Returns `{ role: "viewer", isAdmin: false }` with no session
- Returns `{ role: "admin", isAdmin: true }` for admin users
- Returns `{ role: "viewer", isAdmin: false }` for viewer users
- Defaults to `"viewer"` when session exists but `role` is undefined

#### `useTimeFormat()`
- Returns `"24h"` as the default while data is loading
- Returns `"12h"` / `"24h"` from the API response
- Falls back to `"24h"` on network error
- Always calls `GET /api/settings/display`

---

## CI Integration

Every pull request targeting `main` must pass three required status checks before it can be merged:

1. **Lint & Type Check** — ESLint + `tsc --noEmit`
2. **Unit & Integration Tests** — full Vitest run with coverage
3. **Build** — `next build` (only runs after checks 1 and 2 pass)

The workflow is defined in [`.github/workflows/ci.yml`](https://github.com/Go2Engle/FileBridge/blob/main/.github/workflows/ci.yml).

Coverage reports are uploaded as a `coverage-report` artifact on every run and are available in the Actions UI for 7 days.

### Branch Protection

To enforce these checks, configure branch protection on `main` in **Settings → Branches → Branch protection rules**:

- ✅ *Require status checks to pass before merging*
  - `Lint & Type Check`
  - `Unit & Integration Tests`
  - `Build`
- ✅ *Require branches to be up to date before merging*
- ✅ *Do not allow bypassing the above settings*

---

## Adding New Tests

### Naming Conventions

| Type | Location | Suffix |
|---|---|---|
| Library / util | `__tests__/lib/**` | `.test.ts` |
| API route | `__tests__/api/**` | `.test.ts` |
| React component | `__tests__/components/**` | `.test.tsx` |
| React hook | `__tests__/hooks/**` | `.test.tsx` |

### Mocking Guidelines

- **Database**: mock `@/lib/db` with `vi.mock` so no SQLite file is created
- **Auth**: mock `@/lib/auth/rbac` — return `{ session }` for authenticated, `{ error: Response }` for 401/403
- **External services**: mock at the module level (`@/lib/storage/registry`, `@/lib/transfer/engine`, etc.)
- **`fetch`**: use `vi.stubGlobal("fetch", ...)` and call `vi.unstubAllGlobals()` in cleanup

### Coverage Thresholds

The suite enforces minimum coverage thresholds (configured in `vitest.config.ts`):

| Metric | Threshold |
|---|---|
| Lines | 70% |
| Functions | 70% |
| Branches | 60% |
| Statements | 70% |

The build will fail if any threshold is not met.
