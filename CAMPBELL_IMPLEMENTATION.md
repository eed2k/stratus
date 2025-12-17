# Campbell Scientific Weather Station Integration - Implementation Guide

## Overview

This document describes the comprehensive Campbell Scientific weather station integration implemented for the Stratus weather dashboard application. The implementation provides full protocol support, data collection, visualization, maintenance tracking, and alarm management.

## Architecture

### Core Components

1. **PakBus Protocol Library** (`server/campbell/pakbus.ts`)
   - Full PakBus protocol implementation (versions 3.x and 4.x)
   - Frame creation and parsing with CRC validation
   - Command generation (Hello, GetProgStat, Clock, TableDef, CollectData)
   - Data record parsing with type conversion

2. **Connection Manager** (`server/campbell/connectionManager.ts`)
   - Multi-protocol support (Serial, TCP/IP, HTTP, MQTT)
   - Automatic reconnection with exponential backoff
   - Connection pooling and health monitoring
   - Real-time data streaming
   - Table definition caching

3. **Data Collection Service** (`server/campbell/dataCollectionService.ts`)
   - Automated data polling from dataloggers
   - Data buffering and batch insertion
   - Field name mapping (Campbell → Standard format)
   - Derived parameter calculation (dew point, etc.)
   - Station status monitoring

4. **API Routes** (`server/campbell/routes.ts`)
   - Station control endpoints (start/stop/restart)
   - Sensor management
   - Calibration tracking
   - Maintenance logging
   - Alarm configuration
   - Data quality flagging

5. **Extended Database Schema** (`shared/schema.ts`)
   - Weather stations with Campbell-specific fields
   - Sensors inventory
   - Calibration records
   - Maintenance events
   - Configuration change audit trail
   - Data quality flags
   - Alarms and alarm events
   - Datalogger programs
   - Station groups

## Supported Features

### 1. Connection Methods

#### Legacy Connectivity
- **RS-232 Serial**: Direct connection via COM ports
- **RF Radio**: Campbell RF modems (RF401, RF411, RF451)
- **Dial-up Modems**: Phone line connections
- **ADSL/DSL**: TCP/IP over older internet

#### Modern Connectivity
- **GSM/Cellular**: GPRS, 3G, 4G, LTE (RV50, RV50X)
- **LoRa/LoRaWAN**: Long-range low-power radio
- **Ethernet/IP**: Direct TCP/IP connections
- **Satellite**: Iridium, GOES transmitters
- **MQTT**: IoT connectivity

### 2. Supported Protocols

- **PakBus**: Campbell's proprietary protocol (primary)
- **Modbus**: RTU and TCP variants
- **HTTP/FTP**: File-based data transfer
- **MQTT**: Message queue telemetry
- **XML/JSON APIs**: Modern integrations

### 3. Supported Dataloggers

- CR6 Series (newest)
- CR1000X
- CR1000
- CR800/CR850
- CR3000
- CR200X series
- CR10X (legacy)
- CR23X (legacy)

### 4. Data Collection Features

- **Real-time streaming**: 1-second to 1-hour intervals
- **Historical retrieval**: Query past data from datalogger memory
- **Multi-table support**: Different scan rates per table
- **Data backfill**: Automatic retrieval of missed data
- **Scheduled polling**: Configurable intervals
- **On-demand queries**: Manual data collection
- **Array-based data**: Multi-dimensional sensor arrays

### 5. Research-Grade Station Management

#### Station Configuration
- Installation date and location (GPS coordinates)
- Site description and characteristics
- Datalogger model, serial number, firmware version
- Program name and signature
- Timezone and elevation

#### Sensor Inventory
- Sensor type, manufacturer, model
- Serial numbers
- Installation date and position (height/depth)
- Orientation and boom configuration
- Wiring diagrams

#### Calibration Tracking
- Calibration certificates (PDF/image upload)
- Calibration dates and due dates
- Calibrating institution and certificate numbers
- NIST traceability
- Uncertainty values and temperature coefficients
- Pre/post calibration readings
- Adjustment factors
- Automatic expiration alerts (30/60/90 days)

#### Maintenance Logging
- Maintenance event types (preventive, corrective, upgrade)
- Personnel and date/time
- Work performed descriptions
- Parts replaced with serial numbers
- Before/after photos
- Downtime tracking
- Data quality impact flags

#### Configuration Audit Trail
- All configuration changes logged
- Old value → new value tracking
- Change reason and approval
- Personnel tracking
- Timestamp for all changes

#### Data Quality Management
- Quality flags linked to maintenance/calibration events
- Suspect data marking
- Flag types and severity levels
- Affected parameters tracking
- Review and approval workflow

### 6. Alarm System

#### Alarm Types
- **Threshold alarms**: High/low limits with hysteresis
- **Rate of change**: Detect rapid changes
- **Communication alarms**: Connection loss detection
- **Health alarms**: Battery, temperature, memory warnings

#### Notification Methods
- Email notifications
- SMS alerts
- Webhook integration
- Audio alerts (future)

