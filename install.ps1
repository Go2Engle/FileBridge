# ============================================================
#  FileBridge Install / Upgrade Script for Windows
#
#  One-liner (fresh install):
#    irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
#
#  Upgrade / Uninstall / Reinstall — set FILEBRIDGE_MODE first:
#    $env:FILEBRIDGE_MODE = 'upgrade';   irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
#    $env:FILEBRIDGE_MODE = 'uninstall'; irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
#    $env:FILEBRIDGE_MODE = 'reinstall'; irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex
#
#  Environment variable overrides (non-interactive / CI):
#    $env:FILEBRIDGE_URL          = 'https://files.example.com'
#    $env:FILEBRIDGE_PORT         = '3000'
#    $env:FILEBRIDGE_AUTH_SECRET  = '<existing secret>'
#    $env:FILEBRIDGE_MODE         = 'install' | 'upgrade' | 'uninstall' | 'reinstall'
# ============================================================

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # Suppress Invoke-WebRequest progress bar

# Force TLS 1.2 — PowerShell 5.1 defaults to TLS 1.0 which many sites now reject
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# -- Constants
$REPO                = 'go2engle/filebridge'
$APP_NAME            = 'FileBridge'
$REQUIRED_NODE_MAJOR = 20
$DEFAULT_PORT        = 3000
$HEALTH_TIMEOUT      = 60
$HEALTH_INTERVAL     = 2
$SERVICE_NAME        = 'FileBridge'
$NSSM_VERSION        = '2.24'

# -- Paths
$APP_DIR    = 'C:\Program Files\FileBridge'
$CONFIG_DIR = 'C:\ProgramData\FileBridge'
$DATA_DIR   = 'C:\ProgramData\FileBridge\data'
$BACKUP_DIR = 'C:\ProgramData\FileBridge\backups'
$LOG_DIR    = 'C:\ProgramData\FileBridge\logs'
$ENV_FILE   = 'C:\ProgramData\FileBridge\filebridge.env'
$NSSM_EXE   = "$APP_DIR\nssm.exe"

# -- Mode Resolution
# Set $env:FILEBRIDGE_MODE before running to select a mode other than install.
$script:MODE = 'install'
if ($env:FILEBRIDGE_MODE -match '^(upgrade|uninstall|reinstall|install)$') {
    $script:MODE = $env:FILEBRIDGE_MODE.ToLower()
}

$FORCE_REINSTALL = $script:MODE -eq 'reinstall'
if ($FORCE_REINSTALL) { $script:MODE = 'install' }

# -- Architecture
$ARCH = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'amd64' }
    'ARM64' { 'arm64' }
    default {
        Write-Host "  Error: Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)" -ForegroundColor Red
        exit 1
    }
}

# -- Step Counter
$script:_step_num    = 0
$script:_total_steps = 7

# -- Print Helpers
function Write-Banner {
    Write-Host ""
    Write-Host "  +------------------------------------------+" -ForegroundColor Cyan
    Write-Host "  |                                          |" -ForegroundColor Cyan
    Write-Host "  |  " -NoNewline -ForegroundColor Cyan
    Write-Host "FileBridge" -NoNewline -ForegroundColor White
    Write-Host "                               |" -ForegroundColor Cyan
    Write-Host "  |  " -NoNewline -ForegroundColor Cyan
    Write-Host "Automated File Transfer Scheduler" -NoNewline -ForegroundColor DarkGray
    Write-Host "       |" -ForegroundColor Cyan
    Write-Host "  |  " -NoNewline -ForegroundColor Cyan
    Write-Host "https://github.com/$REPO" -NoNewline -ForegroundColor DarkGray
    Write-Host "  |" -ForegroundColor Cyan
    Write-Host "  |                                          |" -ForegroundColor Cyan
    Write-Host "  +------------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Message)
    $script:_step_num++
    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Host "[$($script:_step_num)/$($script:_total_steps)]" -ForegroundColor Cyan -NoNewline
    Write-Host " $Message" -ForegroundColor White
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  " -NoNewline
    Write-Host "+" -ForegroundColor Green -NoNewline
    Write-Host "  $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  " -NoNewline
    Write-Host "!" -ForegroundColor Yellow -NoNewline
    Write-Host "  $Message"
}

function Write-Info {
    param([string]$Message)
    Write-Host "  " -NoNewline
    Write-Host "->" -ForegroundColor DarkGray -NoNewline
    Write-Host "  $Message"
}

