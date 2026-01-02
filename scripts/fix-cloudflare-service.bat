@echo off
echo ============================================
echo Fixing Cloudflare Tunnel Service
echo ============================================
echo.

echo Stopping any running cloudflared processes...
taskkill /F /IM cloudflared.exe 2>nul
timeout /t 2 >nul

echo Uninstalling old service...
cloudflared service uninstall 2>nul
timeout /t 2 >nul

echo Copying config files to SYSTEM profile...
if not exist "C:\Windows\System32\config\systemprofile\.cloudflared" mkdir "C:\Windows\System32\config\systemprofile\.cloudflared"
copy /Y "%USERPROFILE%\.cloudflared\config.yml" "C:\Windows\System32\config\systemprofile\.cloudflared\"
copy /Y "%USERPROFILE%\.cloudflared\*.json" "C:\Windows\System32\config\systemprofile\.cloudflared\"

echo Installing Cloudflare service...
cloudflared service install
timeout /t 2 >nul

echo Starting service...
net start Cloudflared
timeout /t 5 >nul

echo.
echo Checking tunnel status...
cloudflared tunnel info stratus-tunnel

echo.
echo ============================================
echo Done! Press any key to close.
pause >nul
