# Server Install

The quickest way to deploy FileBridge on a Linux server, macOS machine, or Windows host is the one-liner install script. It handles everything: checking prerequisites, installing Node.js if needed, downloading the latest release, creating OS-standard directories, generating a secure `AUTH_SECRET`, and registering FileBridge as a system service that starts automatically on boot.

---

## One-Liner Install

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash
```

> **macOS**: The installer runs without `sudo` — it installs to user-local directories and registers a launchd agent.

### Windows (PowerShell — run as Administrator)

```powershell
irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
```

> Open PowerShell by right-clicking the Start button and selecting **"Windows PowerShell (Admin)"** or **"Terminal (Admin)"**.

The script is interactive. It will ask for:
- Your external URL (e.g. `https://files.example.com` or `http://localhost:3000`)
- The port to listen on (default: `3000`)

Everything else is automatic.

---

## What the Installer Does

### 1 — System check
Verifies OS and CPU architecture. If Node.js 20+ is not found, it offers to install it automatically:
- **Linux**: via NodeSource (apt/yum)
- **macOS**: via Homebrew
- **Windows**: via `winget`, falling back to a silent `.msi` download from nodejs.org

### 2 — Fetch latest release
Queries the GitHub Releases API for the latest version tag.

### 3 — Configuration
Prompts for your URL and port, then generates a cryptographically secure `AUTH_SECRET`:
- **Linux / macOS**: `openssl rand` or Python `secrets`
- **Windows**: .NET `RandomNumberGenerator`

### 4 — Prepare system *(Linux only)*
Creates a locked-down `filebridge` system user (`--no-create-home --shell /bin/false`) and sets directory ownership.

### 5 — Download and extract
Downloads the pre-built standalone package for your platform from GitHub Releases:
- **Linux / macOS**: `.tar.gz` extracted with `tar`
- **Windows**: `.zip` extracted with `Expand-Archive`

