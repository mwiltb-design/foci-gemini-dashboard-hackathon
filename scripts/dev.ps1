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

# Ensure clean port and auth variables
$env:UI_PORT = "5173"
$env:BACKEND_PORT = "4317"
Remove-Item env:PORT -ErrorAction SilentlyContinue
Remove-Item env:PI_DASHBOARD_AUTH_TOKEN -ErrorAction SilentlyContinue

Set-Location "$RootDir"
npm start
