# Backend Testing Guide

## Comprehensive Testing Procedures

### Pre-Testing Checklist
- [ ] Node.js and npm installed
- [ ] Dependencies installed: `npm install axios mqtt serialport noble`
- [ ] PostgreSQL running or Docker database active
- [ ] Environment variables set (.env file created)
- [ ] Development server running: `npm run dev`
- [ ] API responding: `curl http://localhost:5000/api/protocols/status`

---

## Unit Testing

### Test Validation Functions
```powershell
# Test HTTP configuration validation
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http",
    "url": "https://api.example.com/weather",
    "refreshInterval": 300,
    "timeout": 30
  }'

# Expected Response: 200 OK
# {
#   "valid": true,
#   "errors": []
# }

# Test invalid configuration
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http",
    "url": "invalid-url",
    "refreshInterval": -1
  }'

# Expected Response: 400 Bad Request
# {
#   "valid": false,
#   "errors": [
#     "Invalid URL format",
#     "Refresh interval must be positive"
#   ]
# }
```

### Test MQTT Configuration
```powershell
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "mqtt",
    "broker": "mqtt://broker.example.com:1883",
    "topic": "weather/station/temp",
    "username": "user",
    "password": "pass",
    "qos": 1
  }'
```

### Test LoRa Configuration
```powershell
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "lora",
    "devEui": "0102030405060708",
    "appEui": "70B3D57ED0000000",
    "appKey": "AABBCCDDEEFF00112233445566778899",
    "region": "EU868"
  }'
```

### Test Modbus Configuration
```powershell
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "modbus",
    "host": "192.168.1.100",
    "port": 502,
    "deviceId": 1,
    "registers": [
      {"address": 100, "type": "holding", "format": "uint16", "label": "temperature"}
    ]
  }'
```

---

## Integration Testing

### 1. Campbell Scientific Cloud Setup Test
```powershell
# Step 1: Test detection of Campbell endpoint
curl -X POST http://localhost:5000/api/station-setup/detect-service `
  -H "Content-Type: application/json" `
  -d '{
    "url": "https://campbell.apiserver.com/stationdata/v1",
    "method": "GET"
  }'

# Expected Response:
# {
#   "detected": true,
#   "provider": "campbell-scientific",
#   "confidence": 0.95,
#   "requiresAuth": true,
#   "fields": ["temperature", "humidity", "pressure", ...]
# }

# Step 2: Configure Campbell with API key
curl -X POST http://localhost:5000/api/station-setup/configure/campbell `
  -H "Content-Type: application/json" `
  -d '{
    "apiKey": "your-campbell-api-key",
    "organizationId": "org-123",
    "locationId": "loc-456",
    "stationId": "station-789"
  }'

# Step 3: Full setup
curl -X POST http://localhost:5000/api/station-setup/setup `
  -H "Content-Type: application/json" `
  -d '{
    "name": "Campbell Test Station",
    "type": "http",
    "provider": "campbell-scientific",
    "url": "https://campbell.apiserver.com/stationdata/v1",
    "config": {
      "apiKey": "your-key",
      "organizationId": "org-123",
      "locationId": "loc-456",
      "stationId": "station-789"
    },
    "refreshInterval": 300
  }'
```

### 2. Rika Cloud Setup Test
```powershell
# Step 1: Detect Rika Cloud
curl -X POST http://localhost:5000/api/station-setup/detect-service `
  -H "Content-Type: application/json" `
  -d '{
    "url": "https://rika-cloud.example.com/api/v1/stations",
    "method": "GET"
  }'

# Expected Response:
# {
#   "detected": true,
#   "provider": "rika-cloud",
#   "confidence": 0.92,
#   "requiresAuth": true
# }

# Step 2: Configure Rika
curl -X POST http://localhost:5000/api/station-setup/configure/rika `
  -H "Content-Type: application/json" `
  -d '{
    "apiKey": "your-rika-api-key",
    "stationId": "rika-station-123"
  }'

# Step 3: Full setup
curl -X POST http://localhost:5000/api/station-setup/setup `
  -H "Content-Type: application/json" `
  -d '{
    "name": "Rika Test Station",
    "type": "http",
    "provider": "rika-cloud",
    "url": "https://rika-cloud.example.com/api/v1/stations",
    "config": {
      "apiKey": "your-key",
      "stationId": "rika-station-123"
    },
    "refreshInterval": 600
  }'
```

