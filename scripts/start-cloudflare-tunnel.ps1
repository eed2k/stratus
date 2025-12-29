# Cloudflare Tunnel Startup Script for Stratus Weather Server
# This creates a public URL for your local Stratus server

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Stratus Cloudflare Tunnel" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting tunnel to localhost:5000..." -ForegroundColor Yellow
Write-Host ""
Write-Host "IMPORTANT: Make sure Stratus EXE is running first!" -ForegroundColor Red
Write-Host ""
Write-Host "Your public URL will appear below (look for 'https://xxxxx.trycloudflare.com')" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop the tunnel" -ForegroundColor Gray
Write-Host ""

& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:5000
