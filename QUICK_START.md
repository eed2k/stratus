# Campbell Scientific Integration - Quick Start Guide

## Prerequisites

- Node.js 18+ installed
- PostgreSQL database
- Campbell Scientific datalogger (CR1000X, CR6, etc.)
- Network or serial connection to datalogger

## Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/stratus
PORT=5000
NODE_ENV=development
```

### 3. Initialize Database

```bash
npm run db:push
```

This creates all required tables including:
- weather_stations (extended)
- sensors
- calibration_records
- maintenance_events
- alarms
- data_quality_flags
- And more...

## Quick Setup Examples

### Example 1: TCP/IP Connection (Most Common)

```bash
# 1. Create station via API
curl -X POST http://localhost:5000/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main Weather Station",
    "location": "Research Site A",
    "latitude": -34.1374,
    "longitude": 18.3308,
    "altitude": 15,
    "timezone": "Africa/Johannesburg",
    "stationType": "campbell_scientific",
    "dataloggerModel": "CR1000X",
    "connectionType": "tcp",
    "protocol": "pakbus",
    "ipAddress": "192.168.1.100",
    "port": 6785,
    "pakbusAddress": 1,
    "securityCode": 0,
    "dataTable": "OneMin",
    "pollInterval": 60,
    "isActive": true
  }'

# 2. Start data collection
curl -X POST http://localhost:5000/api/campbell/stations/1/start

# 3. Check status
curl http://localhost:5000/api/campbell/stations/1/status
```

### Example 2: Serial Connection (RS-232)

```bash
curl -X POST http://localhost:5000/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Serial Weather Station",
    "stationType": "campbell_scientific",
    "dataloggerModel": "CR1000",
    "connectionType": "serial",
    "protocol": "pakbus",
    "serialPort": "COM3",
    "baudRate": 115200,
    "pakbusAddress": 1,
    "dataTable": "OneMin",
    "pollInterval": 60,
    "isActive": true
  }'
```

### Example 3: GSM/Cellular Connection

```bash
curl -X POST http://localhost:5000/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Remote GSM Station",
    "stationType": "campbell_scientific",
    "dataloggerModel": "CR6",
    "connectionType": "tcp",
    "protocol": "pakbus",
    "ipAddress": "10.20.30.40",
    "port": 6785,
    "pakbusAddress": 1,
    "dataTable": "OneMin",
    "pollInterval": 300,
    "isActive": true,
    "connectionConfig": {
      "apn": "internet.provider.com",
      "keepAlive": true
    }
  }'
```

## Adding Sensors

```bash
# Add temperature sensor
curl -X POST http://localhost:5000/api/stations/1/sensors \
  -H "Content-Type: application/json" \
  -d '{
    "sensorType": "Temperature",
    "manufacturer": "Campbell Scientific",
    "model": "CS215",
    "serialNumber": "T12345",
    "measurementType": "temperature",
    "installationDate": "2024-01-15T00:00:00Z",
    "installationHeight": 2.0,
    "notes": "Installed at standard height"
  }'

# Add wind sensor
curl -X POST http://localhost:5000/api/stations/1/sensors \
  -H "Content-Type: application/json" \
  -d '{
    "sensorType": "Wind Speed/Direction",
    "manufacturer": "R.M. Young",
    "model": "05103",
    "serialNumber": "W67890",
    "measurementType": "wind",
    "installationDate": "2024-01-15T00:00:00Z",
    "installationHeight": 10.0,
    "orientation": "North",
    "boomPosition": "South boom, 1.5m from mast"
  }'
```

## Adding Calibration Records

```bash
curl -X POST http://localhost:5000/api/sensors/1/calibrations \
  -H "Content-Type: application/json" \
  -d '{
    "calibrationDate": "2024-01-10T00:00:00Z",
    "nextCalibrationDue": "2025-01-10T00:00:00Z",
    "calibratingInstitution": "National Metrology Institute",
    "certificateNumber": "CAL-2024-001",
    "calibrationStandard": "NIST traceable",
    "uncertaintyValue": 0.1,
    "uncertaintyUnit": "°C",
    "adjustmentFactor": 1.002,
    "calibrationStatus": "valid",
    "performedBy": "John Smith"
  }'
```

## Setting Up Alarms

```bash
# High temperature alarm
curl -X POST http://localhost:5000/api/stations/1/alarms \
  -H "Content-Type: application/json" \
  -d '{
    "alarmName": "High Temperature Alert",
    "alarmType": "threshold",
    "parameter": "temperature",
    "condition": "greater_than",
    "thresholdValue": 35.0,
    "hysteresis": 1.0,
    "severity": "warning",
    "isEnabled": true,
    "notificationEmail": "alerts@example.com"
  }'

# Low battery alarm
curl -X POST http://localhost:5000/api/stations/1/alarms \
  -H "Content-Type: application/json" \
  -d '{
    "alarmName": "Low Battery Warning",
    "alarmType": "threshold",
    "parameter": "batteryVoltage",
    "condition": "less_than",
    "thresholdValue": 12.0,
    "severity": "critical",
    "isEnabled": true,
    "notificationEmail": "maintenance@example.com"
  }'
