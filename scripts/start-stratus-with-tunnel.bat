@echo off
echo ========================================
echo  Stratus Weather Server + Cloudflare Tunnel
echo ========================================
echo.
echo Starting Stratus server...
start "" "C:\Users\eed2k\Downloads\Itronics Projects\stratus\release\win-unpacked\Stratus Weather Server.exe"
echo.
echo Waiting 10 seconds for Stratus to start...
timeout /t 10 /nobreak
echo.
echo Starting Cloudflare Tunnel...
echo Your public URL will appear below!
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:5000
pause
