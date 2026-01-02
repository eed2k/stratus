@echo off
echo ============================================
echo Fixing Cloudflare Tunnel Service (v2)
echo ============================================
echo.

echo Step 1: Stopping any running cloudflared processes...
taskkill /F /IM cloudflared.exe 2>nul
net stop Cloudflared 2>nul
timeout /t 3 >nul

echo.
echo Step 2: Uninstalling old service...
"C:\Program Files (x86)\cloudflared\cloudflared.exe" service uninstall 2>nul
timeout /t 2 >nul

echo.
echo Step 3: Creating SYSTEM profile cloudflared directory...
if not exist "C:\Windows\System32\config\systemprofile\.cloudflared" (
    mkdir "C:\Windows\System32\config\systemprofile\.cloudflared"
)

echo.
echo Step 4: Copying credential files to SYSTEM profile...
copy /Y "%USERPROFILE%\.cloudflared\*.json" "C:\Windows\System32\config\systemprofile\.cloudflared\" >nul

echo.
echo Step 5: Creating SYSTEM profile config.yml with correct paths...
(
echo protocol: http2
echo.
echo # Stratus Weather Server - Cloudflare Tunnel Configuration
echo # For Windows Service running as SYSTEM
echo.
echo tunnel: 71c81491-994c-4a34-a095-0e4a1c0490e6
echo credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\71c81491-994c-4a34-a095-0e4a1c0490e6.json
echo.
echo originRequest:
echo   connectTimeout: 30s
echo   noTLSVerify: false
echo.
echo ingress:
echo   - hostname: api.meteotronics.com
echo     service: http://localhost:5000
echo     originRequest:
echo       connectTimeout: 60s
echo.
echo   - hostname: meteotronics.com
echo     service: http://localhost:5000
echo.
echo   - hostname: www.meteotronics.com
echo     service: http://localhost:5000
echo.
echo   - service: http_status:404
) > "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml"

echo.
echo Step 6: Installing Cloudflare service...
"C:\Program Files (x86)\cloudflared\cloudflared.exe" service install
timeout /t 2 >nul

echo.
echo Step 7: Starting Cloudflare service...
net start Cloudflared
timeout /t 10 >nul

echo.
echo Step 8: Checking tunnel status...
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel info stratus-tunnel

echo.
echo ============================================
echo If still no connections, try:
echo   cloudflared tunnel run stratus-tunnel
echo in an admin terminal to see errors.
echo ============================================
echo.
pause