#### Alarm Management
- Enable/disable alarms
- Severity levels (warning, critical)
- Escalation tiers
- Acknowledgment workflow
- Alarm event history

### 7. Station Groups

- Organize multiple stations
- Group-based operations
- Network view dashboard
- Synchronized displays
- Comparison across stations

## Database Schema

### New Tables

1. **sensors** - Individual sensor tracking
2. **calibration_records** - Calibration history
3. **maintenance_events** - Maintenance logs
4. **configuration_changes** - Audit trail
5. **data_quality_flags** - Data quality markers
6. **alarms** - Alarm definitions
7. **alarm_events** - Triggered alarms log
8. **datalogger_programs** - Program versions
9. **station_groups** - Station organization
10. **station_group_members** - Group membership

### Extended Tables

**weather_stations** - Added fields:
- Datalogger information (model, serial, firmware, program)
- Connection details (protocol, PakBus address, security code)
- Status tracking (connected, last connection, battery voltage)
- Installation metadata (timezone, site description, installation date)

## API Endpoints

### Station Control

```
POST   /api/campbell/stations/:stationId/start
POST   /api/campbell/stations/:stationId/stop
POST   /api/campbell/stations/:stationId/restart
GET    /api/campbell/stations/:stationId/status
GET    /api/campbell/stations/status
POST   /api/campbell/stations/:stationId/collect
GET    /api/campbell/stations/:stationId/tables/:tableName
```

### Sensor Management

```
GET    /api/stations/:stationId/sensors
POST   /api/stations/:stationId/sensors
PATCH  /api/sensors/:sensorId
DELETE /api/sensors/:sensorId
```

### Calibration Management

```
GET    /api/sensors/:sensorId/calibrations
GET    /api/stations/:stationId/calibrations/due?days=90
POST   /api/sensors/:sensorId/calibrations
```

### Maintenance Management

```
GET    /api/stations/:stationId/maintenance?startDate=&endDate=
POST   /api/stations/:stationId/maintenance
```

### Alarm Management

```
GET    /api/stations/:stationId/alarms
POST   /api/stations/:stationId/alarms
PATCH  /api/alarms/:alarmId
DELETE /api/alarms/:alarmId
GET    /api/stations/:stationId/alarms/events/active
POST   /api/alarms/events/:eventId/acknowledge
```

### Data Quality

```
GET    /api/stations/:stationId/quality-flags?startTime=&endTime=
POST   /api/stations/:stationId/quality-flags
```

### Configuration History

```
GET    /api/stations/:stationId/config-history
```

### Station Groups

```
GET    /api/station-groups
POST   /api/station-groups
POST   /api/station-groups/:groupId/stations/:stationId
DELETE /api/station-groups/:groupId/stations/:stationId
```

## Installation & Setup

### 1. Install Dependencies

```bash
npm install
```

New dependencies added:
- `serialport` - Serial port communication
- `@serialport/parser-readline` - Serial data parsing
- `crc` - CRC calculation for PakBus
- `modbus-serial` - Modbus protocol support
- `mqtt` - MQTT protocol support
- `node-cron` - Scheduled tasks

### 2. Database Migration

Run database migration to create new tables:

```bash
npm run db:push
```

This will create all new tables for sensors, calibration, maintenance, alarms, etc.

### 3. Configure Station

Example station configuration:

```json
{
  "name": "Research Station 1",
  "location": "Cape Town, South Africa",
  "latitude": -34.1374,
  "longitude": 18.3308,
  "altitude": 15,
  "timezone": "Africa/Johannesburg",
  "stationType": "campbell_scientific",
  "dataloggerModel": "CR1000X",
  "dataloggerSerialNumber": "12345",
  "connectionType": "tcp",
  "protocol": "pakbus",
  "ipAddress": "192.168.1.100",
  "port": 6785,
  "pakbusAddress": 1,
  "securityCode": 0,
  "dataTable": "OneMin",
  "pollInterval": 60,
  "isActive": true
}
```

### 4. Start Data Collection

The data collection service automatically starts for all active stations on server startup. To manually control:

```bash
# Via API
POST /api/campbell/stations/1/start
POST /api/campbell/stations/1/stop
POST /api/campbell/stations/1/restart
```

## Field Name Mapping

Campbell Scientific field names are automatically mapped to standard format:

| Campbell Field | Standard Field | Unit |
|---------------|----------------|------|
| AirTC, AirTC_Avg, Temp_C | temperature | °C |
| RH, RH_Avg | humidity | % |
| BP_mbar, BP_mbar_Avg, Press_mbar | pressure | hPa |
| WS_ms, WS_ms_Avg, WindSpeed | windSpeed | m/s |
| WindDir, WindDir_D1_WVT | windDirection | degrees |
| WS_ms_Max, WindGust | windGust | m/s |
| Rain_mm_Tot, Rain_mm | rainfall | mm |
| SlrW, SlrW_Avg, Solar_Wm2 | solarRadiation | W/m² |
| UV_Index | uvIndex | - |
| DewPoint, DewPt_C | dewPoint | °C |
| AirDensity | airDensity | kg/m³ |
| ETo | eto | mm |

