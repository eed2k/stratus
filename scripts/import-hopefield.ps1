# Stratus Data Import Script - Hopefield CR300
# Voer uit in 'n NUWE PowerShell venster terwyl Stratus loop

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  STRATUS DATA IMPORT - HOPEFIELD CR300" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Wag vir server
Write-Host "`nWag vir Stratus server..." -ForegroundColor Yellow
$maxRetries = 10
$retry = 0
$serverReady = $false

while (-not $serverReady -and $retry -lt $maxRetries) {
    try {
        $null = Invoke-RestMethod -Uri "http://localhost:5000/api/stations" -Method GET -TimeoutSec 2
        $serverReady = $true
    } catch {
        $retry++
        Write-Host "  Probeer weer... ($retry/$maxRetries)"
        Start-Sleep -Seconds 2
    }
}

if (-not $serverReady) {
    Write-Host "`nFOUT: Stratus server loop nie!" -ForegroundColor Red
    Write-Host "Begin eers Stratus met: npm run dev" -ForegroundColor Yellow
    exit 1
}

Write-Host "Server gereed!" -ForegroundColor Green

# Stap 1: Skep stasie
Write-Host "`n[1/3] Skep Hopefield stasie..." -ForegroundColor Yellow

$stationBody = @{
    name = "Hopefield CR300 - RM Young 92000"
    pakbusAddress = 990
    connectionType = "tcp"
    collectionEnabled = $false
    latitude = -33.08
    longitude = 18.35
    elevation = 100
    timezone = "Africa/Johannesburg"
} | ConvertTo-Json

try {
    $station = Invoke-RestMethod -Uri "http://localhost:5000/api/stations" -Method POST -Body $stationBody -ContentType "application/json"
    $stationId = $station.id
    Write-Host "  Stasie geskep! ID: $stationId" -ForegroundColor Green
} catch {
    Write-Host "  Stasie bestaan moontlik al, soek bestaande..." -ForegroundColor Yellow
    $stations = Invoke-RestMethod -Uri "http://localhost:5000/api/stations" -Method GET
    $station = $stations | Where-Object { $_.name -like "*Hopefield*" } | Select-Object -First 1
    if ($station) {
        $stationId = $station.id
        Write-Host "  Bestaande stasie gevind! ID: $stationId" -ForegroundColor Green
    } else {
        $stationId = ($stations | Select-Object -Last 1).id
        if (-not $stationId) { $stationId = 1 }
        Write-Host "  Gebruik stasie ID: $stationId" -ForegroundColor Yellow
    }
}

# Stap 2: Lees data file
Write-Host "`n[2/3] Lees data file..." -ForegroundColor Yellow

$dataFile = "c:\Users\eed2k\Downloads\Itronics Projects\stratus\HOPEFIELD_CR300_Table1 20230617.txt"

if (-not (Test-Path $dataFile)) {
    Write-Host "  FOUT: File nie gevind: $dataFile" -ForegroundColor Red
    exit 1
}

$content = Get-Content $dataFile -Raw
$lineCount = ($content -split "`n").Count
Write-Host "  File gelees: $lineCount lyne" -ForegroundColor Green

# Stap 3: Import data
Write-Host "`n[3/3] Import data na Stratus..." -ForegroundColor Yellow

$importBody = @{
    content = $content
    filename = "HOPEFIELD_CR300_Table1.txt"
} | ConvertTo-Json -Depth 10

try {
    $result = Invoke-RestMethod -Uri "http://localhost:5000/api/stations/$stationId/import" -Method POST -Body $importBody -ContentType "application/json"
    
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "  SUKSES!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Stasie: $($result.stationName)" -ForegroundColor White
    Write-Host "  Formaat: $($result.format)" -ForegroundColor White
    Write-Host "  Rekords ingevoer: $($result.importedCount)" -ForegroundColor White
    
    if ($result.errors -and $result.errors.Count -gt 0) {
        Write-Host "  Foute: $($result.errors.Count)" -ForegroundColor Yellow
    }
    
    Write-Host "`nMaak oop in blaaier: http://localhost:5173/" -ForegroundColor Cyan
    
} catch {
    Write-Host "  FOUT tydens import: $_" -ForegroundColor Red
}

Write-Host "`nDruk Enter om te sluit..."
Read-Host