### 3. Generic HTTP Service Test (OpenWeatherMap)
```powershell
# Get OpenWeather API key from https://openweathermap.org/api

curl -X POST http://localhost:5000/api/station-setup/setup `
  -H "Content-Type: application/json" `
  -d '{
    "name": "OpenWeather Test",
    "type": "http",
    "provider": "openweathermap",
    "url": "https://api.openweathermap.org/data/2.5/weather",
    "config": {
      "params": {
        "lat": "-34.0",
        "lon": "18.8",
        "appid": "your-openweather-api-key"
      },
      "fieldMapping": {
        "main.temp": "temperature",
        "main.humidity": "humidity",
        "main.pressure": "pressure",
        "wind.speed": "windSpeed"
      }
    },
    "refreshInterval": 300
  }'

# Expected Response: 200 OK with station data
# {
#   "id": "station-uuid",
#   "name": "OpenWeather Test",
#   "provider": "openweathermap",
#   "lastReading": {
#     "temperature": 23.5,
#     "humidity": 65,
#     "pressure": 1013,
#     "windSpeed": 3.2
#   }
# }
```

### 4. Test Connection Without Setup
```powershell
# Test connection to verify credentials/endpoint before full setup
curl -X POST http://localhost:5000/api/station-setup/test `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http",
    "url": "https://api.openweathermap.org/data/2.5/weather",
    "config": {
      "params": {
        "lat": "-34.0",
        "lon": "18.8",
        "appid": "your-api-key"
      }
    },
    "timeout": 30
  }'

# Expected Response: 200 OK
# {
#   "success": true,
#   "statusCode": 200,
#   "responseTime": 245,
#   "sampleData": {
#     "temperature": 23.5,
#     "humidity": 65,
#     ...
#   }
# }
```

---

## Real-time Data Testing

### Setup WebSocket Subscription
```powershell
# Install WebSocket CLI tool
npm install -g ws

# Subscribe to real-time HTTP station data
wsc ws://localhost:5000/ws/protocols/http

# Subscribe to MQTT data
wsc ws://localhost:5000/ws/protocols/mqtt

# Subscribe to LoRa data
wsc ws://localhost:5000/ws/protocols/lora

# Expected output (every update from station):
# {
#   "stationId": "station-uuid",
#   "timestamp": "2025-12-20T12:34:56Z",
#   "temperature": 23.5,
#   "humidity": 65,
#   "pressure": 1013.25,
#   "windSpeed": 3.2,
#   "windDirection": 180,
#   "rainfall": 0,
#   "solarRadiation": 450,
#   "dewPoint": 14.2,
#   "batteryLevel": 95,
#   "signalStrength": -75
# }
```

### Test Multiple WebSocket Connections
```powershell
# Terminal 1: Watch HTTP protocol
wsc ws://localhost:5000/ws/protocols/http

# Terminal 2: Watch MQTT protocol
wsc ws://localhost:5000/ws/protocols/mqtt

# Terminal 3: Watch LoRa protocol
wsc ws://localhost:5000/ws/protocols/lora

# All should receive updates simultaneously
```

---

## Protocol Adapter Testing

### HTTP Adapter Test
```powershell
# Setup HTTP station first
$stationSetup = @{
    "name": "HTTP Test Station"
    "type": "http"
    "url": "https://jsonplaceholder.typicode.com/todos/1"
    "refreshInterval": 10
} | ConvertTo-Json

curl -X POST http://localhost:5000/api/station-setup/setup `
  -H "Content-Type: application/json" `
  -d $stationSetup

# Verify adapter is running
curl http://localhost:5000/api/protocols/status
# Should show HTTP adapter in "active" list
```

