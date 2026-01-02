#===============================================================================
# STRATUS WEATHER SERVER - 24/7 Production Setup
# This script properly configures both services to run continuously
#===============================================================================
# Run as Administrator: 
#   Start-Process powershell -Verb RunAs -ArgumentList "-File `"$PSScriptRoot\setup-production-24-7.ps1`""
#===============================================================================

param(
    [switch]$FixTunnelOnly,
    [switch]$CheckStatus,
    [switch]$RestartAll,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Colors
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Blue
Write-Host "  STRATUS WEATHER SERVER - 24/7 Production Setup" -ForegroundColor White
Write-Host "  Domain: api.meteotronics.com | meteotronics.com" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Blue
Write-Host ""

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "This script requires Administrator privileges!"
    Write-Host "Run: Start-Process powershell -Verb RunAs -ArgumentList `"-File `$PSScriptRoot\setup-production-24-7.ps1`"" -ForegroundColor Yellow
    exit 1
}
Write-Success "Running with Administrator privileges"

#===============================================================================
# UNINSTALL
#===============================================================================
if ($Uninstall) {
    Write-Host ""
    Write-Warn "Uninstalling Stratus 24/7 services..."
    
    # Stop and remove Cloudflare service
    Stop-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue
    cloudflared service uninstall 2>&1 | Out-Null
    
    # Remove scheduled task
    Unregister-ScheduledTask -TaskName "Stratus Weather Server Production" -Confirm:$false -ErrorAction SilentlyContinue
    
    Write-Success "Services uninstalled"
    exit 0
}

#===============================================================================
# STATUS CHECK
#===============================================================================
if ($CheckStatus) {
    Write-Host ""
    Write-Info "Checking service status..."
    Write-Host ""
    
    # Check Cloudflare tunnel service
    $cfService = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
    if ($cfService) {
        if ($cfService.Status -eq "Running") {
            Write-Success "Cloudflare Tunnel Service: RUNNING"
        } else {
            Write-Warn "Cloudflare Tunnel Service: $($cfService.Status)"
        }
    } else {
        Write-Err "Cloudflare Tunnel Service: NOT INSTALLED"
    }
    
    # Check tunnel connections
    Write-Host ""
    $tunnelInfo = cloudflared tunnel info stratus-tunnel 2>&1
    if ($tunnelInfo -match "does not have any active connection") {
        Write-Err "Tunnel has NO ACTIVE CONNECTIONS"
        Write-Warn "The service is running but not properly configured!"
        Write-Info "Try running: .\setup-production-24-7.ps1 -RestartAll"
    } elseif ($tunnelInfo -match "connection") {
        Write-Success "Tunnel has active connections"
        # Show connection details
        $tunnelInfo | Select-String "connector" | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
    
    # Check Stratus server
    Write-Host ""
    $stratusTask = Get-ScheduledTask -TaskName "Stratus Weather Server Production" -ErrorAction SilentlyContinue
    if ($stratusTask) {
        Write-Success "Stratus Server Task: $($stratusTask.State)"
    } else {
        Write-Warn "Stratus Server Task: NOT CONFIGURED"
    }
    
    # Check if port 5000 is in use
    $port5000 = netstat -ano | Select-String ":5000.*LISTENING"
    if ($port5000) {
        Write-Success "Port 5000: IN USE (server running)"
    } else {
        Write-Err "Port 5000: NOT IN USE (server not running)"
    }
    
    # Test API endpoints
    Write-Host ""
    Write-Info "Testing API endpoints..."
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5000" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        Write-Success "Local server (localhost:5000): OK (Status: $($response.StatusCode))"
    } catch {
        Write-Err "Local server (localhost:5000): NOT RESPONDING"
    }
    
    try {
        $response = Invoke-WebRequest -Uri "https://api.meteotronics.com" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        Write-Success "Public API (api.meteotronics.com): OK (Status: $($response.StatusCode))"
    } catch {
        Write-Err "Public API (api.meteotronics.com): NOT RESPONDING"
        Write-Warn "Check tunnel configuration and DNS settings"
    }
    
    try {
        $response = Invoke-WebRequest -Uri "https://meteotronics.com" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
        Write-Success "Main dashboard (meteotronics.com): OK (Status: $($response.StatusCode))"
    } catch {
        Write-Err "Main dashboard (meteotronics.com): NOT RESPONDING"
    }
    
    # Show uptime
    Write-Host ""
    if ($cfService -and $cfService.Status -eq "Running") {
        $startTime = (Get-Process cloudflared -ErrorAction SilentlyContinue).StartTime
        if ($startTime) {
            $uptime = (Get-Date) - $startTime
            Write-Info "Tunnel uptime: $($uptime.Days)d $($uptime.Hours)h $($uptime.Minutes)m"
        }
    }
    
    exit 0
}

