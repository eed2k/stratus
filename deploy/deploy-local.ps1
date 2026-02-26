# =============================================================================
# Stratus Weather Station - Local Deployment Script (Windows PowerShell)
# Run this from your local machine to deploy to the Vultr server
# =============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$ServerIP = "",
    
    [Parameter(Mandatory=$false)]
    [string]$Domain = "stratus.dynv6.net",
    
    [Parameter(Mandatory=$false)]
    [string]$AdminEmail = "admin@example.com",
    
    [Parameter(Mandatory=$false)]
    [string]$SSHUser = "root"
)

$ErrorActionPreference = "Stop"

# Colors
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) { Write-Output $args }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-Host ""
Write-Host "=============================================="
Write-Host "  Stratus Deployment Script" -ForegroundColor Cyan
Write-Host "=============================================="
Write-Host ""
Write-Host "Server: $SSHUser@$ServerIP"
Write-Host "Domain: $Domain"
Write-Host ""

# Check for SSH
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] SSH not found. Please install OpenSSH or use Git Bash." -ForegroundColor Red
    exit 1
}

# Step 1: Create deployment archive
Write-Host "[1/5] Creating deployment archive..." -ForegroundColor Yellow

$excludePatterns = @(
    "node_modules",
    "dist",
    ".git",
    "logs",
    "*.log",
    ".env",
    ".env.local",
    "stratus-deploy.tar.gz"
)

# Use tar (available in Windows 10+)
$tarExclude = ($excludePatterns | ForEach-Object { "--exclude=$_" }) -join " "

# Create tar archive
Push-Location $PSScriptRoot\..
$archivePath = "stratus-deploy.tar.gz"

Write-Host "  Compressing files..."
tar -czf $archivePath --exclude=node_modules --exclude=dist --exclude=.git --exclude=logs --exclude="*.log" --exclude=.env --exclude=.env.local .

if (-not (Test-Path $archivePath)) {
    Write-Host "[ERROR] Failed to create archive" -ForegroundColor Red
    exit 1
}

$archiveSize = (Get-Item $archivePath).Length / 1MB
Write-Host "  Archive created: $([math]::Round($archiveSize, 2)) MB" -ForegroundColor Green

# Step 2: Upload setup script
Write-Host "`n[2/5] Uploading setup script..." -ForegroundColor Yellow
scp -o StrictHostKeyChecking=no deploy/server-setup.sh "${SSHUser}@${ServerIP}:/root/server-setup.sh"
Write-Host "  Setup script uploaded" -ForegroundColor Green

# Step 3: Run setup script on server
Write-Host "`n[3/5] Running server setup (this may take a few minutes)..." -ForegroundColor Yellow
$setupCmd = "chmod +x /root/server-setup.sh && DOMAIN=$Domain ADMIN_EMAIL=$AdminEmail /root/server-setup.sh"
ssh -o StrictHostKeyChecking=no "${SSHUser}@${ServerIP}" $setupCmd

# Step 4: Upload application code
Write-Host "`n[4/5] Uploading application code..." -ForegroundColor Yellow
scp -o StrictHostKeyChecking=no $archivePath "${SSHUser}@${ServerIP}:/opt/stratus/"
Write-Host "  Application code uploaded" -ForegroundColor Green

# Extract on server
Write-Host "  Extracting on server..."
ssh -o StrictHostKeyChecking=no "${SSHUser}@${ServerIP}" "cd /opt/stratus && tar -xzf stratus-deploy.tar.gz && rm stratus-deploy.tar.gz"

# Step 5: Build and start containers
Write-Host "`n[5/5] Building and starting Docker containers..." -ForegroundColor Yellow
ssh -o StrictHostKeyChecking=no "${SSHUser}@${ServerIP}" "cd /opt/stratus && docker compose up -d --build"

# Cleanup local archive
Remove-Item $archivePath -Force
Pop-Location

# Final status
Write-Host ""
Write-Host "=============================================="
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "=============================================="
Write-Host ""
Write-Host "Your Stratus instance should be available at:"
Write-Host "  https://$Domain" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: SSL certificate may take a few minutes to provision."
Write-Host ""
Write-Host "To check status, run:"
Write-Host "  ssh ${SSHUser}@${ServerIP} 'cd /opt/stratus && docker compose ps'"
Write-Host ""
Write-Host "To view logs:"
Write-Host "  ssh ${SSHUser}@${ServerIP} 'cd /opt/stratus && docker compose logs -f stratus'"
Write-Host ""