```

## Logging Maintenance

```bash
curl -X POST http://localhost:5000/api/stations/1/maintenance \
  -H "Content-Type: application/json" \
  -d '{
    "eventDate": "2024-12-17T10:00:00Z",
    "eventType": "preventive",
    "description": "Routine sensor cleaning and inspection",
    "performedBy": "Jane Doe",
    "downtimeMinutes": 30,
    "dataQualityImpact": false,
    "notes": "All sensors functioning normally after cleaning"
  }'
```

## Viewing Data

### Get Latest Data

```bash
curl http://localhost:5000/api/stations/1/data/latest
```

### Get Historical Data

```bash
curl "http://localhost:5000/api/stations/1/data?startTime=2024-12-16T00:00:00Z&endTime=2024-12-17T00:00:00Z"
```

### Get Calibrations Due

```bash
# Get calibrations due in next 90 days
curl "http://localhost:5000/api/stations/1/calibrations/due?days=90"
```

### Get Active Alarms

```bash
curl http://localhost:5000/api/stations/1/alarms/events/active
```

## Common Operations

### Restart Data Collection

```bash
curl -X POST http://localhost:5000/api/campbell/stations/1/restart
```

### Manual Data Collection

```bash
# Collect data now from specific table
curl -X POST http://localhost:5000/api/campbell/stations/1/collect \
  -H "Content-Type: application/json" \
  -d '{"tableName": "OneMin"}'
```

### Get Table Definition

```bash
curl http://localhost:5000/api/campbell/stations/1/tables/OneMin
```

### Check All Station Statuses

```bash
curl http://localhost:5000/api/campbell/stations/status
```

## Troubleshooting

### Connection Issues

**Check station status:**
```bash
curl http://localhost:5000/api/campbell/stations/1/status
```

**Restart connection:**
```bash
curl -X POST http://localhost:5000/api/campbell/stations/1/restart
```

**Check server logs:**
```bash
# Look for connection errors
tail -f logs/stratus.log | grep "Station 1"
```

### No Data Received

1. Verify datalogger is running:
   - Check datalogger display
   - Verify program is compiled and running

2. Check table name:
   ```bash
   curl http://localhost:5000/api/campbell/stations/1/tables/OneMin
   ```

3. Verify network connectivity:
   ```bash
   ping 192.168.1.100
   telnet 192.168.1.100 6785
   ```

4. Check PakBus address and security code

### Serial Port Issues (Windows)

1. Check COM port in Device Manager
2. Verify no other application is using the port
3. Try different baud rates (9600, 19200, 38400, 115200)

### Serial Port Issues (Linux/Mac)

1. Check port permissions:
   ```bash
   ls -l /dev/ttyUSB0
   sudo chmod 666 /dev/ttyUSB0
   ```

2. Add user to dialout group:
   ```bash
   sudo usermod -a -G dialout $USER
   ```

## Development Mode

### Start Development Server

```bash
npm run dev
```

Server runs on http://localhost:5000

### Enable Debug Logging

```env
DEBUG=campbell:*
LOG_LEVEL=debug
```

### Test Connection Without Database

```typescript
import { ConnectionManager } from './server/campbell/connectionManager';

const manager = new ConnectionManager();

manager.on('connected', ({ stationId }) => {
  console.log(`Station ${stationId} connected`);
});

manager.on('data', ({ stationId, records }) => {
  console.log(`Received ${records.length} records from station ${stationId}`);
});

await manager.connect({
  stationId: 1,
  connectionType: 'tcp',
  protocol: 'pakbus',
  host: '192.168.1.100',
  port: 6785,
  pakbusAddress: 1,
  dataTable: 'OneMin',
  pollInterval: 60,
});
```

## Production Deployment

### 1. Set Environment Variables

```env
NODE_ENV=production
DATABASE_URL=postgresql://user:password@prod-db:5432/stratus
PORT=5000
```

### 2. Build Application

```bash
npm run build
```

### 3. Start Production Server

```bash
npm start
```

### 4. Use Process Manager

```bash
# Using PM2
npm install -g pm2
pm2 start npm --name "stratus" -- start
pm2 save
pm2 startup
```

### 5. Setup Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name weather.example.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

## Next Steps

1. **Configure Sensors**: Add all sensors with calibration records
2. **Setup Alarms**: Configure threshold and health alarms
3. **Schedule Maintenance**: Log regular maintenance events
4. **Monitor Status**: Check station status regularly
5. **Review Data Quality**: Flag suspect data periods
6. **Export Data**: Setup automated data exports

## Resources

- Full Documentation: `CAMPBELL_IMPLEMENTATION.md`
- Station Setup Guide: `STATION_SETUP.md`
- API Reference: See routes in `server/campbell/routes.ts`
- Campbell Scientific: https://www.campbellsci.com/support
- GitHub Issues: https://github.com/reuxnergy-admin1/stratus/issues

## Support

For technical support:
- Email: support@example.com
- Documentation: See `/docs` folder
- Community: GitHub Discussions

---

**Version**: 1.0.0  
**Last Updated**: December 2024