function Write-Die {
    param([string]$Message)
    Write-Host ""
    Write-Host "  Error: $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# -- Administrator Check
function Test-IsAdministrator {
    $id        = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$id
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# -- Node.js Helpers
function Get-NodeMajor {
    try {
        $ver = & node --version 2>$null
        if ($ver -match 'v(\d+)') { return [int]$Matches[1] }
    } catch {}
    return 0
}

function Invoke-RefreshPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
    $userPath    = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    $env:PATH    = "$machinePath;$userPath"
}

function Install-Node {
    Write-Warn "Node.js $REQUIRED_NODE_MAJOR LTS is required but not found."
    $ans = Read-Host "  Install it automatically? [Y/n]"
    if ($ans -match '^[Nn]') {
        Write-Die "Node.js $REQUIRED_NODE_MAJOR LTS is required. Install from: https://nodejs.org/en/download"
    }

    # Try winget first — install the specific major version, not generic LTS,
    # because the pre-built native modules must match the compiled Node version.
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info "Installing Node.js $REQUIRED_NODE_MAJOR LTS via winget..."
        & winget install --id "OpenJS.NodeJS.$REQUIRED_NODE_MAJOR" --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Null
        Invoke-RefreshPath
        if ((Get-NodeMajor) -eq $REQUIRED_NODE_MAJOR) {
            Write-Ok "Node.js $REQUIRED_NODE_MAJOR installed via winget"
            return
        }
        Write-Warn "winget install did not succeed; falling back to direct download."
    }

    # Fallback: direct .msi download from nodejs.org
    Write-Info "Fetching Node.js $REQUIRED_NODE_MAJOR LTS release info..."
    try {
        $distIndex = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
    } catch {
        Write-Die "Could not reach nodejs.org. Check your internet connection."
    }

    $lts = $distIndex |
        Where-Object { $_.lts -and ($_.version -match "^v$REQUIRED_NODE_MAJOR\.") } |
        Select-Object -First 1

    if (-not $lts) {
        Write-Die "Could not find a Node.js $REQUIRED_NODE_MAJOR LTS release."
    }

    $nodeVer  = $lts.version
    $msiArch  = if ($ARCH -eq 'arm64') { 'arm64' } else { 'x64' }
    $msiUrl   = "https://nodejs.org/dist/$nodeVer/node-$nodeVer-$msiArch.msi"
    $msiPath  = "$env:TEMP\node-installer.msi"

    Write-Info "Downloading Node.js $nodeVer ($msiArch)..."
    try {
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
    } catch {
        Write-Die "Failed to download Node.js installer from: $msiUrl"
    }

    Write-Info "Running Node.js installer (silent, this may take a moment)..."
    $proc = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru -NoNewWindow
    Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

    if ($proc.ExitCode -ne 0) {
        Write-Die "Node.js MSI installer exited with code $($proc.ExitCode)."
    }

    Invoke-RefreshPath
}

function Assert-Node {
    $major = Get-NodeMajor
    if ($major -eq $REQUIRED_NODE_MAJOR) { return }

    if ($major -gt $REQUIRED_NODE_MAJOR) {
        Write-Die ("Node.js $major is installed, but the pre-built FileBridge release requires " +
            "Node.js $REQUIRED_NODE_MAJOR LTS exactly.`n" +
            "  Native modules (better-sqlite3) are compiled for Node $REQUIRED_NODE_MAJOR and " +
            "will not load under a different major version.`n`n" +
            "  Install Node.js $REQUIRED_NODE_MAJOR LTS from https://nodejs.org/en/download `n" +
            "  or via winget:  winget install OpenJS.NodeJS.$REQUIRED_NODE_MAJOR")
    }

    Install-Node
    if ((Get-NodeMajor) -ne $REQUIRED_NODE_MAJOR) {
        Write-Die "Node.js $REQUIRED_NODE_MAJOR installation failed. Install manually: https://nodejs.org/en/download"
    }
}

# -- GitHub Release Helpers
function Get-LatestVersion {
    # Honour the FILEBRIDGE_VERSION pin (used for branch test builds)
    if ($env:FILEBRIDGE_VERSION) {
        $pin = $env:FILEBRIDGE_VERSION
        # Add leading 'v' only for plain semver numbers (e.g. "0.6.0" -> "v0.6.0")
        # Leave non-semver tags like "test-branch-abc1234" untouched.
        if ($pin -match '^\d') { return "v$pin" }
        return $pin
    }
    try {
        $release = Invoke-RestMethod "https://api.github.com/repos/$REPO/releases/latest" -UseBasicParsing
        return $release.tag_name
    } catch {
        Write-Die "Could not fetch latest version from GitHub. Check your internet connection."
    }
}

