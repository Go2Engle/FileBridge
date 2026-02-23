# Getting Started

This guide walks you through installing FileBridge, configuring it for first use, and running your first transfer job.

---

## Prerequisites

- **Node.js 18+** (LTS recommended — v20 or v22)
- **npm**, **yarn**, or **pnpm**
- An **Azure AD / Microsoft Entra ID application** for authentication (or use [dev bypass mode](Authentication#dev-bypass-mode) for local development)

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

# Azure AD (skip if using dev bypass)
AZURE_AD_CLIENT_ID=your-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret
AZURE_AD_TENANT_ID=your-tenant-id
```

See [Configuration](Configuration) for the full list of environment variables.

### Development Without Azure AD

To run locally without Azure AD, use dev bypass mode:

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

## First Steps After Install

1. **Sign in** — Use your Azure AD account (or the dev bypass)
2. **Create a connection** — Go to **Connections** → **New Connection** and configure your source or destination (SFTP, SMB, or Azure Blob)
3. **Test the connection** — Use the **Test Connection** button to verify credentials and reachability
4. **Create a job** — Go to **Jobs** → **New Job**, pick source and destination connections, set a schedule and file filter
5. **Run Now** — Trigger an immediate execution to verify everything works
6. **Check logs** — Review per-file transfer results on the **Logs** page

---

## Next Steps

- [Configuration](Configuration) — All environment variables
- [Authentication](Authentication) — Azure AD setup and access control
- [Connections](Connections) — SFTP, SMB, and Azure Blob Storage setup
- [Jobs](Jobs) — Scheduling, filtering, post-transfer actions
- [Docker Deployment](Docker-Deployment) — Container-based deployment
