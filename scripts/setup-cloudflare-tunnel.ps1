#===============================================================================
# STRATUS WEATHER SERVER - Cloudflare Tunnel Setup Script
# Automated setup for secure remote access via Cloudflare
#===============================================================================
# This script automates the setup of Cloudflare Tunnel for Stratus Weather Server
# enabling secure HTTPS access for weather station data ingestion.
#
# Prerequisites:
# - Cloudflare account with domain (e.g., meteotronics.com)
# - cloudflared installed (winget install Cloudflare.cloudflared)
# - Domain DNS managed by Cloudflare
#===============================================================================

param(
    [string]$Domain = "meteotronics.com",
    [string]$TunnelName = "stratus-tunnel",
    [int]$LocalPort = 5000,
    [switch]$InstallService,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warning { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }

# Banner
Write-Host ""
Write-Host "============================================================" -ForegroundColor Blue
Write-Host "  STRATUS WEATHER SERVER - Cloudflare Tunnel Setup" -ForegroundColor White
Write-Host "  Domain: $Domain" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Blue
Write-Host ""

# Check if cloudflared is installed
function Test-CloudflaredInstalled {
    try {
        $version = cloudflared --version 2>&1
        Write-Success "cloudflared is installed: $version"
        return $true
    }
    catch {
        return $false
    }
}

# Install cloudflared
function Install-Cloudflared {
    Write-Info "Installing cloudflared via winget..."
    try {
        winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
        Write-Success "cloudflared installed successfully"
    }
    catch {
        Write-Error "Failed to install cloudflared. Please install manually from:"
        Write-Host "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        exit 1
    }
}

# Authenticate with Cloudflare
function Invoke-CloudflareLogin {
    Write-Info "Authenticating with Cloudflare..."
    Write-Host "A browser window will open. Please log in to your Cloudflare account and authorize access to $Domain" -ForegroundColor Yellow
    
    cloudflared tunnel login
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Authentication successful"
    }
    else {
        Write-Error "Authentication failed"
        exit 1
    }
}

# Check if tunnel exists
function Get-ExistingTunnel {
    param($Name)
    
    $tunnels = cloudflared tunnel list --output json 2>$null | ConvertFrom-Json
    return $tunnels | Where-Object { $_.name -eq $Name }
}

# Create tunnel
function New-CloudflareTunnel {
    param($Name)
    
    $existing = Get-ExistingTunnel -Name $Name
    
    if ($existing) {
        Write-Warning "Tunnel '$Name' already exists (ID: $($existing.id))"
        return $existing.id
    }
    
    Write-Info "Creating tunnel '$Name'..."
    $output = cloudflared tunnel create $Name 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        # Extract tunnel ID from output
        $tunnelId = ($output | Select-String -Pattern "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}").Matches[0].Value
        Write-Success "Tunnel created with ID: $tunnelId"
        return $tunnelId
    }
    else {
        Write-Error "Failed to create tunnel: $output"
        exit 1
    }
}

# Create config file
function New-TunnelConfig {
    param($TunnelId, $Domain, $LocalPort)
    
    $configDir = "$env:USERPROFILE\.cloudflared"
    $configPath = "$configDir\config.yml"
    
    # Find credentials file
    $credentialsFile = Get-ChildItem "$configDir\*.json" | Where-Object { $_.Name -match $TunnelId } | Select-Object -First 1
    
    if (-not $credentialsFile) {
        $credentialsFile = "$configDir\$TunnelId.json"
    }
    
    $config = @"
# Stratus Weather Server - Cloudflare Tunnel Configuration
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# Domain: $Domain

tunnel: $TunnelId
credentials-file: $($credentialsFile.FullName ?? $credentialsFile)

# Origin server configuration
originRequest:
  connectTimeout: 30s
  noTLSVerify: false

ingress:
  # API endpoint for weather station data ingestion (WMO standard)
  # Weather stations should POST to: https://api.$Domain/api/weather-data
  - hostname: api.$Domain
    service: http://localhost:$LocalPort
    originRequest:
      connectTimeout: 60s
  
  # Main web dashboard
  - hostname: $Domain
    service: http://localhost:$LocalPort
  
  # WWW subdomain redirect
  - hostname: www.$Domain
    service: http://localhost:$LocalPort
  
  # Data ingestion endpoint (alternative)
  - hostname: data.$Domain
    service: http://localhost:$LocalPort
  
  # Catch-all rule (required)
  - service: http_status:404
"@
    
    Write-Info "Creating tunnel configuration at $configPath..."
    $config | Out-File -FilePath $configPath -Encoding utf8 -Force
    Write-Success "Configuration file created"
    
    return $configPath
}