function Get-InstalledVersion {
    $vf = "$APP_DIR\FILEBRIDGE_VERSION"
    if (Test-Path $vf) { return (Get-Content $vf -Raw).Trim() }
    return 'unknown'
}

# -- NSSM Helpers
function Install-NSSM {
    if (Test-Path $NSSM_EXE) { return }

    New-Item -ItemType Directory -Force -Path $APP_DIR | Out-Null

    # Try winget first — avoids any external download reliability issues
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Info "Installing NSSM via winget..."
        & winget install NSSM.NSSM --accept-source-agreements --accept-package-agreements --silent 2>&1 | Out-Null
        Invoke-RefreshPath
        $found = Get-Command nssm -ErrorAction SilentlyContinue
        if ($found) {
            Copy-Item $found.Source $NSSM_EXE -Force
            Write-Ok "NSSM installed via winget"
            return
        }
        Write-Warn "winget install did not succeed; falling back to direct download."
    }

    # Direct download from nssm.cc with a browser User-Agent (nssm.cc blocks non-browser agents)
    Write-Info "Downloading NSSM $NSSM_VERSION (Windows service manager)..."
    $nssmUrl  = "https://nssm.cc/release/nssm-$NSSM_VERSION.zip"
    $tmpDir   = "$env:TEMP\nssm-dl"
    $zipPath  = "$tmpDir\nssm.zip"

    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

    try {
        Invoke-WebRequest -Uri $nssmUrl -OutFile $zipPath -UseBasicParsing `
            -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    } catch {
        Write-Die "Failed to download NSSM from: $nssmUrl`nCheck your internet connection."
    }

    Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

    # NSSM zip contains win32/ and win64/ subdirectories
    $nssmBin = "$tmpDir\nssm-$NSSM_VERSION\win64\nssm.exe"
    if (-not (Test-Path $nssmBin)) {
        $nssmBin = "$tmpDir\nssm-$NSSM_VERSION\win32\nssm.exe"
    }
    if (-not (Test-Path $nssmBin)) {
        Write-Die "Could not find nssm.exe in the downloaded archive."
    }

    Copy-Item $nssmBin $NSSM_EXE -Force
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# -- Download & Extract App
function Install-App {
    param([string]$Version)

    $zipName = "filebridge-$Version-windows-$ARCH.zip"
    $url     = "https://github.com/$REPO/releases/download/$Version/$zipName"
    $tmpDir  = "$env:TEMP\filebridge-install"
    $zipPath = "$tmpDir\filebridge.zip"

    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

    Write-Info "Downloading FileBridge $Version for windows/$ARCH..."
    try {
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    } catch {
        Write-Die "Download failed.`nURL: $url`n`nVerify that a release exists for windows/$ARCH at:`nhttps://github.com/$REPO/releases"
    }

    if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -eq 0) {
        Write-Die "Downloaded file is empty or missing. URL: $url"
    }

    Write-Info "Extracting application files..."
    # Clear existing app files while preserving the directory and NSSM
    if (Test-Path $APP_DIR) {
        Get-ChildItem $APP_DIR -Exclude 'nssm.exe', 'FILEBRIDGE_VERSION' |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $APP_DIR | Out-Null

    Expand-Archive -Path $zipPath -DestinationPath $APP_DIR -Force

    # Write version marker
    $Version | Set-Content "$APP_DIR\FILEBRIDGE_VERSION" -NoNewline -Encoding UTF8

    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# -- Generate AUTH_SECRET
function New-AuthSecret {
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = [byte[]]::new(48)
    $rng.GetBytes($bytes)
    $b64   = [Convert]::ToBase64String($bytes) -replace '[/+=]', ''
    return $b64.Substring(0, [Math]::Min(64, $b64.Length))
}

# -- Prompt Helper
function Get-PromptOrEnv {
    param([string]$VarName, [string]$PromptText, [string]$Default)
    $current = [System.Environment]::GetEnvironmentVariable($VarName)
    if ($current) { return $current }
    if ($Default) {
        $val = Read-Host "  $PromptText [$Default]"
        if ($val) { return $val } else { return $Default }
    }
    return Read-Host "  $PromptText"
}

# -- Write .env File
function Write-EnvFile {
    param([string]$Secret, [string]$Url, [string]$Port)

    New-Item -ItemType Directory -Force -Path $CONFIG_DIR | Out-Null

    $timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' UTC'

    @"
# FileBridge Configuration
# Generated by install.ps1 on $timestamp
#
# !!  IMPORTANT  !!
# This file contains your AUTH_SECRET.  Back it up alongside
# your database.  Without it you cannot recover encrypted
# connection credentials after a server rebuild.
# -------------------------------------------------------------

NODE_ENV=production
NODE_OPTIONS=--openssl-legacy-provider

# -- Authentication
# Used to sign sessions and encrypt stored SSO credentials.
AUTH_SECRET=$Secret

# -- Network
NEXTAUTH_URL=$Url
PORT=$Port
HOSTNAME=0.0.0.0

# -- Storage
DATABASE_PATH=$DATA_DIR\filebridge.db
BACKUP_PATH=$BACKUP_DIR

# -- Logging
LOG_LEVEL=info

# -- Install metadata (used by the built-in updater)
FILEBRIDGE_INSTALL_TYPE=native
FILEBRIDGE_OS=windows
FILEBRIDGE_ARCH=windows-$ARCH
FILEBRIDGE_INSTALL_DIR=$APP_DIR
FILEBRIDGE_DATA_DIR=$DATA_DIR
FILEBRIDGE_SERVICE_NAME=$SERVICE_NAME
"@ | Set-Content $ENV_FILE -Encoding UTF8

    # Restrict write access — full control for Administrators + SYSTEM only.
    # The current (installing) user gets Read so they can view the config
    # without needing an elevated editor (UAC strips admin token for ACL access).
    try {
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $acl = Get-Acl $ENV_FILE
        $acl.SetAccessRuleProtection($true, $false)
        $rules = @(
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                'BUILTIN\Administrators', 'FullControl', 'Allow'),
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                'NT AUTHORITY\SYSTEM', 'FullControl', 'Allow'),
            [System.Security.AccessControl.FileSystemAccessRule]::new(
                $currentUser, 'Read', 'Allow')
        )
        foreach ($r in $rules) { $acl.AddAccessRule($r) }
        Set-Acl $ENV_FILE $acl
    } catch {
        Write-Warn "Could not restrict permissions on env file (non-fatal)."
    }
}

