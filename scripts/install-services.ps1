# Stratus Weather Server - Service Installation Script
# Run this script as Administrator to install services for 24/7 operation
#
# Usage: Right-click this file → Run with PowerShell (as Administrator)
# Or: Start-Process powershell -Verb RunAs -ArgumentList "-File `"$PSScriptRoot\install-services.ps1`""

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Stratus Weather Server - Service Setup   " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check for Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please right-click and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host "Or run: Start-Process powershell -Verb RunAs -ArgumentList `"-File `$PSScriptRoot\install-services.ps1`"" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✓ Running with Administrator privileges" -ForegroundColor Green
Write-Host ""

# 1. Install Cloudflare Tunnel as Windows Service
Write-Host "Step 1: Installing Cloudflare Tunnel Service..." -ForegroundColor Yellow

try {
    $cloudflaredPath = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if ($cloudflaredPath) {
        Write-Host "  Found cloudflared at: $cloudflaredPath" -ForegroundColor Gray
        
        # Check if service already exists
        $existingService = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
        if ($existingService) {
            Write-Host "  Cloudflared service already exists, stopping..." -ForegroundColor Gray
            Stop-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue
            & cloudflared service uninstall 2>&1 | Out-Null
            Start-Sleep -Seconds 2
        }
        
        & cloudflared service install
        Start-Sleep -Seconds 2
        
        # Start the service
        Start-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
        Write-Host "✓ Cloudflare Tunnel service installed and started!" -ForegroundColor Green
    } else {
        Write-Host "✗ cloudflared not found. Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Failed to install Cloudflare service: $_" -ForegroundColor Red
}

Write-Host ""

# 2. Create Stratus Server scheduled task (runs on startup)
Write-Host "Step 2: Creating Stratus Server startup task..." -ForegroundColor Yellow

try {
    $stratusPath = Split-Path -Parent $PSScriptRoot
    $exePath = Join-Path $stratusPath "output\Stratus Weather Server-1.0.0-Setup.exe"
    $installedExe = "$env:LOCALAPPDATA\Programs\stratus-weather-server\Stratus Weather Server.exe"
    
    # Check if the app is installed
    if (Test-Path $installedExe) {
        $targetExe = $installedExe
    } elseif (Test-Path $exePath) {
        Write-Host "  EXE found but not installed. Running installer first..." -ForegroundColor Gray
        Start-Process -FilePath $exePath -Wait
        $targetExe = $installedExe
    } else {
        Write-Host "  Building EXE first..." -ForegroundColor Gray
        Push-Location $stratusPath
        npm run dist:win
        Pop-Location
        if (Test-Path $exePath) {
            Start-Process -FilePath $exePath -Wait
            $targetExe = $installedExe
        }
    }
    
    if ($targetExe -and (Test-Path $targetExe)) {
        # Remove existing task if present
        Unregister-ScheduledTask -TaskName "Stratus Weather Server" -Confirm:$false -ErrorAction SilentlyContinue
        
        # Create scheduled task to run at logon
        $action = New-ScheduledTaskAction -Execute $targetExe
        $trigger = New-ScheduledTaskTrigger -AtLogon
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
        
        Register-ScheduledTask -TaskName "Stratus Weather Server" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
        
        Write-Host "✓ Stratus Server startup task created!" -ForegroundColor Green
        Write-Host "  The server will start automatically when you log in." -ForegroundColor Gray
    } else {
        Write-Host "✗ Could not find Stratus Weather Server executable" -ForegroundColor Red
        Write-Host "  Please build and install the EXE first: npm run dist:win" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Failed to create startup task: $_" -ForegroundColor Red
}

Write-Host ""

# 3. Verify services
Write-Host "Step 3: Verifying services..." -ForegroundColor Yellow

$tunnelService = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if ($tunnelService -and $tunnelService.Status -eq "Running") {
    Write-Host "✓ Cloudflare Tunnel: Running" -ForegroundColor Green
} else {
    Write-Host "✗ Cloudflare Tunnel: Not running" -ForegroundColor Red
}

$task = Get-ScheduledTask -TaskName "Stratus Weather Server" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "✓ Stratus Startup Task: Configured" -ForegroundColor Green
} else {
    Write-Host "✗ Stratus Startup Task: Not configured" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!                          " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your services will now run 24/7:" -ForegroundColor White
Write-Host "  • Cloudflare Tunnel runs as a Windows Service (always on)" -ForegroundColor Gray
Write-Host "  • Stratus Server starts automatically on login" -ForegroundColor Gray
Write-Host ""
Write-Host "Endpoints:" -ForegroundColor White
Write-Host "  • https://meteotronics.com (Dashboard)" -ForegroundColor Cyan
Write-Host "  • https://api.meteotronics.com (API)" -ForegroundColor Cyan
Write-Host ""

Read-Host "Press Enter to exit"
