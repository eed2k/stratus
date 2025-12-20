# Backend Setup & Integration Guide

## Quick Start

### 1. Install Dependencies
```bash
npm install axios mqtt serialport noble --save
```

### 2. Environment Setup
Create a `.env.local` file:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/weather_stations
VITE_DEMO_MODE=false
PORT=5000
```

### 3. Start Development Server
```bash
npm run dev
```

The server will start on http://localhost:5000

## Adding a New Weather Station

### Option 1: Auto-Detect from Endpoint (Easiest)

```javascript
// 1. Detect provider automatically
const detectResponse = await fetch('/api/station-setup/detect-service', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiEndpoint: 'https://api.campbellcloud.com/v2',
    apiKey: 'your-api-key'
  })
});

const detection = await detectResponse.json();
// detection.provider === "campbellcloud"
// detection.suggestedConfig contains recommended settings

// 2. Setup station with detected provider
const setupResponse = await fetch('/api/station-setup/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My Weather Station',
    stationType: detection.provider,
    connectionType: detection.connectionType,
    apiEndpoint: 'https://api.campbellcloud.com/v2',
    apiKey: 'your-api-key',
    isActive: true
  })
});

const result = await setupResponse.json();
// result.stationId is your new station ID
```

### Option 2: Manual Configuration

```javascript
// 1. Get template for connection type
const templateResponse = await fetch('/api/station-setup/template/http');
const template = await templateResponse.json();

// 2. Customize template with your values
const config = {
  ...template,
  apiEndpoint: 'https://your-endpoint.com',
  apiKey: 'your-key'
};

// 3. Validate configuration
const validateResponse = await fetch('/api/station-setup/validate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    connectionType: 'http',
    config
  })
});

const validation = await validateResponse.json();
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
  return;
}

// 4. Test connection
const testResponse = await fetch('/api/station-setup/test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    connectionType: 'http',
    config
  })
});

const testResult = await testResponse.json();
if (!testResult.success) {
  console.error('Connection test failed:', testResult.message);
  return;
}

// 5. Create station
const setupResponse = await fetch('/api/station-setup/setup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'My Weather Station',
    connectionType: 'http',
    apiEndpoint: 'https://your-endpoint.com',
    apiKey: 'your-key'
  })
});

const result = await setupResponse.json();
console.log('Station created:', result.stationId);
```

## Campbell Scientific Setup

### Quick Setup with Auto-Configuration

```javascript
// 1. Get available organizations
const configResponse = await fetch('/api/station-setup/configure/campbell', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey: 'your-campbell-api-key'
  })
});

const config = await configResponse.json();
const orgId = config.organizations[0]?.id;

// 2. Fetch stations from organization
const stationsResponse = await fetch(
  `/api/station-setup/campbell/stations?apiKey=${apiKey}&orgUid=${orgId}`,
  { method: 'GET' }
);

const stationsData = await stationsResponse.json();

// 3. Setup each station (bulk or individual)
for (const station of stationsData.stations) {
  const setupResponse = await fetch('/api/station-setup/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: station.name,
      stationType: 'campbell',
      connectionType: 'http',
      apiEndpoint: 'https://api.campbellcloud.com/v2',
      apiKey: 'your-campbell-api-key',
      connectionConfig: {
        organizationUid: orgId,
        stationUid: station.id
      }
    })
  });

  const result = await setupResponse.json();
  console.log('Created station:', result.stationId);
}
```

### Manual Campbell Setup

```json
{
  "name": "CR1000X Datalogger",
  "stationType": "campbell",
  "connectionType": "http",
  "apiEndpoint": "https://api.campbellcloud.com/v2",
  "apiKey": "YOUR_BEARER_TOKEN",
  "connectionConfig": {
    "organizationUid": "org-123",
    "locationUid": "loc-456",
    "stationUid": "station-789"
  },
  "isActive": true
}
```

## Rika Cloud Setup

### Quick Setup with Auto-Configuration

```javascript
const configResponse = await fetch('/api/station-setup/configure/rika', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey: 'your-rika-api-key'
  })
});

const config = await configResponse.json();

// Setup stations from Rika
for (const station of config.stations) {
  const setupResponse = await fetch('/api/station-setup/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: station.name,
      stationType: 'rika',
      connectionType: 'http',
      apiEndpoint: 'https://api.rika.co/v1',
      apiKey: 'your-rika-api-key',
      connectionConfig: {
        stationId: station.id
      }
    })
  });
}
```

## MQTT Setup

```json
{
  "name": "MQTT Weather Data",
  "connectionType": "mqtt",
  "host": "mqtt.example.com",
  "port": 1883,
  "apiEndpoint": "weather/station/data/+",
  "apiKey": "username:password",
  "connectionConfig": {
    "qos": 1,
    "cleanSession": true
  },
  "isActive": true
}
```

## LoRa Setup

```json
{
  "name": "LoRa Weather Sensor",
  "connectionType": "lora",
  "host": "eu1.cloud.thethings.network",
  "apiKey": "your-app-id:your-app-key",
  "connectionConfig": {
    "deviceEUI": "0102030405060708",
    "appEUI": "70B3D57ED00040C6"
  },
  "isActive": true
}
```

## Monitoring & Troubleshooting

### Check Station Status

```javascript
// Get all station statuses
const statusResponse = await fetch('/api/protocols/status');
const statuses = await statusResponse.json();

// Get specific station status
const stationResponse = await fetch('/api/protocols/status/1');
const status = await stationResponse.json();