# -- Read Value from Existing .env
function Get-EnvValue {
    param([string]$Key, [string]$Default = '')
    if (Test-Path $ENV_FILE) {
        $line = Get-Content $ENV_FILE |
            Where-Object { $_ -match "^${Key}=" } |
            Select-Object -First 1
        if ($line) {
            return ($line -split '=', 2)[1].Trim('"').Trim("'")
        }
    }
    return $Default
}

# -- Directories
function New-AppDirectories {
    foreach ($dir in @($APP_DIR, $CONFIG_DIR, $DATA_DIR, $BACKUP_DIR, $LOG_DIR)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
}

# -- Windows Service (NSSM)
function Register-FileBridgeService {
    Install-NSSM

    # Resolve node.exe — prefer the exact required major version so the service
    # uses the same Node.js that the native modules were compiled against.
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $nodeActualMajor = Get-NodeMajor
    if ($nodeActualMajor -ne $REQUIRED_NODE_MAJOR) {
        Write-Die ("node in PATH is version $nodeActualMajor but FileBridge requires Node.js $REQUIRED_NODE_MAJOR.`n" +
            "  Run Assert-Node / install Node.js $REQUIRED_NODE_MAJOR before registering the service.")
    }

    # Remove any pre-existing service cleanly
    $existing = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Info "Removing existing service registration..."
        if ($existing.Status -eq 'Running') {
            & $NSSM_EXE stop $SERVICE_NAME 2>$null | Out-Null
            Start-Sleep -Seconds 3
        }
        & $NSSM_EXE remove $SERVICE_NAME confirm 2>$null | Out-Null
        Start-Sleep -Seconds 1
    }

    # Install the service.
    # Pass node.exe alone as the application; set AppParameters separately with inner
    # quotes so the space in "C:\Program Files\..." survives the Windows command-line
    # split that NSSM performs when it spawns the process.
    & $NSSM_EXE install    $SERVICE_NAME $nodePath | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME AppParameters  "`"$APP_DIR\server.js`"" | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME AppDirectory    $APP_DIR         | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME DisplayName     "$APP_NAME File Transfer Service" | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME Description     "Automated File Transfer Scheduler - https://github.com/$REPO" | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME Start           SERVICE_AUTO_START | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME AppStdout        "$LOG_DIR\filebridge.log"       | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME AppStderr        "$LOG_DIR\filebridge.error.log" | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME AppRotateFiles   1         | Out-Null
    & $NSSM_EXE set        $SERVICE_NAME AppRotateBytes   10485760  | Out-Null  # 10 MB
    & $NSSM_EXE set        $SERVICE_NAME AppRestartDelay  10000     | Out-Null  # 10s

    # Inject environment from the .env file via NSSM's registry key (REG_MULTI_SZ)
    # This is more reliable than passing each var on the command line
    $envVars = Get-Content $ENV_FILE |
        Where-Object { $_ -match '^[A-Z_][A-Z0-9_]*=.+' } |
        ForEach-Object { $_.Trim() }

    if ($envVars.Count -gt 0) {
        $nssmParamsKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$SERVICE_NAME\Parameters"
        # Wait for NSSM to create the key
        $waited = 0
        while (-not (Test-Path $nssmParamsKey) -and $waited -lt 10) {
            Start-Sleep -Seconds 1; $waited++
        }
        if (Test-Path $nssmParamsKey) {
            Set-ItemProperty -Path $nssmParamsKey -Name 'AppEnvironmentExtra' -Value $envVars -Type MultiString
        }
    }

    # Start the service (redirect stderr so NSSM status messages don't bleed to console)
    & $NSSM_EXE start $SERVICE_NAME 2>&1 | Out-Null

    # NSSM 2.24 sometimes leaves the service in PAUSED on first start.
    # Node.js does not implement the Resume control code, so Resume-Service won't work.
    # The only reliable fix is a full stop → start cycle.
    Start-Sleep -Seconds 2
    $svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') {
        & $NSSM_EXE stop  $SERVICE_NAME 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        & $NSSM_EXE start $SERVICE_NAME 2>&1 | Out-Null
    }
}

function Stop-FileBridgeService {
    if (Test-Path $NSSM_EXE) {
        & $NSSM_EXE stop $SERVICE_NAME 2>$null | Out-Null
    } else {
        Stop-Service -Name $SERVICE_NAME -Force -ErrorAction SilentlyContinue
    }
}

function Unregister-FileBridgeService {
    $svc = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
    if (-not $svc) { return }

    if (Test-Path $NSSM_EXE) {
        & $NSSM_EXE stop   $SERVICE_NAME          2>$null | Out-Null
        & $NSSM_EXE remove $SERVICE_NAME confirm   2>$null | Out-Null
    } else {
        Stop-Service -Name $SERVICE_NAME -Force -ErrorAction SilentlyContinue
        & sc.exe delete $SERVICE_NAME | Out-Null
    }
    Start-Sleep -Seconds 2
}

# -- Upgrade Helper Script
# Writes upgrade-helper.ps1 to the install dir and creates a scheduled task
# that runs as SYSTEM so the app can trigger an upgrade without admin prompts.
function Write-UpgradeHelper {
    $helperPath = "$APP_DIR\upgrade-helper.ps1"

    # The scheduled task runs as NT AUTHORITY\SYSTEM which does not inherit the
    # FileBridge service environment variables. Embed the actual paths at install
    # time using a double-quoted here-string so $APP_DIR / $DATA_DIR / $SERVICE_NAME
    # are expanded now. All other $ references are backtick-escaped so they remain
    # as literals in the generated script.
    $header = @"
# FileBridge in-app upgrade helper -- runs as SYSTEM via scheduled task.
# Reads the zip URL from the trigger file, validates it, then upgrades.
# Log: $LOG_DIR\upgrade-helper.log
`$ErrorActionPreference = 'Stop'

# Paths hardcoded at install time (SYSTEM account has no FILEBRIDGE_* env vars)
`$TriggerFile = "$DATA_DIR\.update-trigger"
`$AppDir      = "$APP_DIR"
`$DataDir     = "$DATA_DIR"
`$BackupDir   = "`$DataDir\backups"
`$LogDir      = "$LOG_DIR"
`$LogFile     = "`$LogDir\upgrade-helper.log"
`$ServiceName = "$SERVICE_NAME"

"@

    $body = @'
function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] [$Level] $Message"
    try {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    } catch { <# best-effort #> }
    Write-Output $line
}

Write-Log "--- upgrade-helper started ---"

try {

if (-not (Test-Path $TriggerFile)) {
    Write-Log "Trigger file not found: $TriggerFile" 'ERROR'
    exit 1
}

$ZipUrl = (Get-Content $TriggerFile -Raw).Trim()
Remove-Item $TriggerFile -Force -ErrorAction SilentlyContinue
Write-Log "Trigger file read. URL: $ZipUrl"

# Validate URL
if ($ZipUrl -notmatch '^https://github\.com/Go2Engle/FileBridge/releases/download/[A-Za-z0-9._-]+/filebridge-[A-Za-z0-9._-]+-windows-[a-z0-9]+\.zip$') {
    Write-Log "URL failed validation: $ZipUrl" 'ERROR'
    exit 1
}
Write-Log "URL validated OK"

# Backup database
$Db = "$DataDir\filebridge.db"
if (Test-Path $Db) {
    $Ts = Get-Date -Format 'yyyyMMdd_HHmmss'
    $BackupFile = "$BackupDir\filebridge_pre_upgrade_$Ts.db"
    Copy-Item $Db $BackupFile -ErrorAction SilentlyContinue
    Write-Log "Database backed up to: $BackupFile"
} else {
    Write-Log "No database found at $Db — skipping backup"
}

# Stop service
$NssmExe = "$AppDir\nssm.exe"
Write-Log "Stopping service: $ServiceName"
if (Test-Path $NssmExe) {
    $nssmOut = & $NssmExe stop $ServiceName 2>&1
    Write-Log "nssm stop output: $nssmOut"
} else {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3
Write-Log "Service stopped"

# Download
$Tmp = [System.IO.Path]::GetTempPath() + [System.IO.Path]::GetRandomFileName()
New-Item -ItemType Directory -Path $Tmp | Out-Null
$ZipPath = "$Tmp\update.zip"
Write-Log "Downloading $ZipUrl"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
    $sizeMB = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
    Write-Log "Download complete ($sizeMB MB)"

    # Extract
    Write-Log "Removing old app files from: $AppDir"
    Remove-Item "$AppDir\*" -Recurse -Force -Exclude 'nssm.exe' -ErrorAction SilentlyContinue
    Write-Log "Extracting archive to: $AppDir"
    Expand-Archive -Path $ZipPath -DestinationPath $AppDir -Force
    Write-Log "Extraction complete"
} finally {
    Remove-Item $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# Restart service
Write-Log "Starting service: $ServiceName"
if (Test-Path $NssmExe) {
    $nssmOut = & $NssmExe start $ServiceName 2>&1
    Write-Log "nssm start output: $nssmOut"
} else {
    Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
}
Write-Log "--- upgrade-helper finished successfully ---"

} catch {
    Write-Log "UNHANDLED ERROR: $($_.Exception.Message)" 'ERROR'
    Write-Log "Stack trace: $($_.ScriptStackTrace)" 'ERROR'
    exit 1
}
'@

    ($header + $body) | Set-Content $helperPath -Encoding UTF8
}

function Register-UpgradeTask {
    # Remove any old task first
    Unregister-ScheduledTask -TaskName 'FileBridgeUpdater' -Confirm:$false -ErrorAction SilentlyContinue

    $action  = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$APP_DIR\upgrade-helper.ps1`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(10)   # on-demand only
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest

    Register-ScheduledTask `
        -TaskName 'FileBridgeUpdater' `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description 'FileBridge in-app upgrade helper — triggered by the web UI' | Out-Null

    Write-Ok "Registered FileBridgeUpdater scheduled task"
}

