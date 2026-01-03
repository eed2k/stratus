# Stratus Weather Server - Install as Windows Service
# Run this script as Administrator

$ErrorActionPreference = "Stop"

$nssmPath = "C:\Users\eed2k\AppData\Local\Microsoft\WinGet\Packages\NSSM.NSSM_Microsoft.Winget.Source_8wekyb3d8bbwe\nssm-2.24-101-g897c7ad\win64\nssm.exe"
$stratusPath = "c:\Users\eed2k\Downloads\Itronics Projects\stratus"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $nodePath) {
    Write-Error "Node.js not found in PATH. Please install Node.js first."
    exit 1
}

# Create logs directory
$logsPath = Join-Path $stratusPath "logs"
if (-not (Test-Path $logsPath)) {
    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
}

# Remove existing service if exists
Write-Host "Removing existing StratusServer service if exists..." -ForegroundColor Yellow
& $nssmPath stop StratusServer 2>$null
& $nssmPath remove StratusServer confirm 2>$null

# Install new service
Write-Host "Installing StratusServer service..." -ForegroundColor Green
& $nssmPath install StratusServer $nodePath
& $nssmPath set StratusServer AppParameters "node_modules\tsx\dist\cli.mjs server/index.ts"
& $nssmPath set StratusServer AppDirectory $stratusPath
& $nssmPath set StratusServer DisplayName "Stratus Weather Server"
& $nssmPath set StratusServer Description "Stratus Weather Station Server - API and Dashboard on port 5000"
& $nssmPath set StratusServer Start SERVICE_AUTO_START
& $nssmPath set StratusServer AppStdout "$logsPath\stratus-stdout.log"
& $nssmPath set StratusServer AppStderr "$logsPath\stratus-stderr.log"
& $nssmPath set StratusServer AppRotateFiles 1
& $nssmPath set StratusServer AppRotateBytes 1048576

# Start the service
Write-Host "Starting StratusServer service..." -ForegroundColor Green
& $nssmPath start StratusServer

# Verify
Start-Sleep -Seconds 3
$service = Get-Service -Name StratusServer -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
    Write-Host "`nStratus Weather Server installed and running successfully!" -ForegroundColor Green
    Write-Host "Service: StratusServer"
    Write-Host "Port: 5000"
    Write-Host "Logs: $logsPath"
} else {
    Write-Host "`nWarning: Service may not have started correctly. Check logs." -ForegroundColor Yellow
}

Write-Host "`nPress any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
