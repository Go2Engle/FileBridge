# Authentication

FileBridge uses **NextAuth v5** (Auth.js) with **Azure AD (Microsoft Entra ID)** as the identity provider. Authentication protects every page and API route — only users who sign in with an allowed Azure AD identity can access the application.

---

## How It Works

1. The user visits FileBridge and is redirected to Microsoft's login page
2. After a successful Azure AD sign-in, Microsoft issues an OAuth token
3. NextAuth validates the token and creates a server-side session
4. The session is checked on every protected request via `middleware.ts`
5. If access control is configured, the user's email and group memberships are checked

---

## Setting Up Azure AD

### Step 1 — Register an Application

1. Go to the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations**
2. Click **New registration**
3. Set the **Name** (e.g. "FileBridge")
4. Set **Supported account types** to "Accounts in this organizational directory only" (single tenant)
5. Set the **Redirect URI**:
   - Type: **Web**
   - URI: `https://your-domain.com/api/auth/callback/azure-ad`
   - For local development: `http://localhost:3000/api/auth/callback/azure-ad`
6. Click **Register**

### Step 2 — Collect Credentials

From the **Overview** page, copy:
- **Application (client) ID** → `AZURE_AD_CLIENT_ID`
- **Directory (tenant) ID** → `AZURE_AD_TENANT_ID`

### Step 3 — Create a Client Secret

1. Go to **Certificates & secrets** → **New client secret**
2. Set a description and expiry
3. Copy the **Value** immediately (it won't be shown again) → `AZURE_AD_CLIENT_SECRET`

### Step 4 — Configure API Permissions (Optional)

For group-based access control, grant the `GroupMember.Read.All` permission:

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph**
2. Select **Application permissions** → `GroupMember.Read.All`
3. Click **Grant admin consent**

---

## Environment Variables

```env
AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_CLIENT_SECRET=your-client-secret-value
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://your-domain.com
```

---

## Access Control

By default, any user with a valid account in your Azure AD tenant can sign in. You can restrict access further:

### Email Allowlist

Set `ALLOWED_EMAILS` to a comma-separated list of permitted email addresses:

```env
ALLOWED_EMAILS=alice@example.com,bob@example.com,carol@example.com
```

Users not in this list will be denied access after signing in.

### Group Allowlist

Set `ALLOWED_GROUP_IDS` to a comma-separated list of Azure AD group object IDs:

```env
ALLOWED_GROUP_IDS=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx,yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
```

Users must be a member of at least one listed group to gain access. Obtain group object IDs from **Azure portal** → **Groups** → select a group → **Overview** → **Object ID**.

### Combining Both

If both `ALLOWED_EMAILS` and `ALLOWED_GROUP_IDS` are set, a user must satisfy **at least one** of the checks (union, not intersection).

---

## Login Audit Events

Every sign-in attempt is recorded in the audit log with:
- **Action**: `login`
- **Resource**: `auth`
- **User ID**: the authenticated email address
- **Details**: `{ outcome: "success" | "denied" }`
- **IP address**: extracted from request headers

See [Audit Logging](Audit-Logging) for more.

---

## Dev Bypass Mode

For local development without an Azure AD application, set:

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
```

In bypass mode:
- All authentication checks are skipped
- A mock session is injected with the user email `dev@localhost`
- The middleware passes all requests through without validation
- Azure AD environment variables are not required at startup

> **Warning**: Dev bypass mode is only active when `NODE_ENV=development`. It is enforced in middleware and cannot be enabled in production builds.

---

## Session Management

FileBridge uses NextAuth's default session strategy (JWT-based cookies). Sessions are server-validated on every request. There is no explicit session duration configuration exposed — the NextAuth defaults apply (typically 30 days with sliding expiry).

---

## Middleware

`middleware.ts` intercepts every request (except `/api/auth/*`, static files, and Next.js internals) and:

1. Generates or propagates a `X-Request-ID` correlation UUID for log tracing
2. Checks for a valid NextAuth session
3. Redirects unauthenticated requests to the sign-in page

The matcher pattern is:

```ts
matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"]
```