### 6 — Write configuration
Writes the environment file with all required variables (paths vary by OS — see [Directory Layout](#directory-layout) below).

### 7 — Register and start service
- **Linux**: installs and enables a **systemd** unit
- **macOS**: installs and loads a **launchd** plist
- **Windows**: downloads [NSSM](https://nssm.cc) and registers a **Windows Service** set to auto-start

The script then waits for the `/api/health` endpoint to confirm the service is up.

---

## Directory Layout

### Linux

| Path | Purpose |
|---|---|
| `/opt/filebridge/` | Application files (Node.js standalone) |
| `/etc/filebridge/filebridge.env` | Environment config and `AUTH_SECRET` |
| `/var/lib/filebridge/` | SQLite database (`filebridge.db`) |
| `/var/lib/filebridge/backups/` | Automated database backups |
| `/var/log/filebridge/` | Log files (journald is primary) |

### macOS

| Path | Purpose |
|---|---|
| `/usr/local/opt/filebridge/` | Application files |
| `~/.config/filebridge/filebridge.env` | Environment config and `AUTH_SECRET` |
| `~/.local/share/filebridge/` | SQLite database |
| `~/.local/share/filebridge/backups/` | Database backups |
| `~/.local/share/filebridge/logs/` | Log files |

### Windows

| Path | Purpose |
|---|---|
| `C:\Program Files\FileBridge\` | Application files |
| `C:\ProgramData\FileBridge\filebridge.env` | Environment config and `AUTH_SECRET` |
| `C:\ProgramData\FileBridge\data\` | SQLite database (`filebridge.db`) |
| `C:\ProgramData\FileBridge\backups\` | Database backups |
| `C:\ProgramData\FileBridge\logs\` | Log files |

---

## AUTH_SECRET

The installer generates a unique `AUTH_SECRET` and writes it to the config file. This secret:
- Signs user sessions
- Encrypts SSO provider credentials stored in the database

**You must back up the config file alongside your database.** If the secret is lost, stored SSO credentials cannot be recovered after a server rebuild.

The full value is displayed at the end of a fresh install. On upgrades, the existing secret is always preserved — the installer never overwrites the config file.

---

## Upgrading

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash -s -- --upgrade
```

### Windows (PowerShell — run as Administrator)

```powershell
$env:FILEBRIDGE_MODE = 'upgrade'; irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
```

The upgrade process:
1. Compares the installed version to the latest GitHub release
2. Backs up `filebridge.db` to the backups directory with a timestamp
3. Stops the service
4. Extracts the new release over the app directory (config and data directories are untouched)
5. Restarts the service and waits for the health check

If FileBridge is already at the latest version, the script exits with a confirmation message.

---

## Uninstalling

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash -s -- --uninstall
```

### Windows (PowerShell — run as Administrator)

```powershell
$env:FILEBRIDGE_MODE = 'uninstall'; irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
```

This removes the application files, service registration, and (on Linux) the system user. Your data and config directories are **preserved**.

---

## Managing the Service

### Linux (systemd)

```bash
# Status
systemctl status filebridge

# Logs (follow)
journalctl -fu filebridge

# Stop / Start / Restart
systemctl stop filebridge
systemctl start filebridge
systemctl restart filebridge
```

### macOS (launchd)

```bash
# Status
launchctl list com.filebridge.app

# Logs (follow)
tail -f ~/.local/share/filebridge/logs/filebridge.log

# Stop / Start
launchctl stop com.filebridge.app
launchctl start com.filebridge.app
```

### Windows (Windows Service)

```powershell
# Status
Get-Service -Name FileBridge

# Stop / Start / Restart
Stop-Service    -Name FileBridge
Start-Service   -Name FileBridge
Restart-Service -Name FileBridge

# Logs (follow)
Get-Content 'C:\ProgramData\FileBridge\logs\filebridge.log' -Tail 50 -Wait
```

You can also manage the service from **Services** (`services.msc`) in the Windows administrative tools.

---

## Reverse Proxy

In production, run FileBridge behind a reverse proxy for TLS termination. See the [Docker Deployment](Docker-Deployment#reverse-proxy) page for nginx and Caddy examples — the proxy config is identical regardless of whether you used the install script or Docker.

Update `NEXTAUTH_URL` in your config file to your public HTTPS URL if you didn't provide it during install:

```bash
# Linux
sudo nano /etc/filebridge/filebridge.env

# macOS
nano ~/.config/filebridge/filebridge.env
```

```powershell
# Windows
notepad 'C:\ProgramData\FileBridge\filebridge.env'
```

Then restart the service.

---

## Non-Interactive (Automated) Install

Set environment variables before running the script to skip prompts — useful for provisioning scripts and CI pipelines.

### Linux / macOS

```bash
FILEBRIDGE_URL=https://files.example.com \
FILEBRIDGE_PORT=3000 \
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash
```

To reuse an existing `AUTH_SECRET` (e.g. when rebuilding a server):

```bash
FILEBRIDGE_URL=https://files.example.com \
FILEBRIDGE_AUTH_SECRET=your-existing-secret \
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash
```

### Windows

```powershell
$env:FILEBRIDGE_URL         = 'https://files.example.com'
$env:FILEBRIDGE_PORT        = '3000'
$env:FILEBRIDGE_AUTH_SECRET = 'your-existing-secret'   # omit to auto-generate
irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
```

| Variable | Description | Default |
|---|---|---|
| `FILEBRIDGE_URL` | External URL (`NEXTAUTH_URL`) | `http://localhost:3000` |
| `FILEBRIDGE_PORT` | Port to listen on | `3000` |
| `FILEBRIDGE_AUTH_SECRET` | Use an existing secret instead of generating one | *(auto-generated)* |
| `FILEBRIDGE_MODE` | `install` \| `upgrade` \| `uninstall` \| `reinstall` | `install` |

---

## Supported Platforms

| Platform | Architectures | Service manager |
|---|---|---|
| Ubuntu 20.04+ / Debian 11+ | x86_64, arm64 | systemd |
| RHEL / CentOS / Rocky / AlmaLinux 8+ | x86_64, arm64 | systemd |
| Fedora 36+ | x86_64, arm64 | systemd |
| macOS 13+ (Ventura+) | x86_64 (Intel), arm64 (Apple Silicon) | launchd |
| Windows 10+ / Windows Server 2019+ | x86_64, arm64 | Windows Service (NSSM) |

> Pre-built packages for all platform/arch combinations are published to [GitHub Releases](https://github.com/go2engle/filebridge/releases) on every version tag (`.tar.gz` for Linux/macOS, `.zip` for Windows).

---

## First-Run Setup

Once the service is running, open your browser to the URL you configured. FileBridge detects that no users exist and redirects to the **Setup Wizard**:

1. **Create Admin Account** — enter a username, display name, and password
2. **Sign in** with the credentials you just created
3. **Create connections** → **Create jobs** → **Run Now**

See [Getting Started](Getting-Started#first-steps-after-setup) for the full first-steps walkthrough.

---

## Next Steps

- [Configuration](Configuration) — Full list of environment variables
- [Authentication](Authentication) — SSO setup (Azure AD, GitHub), user management, RBAC
- [Database Backups](Database-Backups) — Automated backup scheduling and restore
- [Connections](Connections) — SFTP, SMB/CIFS, and Azure Blob Storage setup
