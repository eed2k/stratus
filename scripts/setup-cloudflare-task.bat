@echo off
:: ============================================
:: SETUP CLOUDFLARE TUNNEL AS SCHEDULED TASK
:: Run as Administrator
:: ============================================

echo ============================================
echo Setting up Cloudflare Tunnel Scheduled Task
echo ============================================
echo.

:: Remove the Windows service (it doesn't work well)
echo Removing Cloudflare Windows Service...
net stop Cloudflared 2>nul
cloudflared service uninstall 2>nul
timeout /t 2 >nul

:: Get current user
for /f "tokens=*" %%a in ('whoami') do set CURRENT_USER=%%a
echo Current user: %CURRENT_USER%

:: Get the script path
set SCRIPT_PATH=%~dp0run-cloudflare-tunnel.bat

:: Remove old task if exists
echo Removing old scheduled task...
schtasks /delete /tn "Cloudflare Tunnel 24x7" /f 2>nul

:: Create scheduled task that runs at startup and on login
echo Creating new scheduled task...
schtasks /create /tn "Cloudflare Tunnel 24x7" /tr "\"%SCRIPT_PATH%\"" /sc onstart /ru "%USERNAME%" /rl highest /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo SUCCESS: Scheduled task created!
    echo.
    echo Starting tunnel now...
    schtasks /run /tn "Cloudflare Tunnel 24x7"
    
    timeout /t 10 >nul
    echo.
    echo Checking tunnel status...
    cloudflared tunnel info stratus-tunnel
) else (
    echo.
    echo FAILED to create scheduled task.
    echo Try running this as Administrator.
)

echo.
pause
