# Server Install

The quickest way to deploy FileBridge on a Linux server or macOS machine is the one-liner install script. It handles everything: checking prerequisites, installing Node.js if needed, downloading the latest release, creating OS-standard directories, generating a secure `AUTH_SECRET`, and registering FileBridge as a system service that starts automatically on boot.

---

## One-Liner Install

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash
```

> **macOS**: The installer runs without `sudo` — it installs to user-local directories and registers a launchd agent.

The script is interactive. It will ask for:
- Your external URL (e.g. `https://files.example.com` or `http://localhost:3000`)
- The port to listen on (default: `3000`)

Everything else is automatic.

---

## What the Installer Does

### 1 — System check
Verifies OS, CPU architecture, and `curl`. If Node.js 20+ is not found, it offers to install it automatically via NodeSource (Linux) or Homebrew (macOS).

### 2 — Fetch latest release
Queries the GitHub Releases API for the latest version tag.

### 3 — Configuration
Prompts for your URL and port, then generates a cryptographically secure `AUTH_SECRET` using `openssl rand`.

### 4 — Prepare system *(Linux only)*
Creates a locked-down `filebridge` system user (`--no-create-home --shell /bin/false`) and sets directory ownership.

### 5 — Download and extract
Downloads the pre-built standalone tarball for your platform from GitHub Releases and extracts it to the app directory.

### 6 — Write configuration
Writes `/etc/filebridge/filebridge.env` (Linux) or `~/.config/filebridge/filebridge.env` (macOS) with all required environment variables.

### 7 — Register and start service
Installs and enables a **systemd** unit (Linux) or **launchd** plist (macOS), then starts the service and waits for the `/api/health` endpoint to respond.

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

---

## AUTH_SECRET

The installer generates a unique `AUTH_SECRET` and writes it to the config file. This secret:
- Signs user sessions
- Encrypts SSO provider credentials stored in the database

**You must back up the config file alongside your database.** If the secret is lost, stored SSO credentials cannot be recovered after a server rebuild.

The full value is displayed at the end of a fresh install. On upgrades, the existing secret is always preserved — the installer never overwrites the config file.

---

## Upgrading

Re-run the script with `--upgrade`:

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash -s -- --upgrade
```

The upgrade process:
1. Compares the installed version to the latest GitHub release
2. Backs up `filebridge.db` to the backups directory with a timestamp
3. Stops the service
4. Extracts the new release over `/opt/filebridge/` (config and data directories are untouched)
5. Restarts the service and waits for the health check

If FileBridge is already at the latest version, the script exits with a confirmation message.

---

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash -s -- --uninstall
```

This removes the application files, service unit, and system user. Your data and config (`/var/lib/filebridge/`, `/etc/filebridge/`) are **preserved**.

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

Then restart the service.

---

## Non-Interactive (Automated) Install

Set environment variables before running the script to skip prompts — useful for provisioning scripts and CI pipelines:

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

| Variable | Description | Default |
|---|---|---|
| `FILEBRIDGE_URL` | External URL (`NEXTAUTH_URL`) | `http://localhost:3000` |
| `FILEBRIDGE_PORT` | Port to listen on | `3000` |
| `FILEBRIDGE_AUTH_SECRET` | Use an existing secret instead of generating one | *(auto-generated)* |

---

## Supported Platforms

| Platform | Architectures | Service manager |
|---|---|---|
| Ubuntu 20.04+ / Debian 11+ | x86_64, arm64 | systemd |
| RHEL / CentOS / Rocky / AlmaLinux 8+ | x86_64, arm64 | systemd |
| Fedora 36+ | x86_64, arm64 | systemd |
| macOS 13+ (Ventura+) | x86_64 (Intel), arm64 (Apple Silicon) | launchd |

> The install script builds the Node.js process manager integration for whichever platform it detects. Pre-built tarballs for all four platform/arch combinations are published to [GitHub Releases](https://github.com/go2engle/filebridge/releases) on every version tag.

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
