# Backend API Quick Reference

## Base URL
```
http://localhost:5000
```

## Core Setup Flow

```
1. Detect Service (optional)
   POST /api/station-setup/detect-service
   
2. Validate Configuration
   POST /api/station-setup/validate
   
3. Test Connection
   POST /api/station-setup/test
   
4. Create Station
   POST /api/station-setup/setup
```

## All Endpoints

### Validation & Testing
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/station-setup/validate` | Validate configuration |
| POST | `/api/station-setup/test` | Test connection |
| GET | `/api/station-setup/discover` | Discover devices (BLE, Serial, WiFi) |

### Configuration
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/station-setup/types` | List connection types |
| GET | `/api/station-setup/template/{type}` | Get config template |
| GET | `/api/station-setup/providers` | List all providers |
| GET | `/api/station-setup/providers/info` | Provider capabilities |

### Service Detection
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/station-setup/detect-service` | Detect provider from endpoint |
| POST | `/api/station-setup/configure/campbell` | Auto-config Campbell |
| POST | `/api/station-setup/configure/rika` | Auto-config Rika |

### Station Management
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/station-setup/setup` | Create station |
| PATCH | `/api/station-setup/{stationId}` | Update station |
| POST | `/api/station-setup/setup-bulk` | Bulk import stations |

### Provider Stations
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/station-setup/campbell/stations` | List Campbell stations |
| GET | `/api/station-setup/rika/stations` | List Rika stations |

### Protocol Status
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/protocols/status` | Get all station statuses |
| GET | `/api/protocols/status/{stationId}` | Get specific status |
| POST | `/api/protocols/test/{stationId}` | Test station |
| POST | `/api/protocols/reconnect/{stationId}` | Reconnect station |

## Connection Types

| Type | Use Case | Required Fields |
|------|----------|-----------------|
| `http` | Cloud services | `apiEndpoint` |
| `mqtt` | Message brokers | `broker`, `topic` |
| `lora` | LoRaWAN networks | `deviceEUI` |
| `satellite` | Satellite links | `imei` |
| `modbus` | Industrial devices | `serialPort` or `host` |
| `dnp3` | SCADA systems | `host`, `port` |
| `ble` | Bluetooth devices | `deviceAddress` |
| `gsm` / `4g` | Cellular networks | `serialPort` |

## Quick Examples

### Campbell Scientific
```javascript
// Auto-config
fetch('/api/station-setup/configure/campbell', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apiKey: 'YOUR_KEY' })
});

// Create
fetch('/api/station-setup/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Campbell Station',
    stationType: 'campbell',
    connectionType: 'http',
    apiEndpoint: 'https://api.campbellcloud.com/v2',
    apiKey: 'YOUR_KEY'
  })
});
```

### Rika Cloud
```javascript
fetch('/api/station-setup/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Rika Station',
    stationType: 'rika',
    connectionType: 'http',
    apiEndpoint: 'https://api.rika.co/v1',
    apiKey: 'YOUR_KEY'
  })
});
```

### MQTT
```javascript
fetch('/api/station-setup/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'MQTT Station',
    connectionType: 'mqtt',
    host: 'mqtt.example.com',
    port: 1883,
    apiEndpoint: 'weather/data/#',
    apiKey: 'username:password'
  })
});
```

### HTTP Generic
```javascript
fetch('/api/station-setup/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Custom Station',
    connectionType: 'http',
    apiEndpoint: 'https://your-api.com/weather',
    apiKey: 'OPTIONAL_KEY'
  })
});
```

## Response Status

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad request |
| 401 | Unauthorized |
| 404 | Not found |
| 500 | Server error |

## Common Errors

| Error | Solution |
|-------|----------|
| "Connection timeout" | Check internet, increase timeout |
| "Authentication failed" | Verify API key format |
| "No data available" | Check remote station is sending |
| "Invalid port" | Port must be 1-65535 |
| "Serial port not found" | Check device connection |

## WebSocket Real-Time Updates

```javascript
const ws = new WebSocket('ws://localhost:5000/ws');

// Subscribe to station
ws.send(JSON.stringify({ type: 'subscribe', stationId: 1 }));

// Receive updates
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'weather_update') {
    console.log(msg.data); // Contains temperature, humidity, etc.
  }
};

// Unsubscribe
ws.send(JSON.stringify({ type: 'unsubscribe', stationId: 1 }));
```

## Data Fields

Weather data is normalized to:
- `temperature` (°C)
- `humidity` (%)
- `pressure` (hPa)
- `windSpeed` (m/s)
- `windDirection` (°)
- `windGust` (m/s)
- `rainfall` (mm)
- `solarRadiation` (W/m²)
- `dewPoint` (°C)
- `batteryVoltage` (V)

## Protocol Features

**HTTP**: Cloud APIs, simple setup
**MQTT**: Real-time, scalable, reliable
**LoRa**: Long range, low power
**Satellite**: Remote locations, global coverage
**Modbus**: Industrial standard, proven
**DNP3**: SCADA systems, critical infrastructure
**BLE**: Mobile devices, short range
**GSM/4G**: Mobile networks, always connected

## File Locations

- **API Documentation**: `BACKEND_API_DOCUMENTATION.md`
- **Setup Guide**: `BACKEND_SETUP_GUIDE.md`
- **Implementation Summary**: `BACKEND_IMPLEMENTATION_SUMMARY.md`
- **Routes**: `server/station-setup/routes.ts`
- **Validation**: `server/station-setup/validation.ts`
- **Service Detector**: `server/station-setup/serviceDetector.ts`
- **Integration Service**: `server/station-setup/integrationService.ts`

## Testing Your Setup

```bash
# Detect provider
curl -X POST http://localhost:5000/api/station-setup/detect-service \
  -H "Content-Type: application/json" \
  -d '{"apiEndpoint": "https://api.campbellcloud.com/v2"}'

# Validate config
curl -X POST http://localhost:5000/api/station-setup/validate \
  -H "Content-Type: application/json" \
  -d '{"connectionType": "http", "config": {"apiEndpoint": "..."}}'

# Test connection
curl -X POST http://localhost:5000/api/station-setup/test \
  -H "Content-Type: application/json" \
  -d '{"connectionType": "http", "config": {"apiEndpoint": "...", "apiKey": "..."}}'

# Create station
curl -X POST http://localhost:5000/api/station-setup/setup \
  -H "Content-Type: application/json" \
  -d '{"name": "My Station", "connectionType": "http", "apiEndpoint": "...", "apiKey": "..."}'
```

## Support Resources

1. Check BACKEND_API_DOCUMENTATION.md for complete API reference
2. Check BACKEND_SETUP_GUIDE.md for setup instructions
3. Review error messages for guidance
4. Check provider documentation (Campbell, Rika, etc.)
5. Test connection before creating station

---

**Quick Start**: 
1. `npm install axios mqtt serialport noble`
2. `npm run dev`
3. Use endpoints above to setup your weather stations
4. Monitor at `/api/protocols/status`
