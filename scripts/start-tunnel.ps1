# Stratus Weather Server - Cloudflare Tunnel Launcher
# This script starts Stratus and creates a public tunnel URL
# The URL will be displayed - copy it for your datalogger

$cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$stratusPath = "C:\Users\eed2k\Downloads\Itronics Projects\stratus"

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   STRATUS WEATHER SERVER - CLOUDFLARE TUNNEL LAUNCHER" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Stratus is running
$stratusRunning = Get-Process -Name "Stratus Weather Server" -ErrorAction SilentlyContinue

if (-not $stratusRunning) {
    Write-Host "[!] Stratus is not running." -ForegroundColor Yellow
    Write-Host "    Please start Stratus Weather Server EXE first!" -ForegroundColor Yellow
    Write-Host ""
    $start = Read-Host "Start Stratus now? (y/n)"
    if ($start -eq "y") {
        $exePath = Get-ChildItem -Path $stratusPath -Recurse -Filter "*.exe" | Where-Object { $_.Name -like "*Stratus*" } | Select-Object -First 1
        if ($exePath) {
            Write-Host "Starting: $($exePath.FullName)" -ForegroundColor Green
            Start-Process $exePath.FullName
            Write-Host "Waiting 10 seconds for Stratus to start..." -ForegroundColor Gray
            Start-Sleep -Seconds 10
        }
    }
}

Write-Host ""
Write-Host "[*] Starting Cloudflare Tunnel..." -ForegroundColor Green
Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "  LOOK FOR YOUR PUBLIC URL BELOW!" -ForegroundColor Yellow
Write-Host "  It will look like:" -ForegroundColor Yellow
Write-Host "  https://xxxxx-xxxxx-xxxxx.trycloudflare.com" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop the tunnel" -ForegroundColor Gray
Write-Host ""

# Start tunnel
& $cloudflared tunnel --url http://localhost:5000
