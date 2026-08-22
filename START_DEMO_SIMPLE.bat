@echo off
REM Simple demo startup - tries to start server and shows errors

cd /d "%~dp0"

echo.
echo ========================================================================
echo   Starting Stratus Server
echo ========================================================================
echo.

echo Checking prerequisites...
echo.

REM Check if dependencies installed
if not exist "node_modules" (
    echo Installing server dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
)

if not exist "client\node_modules" (
    echo Installing client dependencies...
    cd client
    call npm install
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to install client dependencies
        pause
        exit /b 1
    )
    cd ..
)

echo.
echo Starting server (this will show any errors)...
echo.
echo Press Ctrl+C to stop
echo.

npm run dev

pause
