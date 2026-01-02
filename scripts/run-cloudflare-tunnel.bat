@echo off
:: ============================================
:: CLOUDFLARE TUNNEL - RUN AS SCHEDULED TASK
:: This runs cloudflared tunnel as your user account
:: which has access to your config files
:: ============================================

echo Starting Cloudflare Tunnel...
cd /d "%USERPROFILE%\.cloudflared"

:loop
echo [%date% %time%] Starting tunnel...
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --config "%USERPROFILE%\.cloudflared\config.yml" run stratus-tunnel

echo [%date% %time%] Tunnel stopped. Restarting in 5 seconds...
timeout /t 5 >nul
goto loop
