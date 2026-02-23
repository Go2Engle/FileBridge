# Getting Started

This guide walks you through installing FileBridge, running the setup wizard, and creating your first transfer job.

---

## Prerequisites

- **Node.js 18+** (LTS recommended — v20 or v22)
- **npm**, **yarn**, or **pnpm**

No external authentication provider is required to get started. FileBridge includes built-in local authentication.

---

## Installation

```bash
git clone https://github.com/your-org/filebridge.git
cd filebridge
npm install
```

---

## Configuration

Copy the example environment file:

```bash
cp .env.example .env.local
```

At minimum you need:

```env
AUTH_SECRET=<generate with: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
```

That's it. No external provider credentials are needed — SSO providers can be configured later through the admin UI.

See [Configuration](Configuration) for the full list of environment variables.

### Development Without Login

To run locally without creating a user account, use dev bypass mode:

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
AUTH_SECRET=any-random-string-for-dev
NEXTAUTH_URL=http://localhost:3000
```

See [Authentication](Authentication) for details.

---

## Running the Application

### Development (with hot reload)

```bash
npm run dev
```

For human-readable colorized log output during development:

```bash
npm run dev:pretty
```

The app will be available at [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build
npm start
```

> **Note**: `NODE_OPTIONS=--openssl-legacy-provider` is required for SMB/CIFS NTLMv2 support on Node.js 17+. The `npm run dev` and `npm start` scripts set this automatically.

---

## Database

The SQLite database is **automatically created** at `data/filebridge.db` on first startup. No migration scripts need to be run — the schema initializes itself.

To browse the database with Drizzle Studio:

```bash
npm run db:studio
```

---

## Setup Wizard

On first launch, FileBridge detects that no users exist and automatically redirects to the **Setup Wizard** at `/setup`:

1. **Welcome** — overview of what the wizard will configure
2. **Create Admin Account** — enter a username, display name, email (optional), and password
3. **Complete** — redirects to the login page

After completing the wizard, sign in with the credentials you just created.

> The setup wizard is a one-time process. Once the first user is created, the `/setup` endpoint is permanently disabled.

---

## First Steps After Setup

1. **Sign in** — Use the admin credentials you created during setup
2. **Create a connection** — Go to **Connections** → **New Connection** and configure your source or destination (SFTP, SMB, or Azure Blob)
3. **Test the connection** — Use the **Test Connection** button to verify credentials and reachability
4. **Create a job** — Go to **Jobs** → **New Job**, pick source and destination connections, set a schedule and file filter
5. **Run Now** — Trigger an immediate execution to verify everything works
6. **Check logs** — Review per-file transfer results on the **Logs** page

### Optional: Configure SSO

To enable external sign-in (Azure AD, GitHub):

1. Go to **Admin → Authentication** → **Add Provider**
2. Enter your provider's Client ID, Client Secret, and Tenant ID (Azure AD) or just Client ID and Secret (GitHub)
3. Pre-create SSO user accounts at **Admin → Users** with matching email addresses

See [Authentication](Authentication) for detailed provider setup instructions.

---

## Next Steps

- [Configuration](Configuration) — All environment variables
- [Authentication](Authentication) — Local auth, SSO setup, user management, RBAC
- [Connections](Connections) — SFTP, SMB, and Azure Blob Storage setup
- [Jobs](Jobs) — Scheduling, filtering, post-transfer actions
- [Docker Deployment](Docker-Deployment) — Container-based deployment