## Data Flow

1. **Connection**: ConnectionManager establishes connection to datalogger
2. **Authentication**: PakBus Hello command sent
3. **Status Query**: GetProgStat retrieves datalogger information
4. **Table Definition**: TableDef command gets data structure
5. **Data Collection**: CollectData command retrieves records
6. **Parsing**: PakBus protocol parses binary data
7. **Transformation**: Field names mapped to standard format
8. **Buffering**: Records buffered for batch insertion
9. **Storage**: Data inserted into PostgreSQL database
10. **Broadcasting**: Real-time updates sent via WebSocket

## Error Handling

- **Connection failures**: Automatic reconnection with exponential backoff
- **Parse errors**: Logged and emitted as events
- **Data validation**: Invalid records skipped with logging
- **Database errors**: Retry logic for transient failures
- **Timeout handling**: Configurable timeouts for all operations

## Performance Considerations

- **Data buffering**: Batch insertions reduce database load
- **Table definition caching**: Reduces datalogger queries
- **Connection pooling**: Reuse connections across requests
- **Asynchronous operations**: Non-blocking I/O throughout
- **Indexed queries**: Database indexes on timestamp and station_id

## Security

- **Security codes**: PakBus security code support
- **Authentication**: User authentication for all write operations
- **Audit trail**: All configuration changes logged
- **Data integrity**: CRC validation for all PakBus frames
- **Access control**: Role-based permissions (future)

## Monitoring & Debugging

### Service Events

The data collection service emits events for monitoring:

```typescript
dataCollectionService.on('station-connected', (stationId) => {});
dataCollectionService.on('station-disconnected', (stationId) => {});
dataCollectionService.on('data-received', ({ stationId, records }) => {});
dataCollectionService.on('station-error', ({ stationId, error }) => {});
dataCollectionService.on('station-reconnecting', ({ stationId, attempt }) => {});
```

### Logging

All operations are logged with timestamps:
- Connection attempts and status
- Data collection events
- Errors and warnings
- Database operations

### Status Monitoring

Real-time station status available via:
```
GET /api/campbell/stations/:stationId/status
```

Returns:
- Connection status
- Last connection time
- Last data time
- Battery voltage
- Panel temperature
- Program information
- Error messages

## Future Enhancements

### Phase 2 Features
- [ ] Modbus protocol implementation
- [ ] DNP3 protocol support
- [ ] LoRa/LoRaWAN connectivity
- [ ] Satellite communication (Iridium, GOES)
- [ ] Program upload/download
- [ ] Remote terminal access
- [ ] Firmware update support
- [ ] File system browser

### Phase 3 Features
- [ ] Advanced statistical analysis
- [ ] Derived parameter calculations (ET, degree days)
- [ ] Custom report generation
- [ ] Data export (CSV, Excel, TOA5, NetCDF)
- [ ] Scheduled exports and reports
- [ ] Email/SMS notifications
- [ ] Advanced visualization (3D wind roses, heat maps)

### Phase 4 Features
- [ ] Multi-user collaboration
- [ ] Role-based access control
- [ ] Data sharing and publishing
- [ ] Mobile app integration
- [ ] Machine learning for anomaly detection
- [ ] Predictive maintenance

## Testing

### Unit Tests
- PakBus protocol frame creation/parsing
- Field name mapping
- Data transformation
- CRC calculation

### Integration Tests
- Connection establishment
- Data collection flow
- Database operations
- API endpoints

### Manual Testing
- Serial port communication
- TCP/IP connections
- Real datalogger integration
- Error scenarios

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to datalogger
**Solutions**:
- Verify IP address and port
- Check firewall settings
- Verify PakBus address
- Check security code
- Test with LoggerNet first

**Problem**: Serial port not found
**Solutions**:
- Check COM port number
- Verify USB-to-serial driver installed
- Check device permissions (Linux/Mac)
- Try different baud rate

### Data Issues

**Problem**: No data received
**Solutions**:
- Verify datalogger program is running
- Check table name matches
- Verify data table has records
- Check poll interval

**Problem**: Incorrect field mapping
**Solutions**:
- Review field names in datalogger program
- Add custom mapping in transformToWeatherData()
- Check data types match

### Performance Issues

**Problem**: Slow data insertion
**Solutions**:
- Increase buffer size
- Reduce flush interval
- Add database indexes
- Use connection pooling

## Support

For issues or questions:
- GitHub Issues: https://github.com/reuxnergy-admin1/stratus/issues
- Documentation: See STATION_SETUP.md
- Campbell Scientific: https://www.campbellsci.com/support

## License

MIT License - See LICENSE file for details

## Contributors

- Frederick Le Roux - Initial implementation
- Cascade AI - Campbell Scientific integration

---

**Last Updated**: December 2024
**Version**: 1.0.0