#===============================================================================
# RESTART ALL SERVICES
#===============================================================================
if ($RestartAll) {
    Write-Host ""
    Write-Info "Restarting all services..."
    
    # Restart Cloudflare tunnel
    Write-Info "Restarting Cloudflare tunnel service..."
    Restart-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    
    # Restart Stratus server task
    Write-Info "Restarting Stratus server..."
    Stop-ScheduledTask -TaskName "Stratus Weather Server Production" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName "Stratus Weather Server Production" -ErrorAction SilentlyContinue
    
    Write-Success "Services restarted! Waiting for startup..."
    Start-Sleep -Seconds 10
    
    # Run status check
    & $PSCommandPath -CheckStatus
    exit 0
}

#===============================================================================
# FIX CLOUDFLARE TUNNEL SERVICE
#===============================================================================
Write-Host ""
Write-Info "Step 1: Setting up Cloudflare Tunnel Service for 24/7 operation..."
Write-Host ""

# Stop existing service
Stop-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Uninstall existing (improperly configured) service
Write-Info "Removing old service configuration..."
cloudflared service uninstall 2>&1 | Out-Null
Start-Sleep -Seconds 2

# Check for config file
$configPath = "$env:USERPROFILE\.cloudflared\config.yml"
if (-not (Test-Path $configPath)) {
    Write-Warn "No tunnel configuration found at: $configPath"
    Write-Info "Creating default configuration..."
    
    # Check if tunnel exists
    $tunnelList = cloudflared tunnel list --output json 2>$null | ConvertFrom-Json
    $existingTunnel = $tunnelList | Where-Object { $_.name -eq "stratus-tunnel" }
    
    if (-not $existingTunnel) {
        Write-Err "Tunnel 'stratus-tunnel' not found!"
        Write-Err "Please run setup-cloudflare-tunnel.ps1 first to create the tunnel."
        exit 1
    }
    
    $tunnelId = $existingTunnel.id
    
    # Create config file
    $configContent = @"
# Stratus Weather Server - Cloudflare Tunnel Configuration
# Auto-generated for 24/7 operation

tunnel: $tunnelId
credentials-file: $env:USERPROFILE\.cloudflared\$tunnelId.json

originRequest:
  connectTimeout: 30s
  noTLSVerify: false

ingress:
  - hostname: api.meteotronics.com
    service: http://localhost:5000
    originRequest:
      connectTimeout: 60s
  
  - hostname: meteotronics.com
    service: http://localhost:5000
  
  - hostname: www.meteotronics.com
    service: http://localhost:5000
  
  - service: http_status:404
"@
    
    $configContent | Out-File -FilePath $configPath -Encoding utf8 -Force
    Write-Success "Created tunnel configuration"
} else {
    Write-Success "Found tunnel config at: $configPath"
}

# Install service with proper configuration
Write-Info "Installing Cloudflare service with tunnel configuration..."
cloudflared service install

if ($LASTEXITCODE -eq 0) {
    Write-Success "Cloudflare service installed!"
    Start-Sleep -Seconds 2
    
    # Verify the service binary path now includes tunnel run
    $svcConfig = sc.exe qc Cloudflared
    Write-Host ""
    Write-Info "Service configuration:"
    $svcConfig | Select-String "BINARY_PATH_NAME" | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    
    # Start the service
    Start-Service -Name "Cloudflared"
    Start-Sleep -Seconds 5
    
    # Verify connections
    $tunnelInfo = cloudflared tunnel info stratus-tunnel 2>&1
    if ($tunnelInfo -match "does not have any active connection") {
        Write-Warn "Tunnel not connecting yet, waiting..."
        Start-Sleep -Seconds 10
        $tunnelInfo = cloudflared tunnel info stratus-tunnel 2>&1
    }
    
    if ($tunnelInfo -match "does not have any active connection") {
        Write-Err "Tunnel still not connecting. Check logs with:"
        Write-Host "  Get-EventLog -LogName Application -Source 'cloudflared' -Newest 20" -ForegroundColor Yellow
    } else {
        Write-Success "Tunnel is connected!"
    }
} else {
    Write-Err "Failed to install Cloudflare service"
    exit 1
}

