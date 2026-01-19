# Stratus Weather Server - Service Installation Script
# Run this script as Administrator to install Stratus Weather Server for 24/7 operation
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

# 1. Create Stratus Server scheduled task (runs on startup)
Write-Host "Step 1: Creating Stratus Server startup task..." -ForegroundColor Yellow

try {
    $stratusPath = Split-Path -Parent $PSScriptRoot
    $exePath = Join-Path $stratusPath "output\Stratus Weather Station-1.0.0-Setup.exe"
    $installedExe = "$env:LOCALAPPDATA\Programs\stratus-weather-station\Stratus Weather Station.exe"
    
    # Check if the app is installed
    if (Test-Path $installedExe) {
        $targetExe = $installedExe
        Write-Host "  Found installed application at: $installedExe" -ForegroundColor Gray
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
        Unregister-ScheduledTask -TaskName "Stratus Weather Station" -Confirm:$false -ErrorAction SilentlyContinue
        
        # Create scheduled task to run at logon
        $action = New-ScheduledTaskAction -Execute $targetExe
        $trigger = New-ScheduledTaskTrigger -AtLogon
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
        
        Register-ScheduledTask -TaskName "Stratus Weather Station" -Action $action -Trigger $trigger -Settings $settings -Principal $principal
        
        Write-Host "✓ Stratus Weather Station startup task created!" -ForegroundColor Green
        Write-Host "  The application will start automatically when you log in." -ForegroundColor Gray
    } else {
        Write-Host "✗ Could not find Stratus Weather Station executable" -ForegroundColor Red
        Write-Host "  Please build and install the EXE first: npm run dist:win" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Failed to create startup task: $_" -ForegroundColor Red
}

Write-Host ""

# 2. Verify services
Write-Host "Step 2: Verifying services..." -ForegroundColor Yellow

$task = Get-ScheduledTask -TaskName "Stratus Weather Station" -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "✓ Stratus Weather Station Startup Task: Configured" -ForegroundColor Green
} else {
    Write-Host "✗ Stratus Weather Station Startup Task: Not configured" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!                          " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Stratus Weather Station will now start automatically on login." -ForegroundColor White
Write-Host ""
Write-Host "For cloud deployment, see ORACLE_CLOUD_DEPLOYMENT.md" -ForegroundColor White
Write-Host ""
Write-Host "Developer: Lukas Esterhuizen (esterhuizen2k@proton.me)" -ForegroundColor Cyan
Write-Host ""

Read-Host "Press Enter to exit"
