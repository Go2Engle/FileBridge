
<div align="center">
  <img src="images/FileBridgeLogo.png" alt="FileBridge Logo" width="600" />
</div>

# FileBridge

<div align="center">

[![Release & Publish](https://github.com/Go2Engle/FileBridge/actions/workflows/release.yml/badge.svg)](https://github.com/Go2Engle/FileBridge/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Go2Engle/FileBridge?logo=github&logoColor=white&color=4c1)](https://github.com/Go2Engle/FileBridge/releases/latest)
[![Docker](https://img.shields.io/badge/ghcr.io%2Fgo2engle%2Ffilebridge-2496ED?logo=docker&logoColor=white&label=docker)](https://github.com/Go2Engle/FileBridge/pkgs/container/filebridge)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://sqlite.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

</div>

A self-hosted web application for automated file transfer scheduling and monitoring. FileBridge connects your SFTP, SMB/CIFS, and Azure Blob Storage systems through a modern dashboard, letting you define transfer jobs with cron scheduling, glob filtering, archive extraction, and comprehensive audit logging — all packaged as a single lightweight container.

**[Full documentation at go2engle.com/FileBridge](https://go2engle.com/FileBridge)**

---

## Quick Start

```bash
git clone https://github.com/Go2Engle/FileBridge.git
cd FileBridge
npm install
cp .env.example .env   # fill in your values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The SQLite database is created automatically on first boot and a setup wizard guides you through creating the initial admin account.

**Minimum `.env` for local development:**

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
AUTH_SECRET=any-random-string-for-dev
NEXTAUTH_URL=http://localhost:3000
```

**Minimum `.env` for production:**

```env
AUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://your-domain.com
```

---

## Native Install (Linux / macOS / Windows)

The one-liner installer handles Node.js, downloads the latest release, and registers FileBridge as a system service.

> **Recommended deployment**: An **Ubuntu VM** with the one-liner install below gives you the smoothest experience — systemd service management, structured log output, and the built-in one-click updater. All other install options (Docker, macOS, Windows) are fully supported and production-viable; choose whatever fits your environment.

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash
```

**Windows** (PowerShell — run as Administrator):

```powershell
# Fresh install
irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex

# Upgrade to latest version
$env:FILEBRIDGE_MODE = 'upgrade';   irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex

# Uninstall
$env:FILEBRIDGE_MODE = 'uninstall'; irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
```

Native installs include a **built-in updater**: when a new version is available, a notification appears in the sidebar. Admins can apply the update with one click from **Settings → About** — the service restarts automatically in ~30 seconds with no manual SSH required.

---

## Docker

```bash
docker run -d \
  -p 3000:3000 \
  -v filebridge-data:/app/data \
  --env-file .env \
  ghcr.io/go2engle/filebridge:latest
```

> `NODE_OPTIONS=--openssl-legacy-provider` is required for SMB/CIFS support. The published image sets this automatically.

---

## Documentation

Full documentation, configuration reference, and guides are available at **[go2engle.com/FileBridge](https://go2engle.com/FileBridge)**.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code conventions, and the pull request process.

---

## License

[MIT](LICENSE)
