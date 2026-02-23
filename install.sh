#!/usr/bin/env bash
# ============================================================
#  FileBridge Install / Upgrade Script
#  Usage:
#    Fresh install:  curl -fsSL https://raw.githubusercontent.com/go2engle/filebridge/main/install.sh | sudo bash
#    Upgrade:        curl -fsSL https://... | sudo bash -s -- --upgrade
#    Uninstall:      curl -fsSL https://... | sudo bash -s -- --uninstall
#    Re-install:     curl -fsSL https://... | sudo bash -s -- --reinstall
#
#  Environment overrides (non-interactive):
#    FILEBRIDGE_URL          External URL  (e.g. https://files.example.com)
#    FILEBRIDGE_PORT         Port          (default: 3000)
#    FILEBRIDGE_AUTH_SECRET  Use an existing secret instead of generating one
# ============================================================
set -euo pipefail
IFS=$'\n\t'

# ── Constants ────────────────────────────────────────────────
REPO="go2engle/filebridge"
APP_NAME="FileBridge"
REQUIRED_NODE_MAJOR=20
DEFAULT_PORT=3000
HEALTH_TIMEOUT=60
HEALTH_INTERVAL=2

# ── Colors ───────────────────────────────────────────────────
if [ -t 1 ] && [ "${NO_COLOR:-}" != "1" ]; then
  R=$'\033[0m'          # reset
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[0;31m'
  GREEN=$'\033[0;32m'
  YELLOW=$'\033[0;33m'
  CYAN=$'\033[0;36m'
  WHITE=$'\033[0;37m'
  BGREEN=$'\033[1;32m'
  BRED=$'\033[1;31m'
  BYELLOW=$'\033[1;33m'
  BCYAN=$'\033[1;36m'
  BWHITE=$'\033[1;37m'
else
  R=''; BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''
  CYAN=''; WHITE=''; BGREEN=''; BRED=''; BYELLOW=''; BCYAN=''; BWHITE=''
fi

# ── Spinner ──────────────────────────────────────────────────
SPINNER_PID=''
SPINNER_MSG=''

_spinner_loop() {
  local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while true; do
    local f="${frames:$((i % 10)):1}"
    printf "\r  ${CYAN}%s${R}  %s${DIM}...${R}" "$f" "$SPINNER_MSG"
    sleep 0.08
    i=$(( i + 1 ))
  done
}

start_spinner() {
  SPINNER_MSG="$1"
  _spinner_loop &
  SPINNER_PID=$!
  disown "$SPINNER_PID" 2>/dev/null || true
}

stop_spinner() {
  local status="${1:-ok}"
  if [ -n "$SPINNER_PID" ]; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=''
  fi
  printf "\r\033[K"
  if [ "$status" = "ok" ]; then
    printf "  ${BGREEN}✓${R}  %s\n" "$SPINNER_MSG"
  else
    printf "  ${BRED}✗${R}  %s\n" "$SPINNER_MSG"
  fi
}

# cleanup on any exit
trap 'if [ -n "$SPINNER_PID" ]; then kill "$SPINNER_PID" 2>/dev/null || true; printf "\r\033[K"; fi' EXIT

# ── Print helpers ────────────────────────────────────────────
_step_num=0
_total_steps=7

print_step() {
  _step_num=$(( _step_num + 1 ))
  printf "\n  ${BCYAN}[%d/%d]${R} ${BWHITE}%s${R}\n" "$_step_num" "$_total_steps" "$1"
}

ok()   { printf "  ${BGREEN}✓${R}  %s\n" "$1"; }
err()  { printf "  ${BRED}✗${R}  %s\n" "$1" >&2; }
warn() { printf "  ${BYELLOW}!${R}  %s\n" "$1"; }
info() { printf "  ${DIM}→${R}  %s\n" "$1"; }

die() {
  if [ -n "$SPINNER_PID" ]; then stop_spinner "fail"; fi
  printf "\n  ${BRED}Error:${R} %s\n\n" "$1" >&2
  exit 1
}

# ── Banner ───────────────────────────────────────────────────
print_banner() {
  printf "\n"
  printf "  ${BCYAN}╔══════════════════════════════════════════╗${R}\n"
  printf "  ${BCYAN}║${R}                                          ${BCYAN}║${R}\n"
  printf "  ${BCYAN}║${R}  ${DIM}Automated File Transfer Scheduler${R}       ${BCYAN}║${R}\n"
  printf "  ${BCYAN}║${R}  ${DIM}https://github.com/${REPO}${R}  ${BCYAN}║${R}\n"
  printf "  ${BCYAN}║${R}                                          ${BCYAN}║${R}\n"
  printf "  ${BCYAN}╚══════════════════════════════════════════╝${R}\n"
  printf "\n"
}

# ── Argument parsing ─────────────────────────────────────────
MODE="install"
FORCE_REINSTALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upgrade)   MODE="upgrade"; shift ;;
    --uninstall) MODE="uninstall"; shift ;;
    --reinstall) MODE="install"; FORCE_REINSTALL=true; shift ;;
    --help|-h)
      printf "Usage: install.sh [--upgrade|--uninstall|--reinstall]\n\n"
      printf "Environment variable overrides:\n"
      printf "  FILEBRIDGE_URL          External URL (e.g. https://files.example.com)\n"
      printf "  FILEBRIDGE_PORT         Port (default: 3000)\n"
      printf "  FILEBRIDGE_AUTH_SECRET  Use an existing AUTH_SECRET\n"
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ── OS / Arch detection ──────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux|darwin) ;;
  *) die "Unsupported operating system: $OS" ;;
