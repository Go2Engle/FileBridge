
<div align="center">
  <img src="images/FileBridgeLogo.png" alt="FileBridge Logo" width="600" />
</div>

# FileBridge

<div align="center">

[![Release & Publish](https://github.com/Go2Engle/FileBridge/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/Go2Engle/FileBridge/actions/workflows/docker-publish.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Go2Engle/FileBridge?logo=github&logoColor=white&color=4c1)](https://github.com/Go2Engle/FileBridge/releases/latest)
[![Docker](https://img.shields.io/badge/ghcr.io%2Fgo2engle%2Ffilebridge-2496ED?logo=docker&logoColor=white&label=docker)](https://github.com/Go2Engle/FileBridge/pkgs/container/filebridge)
[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://sqlite.org)
[![License](https://img.shields.io/badge/License-Private-critical)](LICENSE)

</div>

A self-hosted web application for automated file transfer scheduling and monitoring. FileBridge connects your SFTP, SMB/CIFS, and Azure Blob Storage systems through a modern dashboard, letting you define transfer jobs with cron scheduling, glob filtering, archive extraction, and comprehensive audit logging — all packaged as a single lightweight container.

---

## Features

- **Multi-protocol transfers** — SFTP, SMB/CIFS (NTLMv2), and Azure Blob Storage, with a pluggable interface for future protocols
- **Cron scheduling** — Full cron expression support with preset shortcuts; manual Run Now trigger
- **Glob file filtering** — `*.csv`, `report_*.xlsx`, comma-separated multi-pattern support
- **Delta sync** — Skip files that are already up to date at the destination
- **Archive extraction** — Auto-extract ZIP, TAR, TAR.GZ, and TGZ at the destination
- **Post-transfer actions** — Retain, delete, or move source files after transfer
- **Job dry run** — Preview exactly what a job would do before running it for real
- **Audit logging** — Complete security trail: who did what, when, from where, with field-level diffs
- **Structured logging** — pino JSON output to stdout; natively ingestable by Datadog, Grafana Loki, CloudWatch, Azure Monitor
- **Automated backups** — Scheduled SQLite snapshots with integrity verification and in-app restore
- **Health check endpoint** — `GET /api/health` for Kubernetes liveness/readiness probes
- **Azure AD SSO** — Enterprise single sign-on with email and group-based access control
- **Dashboard** — KPI cards, 7-day transfer chart, job status list, activity feed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Authentication | NextAuth v5 (Auth.js) + Azure AD |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| UI Components | shadcn/ui (new-york style) |
| Styling | Tailwind CSS v4 |
| State Management | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| SFTP | ssh2-sftp-client |
| SMB/CIFS | v9u-smb2 (NTLMv2-capable) |
| Azure Blob Storage | @azure/storage-blob |
| Scheduler | node-cron |
| Logging | pino |

---

## Quick Start

```bash
git clone https://github.com/your-org/filebridge.git
cd filebridge
npm install
cp .env.example .env.local   # fill in your values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Minimum .env for local development (no Azure AD)

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
AUTH_SECRET=any-random-string-for-dev
NEXTAUTH_URL=http://localhost:3000
```

### Minimum .env for production

```env
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://your-domain.com
AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_CLIENT_SECRET=your-client-secret
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

The SQLite database is created automatically at `data/filebridge.db` on first startup. No migration step required.

---

## Docker

```bash
docker build -t filebridge .
docker run -d \
  -p 3000:3000 \
  -v filebridge-data:/app/data \
  --env-file .env.production \
  filebridge
```

> `NODE_OPTIONS=--openssl-legacy-provider` must be set in the container for SMB/CIFS support. The Dockerfile sets this automatically.

---

## Documentation

Full documentation is available in the [project wiki](../../wiki):

| Page | Description |
|---|---|
| [Getting Started](../../wiki/Getting-Started) | Installation, prerequisites, first run |
| [Configuration](../../wiki/Configuration) | All environment variables and app settings |
| [Authentication](../../wiki/Authentication) | Azure AD setup, access control, dev bypass |
| [Connections](../../wiki/Connections) | SFTP, SMB/CIFS, and Azure Blob Storage |
| [Jobs](../../wiki/Jobs) | Scheduling, filtering, delta sync, dry run |
| [Transfer Engine](../../wiki/Transfer-Engine) | How transfers work under the hood |
| [API Reference](../../wiki/API-Reference) | All REST API endpoints |
| [Audit Logging](../../wiki/Audit-Logging) | Security audit trail |
| [Structured Logging](../../wiki/Structured-Logging) | pino logging and monitoring integration |
| [Database Backups](../../wiki/Database-Backups) | Automated backups and restore |
| [Health Check](../../wiki/Health-Check) | Kubernetes liveness/readiness probes |
| [Architecture](../../wiki/Architecture) | System design and database schema |
| [Docker Deployment](../../wiki/Docker-Deployment) | Container deployment guide |
| [Extending FileBridge](../../wiki/Extending-FileBridge) | Adding new storage providers and features |
| [Security](../../wiki/Security) | Security model and hardening checklist |
| [Roadmap](../../wiki/Roadmap) | Planned features and known gaps |

---

## License

Private — internal use only.