# -- Health Check
function Wait-ForHealth {
    param([string]$Port)
    $url     = "http://localhost:$Port/api/health"
    $elapsed = 0

    Write-Info "Waiting for FileBridge to be ready..."
    while ($elapsed -lt $HEALTH_TIMEOUT) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Ok "FileBridge is ready"
                return
            }
        } catch {}
        Start-Sleep -Seconds $HEALTH_INTERVAL
        $elapsed += $HEALTH_INTERVAL
    }
    Write-Warn "Health check timed out after ${HEALTH_TIMEOUT}s — service may still be starting."
    Write-Info "Check logs at: $LOG_DIR"
    Write-Info "Service status: Get-Service -Name $SERVICE_NAME"
}

# -- Pre-upgrade Database Backup
function Backup-Database {
    $db = "$DATA_DIR\filebridge.db"
    if (-not (Test-Path $db)) { return }

    $ts   = Get-Date -Format 'yyyyMMdd_HHmmss'
    $dest = "$BACKUP_DIR\filebridge_pre_upgrade_$ts.db"

    Write-Info "Backing up database..."
    Copy-Item $db $dest
    Write-Ok "Database backed up to: $dest"
}

# -- Auto-detect Upgrade
function Select-AutoMode {
    if ($script:MODE -ne 'install') { return }
    if ($FORCE_REINSTALL) { return }
    if (-not (Test-Path $APP_DIR) -or -not (Test-Path $ENV_FILE)) { return }

    Write-Warn "An existing FileBridge installation was detected."
    $ans = Read-Host "  Upgrade to the latest version instead? [Y/n]"
    if ($ans -notmatch '^[Nn]') { $script:MODE = 'upgrade' }
}