esac

RAW_ARCH=$(uname -m)
case "$RAW_ARCH" in
  x86_64|amd64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) die "Unsupported architecture: $RAW_ARCH" ;;
esac

DISTRO="unknown"
if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  DISTRO=$(. /etc/os-release && echo "${ID:-unknown}")
fi

# ── Path configuration ───────────────────────────────────────
if [ "$OS" = "linux" ]; then
  APP_DIR="/opt/filebridge"
  CONFIG_DIR="/etc/filebridge"
  DATA_DIR="/var/lib/filebridge"
  BACKUP_DIR="/var/lib/filebridge/backups"
  LOG_DIR="/var/log/filebridge"
  ENV_FILE="/etc/filebridge/filebridge.env"
  SERVICE_FILE="/etc/systemd/system/filebridge.service"
  LAUNCH_WRAPPER=""
else
  _HOME="${HOME:-$(eval echo ~)}"
  APP_DIR="/usr/local/opt/filebridge"
  CONFIG_DIR="${_HOME}/.config/filebridge"
  DATA_DIR="${_HOME}/.local/share/filebridge"
  BACKUP_DIR="${_HOME}/.local/share/filebridge/backups"
  LOG_DIR="${_HOME}/.local/share/filebridge/logs"
  ENV_FILE="${_HOME}/.config/filebridge/filebridge.env"
  SERVICE_FILE="${_HOME}/Library/LaunchAgents/com.filebridge.plist"
  LAUNCH_WRAPPER="${APP_DIR}/start.sh"
fi

# ── Privilege check ──────────────────────────────────────────
check_privileges() {
  if [ "$OS" = "linux" ] && [ "$(id -u)" -ne 0 ]; then
    die "This script must be run as root on Linux.\nTry: sudo bash install.sh"
  fi
}

# ── Prerequisite checks ──────────────────────────────────────
cmd_exists() { command -v "$1" >/dev/null 2>&1; }

check_curl() {
  if ! cmd_exists curl; then
    die "curl is required but not installed.\n  Install it with: apt-get install curl  or  brew install curl"
  fi
}

node_major() {
  local ver
  ver=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
  echo "${ver:-0}"
}

