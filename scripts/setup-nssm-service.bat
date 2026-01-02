@echo off
:: ============================================
:: CLOUDFLARE TUNNEL - NSSM SERVICE SETUP
:: Run as Administrator
:: ============================================

echo ============================================
echo  Cloudflare Tunnel 24/7 Service Setup
echo ============================================
echo.

:: Check admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script requires Administrator privileges!
    echo Right-click and select "Run as Administrator"
    pause
    exit /b 1
)

echo [OK] Running as Administrator
echo.

:: Stop existing services
echo Stopping existing cloudflared...
taskkill /F /IM cloudflared.exe 2>nul
net stop Cloudflared 2>nul
net stop CloudflareTunnel 2>nul
nssm stop CloudflareTunnel 2>nul
nssm remove CloudflareTunnel confirm 2>nul
cloudflared service uninstall 2>nul
timeout /t 2 >nul

:: Create config directory
echo Creating config directory...
if not exist "C:\ProgramData\Cloudflared" mkdir "C:\ProgramData\Cloudflared"

:: Copy config files
echo Copying config files...
copy /Y "%USERPROFILE%\.cloudflared\config.yml" "C:\ProgramData\Cloudflared\" >nul
copy /Y "%USERPROFILE%\.cloudflared\*.json" "C:\ProgramData\Cloudflared\" >nul

:: Update config to use new path (using PowerShell for string replacement)
echo Updating config paths...
powershell -Command "$c = Get-Content 'C:\ProgramData\Cloudflared\config.yml' -Raw; $c = $c -replace [regex]::Escape($env:USERPROFILE + '\.cloudflared'), 'C:\ProgramData\Cloudflared'; $c = $c -replace [regex]::Escape($env:USERPROFILE), 'C:\ProgramData\Cloudflared'; $c | Out-File 'C:\ProgramData\Cloudflared\config.yml' -Encoding utf8"

echo [OK] Config files ready
echo.

:: Install service using NSSM
echo Installing service with NSSM...
nssm install CloudflareTunnel "C:\Program Files (x86)\cloudflared\cloudflared.exe"
nssm set CloudflareTunnel AppParameters "tunnel --config C:\ProgramData\Cloudflared\config.yml run stratus-tunnel"
nssm set CloudflareTunnel AppDirectory "C:\ProgramData\Cloudflared"
nssm set CloudflareTunnel DisplayName "Cloudflare Tunnel (Stratus)"
nssm set CloudflareTunnel Description "Cloudflare Tunnel for meteotronics.com"
nssm set CloudflareTunnel Start SERVICE_AUTO_START
nssm set CloudflareTunnel AppStdout "C:\ProgramData\Cloudflared\tunnel-stdout.log"
nssm set CloudflareTunnel AppStderr "C:\ProgramData\Cloudflared\tunnel-stderr.log"
nssm set CloudflareTunnel AppRotateFiles 1
nssm set CloudflareTunnel AppRotateBytes 1048576

echo [OK] Service installed
echo.

:: Start the service
echo Starting service...
nssm start CloudflareTunnel
timeout /t 10 >nul

:: Check status
echo.
echo Checking tunnel status...
nssm status CloudflareTunnel
echo.
cloudflared tunnel info stratus-tunnel

echo.
echo ============================================
echo  Setup Complete!
echo ============================================
echo.
echo The tunnel will now run 24/7 as a Windows service.
echo It will automatically start on boot.
echo.
echo Commands:
echo   Check status: nssm status CloudflareTunnel
echo   View logs: type C:\ProgramData\Cloudflared\tunnel-stderr.log
echo   Stop: nssm stop CloudflareTunnel
echo   Start: nssm start CloudflareTunnel
echo.
pause