console.log('Connected:', status.connected);
console.log('Last Connected:', status.lastConnected);
console.log('Last Error:', status.lastError);
```

### Test Connection

```javascript
// Test an existing station
const testResponse = await fetch('/api/protocols/test/1', {
  method: 'POST'
});

const result = await testResponse.json();
console.log('Test successful:', result.success);
console.log('Message:', result.message);
```

### Reconnect Station

```javascript
const reconnectResponse = await fetch('/api/protocols/reconnect/1', {
  method: 'POST'
});

const result = await reconnectResponse.json();
console.log('Reconnection initiated:', result.success);
```

## Real-Time Data Updates

### WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:5000/ws');

ws.onopen = () => {
  // Subscribe to station updates
  ws.send(JSON.stringify({
    type: 'subscribe',
    stationId: 1
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'weather_update') {
    console.log('New weather data:', message.data);
    // message.data contains:
    // - temperature
    // - humidity
    // - pressure
    // - windSpeed
    // - windDirection
    // - etc.
  }

  if (message.type === 'subscribed') {
    console.log('Subscribed to station', message.stationId);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

// Unsubscribe when done
ws.send(JSON.stringify({
  type: 'unsubscribe',
  stationId: 1
}));
```

## React Component Example

```typescript
import { useEffect, useState } from 'react';
import type { WeatherData } from '@shared/schema';

interface StationSetupProps {
  onStationCreated: (stationId: number) => void;
}

export function StationSetupForm({ onStationCreated }: StationSetupProps) {
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [detected, setDetected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDetect = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/station-setup/detect-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiEndpoint, apiKey })
      });

      const data = await response.json();
      if (data.detected) {
        setDetected(true);
        setError('');
      } else {
        setError('Could not detect provider');
      }
    } catch (err) {
      setError('Detection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/station-setup/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'My Weather Station',
          connectionType: 'http',
          apiEndpoint,
          apiKey,
          isActive: true
        })
      });

      const data = await response.json();
      if (data.success) {
        onStationCreated(data.stationId);
        setError('');
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        value={apiEndpoint}
        onChange={(e) => setApiEndpoint(e.target.value)}
        placeholder="API Endpoint"
      />
      <input
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="API Key"
        type="password"
      />
      <button onClick={handleDetect} disabled={loading}>
        Detect Provider
      </button>
      {detected && (
        <button onClick={handleSetup} disabled={loading}>
          Create Station
        </button>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

## File Structure

```
server/
├── protocols/                 # Protocol adapters
│   ├── adapter.ts            # Base adapter interface
│   ├── httpAdapter.ts        # HTTP/REST adapter
│   ├── mqttAdapter.ts        # MQTT adapter
│   ├── loraAdapter.ts        # LoRa adapter
│   ├── satelliteAdapter.ts   # Satellite adapter
│   ├── modbusAdapter.ts      # Modbus adapter
│   ├── dnp3Adapter.ts        # DNP3 adapter
│   ├── bleAdapter.ts         # BLE adapter
│   ├── gsmAdapter.ts         # GSM/4G adapter
│   ├── protocolManager.ts    # Protocol orchestration
│   └── ...
├── parsers/                   # Data parsers
│   ├── campbellScientific.ts # Campbell file parser
│   ├── campbellCloud.ts      # Campbell Cloud API
│   ├── rikaCloud.ts          # Rika Cloud API
│   ├── genericWeather.ts     # Generic parser
│   └── ...
├── station-setup/            # Station setup API
│   ├── routes.ts             # Setup endpoints
│   ├── validation.ts         # Config validation
│   ├── serviceDetector.ts    # Provider detection
│   ├── integrationService.ts # Setup workflow
│   └── ...
└── routes.ts                 # Main API routes
```

## Testing

### Manual Testing with cURL

```bash
# Validate configuration
curl -X POST http://localhost:5000/api/station-setup/validate \
  -H "Content-Type: application/json" \
  -d '{
    "connectionType": "http",
    "config": {
      "apiEndpoint": "https://api.campbellcloud.com/v2"
    }
  }'

# Test connection
curl -X POST http://localhost:5000/api/station-setup/test \
  -H "Content-Type: application/json" \
  -d '{
    "connectionType": "http",
    "config": {
      "apiEndpoint": "https://api.campbellcloud.com/v2",
      "apiKey": "your-key"
    }
  }'

# Create station
curl -X POST http://localhost:5000/api/station-setup/setup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Station",
    "connectionType": "http",
    "apiEndpoint": "https://api.campbellcloud.com/v2",
    "apiKey": "your-key"
  }'
```

## Performance Tuning

### Database
- Create indexes on frequently queried fields
- Archive old weather data regularly
- Use connection pooling

### Protocol Manager
- Adjust poll intervals per protocol
- Configure reconnect delays
- Monitor memory usage

### Network
- Use compression for HTTP responses
- Enable caching where appropriate
- Consider regional endpoints for cloud services

## Security Considerations

1. **API Keys** - Never expose API keys in logs or source code
2. **TLS/SSL** - Always use HTTPS for cloud services
3. **Database** - Use strong passwords, limit access
4. **MQTT** - Enable TLS, use strong credentials
5. **Firewall** - Restrict access to internal services
6. **Monitoring** - Log and alert on suspicious activity

## Support & Documentation

- API Documentation: `BACKEND_API_DOCUMENTATION.md`
- Campbell Scientific: https://www.campbellsci.com/
- Rika Cloud: https://www.rika.co/
- MQTT Protocol: https://mqtt.org/
- LoRaWAN: https://lora-alliance.org/