install_node() {
  warn "Node.js ${REQUIRED_NODE_MAJOR}+ is required but not found."
  printf "  Install it automatically? [Y/n] "
  local ans
  read -r ans </dev/tty 2>/dev/null || ans="Y"
  case "$ans" in [Nn]*) die "Node.js ${REQUIRED_NODE_MAJOR}+ is required. Install from: https://nodejs.org" ;; esac

  if [ "$OS" = "linux" ]; then
    start_spinner "Installing Node.js ${REQUIRED_NODE_MAJOR}"
    case "$DISTRO" in
      ubuntu|debian|linuxmint|pop|elementary|raspbian)
        curl -fsSL "https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | bash - >/dev/null 2>&1
        apt-get install -y nodejs >/dev/null 2>&1
        ;;
      rhel|centos|fedora|rocky|almalinux|ol|amzn)
        curl -fsSL "https://rpm.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | bash - >/dev/null 2>&1
        if cmd_exists dnf; then
          dnf install -y nodejs >/dev/null 2>&1
        else
          yum install -y nodejs >/dev/null 2>&1
        fi
        ;;
      *)
        stop_spinner "fail"
        die "Auto-install is not supported on this Linux distribution (${DISTRO}).\nInstall Node.js ${REQUIRED_NODE_MAJOR}+ manually: https://nodejs.org"
        ;;
    esac
    stop_spinner "ok"
  else
    # macOS
    if cmd_exists brew; then
      start_spinner "Installing Node.js ${REQUIRED_NODE_MAJOR} via Homebrew"
      brew install "node@${REQUIRED_NODE_MAJOR}" >/dev/null 2>&1
      brew link --overwrite "node@${REQUIRED_NODE_MAJOR}" >/dev/null 2>&1 || true
      stop_spinner "ok"
    else
      die "Homebrew is required to auto-install Node.js on macOS.\nInstall Homebrew: https://brew.sh  or Node.js directly: https://nodejs.org"
    fi
  fi
}

check_node() {
  local major
  major=$(node_major)
  if [ "$major" -lt "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
    install_node
    major=$(node_major)
    if [ "$major" -lt "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
      die "Node.js installation failed. Install Node.js ${REQUIRED_NODE_MAJOR}+ manually: https://nodejs.org"
    fi
  fi
}

# ── GitHub release helpers ───────────────────────────────────
get_latest_version() {
  local v
  v=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' \
    | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' \
    | head -1)
  [ -n "$v" ] || die "Could not fetch latest version from GitHub. Check your internet connection."
  echo "$v"
}

get_installed_version() {
  if [ -f "${APP_DIR}/FILEBRIDGE_VERSION" ]; then
    cat "${APP_DIR}/FILEBRIDGE_VERSION"
  else
    echo "unknown"
  fi
}

download_tarball() {
  local version="$1"
  local dest="$2"
  local url="https://github.com/${REPO}/releases/download/${version}/filebridge-${version}-${OS}-${ARCH}.tar.gz"

  start_spinner "Downloading FileBridge ${version} for ${OS}/${ARCH}"
  local http_code
  http_code=$(curl -fsSL -o "$dest" -w "%{http_code}" "$url" 2>/dev/null) || true

  if [ "${http_code:-0}" != "200" ] || [ ! -s "$dest" ]; then
    stop_spinner "fail"
    die "Download failed (HTTP ${http_code:-unknown}).\nURL: ${url}\n\nVerify that a release exists for ${OS}/${ARCH} at:\nhttps://github.com/${REPO}/releases"
  fi
  stop_spinner "ok"
}

# ── Generate AUTH_SECRET ─────────────────────────────────────
generate_secret() {
  if cmd_exists openssl; then
    openssl rand -base64 48 | tr -d '\n/+=' | head -c 64
  elif cmd_exists python3; then
    python3 -c "import secrets; print(secrets.token_urlsafe(48), end='')"
  elif cmd_exists python; then
    python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(48)).decode(), end='')"
  else
    die "Cannot generate AUTH_SECRET: openssl or python is required."
  fi
}

# ── Interactive prompt helper ────────────────────────────────
# Usage: VAL=$(prompt_or_env VAR_NAME "Prompt text" "default")
prompt_or_env() {
  local varname="$1"
  local prompt_text="$2"
  local default="$3"
  # indirect expansion works in bash 3.2+
  local current
  current=$(eval "echo \"\${${varname}:-}\"")

  if [ -n "$current" ]; then
    echo "$current"
    return
  fi

  if [ -n "$default" ]; then
    printf "  ${BWHITE}%s${R} ${DIM}[%s]${R}: " "$prompt_text" "$default" >/dev/tty
  else
    printf "  ${BWHITE}%s${R}: " "$prompt_text" >/dev/tty
  fi

  local val
  read -r val </dev/tty 2>/dev/null || val=""
  echo "${val:-$default}"
}

