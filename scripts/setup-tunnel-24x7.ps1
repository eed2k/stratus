#Requires -RunAsAdministrator
#===============================================================================
# CLOUDFLARE TUNNEL - 24/7 SETUP (Run as Administrator)
# This creates a scheduled task that runs even when logged out
#===============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Blue
Write-Host "  Cloudflare Tunnel 24/7 Setup" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Blue
Write-Host ""

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[ERROR] This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host "Right-click and select 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "[OK] Running with Administrator privileges" -ForegroundColor Green

# Stop any existing cloudflared
Write-Host ""
Write-Host "[INFO] Stopping any existing cloudflared processes..." -ForegroundColor Cyan
Stop-Process -Name "cloudflared" -Force -ErrorAction SilentlyContinue
Stop-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue
cloudflared service uninstall 2>$null

# Remove old scheduled task
Unregister-ScheduledTask -TaskName "Cloudflare Tunnel 24x7" -Confirm:$false -ErrorAction SilentlyContinue

Start-Sleep -Seconds 2

# Paths
$cloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$userConfigPath = "$env:USERPROFILE\.cloudflared\config.yml"
$tunnelName = "stratus-tunnel"

# Verify cloudflared exists
if (-not (Test-Path $cloudflaredExe)) {
    Write-Host "[ERROR] cloudflared.exe not found at: $cloudflaredExe" -ForegroundColor Red
    pause
    exit 1
}

# Verify config exists
if (-not (Test-Path $userConfigPath)) {
    Write-Host "[ERROR] Config not found at: $userConfigPath" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "[OK] Found cloudflared and config" -ForegroundColor Green

# Create a wrapper script in a location accessible to SYSTEM
$wrapperDir = "C:\ProgramData\Cloudflared"
$wrapperScript = "$wrapperDir\run-tunnel.ps1"

if (-not (Test-Path $wrapperDir)) {
    New-Item -Path $wrapperDir -ItemType Directory -Force | Out-Null
}

# Copy config and credentials to ProgramData (accessible by all users)
Write-Host "[INFO] Copying config files to system location..." -ForegroundColor Cyan
Copy-Item "$env:USERPROFILE\.cloudflared\config.yml" "$wrapperDir\" -Force
Copy-Item "$env:USERPROFILE\.cloudflared\*.json" "$wrapperDir\" -Force

# Update the config to use the new location for credentials
$config = Get-Content "$wrapperDir\config.yml" -Raw
$config = $config -replace [regex]::Escape("$env:USERPROFILE\.cloudflared"), $wrapperDir
$config = $config -replace [regex]::Escape($env:USERPROFILE), $wrapperDir
$config | Out-File "$wrapperDir\config.yml" -Encoding utf8 -Force

Write-Host "[OK] Config files copied to $wrapperDir" -ForegroundColor Green

# Create the wrapper script
$wrapperContent = @"
# Cloudflare Tunnel Runner - Auto-restart on failure
`$ErrorActionPreference = "Continue"
`$configPath = "$wrapperDir\config.yml"
`$logFile = "$wrapperDir\tunnel.log"

while (`$true) {
    `$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path `$logFile -Value "`$timestamp - Starting cloudflared tunnel..."
    
    & "$cloudflaredExe" tunnel --config `$configPath run $tunnelName 2>&1 | Tee-Object -Append -FilePath `$logFile
    
    `$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path `$logFile -Value "`$timestamp - Tunnel stopped, restarting in 10 seconds..."
    Start-Sleep -Seconds 10
}
"@

$wrapperContent | Out-File $wrapperScript -Encoding utf8 -Force
Write-Host "[OK] Created wrapper script" -ForegroundColor Green

# Create scheduled task that runs as SYSTEM
Write-Host "[INFO] Creating scheduled task..." -ForegroundColor Cyan

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapperScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 9999) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

# Run as SYSTEM so it works even when logged out
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "Cloudflare Tunnel 24x7" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "[OK] Scheduled task created!" -ForegroundColor Green

# Start the task now
Write-Host "[INFO] Starting tunnel..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName "Cloudflare Tunnel 24x7"

Start-Sleep -Seconds 10

# Verify it's running
$task = Get-ScheduledTask -TaskName "Cloudflare Tunnel 24x7"
Write-Host ""
Write-Host "Task Status: $($task.State)" -ForegroundColor Yellow

# Check tunnel connections
Write-Host ""
Write-Host "[INFO] Checking tunnel connections..." -ForegroundColor Cyan
$tunnelInfo = & $cloudflaredExe tunnel info $tunnelName 2>&1

if ($tunnelInfo -match "does not have any active connection") {
    Write-Host "[WARN] Tunnel not connected yet, waiting longer..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    $tunnelInfo = & $cloudflaredExe tunnel info $tunnelName 2>&1
}

if ($tunnelInfo -match "Connector") {
    Write-Host "[OK] Tunnel is CONNECTED!" -ForegroundColor Green
} else {
    Write-Host "[INFO] Tunnel status:" -ForegroundColor Cyan
    Write-Host $tunnelInfo
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Blue
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Blue
Write-Host ""
Write-Host "The tunnel will now run 24/7, even after:" -ForegroundColor White
Write-Host "  - Closing VS Code" -ForegroundColor Gray
Write-Host "  - Closing all terminals" -ForegroundColor Gray
Write-Host "  - Logging out" -ForegroundColor Gray
Write-Host "  - Restarting the computer" -ForegroundColor Gray
Write-Host ""
Write-Host "Log file: $wrapperDir\tunnel.log" -ForegroundColor Cyan
Write-Host ""
Write-Host "To check status: cloudflared tunnel info stratus-tunnel" -ForegroundColor Cyan
Write-Host "To view task: Get-ScheduledTask 'Cloudflare Tunnel 24x7'" -ForegroundColor Cyan
Write-Host ""
pause