# Setup DNS routes
function Set-DNSRoutes {
    param($TunnelName, $Domain)
    
    $subdomains = @("", "www", "api", "data")
    
    foreach ($sub in $subdomains) {
        $hostname = if ($sub) { "$sub.$Domain" } else { $Domain }
        
        Write-Info "Creating DNS route for $hostname..."
        
        $output = cloudflared tunnel route dns $TunnelName $hostname 2>&1
        
        if ($output -match "already exists" -or $LASTEXITCODE -eq 0) {
            Write-Success "DNS route configured for $hostname"
        }
        else {
            Write-Warning "DNS route for $hostname may need manual configuration: $output"
        }
    }
}

# Start tunnel
function Start-Tunnel {
    param($TunnelName)
    
    Write-Info "Starting tunnel '$TunnelName'..."
    Write-Host ""
    Write-Host "Press Ctrl+C to stop the tunnel" -ForegroundColor Yellow
    Write-Host ""
    
    cloudflared tunnel run $TunnelName
}

# Install as Windows service
function Install-TunnelService {
    Write-Info "Installing Cloudflare Tunnel as Windows service..."
    
    # Check if running as admin
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    
    if (-not $isAdmin) {
        Write-Error "Administrator privileges required to install service"
        Write-Host "Please run this script as Administrator" -ForegroundColor Yellow
        exit 1
    }
    
    cloudflared service install
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Service installed successfully"
        Write-Info "The tunnel will now start automatically with Windows"
        
        # Start the service
        Start-Service cloudflared -ErrorAction SilentlyContinue
        Write-Success "Service started"
    }
    else {
        Write-Error "Failed to install service"
    }
}

# Uninstall service and cleanup
function Uninstall-Tunnel {
    param($TunnelName)
    
    Write-Warning "Uninstalling Cloudflare Tunnel..."
    
    # Stop and remove service
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    
    if ($isAdmin) {
        Stop-Service cloudflared -ErrorAction SilentlyContinue
        cloudflared service uninstall 2>$null
        Write-Success "Service removed"
    }
    
    # Delete tunnel
    $existing = Get-ExistingTunnel -Name $TunnelName
    if ($existing) {
        cloudflared tunnel delete $TunnelName --force 2>$null
        Write-Success "Tunnel deleted"
    }
    
    Write-Success "Uninstallation complete"
}

#===============================================================================
# MAIN EXECUTION
#===============================================================================

# Handle uninstall
if ($Uninstall) {
    Uninstall-Tunnel -TunnelName $TunnelName
    exit 0
}

# Step 1: Check/Install cloudflared
if (-not (Test-CloudflaredInstalled)) {
    Install-Cloudflared
}

# Step 2: Check authentication
$certPath = "$env:USERPROFILE\.cloudflared\cert.pem"
if (-not (Test-Path $certPath)) {
    Invoke-CloudflareLogin
}
else {
    Write-Success "Already authenticated with Cloudflare"
}

# Step 3: Create tunnel
$tunnelId = New-CloudflareTunnel -Name $TunnelName

# Step 4: Create configuration
$configPath = New-TunnelConfig -TunnelId $tunnelId -Domain $Domain -LocalPort $LocalPort

# Step 5: Setup DNS routes
Set-DNSRoutes -TunnelName $TunnelName -Domain $Domain

# Step 6: Install as service (if requested)
if ($InstallService) {
    Install-TunnelService
    
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  SETUP COMPLETE - Tunnel running as Windows service" -ForegroundColor White
    Write-Host "============================================================" -ForegroundColor Green
}
else {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  SETUP COMPLETE" -ForegroundColor White
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your Stratus server will be accessible at:" -ForegroundColor Cyan
    Write-Host "  Dashboard: https://$Domain" -ForegroundColor White
    Write-Host "  API:       https://api.$Domain" -ForegroundColor White
    Write-Host ""
    Write-Host "Weather station data endpoint:" -ForegroundColor Cyan
    Write-Host "  POST https://api.$Domain/api/weather-data" -ForegroundColor White
    Write-Host "  POST https://api.$Domain/api/campbell/data" -ForegroundColor White
    Write-Host ""
    Write-Host "To start the tunnel now, run:" -ForegroundColor Yellow
    Write-Host "  cloudflared tunnel run $TunnelName" -ForegroundColor Gray
    Write-Host ""
    Write-Host "To install as Windows service (auto-start), run:" -ForegroundColor Yellow
    Write-Host "  .\setup-cloudflare-tunnel.ps1 -InstallService" -ForegroundColor Gray
    Write-Host ""
    
    # Ask to start tunnel
    $startNow = Read-Host "Start tunnel now? (y/n)"
    if ($startNow -eq "y" -or $startNow -eq "Y") {
        Start-Tunnel -TunnelName $TunnelName
    }
}