### MQTT Adapter Test (requires MQTT broker)
```powershell
# Install Mosquitto MQTT broker locally or use public broker
# Test with public broker: broker.hivemq.com:1883

$mqttSetup = @{
    "name": "MQTT Test"
    "type": "mqtt"
    "broker": "mqtt://broker.hivemq.com:1883"
    "topic": "test/weather/data"
    "refreshInterval": 0  # Event-driven (no refresh interval)
} | ConvertTo-Json

curl -X POST http://localhost:5000/api/station-setup/setup `
  -H "Content-Type: application/json" `
  -d $mqttSetup

# Publish test message
# Use another client to publish to test/weather/data:
# {
#   "temperature": 25.3,
#   "humidity": 60,
#   "pressure": 1010
# }

# Verify update via WebSocket
wsc ws://localhost:5000/ws/protocols/mqtt
```

---

## Bulk Setup Testing

### Create Multiple Stations at Once
```powershell
$bulkSetup = @{
    "stations": @(
        @{
            "name": "Station 1"
            "type": "http"
            "url": "https://api.service1.com/weather"
            "refreshInterval": 300
        },
        @{
            "name": "Station 2"
            "type": "http"
            "url": "https://api.service2.com/data"
            "refreshInterval": 600
        },
        @{
            "name": "Station 3"
            "type": "mqtt"
            "broker": "mqtt://broker.example.com:1883"
            "topic": "weather/station3"
        }
    )
} | ConvertTo-Json

curl -X POST http://localhost:5000/api/station-setup/setup-bulk `
  -H "Content-Type: application/json" `
  -d $bulkSetup

# Expected Response: 200 OK
# {
#   "created": 3,
#   "failed": 0,
#   "stations": [
#     { "id": "...", "name": "Station 1", "status": "active" },
#     { "id": "...", "name": "Station 2", "status": "active" },
#     { "id": "...", "name": "Station 3", "status": "active" }
#   ]
# }
```

---

## Error Handling Testing

### Test Invalid Configuration
```powershell
# Missing required fields
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http"
    # Missing "url"
  }'

# Expected Response: 400 Bad Request
# { "valid": false, "errors": ["URL is required"] }

# Invalid URL format
curl -X POST http://localhost:5000/api/station-setup/validate `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http",
    "url": "not-a-valid-url"
  }'

# Expected Response: 400 Bad Request
# { "valid": false, "errors": ["Invalid URL format"] }
```

### Test Connection Timeout
```powershell
# Test with unreachable host (will timeout)
curl -X POST http://localhost:5000/api/station-setup/test `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http",
    "url": "http://192.0.2.1:8080/data",
    "timeout": 5
  }'

# Expected Response: 408 Request Timeout
# {
#   "success": false,
#   "error": "Connection timeout after 5 seconds",
#   "code": "TIMEOUT"
# }
```

### Test Invalid API Credentials
```powershell
curl -X POST http://localhost:5000/api/station-setup/test `
  -H "Content-Type: application/json" `
  -d '{
    "type": "http",
    "url": "https://api.service.com/data",
    "config": {
      "apiKey": "invalid-key"
    }
  }'

# Expected Response: 401 Unauthorized
# {
#   "success": false,
#   "error": "Authentication failed",
#   "statusCode": 401
# }
```

---

## Performance Testing

### Load Test with Multiple Concurrent Connections
```powershell
# Create 5 stations and monitor performance
for ($i = 1; $i -le 5; $i++) {
    $stationData = @{
        "name": "Load Test Station $i"
        "type": "http"
        "url": "https://api.openweathermap.org/data/2.5/weather?lat=-34&lon=18&appid=key"
        "refreshInterval": 60
    } | ConvertTo-Json

    curl -X POST http://localhost:5000/api/station-setup/setup `
      -H "Content-Type: application/json" `
      -d $stationData
}

# Monitor system performance
while ($true) {
    $status = curl http://localhost:5000/api/protocols/status | ConvertFrom-Json
    Write-Host "Active Connections: $($status.activeConnections)"
    Write-Host "Readings/minute: $($status.readingsPerMinute)"
    Start-Sleep -Seconds 10
}
```