# ── Write env file ───────────────────────────────────────────
write_env_file() {
  local secret="$1" url="$2" port="$3"
  mkdir -p "$CONFIG_DIR"
  chmod 750 "$CONFIG_DIR"

  cat > "$ENV_FILE" <<EOF
# FileBridge Configuration
# Generated by install.sh on $(date -u "+%Y-%m-%d %H:%M:%S UTC")
#
# !!  IMPORTANT  !!
# This file contains your AUTH_SECRET.  Back it up alongside
# your database.  Without it you cannot recover encrypted
# connection credentials after a server rebuild.
# ─────────────────────────────────────────────────────────────

NODE_ENV=production
NODE_OPTIONS=--openssl-legacy-provider

# ── Authentication ────────────────────────────────────────────
# Used to sign sessions and encrypt stored SSO credentials.
AUTH_SECRET=${secret}

# ── Network ──────────────────────────────────────────────────
NEXTAUTH_URL=${url}
PORT=${port}
HOSTNAME=0.0.0.0

# ── Storage ──────────────────────────────────────────────────
DATABASE_PATH=${DATA_DIR}/filebridge.db
BACKUP_PATH=${BACKUP_DIR}

# ── Logging ──────────────────────────────────────────────────
LOG_LEVEL=info
EOF

  chmod 600 "$ENV_FILE"
}

# ── System user (Linux only) ─────────────────────────────────
ensure_system_user() {
  [ "$OS" = "linux" ] || return 0
  if ! id "filebridge" >/dev/null 2>&1; then
    start_spinner "Creating filebridge system user"
    useradd --system --no-create-home --shell /bin/false filebridge
    stop_spinner "ok"
  else
    info "System user 'filebridge' already exists"
  fi
}

# ── Directory setup ──────────────────────────────────────────
create_directories() {
  start_spinner "Creating directories"
  mkdir -p "$APP_DIR" "$CONFIG_DIR" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR"
  if [ "$OS" = "linux" ]; then
    chown root:filebridge "$APP_DIR"
    chmod 750 "$APP_DIR"
    chown -R filebridge:filebridge "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR"
    chmod 750 "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR"
    chown root:filebridge "$CONFIG_DIR"
    chmod 750 "$CONFIG_DIR"
  fi
  stop_spinner "ok"
}

