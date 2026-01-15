# Stratus Data Import Test Script
# This script creates a station and imports your Hopefield data

param(
    [int]$WaitSeconds = 5
)

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  STRATUS DATA IMPORT TEST" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Wait for server
Write-Host "Waiting $WaitSeconds seconds for server..." -ForegroundColor Yellow
Start-Sleep -Seconds $WaitSeconds

# Test server connection
Write-Host "Testing server connection..." -ForegroundColor Yellow
try {
    $null = Invoke-RestMethod -Uri "http://localhost:5000/api/stations" -Method GET -TimeoutSec 5
    Write-Host "✓ Server is running!" -ForegroundColor Green
} catch {
    Write-Host "✗ Server not responding. Make sure 'npm run dev' is running!" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    exit 1
}

# Step 1: Create Station
Write-Host ""
Write-Host "Step 1: Creating station..." -ForegroundColor Yellow

$stationBody = @{
    name = "Hopefield CR300 - RM Young 92000"
    pakbusAddress = 990
    connectionType = "tcp"
    ipAddress = "weatherafrica.dyndns.org"
    port = 6788
    collectionEnabled = $false
    latitude = -33.0
    longitude = 18.5
    elevation = 100
    timezone = "Africa/Johannesburg"
} | ConvertTo-Json

try {
    $station = Invoke-RestMethod -Uri "http://localhost:5000/api/stations" -Method POST -Body $stationBody -ContentType "application/json"
    $stationId = $station.id
    Write-Host "✓ Station created! ID: $stationId" -ForegroundColor Green
    Write-Host "  Name: $($station.name)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Failed to create station: $_" -ForegroundColor Red
    # Try to get existing station
    $stations = Invoke-RestMethod -Uri "http://localhost:5000/api/stations" -Method GET
    if ($stations.Count -gt 0) {
        $stationId = $stations[0].id
        Write-Host "  Using existing station ID: $stationId" -ForegroundColor Yellow
    } else {
        exit 1
    }
}

# Step 2: Import Data
Write-Host ""
Write-Host "Step 2: Importing data file..." -ForegroundColor Yellow

$dataFile = "c:\Users\eed2k\Downloads\Itronics Projects\stratus\HOPEFIELD_CR300_Table1 20230617.txt"

if (Test-Path $dataFile) {
    $content = Get-Content $dataFile -Raw
    $lineCount = ($content -split "`n").Count
    Write-Host "  File: HOPEFIELD_CR300_Table1 20230617.txt" -ForegroundColor Gray
    Write-Host "  Lines: $lineCount" -ForegroundColor Gray
    
    $importBody = @{
        content = $content
        filename = "HOPEFIELD_CR300_Table1.txt"
    } | ConvertTo-Json -Depth 10 -Compress
    
    try {
        $result = Invoke-RestMethod -Uri "http://localhost:5000/api/stations/$stationId/import" -Method POST -Body $importBody -ContentType "application/json"
        Write-Host "✓ Data imported successfully!" -ForegroundColor Green
        Write-Host "  Format: $($result.format)" -ForegroundColor Gray
        Write-Host "  Station: $($result.stationName)" -ForegroundColor Gray
        Write-Host "  Records imported: $($result.importedCount)" -ForegroundColor Gray
        if ($result.errors -and $result.errors.Count -gt 0) {
            Write-Host "  Warnings: $($result.errors.Count)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "✗ Failed to import data: $_" -ForegroundColor Red
    }
} else {
    Write-Host "✗ Data file not found: $dataFile" -ForegroundColor Red
}

# Step 3: Verify Data
Write-Host ""
Write-Host "Step 3: Verifying imported data..." -ForegroundColor Yellow

try {
    $weatherData = Invoke-RestMethod -Uri "http://localhost:5000/api/stations/$stationId/weather-data?limit=5" -Method GET
    if ($weatherData -and $weatherData.Count -gt 0) {
        Write-Host "✓ Found $($weatherData.Count) records in database!" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Sample data (latest record):" -ForegroundColor Cyan
        $latest = $weatherData[0]
        Write-Host "    Timestamp: $($latest.timestamp)" -ForegroundColor Gray
        if ($latest.data) {
            $data = $latest.data
            if ($data.temperature) { Write-Host "    Temperature: $($data.temperature) C" -ForegroundColor Gray }
            if ($data.windSpeed) { Write-Host "    Wind Speed: $($data.windSpeed) m/s" -ForegroundColor Gray }
            if ($data.windDirection) { Write-Host "    Wind Dir: $($data.windDirection) deg" -ForegroundColor Gray }
            if ($data.humidity) { Write-Host "    Humidity: $($data.humidity) %" -ForegroundColor Gray }
            if ($data.pressure) { Write-Host "    Pressure: $($data.pressure) hPa" -ForegroundColor Gray }
        }
    } else {
        Write-Host "  No data found yet" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "  Could not verify data: $_" -ForegroundColor Yellow
}

# Done
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  IMPORT COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Open http://localhost:5173/ to view your data!" -ForegroundColor Cyan
Write-Host ""
