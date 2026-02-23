# Authentication

FileBridge uses **NextAuth v5** (Auth.js) with support for **local username/password authentication** and optional **external SSO providers** (Azure AD, GitHub). Authentication protects every page and API route. A two-tier role system (Administrator and Viewer) controls what authenticated users can do.

---

## How It Works

1. On first launch, FileBridge detects an empty user database and redirects to the **Setup Wizard**
2. The wizard creates the first local administrator account
3. Subsequent users sign in via the **Login** page using their username and password
4. If SSO providers are configured by an admin, SSO buttons appear on the login page
5. Sessions are JWT-based and validated on every request via `middleware.ts`

---

## First-Run Setup Wizard

When no users exist in the database, FileBridge automatically redirects to `/setup`. The wizard walks you through creating the initial administrator account:

1. **Welcome** — overview of what the wizard configures
2. **Create Admin** — set a username, display name, optional email, and password
3. **Complete** — redirects to the login page

> The setup endpoint (`POST /api/setup`) is guarded by `isFirstRun()` — it returns 403 if any users already exist. There is no way to re-run the wizard after the first user is created.

---

## Local Authentication

FileBridge supports built-in username/password login:

- Passwords are hashed with **bcrypt** (12 salt rounds) before storage
- The Credentials provider in NextAuth validates login attempts against the `users` table
- Failed login attempts show a generic "Invalid username or password" message (no user enumeration)

---

## SSO Providers

External SSO providers (Azure AD, GitHub) are configured entirely through the **Admin UI** — no environment variables needed.

### Configuring SSO

1. Sign in as an administrator
2. Navigate to **Admin → Authentication**
3. Click **Add Provider**
4. Fill in the provider details (Client ID, Client Secret, Tenant ID for Azure AD)
5. Save — the provider's "Sign in with..." button immediately appears on the login page

### Azure AD Setup

To configure Azure AD as an SSO provider:

1. Go to the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations**
2. Click **New registration**
3. Set the **Name** (e.g. "FileBridge")
4. Set **Supported account types** to "Accounts in this organizational directory only"
5. Set the **Redirect URI**:
   - Type: **Web**
   - URI: `https://your-domain.com/api/auth/callback/azure-ad`
   - For local development: `http://localhost:3000/api/auth/callback/azure-ad`
6. Click **Register**
7. Copy the **Application (client) ID** and **Directory (tenant) ID** from the Overview page
8. Create a **Client secret** under **Certificates & secrets**
9. Enter these values in FileBridge's **Admin → Authentication → Add Provider** form

### GitHub Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**
2. Set the **Authorization callback URL** to `https://your-domain.com/api/auth/callback/github`
3. Copy the **Client ID** and generate a **Client Secret**
4. Enter these values in FileBridge's **Admin → Authentication → Add Provider** form

### SSO User Provisioning

SSO follows a **deny-by-default** model. An administrator must pre-create a user account in **Admin → Users** before that person can sign in via SSO:

1. Create the user with their email address and set **Auth Type** to SSO
2. Select the appropriate SSO provider
3. When the user signs in via SSO, FileBridge matches them by SSO identity or email

Users who are not pre-created in FileBridge will be denied access even if they authenticate successfully with the SSO provider.

---

## Roles & Permissions (RBAC)

FileBridge has two roles:

| Role | Description |
|---|---|
| **Administrator** | Full access — can create/edit/delete connections, jobs, users, and SSO settings |
| **Viewer** | Read-only access — can view connections, jobs, logs, and settings but cannot modify anything |

### How Roles Work

- Roles are stored in the `users` table and stamped into the JWT token at login
- API routes enforce roles server-side: GET requests require any authenticated user, mutations require the `admin` role
- The UI hides mutation controls (create, edit, delete buttons) for viewers
- Role changes take effect on the user's next login (JWT maxAge is 1 hour)

### Role Enforcement

| Layer | Mechanism |
|---|---|
| API routes | `requireAuth()` for read operations, `requireRole("admin")` for mutations |
| Middleware | JWT validation (edge runtime — checks token existence, not role) |
| UI components | `useRole()` hook conditionally renders admin-only controls |

---

## User Management

Administrators can manage users at **Admin → Users**:

- **Create** users — local (username/password) or SSO-linked
- **Edit** users — change display name, email, role, active status, or reset password
- **Delete** users — with safeguards (cannot delete yourself, cannot delete the last admin)
- **Deactivate** users — toggle the active flag to disable login without deleting the account

---

## Environment Variables

The only required environment variable for authentication is:

```env
AUTH_SECRET=<openssl rand -base64 32>
```

SSO provider credentials (Client ID, Client Secret, Tenant ID) are stored in the database and configured via the admin UI. They are **encrypted at rest** using AES-256-GCM with a key derived from `AUTH_SECRET`.

---

## Login Audit Events

Every sign-in attempt is recorded in the audit log with:
- **Action**: `login`
- **Resource**: `auth`
- **User ID**: the authenticated username
- **Details**: `{ outcome: "success" | "denied" }`
- **IP address**: extracted from request headers

See [Audit Logging](Audit-Logging) for more.

---

## Dev Bypass Mode

For local development without creating user accounts, set:

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
```

In bypass mode:
- All authentication checks are skipped
- A mock session is injected with the user `dev@localhost` and the `admin` role
- The middleware passes all requests through without validation
- No user accounts or SSO configuration are needed

> **Warning**: Dev bypass mode is only active when `NODE_ENV=development`. It cannot be enabled in production builds.

---

## Session Management

FileBridge uses JWT-based sessions with a 1-hour max age. Sessions are validated on every request via middleware. When a user's role is changed by an admin, the change takes effect when the user next logs in (or when the current JWT expires).

---

## Middleware

`middleware.ts` intercepts every request (except public paths) and:

1. Generates or propagates a `X-Request-ID` correlation UUID for log tracing
2. Checks for a valid NextAuth JWT session
3. Redirects unauthenticated requests to `/login`

Public paths excluded from auth checks:
- `/` (root — handles first-run detection)
- `/login`
- `/setup`
- `/api/auth/*` (NextAuth endpoints)
- `/api/setup/*` (setup wizard API)
- `/api/health`