if ($FixTunnelOnly) {
    Write-Host ""
    Write-Success "Tunnel service fixed!"
    exit 0
}

#===============================================================================
# SETUP STRATUS SERVER AS SCHEDULED TASK (WITH RESTART ON FAILURE)
#===============================================================================
Write-Host ""
Write-Info "Step 2: Setting up Stratus Server as Windows Task..."
Write-Host ""

$projectPath = Split-Path -Parent $PSScriptRoot
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $nodeExe) {
    Write-Err "Node.js not found! Please install Node.js."
    exit 1
}

# Build the server first
Write-Info "Building server for production..."
Push-Location $projectPath
npm run build:server 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Server build had issues, continuing anyway..."
}
Pop-Location

# Remove existing task
Unregister-ScheduledTask -TaskName "Stratus Weather Server Production" -Confirm:$false -ErrorAction SilentlyContinue

# Create a wrapper script that runs the server
$wrapperScript = @"
# Stratus Server Wrapper - Auto-restart on failure
`$ErrorActionPreference = "Continue"
`$projectPath = "$projectPath"
`$env:NODE_ENV = "production"
`$env:PORT = "5000"

while (`$true) {
    Write-Host "Starting Stratus server..."
    Set-Location `$projectPath
    
    # Try to run built server first, fall back to tsx
    if (Test-Path "`$projectPath\dist\server\index.js") {
        node "`$projectPath\dist\server\index.js"
    } else {
        npx tsx "`$projectPath\server\index.ts"
    }
    
    Write-Host "Server stopped, restarting in 5 seconds..."
    Start-Sleep -Seconds 5
}
"@

$wrapperPath = "$projectPath\scripts\run-server-production.ps1"
$wrapperScript | Out-File -FilePath $wrapperPath -Encoding utf8 -Force
Write-Success "Created server wrapper script"

# Create scheduled task
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wrapperPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "Stratus Weather Server Production" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

Write-Success "Scheduled task created!"

# Start the task now
Write-Info "Starting Stratus server..."
Start-ScheduledTask -TaskName "Stratus Weather Server Production"
Start-Sleep -Seconds 5

# Verify server is running
$port5000 = netstat -ano | Select-String ":5000.*LISTENING"
if ($port5000) {
    Write-Success "Server is running on port 5000!"
} else {
    Write-Warn "Server may take a moment to start..."
}

#===============================================================================
# FINAL STATUS
#===============================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE - 24/7 Production Mode" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Services configured:" -ForegroundColor Cyan
Write-Host "  • Cloudflare Tunnel: Windows Service (auto-start on boot)" -ForegroundColor Gray
Write-Host "  • Stratus Server: Scheduled Task (auto-start, auto-restart)" -ForegroundColor Gray
Write-Host ""
Write-Host "Your endpoints:" -ForegroundColor Cyan
Write-Host "  • https://meteotronics.com (Dashboard)" -ForegroundColor White
Write-Host "  • https://api.meteotronics.com (API)" -ForegroundColor White
Write-Host "  • https://api.meteotronics.com/api/weather-data (Data Ingestion)" -ForegroundColor White
Write-Host ""
Write-Host "Commands:" -ForegroundColor Yellow
Write-Host "  Check status:    .\setup-production-24-7.ps1 -CheckStatus" -ForegroundColor Gray
Write-Host "  Restart all:     .\setup-production-24-7.ps1 -RestartAll" -ForegroundColor Gray
Write-Host "  Fix tunnel:      .\setup-production-24-7.ps1 -FixTunnelOnly" -ForegroundColor Gray
Write-Host "  Uninstall:       .\setup-production-24-7.ps1 -Uninstall" -ForegroundColor Gray
Write-Host ""
Write-Host "SEO/Google Preview Note:" -ForegroundColor Cyan
Write-Host "  For proper Google search preview, ensure your pages have:" -ForegroundColor Gray
Write-Host "    - <title> tag with 'Stratus Weather Server'" -ForegroundColor Gray
Write-Host "    - <meta name='description' content='...'>" -ForegroundColor Gray
Write-Host "    - Open Graph tags (og:title, og:description, og:image)" -ForegroundColor Gray
Write-Host ""
Write-Host "Tunnel will remain active 24/7 as long as:" -ForegroundColor Cyan
Write-Host "  1. Computer is powered on" -ForegroundColor Gray
Write-Host "  2. Internet connection is available" -ForegroundColor Gray
Write-Host "  3. Cloudflared service is running" -ForegroundColor Gray
Write-Host ""

