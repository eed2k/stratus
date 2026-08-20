@echo off
REM =====================================================================
REM Stratus Lightning Demo - Quick Start
REM =====================================================================

echo.
echo ========================================================================
echo   Stratus Lightning Demo - Starting Localhost
echo ========================================================================
echo.

cd /d "%~dp0"

REM Check if data file exists
if not exist "lightning_demo_station8.dat" (
    echo Generating lightning demo data...
    python generate_demo_quick.py
    if errorlevel 1 (
        echo ERROR: Failed to generate demo data
        pause
        exit /b 1
    )
    echo.
)

REM Create import script if it doesn't exist
if not exist "import-lightning-demo.js" (
    echo Creating import script...
    call :CREATE_IMPORT_SCRIPT
    echo.
)

echo ========================================================================
echo   Services will start in separate windows:
echo   - Server: http://localhost:5000
echo   - Client: http://localhost:5173
echo ========================================================================
echo.
echo Press any key to start services...
pause >nul

REM Start server in new window
echo Starting server...
start "Stratus Server" cmd /k "cd /d %CD% && npm run dev"

REM Wait a bit
timeout /t 5 /nobreak >nul

REM Start client in new window  
echo Starting client...
start "Stratus Client" cmd /k "cd /d %CD%\client && npm run dev"

REM Wait for services to start
echo.
echo Waiting for services to start (30 seconds)...
timeout /t 30 /nobreak

REM Import demo data
echo.
echo ========================================================================
echo   Importing Lightning Demo Data
echo ========================================================================
echo.
node import-lightning-demo.js
if errorlevel 1 (
    echo.
    echo WARNING: Import may have failed. Check the output above.
    echo You can manually import via the dashboard Data Import feature.
)

echo.
echo ========================================================================
echo   DEMO DASHBOARD READY!
echo ========================================================================
echo.
echo   Dashboard: http://localhost:5173
echo   API:       http://localhost:5000
echo.
echo   Lightning Demo:
echo   - 318 strikes over 3 hours (3 days ago)
echo   - Peak intensity: 1.9M (92%% of max)
echo   - Closest strike: 5-6 km
echo.
echo   To view:
echo   1. Login to dashboard
echo   2. Go to SAWS Testbed station (ID 8)
echo   3. Set date range to 'Last 7 Days'
echo   4. Enable 'Lightning Proximity' card in config
echo.
echo   To stop: Close the Server and Client windows
echo.
pause

exit /b 0

:CREATE_IMPORT_SCRIPT
(
echo // Import lightning demo data
echo const fs = require^('fs'^);
echo const ^{ parse ^} = require^('csv-parse/sync'^);
echo.
echo const content = fs.readFileSync^('lightning_demo_station8.dat', 'utf-8'^);
echo const lines = content.split^('\n'^).slice^(4^).filter^(l =^> l.trim^(^)^);
echo const records = parse^(lines, ^{ columns: false, skip_empty_lines: true, quote: '"' ^}^);
echo.
echo console.log^(`Parsed $^{records.length^} records`^);
echo.
echo const weatherData = records.map^(r =^> ^(^{
echo   timestamp: new Date^(r[0]^).toISOString^(^),
echo   lightning: parseInt^(r[2]^) ^|^| null,
echo   lightningDistance: parseFloat^(r[3]^) ^|^| null,
echo   lightningEnergy: parseInt^(r[4]^) ^|^| null,
echo ^}^)^);
echo.
echo const ^{ insertWeatherData ^} = require^('./server/localStorage'^);
echo.
echo ^(async ^(^) =^> ^{
echo   try ^{
echo     console.log^(`Inserting $^{weatherData.length^} records...`^);
echo     for ^(let i = 0; i ^< weatherData.length; i++^) ^{
echo       await insertWeatherData^(8, weatherData[i]^);
echo       if ^(^(i + 1^) %% 10 === 0^) process.stdout.write^(`\rProgress: $^{i+1^}/$^{weatherData.length^}`^);
echo     ^}
echo     console.log^('\n\nDemo data imported successfully!'^);
echo   ^} catch ^(error^) ^{
echo     console.error^('\nImport failed:', error.message^);
echo     process.exit^(1^);
echo   ^}
echo ^}^)^(^);
) > import-lightning-demo.js
goto :eof
