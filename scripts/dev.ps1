param(
    [string]$Workspace,
    [string]$Port
)

# -----------------------------------------------------------------------------
# Pi-Dashboard Desktop - Developer Launch Script (PowerShell / Windows)
# -----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "      Pi-Dashboard Desktop (Dev)        " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Install dependencies across all workspaces if missing
if (-not (Test-Path "$RootDir\server\node_modules")) {
    Write-Host "[*] Installing dependencies..." -ForegroundColor Yellow
    npm --prefix "$RootDir" install
}

if ($Workspace) {
    $Resolved = (Resolve-Path $Workspace).Path
    Write-Host "[*] Active Workspace: $Resolved" -ForegroundColor Green
    $env:PI_DASHBOARD_WORKSPACE = $Resolved
}

if ($Port) {
    $env:PORT = $Port
    $env:BACKEND_PORT = $Port
} else {
    Remove-Item env:PORT -ErrorAction SilentlyContinue
}

Set-Location "$RootDir"
npm start
