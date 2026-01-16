# Script to create Hopefield station and import data
# Run this after starting the server in a separate terminal

$baseUrl = "http://localhost:5000/api"

Write-Host "Waiting for server..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

# Check if server is running
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method GET -TimeoutSec 5
    Write-Host "Server is running!" -ForegroundColor Green
} catch {
    Write-Host "Server not running. Start it first with: npx tsx server/index.ts" -ForegroundColor Red
    exit 1
}

# Get existing stations
Write-Host "`nExisting stations:" -ForegroundColor Cyan
$stations = Invoke-RestMethod -Uri "$baseUrl/stations" -Method GET
$stations | Select-Object id, name, connectionType | Format-Table -AutoSize

# Check if Hopefield already exists
$hopefield = $stations | Where-Object { $_.name -like "*Hopefield*" -or $_.name -like "*Quaggasklip*" }
if ($hopefield) {
    Write-Host "`nHopefield station already exists:" -ForegroundColor Yellow
    $hopefield | Select-Object id, name | Format-Table -AutoSize
    $stationId = $hopefield[0].id
} else {
    # Create new Hopefield station
    Write-Host "`nCreating Hopefield Quaggasklip station..." -ForegroundColor Cyan
    $body = @{
        name = "Hopefield Quaggasklip"
        pakbusAddress = 990
        connectionType = "http"
        latitude = -33.4
        longitude = 18.5
        elevation = 150
        description = "Hopefield weather station - RM Young 92000 ultrasonic anemometer. Import-only mode (data from Dropbox sync)."
    } | ConvertTo-Json
    
    $newStation = Invoke-RestMethod -Uri "$baseUrl/stations" -Method POST -ContentType "application/json" -Body $body
    Write-Host "Created station ID: $($newStation.id)" -ForegroundColor Green
    $stationId = $newStation.id
}

Write-Host "`nStation ID for import: $stationId" -ForegroundColor Green

# Import data file
$dataFile = "demo_data\hopefield_sample.txt"
if (Test-Path $dataFile) {
    Write-Host "`nImporting data from $dataFile..." -ForegroundColor Cyan
    
    # Read file content
    $content = Get-Content $dataFile -Raw
    
    # Create multipart form data
    $boundary = [System.Guid]::NewGuid().ToString()
    $LF = "`r`n"
    $bodyLines = (
        "--$boundary",
        "Content-Disposition: form-data; name=`"file`"; filename=`"hopefield_sample.txt`"",
        "Content-Type: text/plain",
        "",
        $content,
        "--$boundary--"
    ) -join $LF
    
    try {
        $result = Invoke-RestMethod -Uri "$baseUrl/stations/$stationId/import" -Method POST -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyLines
        Write-Host "Import result:" -ForegroundColor Green
        $result | ConvertTo-Json -Depth 2
    } catch {
        Write-Host "Import failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "Data file not found: $dataFile" -ForegroundColor Red
}

Write-Host "`nDone!" -ForegroundColor Green