# -- Summary Box
function Write-Summary {
    param([string]$Version, [string]$Url, [string]$Port, [string]$Secret, [bool]$IsUpgrade)

    $action = if ($IsUpgrade) { 'Upgraded' } else { 'Installed' }
    $w      = 62   # inner width

    $line = { param($t) Write-Host ("  |  {0,-$($w - 4)}  |" -f $t) -ForegroundColor Green }
    $kv   = { param($k, $v) Write-Host ("  |  {0,-18} {1,-$($w - 22)}  |" -f $k, $v) -ForegroundColor Green }
    $sep  = { Write-Host ("  +" + ("-" * $w) + "+") -ForegroundColor Green }

    Write-Host ""
    & $sep
    & $line ""
    & $line "  FileBridge $action Successfully!"
    & $line ""
    & $sep
    & $kv "Version:"  $Version
    & $kv "URL:"      $Url
    & $kv "Port:"     $Port
    & $kv "App:"      $APP_DIR
    & $kv "Config:"   $ENV_FILE
    & $kv "Data:"     $DATA_DIR
    & $kv "Backups:"  $BACKUP_DIR
    & $kv "Service:"  "Get-Service -Name $SERVICE_NAME"
    & $kv "Logs:"     $LOG_DIR
    & $sep
    & $line ""
    & $line "  WARNING: AUTH_SECRET - BACK THIS UP!"
    & $line ""
    & $line "  Saved to:"
    & $line "  $ENV_FILE"
    & $line ""
    & $line "  Back up this file alongside your database."
    & $line "  Without it you cannot restore encrypted credentials"
    & $line "  after a server rebuild."
    & $line ""
    & $sep
    Write-Host ""

    if (-not $IsUpgrade -and $Secret) {
        Write-Host "  AUTH_SECRET value " -NoNewline -ForegroundColor Yellow
        Write-Host "(copy this to a password manager):" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  $Secret" -ForegroundColor White
        Write-Host ""
    }
}

