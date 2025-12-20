# Backend Station Setup & Integration API Documentation

## Overview

The Stratus backend now provides a complete system for connecting weather stations from various manufacturers and cloud services. It supports multiple communication protocols including HTTP/REST, MQTT, LoRa, Satellite, Modbus, DNP3, BLE, and cellular (GSM/4G).

## Architecture

### Core Components

1. **Protocol Adapters** - Unified interface for different communication protocols
2. **Protocol Manager** - Orchestrates adapter lifecycle and data collection
3. **Service Detectors** - Auto-detect provider from endpoint URLs
4. **Data Parsers** - Provider-specific response parsing and normalization
5. **Integration Service** - Complete station setup workflow
6. **Validation System** - Configuration validation and connection testing

## Station Setup Routes

### Validation Endpoints

#### Validate Configuration
```http
POST /api/station-setup/validate
Content-Type: application/json

{
  "connectionType": "http",
  "config": {
    "apiEndpoint": "https://api.campbellcloud.com/v2",
    "apiKey": "your-api-key"
  }
}
```

**Response:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": ["API Key recommended for cloud endpoints"]
}
```

### Connection Testing

#### Test Connection
```http
POST /api/station-setup/test
Content-Type: application/json

{
  "connectionType": "http",
  "config": {
    "apiEndpoint": "https://api.campbellcloud.com/v2",
    "apiKey": "your-api-key"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Connection successful and data received",
  "dataAvailable": true
}
```

### Service Detection

#### Detect Provider
```http
POST /api/station-setup/detect-service
Content-Type: application/json

{
  "apiEndpoint": "https://api.campbellcloud.com/v2",
  "apiKey": "optional-key"
}
```

**Response:**
```json
{
  "detected": true,
  "provider": "campbellcloud",
  "confidence": 0.95,
  "connectionType": "http",
  "suggestedConfig": {
    "apiEndpoint": "https://api.campbellcloud.com/v2",
    "port": 443,
    "timeout": 30000,
    "requiredFields": ["apiKey", "stationUid"]
  }
}
```

#### List Connection Types
```http
GET /api/station-setup/types
```

**Response:**
```json
[
  {
    "name": "HTTP/REST",
    "types": ["http", "ip", "wifi"],
    "description": "Direct REST API endpoints, cloud services",
    "requiredFields": ["apiEndpoint"],
    "examples": ["Campbell Cloud", "WeatherLink", "Rika Cloud", ...]
  },
  {
    "name": "MQTT",
    "types": ["mqtt"],
    "description": "MQTT broker-based messaging",
    "requiredFields": ["broker", "topic"],
    "defaultPort": 1883
  },
  ...
]
```

#### Get Configuration Template
```http
GET /api/station-setup/template/{type}
```

Where `{type}` can be: `http`, `mqtt`, `lora`, `satellite`, `modbus`, `dnp3`, `ble`, `gsm`, `4g`

**Example Response (Campbell Scientific):**
```json
{
  "connectionType": "http",
  "apiEndpoint": "https://api.campbellcloud.com/v2",
  "apiKey": "",
  "host": "",
  "port": 443,
  "timeout": 30000
}
```

### Station Setup

#### Create Station
```http
POST /api/station-setup/setup
Content-Type: application/json

{
  "name": "Weather Station 1",
  "description": "Main research weather station",
  "stationType": "campbell",
  "connectionType": "http",
  "apiEndpoint": "https://api.campbellcloud.com/v2",
  "apiKey": "your-api-key",
  "connectionConfig": {
    "stationUid": "station-123",
    "organizationUid": "org-456"
  },
  "location": "Research Lab A",
  "isActive": true
}
```

**Response:**
```json
{
  "success": true,
  "stationId": 1,
  "message": "Station 'Weather Station 1' created and registered successfully"
}
```

#### Update Station Connection
```http
PATCH /api/station-setup/{stationId}
Content-Type: application/json

{
  "apiEndpoint": "https://new-endpoint.com",
  "apiKey": "new-key",
  "connectionConfig": {
    "additionalField": "value"
  }
}
```

### Bulk Station Setup

#### Setup Multiple Stations from Provider
```http
POST /api/station-setup/setup-bulk
Content-Type: application/json

{
  "provider": "campbell_cloud",
  "apiKey": "your-api-key",
  "basePayload": {
    "stationType": "campbell",
    "location": "Research Campus"
  }
}
```

**Response:**
```json
{
  "success": true,
  "totalStations": 5,
  "successCount": 5,
  "results": [
    {
      "success": true,
      "stationId": 1,
      "message": "Station created"
    }
  ]
}
```

## Provider-Specific Endpoints

### Campbell Scientific

#### Auto-Configure Campbell Cloud
```http
POST /api/station-setup/configure/campbell
Content-Type: application/json

{
  "apiKey": "your-campbell-api-key"
}
```

**Response:**
```json
{
  "success": true,
  "organizations": [
    {
      "id": "org-1",
      "name": "Research Institute",
      "type": "organization"
    }
  ]
}
```

#### Fetch Campbell Stations
```http
GET /api/station-setup/campbell/stations?apiKey=KEY&orgUid=ORG&locUid=LOC
```

**Response:**
```json
{
  "success": true,
  "stations": [
    {
      "id": "station-123",
      "name": "CR1000X",
      "model": "CR1000X"
    }
  ]
}
```

### Rika Cloud

#### Auto-Configure Rika Cloud
```http
POST /api/station-setup/configure/rika
Content-Type: application/json

{
  "apiKey": "your-rika-api-key"
}
```

**Response:**
```json
{
  "success": true,
  "stations": [
    {
      "id": "station-1",
      "name": "Outdoor Sensor",
      "model": "Rika"
    }
  ]
}
```

#### Fetch Rika Stations
```http
GET /api/station-setup/rika/stations?apiKey=YOUR_KEY
```

## Device Discovery

### Discover Devices
```http
GET /api/station-setup/discover?type=ble
```

Supported types: `ble`, `wifi`, `serial`

**Response (Serial Ports):**
```json
{
  "devices": [
    {
      "path": "/dev/ttyUSB0",
      "manufacturer": "FTDI",
      "serialNumber": "FT9V5ZZI",
      "productId": "6015",
      "vendorId": "0403"
    }
  ],
  "message": "Serial ports detected",
  "status": "success"
}
```

## Supported Protocols & Adapters

### HTTP/REST Adapter
- **Connection Types:** HTTP, IP, WiFi
- **Supported Services:**
  - Campbell Scientific Cloud
  - Davis WeatherLink
  - Rika Cloud
  - Arduino IoT Cloud
  - Blynk
  - ThingSpeak
  - OpenWeatherMap
  - Generic HTTP endpoints

### MQTT Adapter
- **Connection Types:** MQTT
- **Features:**
  - Topic subscription
  - QoS support
  - TLS/SSL encryption
  - Username/Password auth

### LoRa Adapter
- **Connection Types:** LoRa
- **Supported Networks:**
  - The Things Network (TTN)
  - LoRa Cloud
  - AWS IoT LoRaWAN

### Satellite Adapter
- **Connection Types:** Satellite
- **Supported Providers:**
  - Iridium
  - Globalstar
  - Inmarsat
  - GOES/NOAA

### Modbus Adapter
- **Connection Types:** Modbus, Serial
- **Modes:**
  - RTU (Serial)
  - TCP/IP
- **Baud Rates:** 9600, 19200, 38400, 57600, 115200

### DNP3 Adapter
- **Connection Types:** TCP
- **Features:**
  - Master/Outstation communication
  - Point mapping
  - Secure authentication

### BLE Adapter
- **Connection Types:** Bluetooth Low Energy
- **Features:**
  - Device discovery
  - Characteristic reading
  - Service enumeration

### GSM/4G Adapter
- **Connection Types:** GSM, 4G, LTE
- **Features:**
  - AT command interface
  - Signal strength monitoring
  - HTTP over cellular

## Data Parsing

All adapters normalize data into the following schema:

```typescript
{
  temperature?: number | null;        // °C
  humidity?: number | null;           // %
  pressure?: number | null;           // hPa
  windSpeed?: number | null;          // m/s
  windDirection?: number | null;      // °
  windGust?: number | null;           // m/s
  rainfall?: number | null;           // mm
  solarRadiation?: number | null;     // W/m²
  dewPoint?: number | null;           // °C
  batteryVoltage?: number | null;     // V
}
```

## Error Handling

### Validation Errors
```json
{
  "valid": false,
  "errors": [
    "Either apiEndpoint or host is required for HTTP connection"
  ]
}
```

### Connection Errors
```json
{
  "success": false,
  "message": "Connection failed",
  "error": "HTTP 401: Unauthorized"
}
```

### Configuration Errors
```json
{
  "success": false,
  "message": "Invalid configuration",
  "errors": ["API Key is required"]
}
```

## Weather Data Storage

When a station is successfully connected, weather data is automatically:

1. **Collected** via the configured protocol adapter
2. **Normalized** to standard weather fields
3. **Stored** in the database with timestamp
4. **Broadcast** to connected WebSocket clients

### Access Weather Data
```http
GET /api/stations/{stationId}/data
```

### Real-Time Updates
```javascript
const ws = new WebSocket('ws://localhost:5000/ws');

// Subscribe to station data
ws.send(JSON.stringify({ type: 'subscribe', stationId: 1 }));

// Receive updates
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'weather_update') {
    console.log('New data:', message.data);
  }
};
```

## Protocol Manager Status

### Get All Statuses
```http
GET /api/protocols/status
```

**Response:**
```json
{
  "1": {
    "connected": true,
    "lastConnected": "2024-12-20T10:30:00Z",
    "lastError": null,
    "signalStrength": 85,
    "isSimulation": false
  }
}
```

### Get Station Status
```http
GET /api/protocols/status/{stationId}
```

### Test Station Connection
```http
POST /api/protocols/test/{stationId}
```

### Reconnect Station
```http
POST /api/protocols/reconnect/{stationId}
```

## Configuration Examples

### Campbell Scientific Cloud
```json
{
  "name": "Campbell CR1000X",
  "stationType": "campbell",
  "connectionType": "http",
  "apiEndpoint": "https://api.campbellcloud.com/v2",
  "apiKey": "your-bearer-token",
  "connectionConfig": {
    "organizationUid": "org-123",
    "locationUid": "loc-456",
    "stationUid": "station-789"
  }
}
```

### Rika Cloud
```json
{
  "name": "Rika Weather Station",
  "stationType": "rika",
  "connectionType": "http",
  "apiEndpoint": "https://api.rika.co/v1",
  "apiKey": "your-rika-key",
  "connectionConfig": {
    "stationId": "rika-station-1"
  }
}
```

### MQTT Broker
```json
{
  "name": "MQTT Weather Data",
  "connectionType": "mqtt",
  "host": "mqtt.example.com",
  "port": 1883,
  "apiEndpoint": "weather/station/data/+",
  "apiKey": "username:password",
  "connectionConfig": {
    "qos": 1
  }
}
```

### LoRa (The Things Network)
```json
{
  "name": "LoRa Weather Sensor",
  "connectionType": "lora",
  "host": "eu1.cloud.thethings.network",
  "apiKey": "appid:appkey",
  "connectionConfig": {
    "deviceEUI": "0102030405060708",
    "appEUI": "70B3D57ED00040C6"
  }
}
```

### Generic HTTP API
```json
{
  "name": "Generic Weather API",
  "connectionType": "http",
  "apiEndpoint": "https://weather.example.com/api/data",
  "apiKey": "optional-key",
  "connectionConfig": {
    "headers": {
      "Authorization": "Bearer token"
    }
  }
}
```

## Best Practices

1. **Test Before Setup** - Always test connection before creating station
2. **Validate Configuration** - Validate settings before connecting
3. **Monitor Status** - Check protocol status regularly
4. **Handle Reconnections** - System auto-reconnects on failure
5. **Data Validation** - Invalid readings are rejected (range validation)
6. **Security** - Use HTTPS for cloud services, TLS for MQTT
7. **Timeouts** - Default 30 seconds, increase for slow connections
8. **Polling** - Default 60 second intervals, adjust as needed

## Dependencies

Required packages for full functionality:
- `axios` - HTTP requests
- `mqtt` - MQTT protocol
- `serialport` - Serial communication
- `noble` - BLE (Bluetooth Low Energy)
- `dnp3` - DNP3 protocol (optional)

Install with:
```bash
npm install axios mqtt serialport noble
```

## Troubleshooting

### Connection Timeout
- Check internet connectivity
- Verify API endpoint is correct
- Increase timeout in configuration
- Check firewall rules

### Authentication Fails
- Verify API key format
- Check service requirements (some need Bearer, others use headers)
- Ensure key has proper permissions

### No Data Received
- Verify remote station is sending data
- Check topic/endpoint configuration
- Review data parsing rules
- Check for field mapping errors

### Serial Connection Issues
- Verify baud rate matches device
- Check serial port availability
- Ensure proper permissions on Linux (`/dev/ttyUSB*`)
- Try different flow control settings

## API Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (new station) |
| 400 | Invalid request/configuration |
| 401 | Unauthorized (bad API key) |
| 404 | Not found |
| 500 | Server error |
| 503 | Service unavailable |

## Version Information

- **API Version:** 1.0
- **Last Updated:** December 2024
- **Node Version:** 18+
- **TypeScript:** 5.0+
