# Install Cloudflare Tunnel as Native Windows Service
# Run this script as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cloudflare Tunnel Native Service Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

# Step 1: Stop and remove old NSSM-based service
Write-Host "[1/4] Removing old NSSM-based CloudflareTunnel service..." -ForegroundColor Yellow
$nssm = Get-ChildItem "C:\Users\eed2k\AppData\Local\Microsoft\WinGet\Packages\NSSM*" -Recurse -Filter "nssm.exe" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1

if ($nssm) {
    & $nssm.FullName stop CloudflareTunnel 2>$null
    Start-Sleep -Seconds 2
    & $nssm.FullName remove CloudflareTunnel confirm 2>$null
    Write-Host "   Old NSSM service removed." -ForegroundColor Green
} else {
    # Try sc.exe if nssm not found
    sc.exe stop CloudflareTunnel 2>$null
    Start-Sleep -Seconds 2
    sc.exe delete CloudflareTunnel 2>$null
    Write-Host "   Old service removed." -ForegroundColor Green
}

# Kill any remaining cloudflared processes
Write-Host "[2/4] Stopping any running cloudflared processes..." -ForegroundColor Yellow
Stop-Process -Name "cloudflared" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host "   Done." -ForegroundColor Green

# Step 2: Install cloudflared as native service
Write-Host "[3/4] Installing cloudflared as native Windows service..." -ForegroundColor Yellow
$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"

if (-not (Test-Path $cloudflared)) {
    Write-Host "   ERROR: cloudflared.exe not found at $cloudflared" -ForegroundColor Red
    exit 1
}

# Install the service with the config file
& $cloudflared service install
Start-Sleep -Seconds 3

# Step 3: Verify and start the service
Write-Host "[4/4] Starting cloudflared service..." -ForegroundColor Yellow
Start-Service cloudflared -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5

# Check status
$service = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "SUCCESS! Cloudflared service is running" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    
    # Check tunnel connection
    Start-Sleep -Seconds 5
    Write-Host ""
    Write-Host "Checking tunnel connection..." -ForegroundColor Cyan
    & $cloudflared tunnel info stratus-tunnel 2>&1
} else {
    Write-Host ""
    Write-Host "WARNING: Service may not have started properly" -ForegroundColor Yellow
    Write-Host "Check Windows Event Viewer for details" -ForegroundColor Yellow
    Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "To test the API, visit: https://api.meteotronics.com" -ForegroundColor Cyan