# ════════════════════════════════════════════════════════════════════════════
#  FRESH INSTALL
# ════════════════════════════════════════════════════════════════════════════
function Invoke-Install {
    $script:_total_steps = 7

    # Step 1 — System check
    Write-Step "Checking system"
    Write-Info "OS: Windows | Arch: $ARCH"
    Assert-Node
    Write-Ok "Node.js $(& node --version)"

    # Step 2 — Fetch latest version
    Write-Step "Fetching latest release"
    $version = Get-LatestVersion
    Write-Ok "Latest version: $version"

    # Step 3 — Configuration
    Write-Step "Configuration"

    $defaultUrl  = "http://localhost:$DEFAULT_PORT"
    $defaultPort = "$DEFAULT_PORT"

    if ($FORCE_REINSTALL -and (Test-Path $ENV_FILE)) {
        $defaultUrl  = Get-EnvValue 'NEXTAUTH_URL' "http://localhost:$DEFAULT_PORT"
        $defaultPort = Get-EnvValue 'PORT'         "$DEFAULT_PORT"
    }

    $fbUrl  = Get-PromptOrEnv 'FILEBRIDGE_URL'  'External URL' $defaultUrl
    $fbPort = Get-PromptOrEnv 'FILEBRIDGE_PORT' 'Port'         $defaultPort
    Write-Host ""

    if ($env:FILEBRIDGE_AUTH_SECRET) {
        $fbSecret = $env:FILEBRIDGE_AUTH_SECRET
        Write-Ok "Using provided AUTH_SECRET"
    } elseif ($FORCE_REINSTALL -and (Test-Path $ENV_FILE)) {
        $existing = Get-EnvValue 'AUTH_SECRET'
        if ($existing) {
            $fbSecret = $existing
            Write-Ok "Preserving existing AUTH_SECRET (required to decrypt stored connection credentials)"
        } else {
            $fbSecret = New-AuthSecret
            Write-Ok "Generated new AUTH_SECRET"
        }
    } else {
        $fbSecret = New-AuthSecret
        Write-Ok "Generated AUTH_SECRET"
    }
    Write-Ok "Configuration ready"

    # Step 4 — Prepare system
    Write-Step "Preparing system"
    New-AppDirectories
    Write-Ok "Directories created"

    # Step 5 — Download & install
    Write-Step "Installing application"
    Install-App $version
    Write-Ok "Application installed to $APP_DIR"

    # Step 6 — Write config
    Write-Step "Writing configuration"
    Write-EnvFile $fbSecret $fbUrl $fbPort
    Write-Ok "Config written to $ENV_FILE"

    # Write upgrade helper and register the scheduled task
    Write-Info "Installing upgrade helper..."
    Write-UpgradeHelper
    Register-UpgradeTask

    # Step 7 — Register & start service
    Write-Step "Starting service"
    Register-FileBridgeService
    Write-Ok "Service registered and started"
    Wait-ForHealth $fbPort

    Write-Summary $version $fbUrl $fbPort $fbSecret $false
}

