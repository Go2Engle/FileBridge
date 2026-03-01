# FileBridge

Welcome to the FileBridge documentation. FileBridge is a self-hosted web application for automated file transfer scheduling and monitoring. It connects SFTP, SMB/CIFS, and Azure Blob Storage systems through a modern dashboard, letting you define transfer jobs with cron scheduling, glob filtering, archive extraction, and comprehensive audit logging.

---

## Quick Start

Get FileBridge running in one command. The script installs Node.js if needed, downloads the latest release, creates OS-standard directories, generates a secure `AUTH_SECRET`, and registers FileBridge as a system service that starts automatically on boot.

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash
```

**Windows** (PowerShell — run as Administrator):

```powershell
irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
```

:::tip Already using Docker?
Pull the pre-built image instead: `docker pull ghcr.io/go2engle/filebridge:latest` — see the [Docker Deployment](Docker-Deployment) guide.
:::

**Upgrading an existing install:**

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash -s -- --upgrade

# Windows (PowerShell — run as Administrator)
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1'))) -Upgrade
```

→ [Full Server Install guide](Server-Install) — options, directory layout, service management, non-interactive installs

---

## Quick Navigation

| Topic | Description |
|---|---|
| [Getting Started](Getting-Started) | Dev setup from source, first run, setup wizard |
| [Server Install](Server-Install) | One-liner production install for Linux, macOS, and Windows |
| [Docker Deployment](Docker-Deployment) | Container deployment (Docker, Compose, Kubernetes) |
| [Configuration](Configuration) | Environment variables and application settings |
| [Authentication](Authentication) | Azure AD SSO setup, access control, dev bypass |
| [Connections](Connections) | SFTP, SMB/CIFS, and Azure Blob Storage setup |
| [Jobs](Jobs) | Creating and managing transfer jobs |
| [Hooks](Hooks) | Pre/post-job webhooks, email alerts, and shell commands |
| [Hook Library](Hook-Library) | Browse, import, and manage hook templates |
| [Hook Template Authoring](Hook-Template-Authoring) | Write and submit community hook templates |
| [Transfer Engine](Transfer-Engine) | How transfers work under the hood |
| [API Reference](API-Reference) | All REST API endpoints |
| [Audit Logging](Audit-Logging) | Security audit trail |
| [Structured Logging](Structured-Logging) | Pino-based logging and monitoring integration |
| [Database Backups](Database-Backups) | Automated SQLite backup and restore |
| [Health Check](Health-Check) | Kubernetes liveness/readiness probes |
| [Architecture](Architecture) | System design and component overview |
| [Extending FileBridge](Extending-FileBridge) | Adding new storage providers and features |
| [Security](Security) | Security model, headers, and best practices |
| [Roadmap](Roadmap) | Planned features and known gaps |

---

## What FileBridge Does

FileBridge lets you define **transfer jobs** that move files between storage systems on a schedule or on demand:

- **Sources and destinations** can be any supported protocol (SFTP, SMB/CIFS, Azure Blob Storage)
- **Jobs run on a cron schedule** or are triggered manually from the dashboard
- **File filtering** via glob patterns (`*.csv`, `report_*.xlsx`) narrows what gets transferred
- **Post-transfer actions** let you retain, delete, or move source files after a successful transfer
- **Archive extraction** automatically unpacks ZIP, TAR, TAR.GZ, and TGZ files at the destination
- **Delta sync** skips files that are already up to date at the destination
- **Every file touched** is logged to an audit trail; every job execution is recorded

---

## Key Facts

- **Runtime**: Node.js 20.9+, Next.js 16 App Router
- **Database**: SQLite (auto-created, no migration step required)
- **Auth**: Azure AD SSO (Microsoft Entra ID) via NextAuth v5
- **Deployment**: Single process — native install (systemd/launchd) or Docker (standalone output)
- **Logging**: Structured JSON (pino) to stdout — compatible with Datadog, Grafana Loki, CloudWatch, Azure Monitor