# ── Install / extract tarball ────────────────────────────────
install_app() {
  local version="$1"
  local tmp
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  local tarball="${tmp}/filebridge.tar.gz"
  download_tarball "$version" "$tarball"

  start_spinner "Extracting application files"
  # Remove old app files but keep the directory (preserves permissions)
  find "$APP_DIR" -mindepth 1 -delete 2>/dev/null || rm -rf "${APP_DIR:?}"/* 2>/dev/null || true
  tar -xzf "$tarball" -C "$APP_DIR"

  # Write version marker used by upgrade detection
  echo "$version" > "${APP_DIR}/FILEBRIDGE_VERSION"

  if [ "$OS" = "linux" ]; then
    chown -R root:filebridge "$APP_DIR"
    chmod 750 "$APP_DIR"
    find "$APP_DIR" -mindepth 1 -type d -exec chmod 755 {} +
    find "$APP_DIR" -mindepth 1 -type f -exec chmod 644 {} +
    # server.js needs to be executable
    chmod 755 "${APP_DIR}/server.js" 2>/dev/null || true
  fi
  stop_spinner "ok"
}

# ── Node binary ──────────────────────────────────────────────
node_binary() {
  # Return absolute path to node — needed for service definitions
  command -v node
}

# ── Systemd service (Linux) ──────────────────────────────────
write_systemd_service() {
  local node_bin
  node_bin=$(node_binary)

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=FileBridge File Transfer Service
Documentation=https://github.com/${REPO}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=filebridge
Group=filebridge
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${node_bin} ${APP_DIR}/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=filebridge
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=${DATA_DIR} ${BACKUP_DIR} ${LOG_DIR}

[Install]
WantedBy=multi-user.target
EOF
  chmod 644 "$SERVICE_FILE"
}

# ── launchd service (macOS) ──────────────────────────────────
write_launchd_service() {
  local node_bin
  node_bin=$(node_binary)

  # launchd can't source an EnvironmentFile, so we use a small wrapper script
  cat > "$LAUNCH_WRAPPER" <<EOF
#!/usr/bin/env bash
# FileBridge launcher — sources env file then starts the server
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}" 2>/dev/null || true
set +a
exec "${node_bin}" "${APP_DIR}/server.js"
EOF
  chmod 755 "$LAUNCH_WRAPPER"

  mkdir -p "$(dirname "$SERVICE_FILE")"
  cat > "$SERVICE_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.filebridge.app</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${LAUNCH_WRAPPER}</string>
  </array>

  <key>KeepAlive</key>
  <true/>

  <key>RunAtLoad</key>
  <true/>

  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/filebridge.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/filebridge.error.log</string>
</dict>
</plist>
EOF
}

# ── Service lifecycle ────────────────────────────────────────
register_and_start_service() {
  start_spinner "Registering service"
  if [ "$OS" = "linux" ]; then
    write_systemd_service
    systemctl daemon-reload
    systemctl enable filebridge >/dev/null 2>&1
  else
    write_launchd_service
    launchctl unload "$SERVICE_FILE" 2>/dev/null || true
    launchctl load "$SERVICE_FILE"
  fi
  stop_spinner "ok"

  start_spinner "Starting FileBridge service"
  if [ "$OS" = "linux" ]; then
    systemctl start filebridge
  else
    launchctl start com.filebridge.app 2>/dev/null || true
  fi
  stop_spinner "ok"
}

stop_service() {
  start_spinner "Stopping FileBridge service"
  if [ "$OS" = "linux" ]; then
    systemctl stop filebridge 2>/dev/null || true
  else
    launchctl stop com.filebridge.app 2>/dev/null || true
  fi
  stop_spinner "ok"
}

unregister_service() {
  if [ "$OS" = "linux" ]; then
    systemctl disable --now filebridge 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
  else
    launchctl unload "$SERVICE_FILE" 2>/dev/null || true
    rm -f "$SERVICE_FILE"
    rm -f "$LAUNCH_WRAPPER"
  fi
}

# ── Health check ─────────────────────────────────────────────
wait_for_health() {
  local port="$1"
  local url="http://localhost:${port}/api/health"
  local elapsed=0

  start_spinner "Waiting for FileBridge to be ready"
  while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
    if curl -fsSL --max-time 2 "$url" >/dev/null 2>&1; then
      stop_spinner "ok"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
    elapsed=$(( elapsed + HEALTH_INTERVAL ))
  done
  stop_spinner "fail"
  warn "Health check timed out after ${HEALTH_TIMEOUT}s — service may still be starting."
  info "Check logs with: $([ "$OS" = "linux" ] && echo "journalctl -fu filebridge" || echo "tail -f ${LOG_DIR}/filebridge.log")"
}

# ── Pre-upgrade DB backup ────────────────────────────────────
backup_database() {
  local db="${DATA_DIR}/filebridge.db"
  [ -f "$db" ] || return 0

  local ts
  ts=$(date +"%Y%m%d_%H%M%S")
  local dest="${BACKUP_DIR}/filebridge_pre_upgrade_${ts}.db"

  start_spinner "Backing up database"
  cp "$db" "$dest"
  [ "$OS" = "linux" ] && chown filebridge:filebridge "$dest" || true
  stop_spinner "ok"
  info "Database backed up to: $dest"
}

# ── Read value from existing env file ────────────────────────
read_env_value() {
  local key="$1"
  local default="${2:-}"
  if [ -f "$ENV_FILE" ]; then
    local val
    val=$(grep "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
    echo "${val:-$default}"
  else
    echo "$default"
  fi
}

# ── Final summary panel ──────────────────────────────────────
print_summary() {
  local version="$1"
  local url="$2"
  local port="$3"
  local secret="$4"       # empty string on upgrades
  local is_upgrade="$5"

  local action="Installed"
  [ "$is_upgrade" = "true" ] && action="Upgraded"

  local svc_cmd log_cmd
  if [ "$OS" = "linux" ]; then
    svc_cmd="systemctl status filebridge"
    log_cmd="journalctl -fu filebridge"
  else
    svc_cmd="launchctl list com.filebridge.app"
    log_cmd="tail -f ${LOG_DIR}/filebridge.log"
  fi

  local w=58  # inner width of the box

  _box_line() { printf "  ${BGREEN}║${R}  %-$(( w - 4 ))s  ${BGREEN}║${R}\n" "$1"; }
  _box_kv()   { printf "  ${BGREEN}║${R}  ${DIM}%-18s${R} ${CYAN}%-$(( w - 23 ))s${R} ${BGREEN}║${R}\n" "$1" "$2"; }

  printf "\n"
  printf "  ${BGREEN}╔%s╗${R}\n" "$(printf '═%.0s' $(seq 1 $w))"
  _box_line ""
  _box_line "  ${BWHITE}FileBridge ${action} Successfully!${R}"
  _box_line ""
  printf "  ${BGREEN}╠%s╣${R}\n" "$(printf '═%.0s' $(seq 1 $w))"
  _box_kv "Version:"  "$version"
  _box_kv "URL:"      "$url"
  _box_kv "Port:"     "$port"
  _box_kv "App:"      "$APP_DIR"
  _box_kv "Config:"   "$ENV_FILE"
  _box_kv "Data:"     "$DATA_DIR"
  _box_kv "Backups:"  "$BACKUP_DIR"
  _box_kv "Service:"  "$svc_cmd"
  _box_kv "Logs:"     "$log_cmd"
  printf "  ${BGREEN}╠%s╣${R}\n" "$(printf '═%.0s' $(seq 1 $w))"
  _box_line ""
  _box_line "  ${BYELLOW}⚠  AUTH_SECRET — BACK THIS UP!${R}"
  _box_line ""
  _box_line "  Saved to:"
  _box_line "  ${CYAN}${ENV_FILE}${R}"
  _box_line ""
  _box_line "  Back up this file alongside your database backups."
  _box_line "  Without it you cannot restore encrypted credentials"
  _box_line "  after a server rebuild."
  _box_line ""
  printf "  ${BGREEN}╚%s╝${R}\n" "$(printf '═%.0s' $(seq 1 $w))"

  # Show the actual secret value below the box on fresh installs
  if [ "$is_upgrade" != "true" ] && [ -n "$secret" ]; then
    printf "\n"
    printf "  ${BYELLOW}AUTH_SECRET value${R} ${DIM}(copy this to a password manager):${R}\n\n"
    printf "  ${BOLD}%s${R}\n\n" "$secret"
  fi
}

# ── Detect existing install, auto-switch to upgrade ─────────
auto_detect_mode() {
  [ "$MODE" = "install" ]              || return 0
  [ "$FORCE_REINSTALL" = "false" ]     || return 0
  [ -d "$APP_DIR" ] && [ -f "$ENV_FILE" ] || return 0

  warn "An existing FileBridge installation was detected."
  printf "  Upgrade to the latest version instead? [Y/n] "
  local ans
  read -r ans </dev/tty 2>/dev/null || ans="Y"
  case "$ans" in [Nn]*) ;; *) MODE="upgrade" ;; esac
}

# ════════════════════════════════════════════════════════════════
#  FRESH INSTALL
# ════════════════════════════════════════════════════════════════
run_install() {
  _total_steps=7

  # Step 1 — System check
  print_step "Checking system"
  info "OS: ${OS} | Arch: ${ARCH}${DISTRO:+ | Distro: ${DISTRO}}"
  check_curl
  check_node
  ok "Node.js $(node --version)"

  # Step 2 — Fetch latest version
  print_step "Fetching latest release"
  start_spinner "Querying GitHub releases"
  local version
  version=$(get_latest_version)
  stop_spinner "ok"
  ok "Latest version: ${version}"

  # Step 3 — Configuration
  print_step "Configuration"
  local fb_url fb_port fb_secret
  fb_url=$(prompt_or_env "FILEBRIDGE_URL"  "External URL" "http://localhost:3000")
  fb_port=$(prompt_or_env "FILEBRIDGE_PORT" "Port"        "$DEFAULT_PORT")
  printf "\n"

  if [ -n "${FILEBRIDGE_AUTH_SECRET:-}" ]; then
    fb_secret="$FILEBRIDGE_AUTH_SECRET"
    ok "Using provided AUTH_SECRET"
  else
    start_spinner "Generating AUTH_SECRET"
    fb_secret=$(generate_secret)
    stop_spinner "ok"
  fi
  ok "Configuration ready"

  # Step 4 — Prepare system
  print_step "Preparing system"
  check_privileges
  ensure_system_user
  create_directories

  # Step 5 — Download & install
  print_step "Installing application"
  install_app "$version"
  ok "Application installed to ${APP_DIR}"

  # Step 6 — Write config
  print_step "Writing configuration"
  start_spinner "Writing environment file"
  write_env_file "$fb_secret" "$fb_url" "$fb_port"
  stop_spinner "ok"
  ok "Config written to ${ENV_FILE}"

  # Step 7 — Start service
  print_step "Starting service"
  register_and_start_service
  wait_for_health "$fb_port"

  print_summary "$version" "$fb_url" "$fb_port" "$fb_secret" "false"
}

# ════════════════════════════════════════════════════════════════
#  UPGRADE
# ════════════════════════════════════════════════════════════════
run_upgrade() {
  _total_steps=6

  # Step 1 — Detect existing install
  print_step "Detecting existing installation"
  if [ ! -d "$APP_DIR" ] || [ ! -f "$ENV_FILE" ]; then
    warn "No existing installation found at ${APP_DIR}."
    printf "  Run a fresh install instead? [Y/n] "
    local ans
    read -r ans </dev/tty 2>/dev/null || ans="Y"
    case "$ans" in [Nn]*) die "Upgrade aborted." ;; esac
    MODE="install"; run_install; return
  fi
  local installed
  installed=$(get_installed_version)
  ok "Currently installed: ${installed}"

  # Step 2 — Check latest
  print_step "Checking for updates"
  start_spinner "Querying GitHub releases"
  local latest
  latest=$(get_latest_version)
  stop_spinner "ok"

  if [ "$installed" = "$latest" ] && [ "$FORCE_REINSTALL" = "false" ]; then
    ok "Already up to date (${latest})"
    printf "\n  FileBridge is running the latest version.\n\n"
    exit 0
  fi
  ok "Upgrading: ${installed} → ${latest}"

  # Step 3 — Backup
  print_step "Backing up data"
  check_privileges
  backup_database

  # Step 4 — Stop service
  print_step "Stopping service"
  stop_service

  # Step 5 — Install new version
  print_step "Installing update"
  install_app "$latest"
  # Re-register service in case the service unit changed
  if [ "$OS" = "linux" ]; then
    write_systemd_service
    systemctl daemon-reload
    systemctl enable filebridge >/dev/null 2>&1
  else
    write_launchd_service
    launchctl unload "$SERVICE_FILE" 2>/dev/null || true
    launchctl load "$SERVICE_FILE"
  fi

  # Step 6 — Start service
  print_step "Starting service"
  start_spinner "Starting FileBridge service"
  if [ "$OS" = "linux" ]; then
    systemctl start filebridge
  else
    launchctl start com.filebridge.app 2>/dev/null || true
  fi
  stop_spinner "ok"

  local fb_port fb_url
  fb_port=$(read_env_value "PORT" "$DEFAULT_PORT")
  fb_url=$(read_env_value "NEXTAUTH_URL" "http://localhost:${fb_port}")
  wait_for_health "$fb_port"

  print_summary "$latest" "$fb_url" "$fb_port" "" "true"
}

# ════════════════════════════════════════════════════════════════
#  UNINSTALL
# ════════════════════════════════════════════════════════════════
run_uninstall() {
  printf "\n  ${BRED}Uninstall FileBridge${R}\n\n"
  warn "This will remove the application and service."
  info "Your data at ${DATA_DIR} will be ${BGREEN}kept${R}."
  printf "\n  Continue? [y/N] "
  local ans
  read -r ans </dev/tty 2>/dev/null || ans="N"
  case "$ans" in [Yy]*) ;; *) printf "\n  Uninstall cancelled.\n\n"; exit 0 ;; esac

  check_privileges
  stop_service 2>/dev/null || true
  unregister_service

  start_spinner "Removing application files"
  rm -rf "$APP_DIR"
  stop_spinner "ok"

  if [ "$OS" = "linux" ] && id "filebridge" >/dev/null 2>&1; then
    start_spinner "Removing filebridge system user"
    userdel filebridge 2>/dev/null || true
    stop_spinner "ok"
  fi

  printf "\n"
  ok "FileBridge has been removed."
  info "Data preserved at:   ${DATA_DIR}"
  info "Config preserved at: ${ENV_FILE}"
  printf "\n"
}

# ════════════════════════════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════════════════════════════
main() {
  print_banner
  printf "  ${DIM}Platform: %s/%s%s${R}\n\n" \
    "$OS" "$ARCH" "${DISTRO:+  •  ${DISTRO}}"

  case "$MODE" in
    install)
      auto_detect_mode
      if [ "$MODE" = "upgrade" ]; then
        run_upgrade
      else
        run_install
      fi
      ;;
    upgrade)   run_upgrade   ;;
    uninstall) run_uninstall ;;
  esac
}

main "$@"