# ════════════════════════════════════════════════════════════════════════════
#  UPGRADE
# ════════════════════════════════════════════════════════════════════════════
function Invoke-Upgrade {
    $script:_total_steps = 6

    # Step 1 — Detect existing install
    Write-Step "Detecting existing installation"
    if (-not (Test-Path $APP_DIR) -or -not (Test-Path $ENV_FILE)) {
        Write-Warn "No existing installation found at $APP_DIR."
        $ans = Read-Host "  Run a fresh install instead? [Y/n]"
        if ($ans -match '^[Nn]') { Write-Die "Upgrade aborted." }
        Invoke-Install
        return
    }
    $installed = Get-InstalledVersion
    Write-Ok "Currently installed: $installed"

    # Step 2 — Check latest
    Write-Step "Checking for updates"
    $latest = Get-LatestVersion

    if ($installed -eq $latest -and -not $FORCE_REINSTALL) {
        Write-Ok "Already up to date ($latest)"
        Write-Host ""
        Write-Host "  FileBridge is running the latest version."
        Write-Host ""
        exit 0
    }
    Write-Ok "Upgrading: $installed -> $latest"

    # Step 3 — Backup
    Write-Step "Backing up data"
    Backup-Database

    # Step 4 — Stop service
    Write-Step "Stopping service"
    Stop-FileBridgeService
    Write-Ok "Service stopped"

    # Step 5 — Install new version
    Write-Step "Installing update"
    Install-App $latest
    Write-Ok "Updated to $latest"

    # Refresh upgrade helper in case it changed in this release
    Write-UpgradeHelper
    Register-UpgradeTask

    # Step 6 — Re-register & start service
    Write-Step "Starting service"
    Register-FileBridgeService
    Write-Ok "Service re-registered and started"

    $fbPort = Get-EnvValue 'PORT'         "$DEFAULT_PORT"
    $fbUrl  = Get-EnvValue 'NEXTAUTH_URL' "http://localhost:$fbPort"
    Wait-ForHealth $fbPort

    Write-Summary $latest $fbUrl $fbPort '' $true
}

# ════════════════════════════════════════════════════════════════════════════
#  UNINSTALL
# ════════════════════════════════════════════════════════════════════════════
function Invoke-Uninstall {
    Write-Host ""
    Write-Host "  Uninstall FileBridge" -ForegroundColor Red
    Write-Host ""
    Write-Warn "This will remove the application and Windows service."
    Write-Info "Your data at $DATA_DIR will be kept."
    Write-Host ""
    $ans = Read-Host "  Continue? [y/N]"
    if ($ans -notmatch '^[Yy]') {
        Write-Host ""
        Write-Host "  Uninstall cancelled."
        Write-Host ""
        exit 0
    }

    Write-Info "Stopping and removing service..."
    Unregister-FileBridgeService
    Unregister-ScheduledTask -TaskName 'FileBridgeUpdater' -Confirm:$false -ErrorAction SilentlyContinue
    Write-Ok "Service removed"

    Write-Info "Removing application files..."
    if (Test-Path $APP_DIR) {
        Remove-Item $APP_DIR -Recurse -Force
    }
    Write-Ok "Application files removed"

    Write-Host ""
    Write-Ok "FileBridge has been uninstalled."
    Write-Info "Data preserved at:   $DATA_DIR"
    Write-Info "Config preserved at: $ENV_FILE"
    Write-Host ""
}

# ════════════════════════════════════════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════════════════════════════════════════
Write-Banner
Write-Host "  Platform: Windows/$ARCH" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-IsAdministrator)) {
    Write-Die "This script must be run as Administrator.`n  Right-click PowerShell and select 'Run as Administrator', then re-run:`n`n  irm https://raw.githubusercontent.com/go2engle/filebridge/main/install.ps1 | iex"
}

Select-AutoMode

switch ($script:MODE) {
    'install'   { Invoke-Install   }
    'upgrade'   { Invoke-Upgrade   }
    'uninstall' { Invoke-Uninstall }
    default     { Write-Die "Unknown mode: $($script:MODE)" }
}