### Measure Response Times
```powershell
# Test API response times
$iterations = 10
$times = @()

for ($i = 0; $i -lt $iterations; $i++) {
    $start = Get-Date
    curl -s http://localhost:5000/api/protocols/status | out-null
    $end = Get-Date
    $times += ($end - $start).TotalMilliseconds
}

$average = ($times | Measure-Object -Average).Average
$max = ($times | Measure-Object -Maximum).Maximum
$min = ($times | Measure-Object -Minimum).Minimum

Write-Host "Average response time: $average ms"
Write-Host "Min response time: $min ms"
Write-Host "Max response time: $max ms"
```

---

## Database Testing

### Verify Data Storage
```powershell
# Check if station was created in database
# This requires direct database access:

# Connect to PostgreSQL
psql -U postgres -d stratus_db

# Query stations
SELECT id, name, provider, last_reading, status FROM stations;

# Query readings
SELECT station_id, timestamp, temperature, humidity, pressure 
FROM weather_readings 
ORDER BY timestamp DESC 
LIMIT 10;
```

### Check Data Persistence
```powershell
# 1. Create station
curl -X POST http://localhost:5000/api/station-setup/setup ...

# 2. Stop server
# Ctrl+C in terminal

# 3. Start server again
npm run dev

# 4. Verify station still exists
curl http://localhost:5000/api/station-setup/{id}

# Station should be persisted with same configuration
```

---

## Debugging

### Enable Debug Logging
```powershell
# Set debug environment variable
$env:DEBUG = "stratus:*"

npm run dev

# Or for specific module
$env:DEBUG = "stratus:protocols:http"
npm run dev

# Or for service detection only
$env:DEBUG = "stratus:services:detector"
npm run dev
```

### Monitor API Logs
```powershell
# Create log file
npm run dev > api.log 2>&1

# Tail the log
Get-Content api.log -Tail 20 -Wait

# Search for errors
Select-String "ERROR" api.log
```

### Test Individual Components
```powershell
# Create test script: test-parser.js
$testScript = @"
const { parseGenericWeather } = require('./server/parsers/genericWeather');

const testData = {
    temperature: 72.5,
    humidity: 65,
    pressure: 29.92
};

const result = parseGenericWeather(testData);
console.log(result);
"@

node -e $testScript
```

---

## Continuous Testing

### Setup Automated Tests
```powershell
# Create test schedule
# test-every-minute.ps1
while ($true) {
    Write-Host "Testing at $(Get-Date)"
    
    # Run all validation tests
    curl -s http://localhost:5000/api/station-setup/validate -d '...' | ConvertFrom-Json
    
    # Check status
    $status = curl -s http://localhost:5000/api/protocols/status | ConvertFrom-Json
    Write-Host "Status: $($status.status)"
    
    Start-Sleep -Seconds 60
}

# Run in background
Start-Job -FilePath ".\test-every-minute.ps1"
```

---

## Testing Checklist

### Pre-Testing
- [ ] Node.js and npm installed
- [ ] Dependencies installed
- [ ] PostgreSQL running
- [ ] Environment variables configured
- [ ] Development server started

### Unit Tests
- [ ] HTTP configuration validation
- [ ] MQTT configuration validation
- [ ] LoRa configuration validation
- [ ] Invalid configuration rejection
- [ ] Negative input handling

### Integration Tests
- [ ] Campbell Scientific setup
- [ ] Rika Cloud setup
- [ ] Generic HTTP service setup
- [ ] Multiple protocol types
- [ ] Bulk station creation

### Protocol Tests
- [ ] HTTP adapter functionality
- [ ] MQTT adapter connectivity
- [ ] LoRa device registration
- [ ] BLE device discovery
- [ ] WebSocket subscriptions

### Real-time Tests
- [ ] Data updates via WebSocket
- [ ] Multiple concurrent subscriptions
- [ ] Data normalization
- [ ] Timestamp accuracy
- [ ] Field value validation

### Error Tests
- [ ] Invalid credentials handling
- [ ] Connection timeout handling
- [ ] Network failure recovery
- [ ] Data validation errors
- [ ] Database error handling

### Performance Tests
- [ ] API response times (<100ms)
- [ ] Concurrent connections (50+)
- [ ] Data throughput monitoring
- [ ] Memory usage stability
- [ ] Database query performance

---

*Testing Complete - Ready for Production*
