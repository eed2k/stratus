# Weather Station Integration Setup Guide

Stratus supports integration with both **Campbell Scientific** and **Rika** weather stations. This guide covers setup for both platforms.

## Table of Contents
1. [Campbell Scientific Setup](#campbell-scientific-setup)
2. [Rika Weather Station Setup](#rika-weather-station-setup)
3. [API Endpoints](#api-endpoints)
4. [Wind Rose Visualization](#wind-rose-visualization)
5. [Data Retrieval](#data-retrieval)

---

## Campbell Scientific Setup

### Supported Equipment
- **DataLogger**: CR300, CR215
- **Sensors**: R.M. Young wind speed/direction, Li-cor solar radiation, Apogee radiation sensors
- **Connection Methods**: Serial (RS232), LoRa Radio, GSM/GPRS

### Setup Option 1: Serial Connection (RS232)

1. **Hardware Setup**:
   - Connect CR300 datalogger to backend server via RS232 serial cable
   - Install USB-to-RS232 adapter if needed (recommended: Prolific or FTDI chips)

2. **Backend Configuration**:
   ```json
   {
     "id": "campbell-kommetjie",
     "name": "Kommetjie Station",
     "type": "campbell",
     "location": {
       "latitude": -34.1374,
       "longitude": 18.3308,
       "altitude": 9,
       "description": "Kommetjie, Cape Town, South Africa"
     },
     "config": {
       "connectionType": "serial",
       "portName": "COM3",
       "baudRate": 115200
     }
   }
   ```

3. **Serial Utils** (`backend/src/utils/serial.ts`):
   ```typescript
   // Configure serial connection
   const serialConnection = new SerialConnection({
     port: 'COM3',
     baudRate: 115200,
     dataBits: 8,
     stopBits: 1,
     parity: 'none'
   });
   ```

### Setup Option 2: LoRa Radio Connection

1. **Hardware Setup**:
   - Install LoRa radio module on CR300
   - Configure LoRa frequency (region-specific: 868 MHz Europe, 915 MHz North America)
   - Set up backend LoRa receiver module

2. **Backend Configuration**:
   ```json
   {
     "id": "campbell-remote",
     "name": "Remote Campbell Station",
     "type": "campbell",
     "config": {
       "connectionType": "lora",
       "frequency": 868000000,
       "spreadingFactor": 12,
       "bandwidth": 125000
     }
   }
   ```

3. **LoRa Utils** (`backend/src/utils/lora.ts`):
   ```typescript
   const loraConnection = new LoRaConnection({
     frequency: 868000000,
     spreadingFactor: 12,
     bandwidth: 125000,
     txPower: 20
   });
   ```

### Setup Option 3: GSM/GPRS Connection

1. **Hardware Setup**:
   - Enable GSM modem on CR300
   - Configure APN credentials for your cellular provider

2. **Backend Configuration**:
   ```json
   {
     "id": "campbell-cellular",
     "name": "Cellular Campbell Station",
     "type": "campbell",
     "config": {
       "connectionType": "gsm",
       "apn": "internet.vodacom.co.za",
       "pushUrl": "https://your-api.com/api/station/receive-data"
     }
   }
   ```

3. **GSM Utils** (`backend/src/utils/gsm.ts`):
   Configure HTTPS endpoint for receiving data pushes from CR300.

---

## Rika Weather Station Setup

### Supported Models
- Rika Professional Weather Stations
- Supports IP-based HTTP/REST API communication
- Compatible with standard meteorological sensors

### Setup Steps

1. **Network Configuration**:
   - Assign static IP address to Rika station or note DHCP address
   - Ensure backend server has network connectivity to station IP
   - Firewall: Open port 8080 (default) or configured port

2. **Get Rika Station Details**:
   - Log into Rika web interface: `http://<RIKA_IP>:8080`
   - Note the station ID/serial number
   - Optional: Generate API key for authentication

3. **Configure in Stratus**:
   ```json
   {
     "id": "rika-main",
     "name": "Main Rika Station",
     "type": "rika",
     "location": {
       "latitude": -34.1374,
       "longitude": 18.3308,
       "altitude": 15,
       "description": "Cape Town Meteorological Station"
     },
     "config": {
       "ipAddress": "192.168.1.100",
       "port": 8080,
       "apiKey": "optional-api-key-if-required",
       "pollIntervalSeconds": 60
     }
   }
   ```

4. **API Endpoints Used**:
   - `/api/status` - Health check
   - `/api/data/current` - Get latest weather data
   - `/api/data/history` - Get historical data (with time range)

### Rika Data Mapping

```typescript
// Rika API Response → Stratus Format
{
  temp: 22.5,              // → temperature (°C)
  humidity: 65,            // → humidity (%)
  pressure: 1013.25,       // → pressure (hPa)
  wind_speed: 3.2,         // → windSpeed (m/s)
  wind_direction: 180,     // → windDirection (0-360°)
  wind_gust: 5.8,          // → windGust (m/s)
  rain: 0.5,               // → rainfall (mm)
  solar_rad: 450,          // → solarRadiation (W/m²)
  uv_index: 6              // → uvIndex
}
```

---

## API Endpoints

### 1. Setup a New Station

**POST** `/api/stations/setup`

```bash
curl -X POST http://localhost:3000/api/stations/setup \
  -H "Content-Type: application/json" \
  -d '{
    "id": "rika-main",
    "name": "Main Weather Station",
    "type": "rika",
    "location": {
      "latitude": -34.1374,
      "longitude": 18.3308,
      "altitude": 15,
      "description": "Cape Town"
    },
    "config": {
      "ipAddress": "192.168.1.100",
      "port": 8080,
      "pollIntervalSeconds": 60
    }
  }'
```

### 2. List All Configured Stations

**GET** `/api/stations`

```bash
curl http://localhost:3000/api/stations
```

Response:
```json
{
  "status": "ok",
  "stations": [
    {
      "id": "rika-main",
      "name": "Main Weather Station",
      "type": "rika",
      "ipAddress": "192.168.1.100",
      "enabled": true,
      "isConnected": true
    }
  ],
  "total": 1
}
```

### 3. Get Station Details

**GET** `/api/stations/:stationId`

```bash
curl http://localhost:3000/api/stations/rika-main
```

### 4. Get Latest Weather Data (All Stations)

**GET** `/api/data/latest`

```bash
curl http://localhost:3000/api/data/latest
```

Response:
```json
{
  "status": "ok",
  "data": {
    "rika-main": {
      "timestamp": "2025-12-17T10:30:00Z",
      "temperature": 22.5,
      "humidity": 65,
      "pressure": 1013.25,
      "windSpeed": 3.2,
      "windDirection": 180,
      "windGust": 5.8,
      "rainfall": 0.5,
      "solarRadiation": 450,
      "dewPoint": 15.2
    }
  }
}
```

### 5. Get Historical Data

**GET** `/api/stations/:stationId/history`

Query parameters:
- `startTime` - ISO 8601 datetime (default: 24h ago)
- `endTime` - ISO 8601 datetime (default: now)
- `limit` - Max records to return (default: 1440)

```bash
curl "http://localhost:3000/api/stations/rika-main/history?startTime=2025-12-16T00:00:00Z&endTime=2025-12-17T00:00:00Z&limit=1000"
```

### 6. Get Weather Statistics

**GET** `/api/stations/:stationId/statistics`

Query parameters:
- `timeWindowMinutes` - Aggregation window (default: 60)

```bash
curl "http://localhost:3000/api/stations/rika-main/statistics?timeWindowMinutes=60"
```

Response:
```json
{
  "status": "ok",
  "statistics": {
    "temperature": {
      "current": 22.5,
      "average": 21.8,
      "min": 18.2,
      "max": 24.1
    },
    "humidity": {
      "current": 65,
      "average": 68,
      "min": 55,
      "max": 80
    },
    "wind": {
      "speed": 3.2,
      "averageSpeed": 2.8,
      "maxGust": 5.8
    }
  }
}
```

---

## Wind Rose Visualization

### Get Wind Rose Data

**GET** `/api/stations/:stationId/wind-rose`

Query parameters:
- `windSpeedBins` - Number of speed classes (default: 6)
- `directionBins` - Number of direction sectors (default: 16)

```bash
curl "http://localhost:3000/api/stations/rika-main/wind-rose?directionBins=16&windSpeedBins=6"
```

Response:
```json
{
  "status": "ok",
  "windRose": {
    "0_0": 15,      // 0° direction, speed class 0
    "0_1": 8,       // 0° direction, speed class 1
    "22.5_0": 12,
    "22.5_1": 10,
    ...
  },
  "dataPoints": 1440,
  "bins": {
    "direction": 16,
    "speed": 6
  }
}
```

### Frontend Implementation

Both **2D Wind Rose** and **3D Wind Rose** components are included:
- `frontend/src/components/Dashboard/WindRose2D.tsx` - D3.js based 2D visualization
- `frontend/src/components/Dashboard/WindRose3D.tsx` - Three.js based 3D visualization

---

## Data Retrieval Strategies

### Real-time Data via WebSocket

```typescript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Station ${data.stationId}: ${data.temperature}°C`);
};
```

### Batch Data Retrieval

```typescript
// Fetch 7 days of historical data
const response = await fetch(`/api/stations/rika-main/history?startTime=${sevenDaysAgo}&endTime=${now}&limit=10000`);
const data = await response.json();
```

### Data Export

Stratus can export data in multiple formats:
- **CSV**: `/api/stations/:stationId/export?format=csv`
- **JSON**: `/api/stations/:stationId/export?format=json`
- **NetCDF**: `/api/stations/:stationId/export?format=netcdf` (scientific standard)

---

## Troubleshooting

### Campbell Scientific - Serial Connection
- Ensure correct COM port and baud rate
- Verify CR300 program is set to output data
- Check RS232 cable for damage

### Rika Station Connection
- Verify station IP is reachable: `ping 192.168.1.100`
- Check firewall allows connections to port 8080
- Verify API key (if required) is correct
- Check station logs: `http://<RIKA_IP>:8080/logs`

### Data Not Appearing
- Check `/api/stations` endpoint—is station showing `isConnected: true`?
- Review backend logs: `tail -f logs/stratus.log`
- Verify database connectivity: `DATABASE_URL` environment variable

---

## Support

For issues or feature requests, visit: https://github.com/reuxnergy-admin1/stratus/issues
