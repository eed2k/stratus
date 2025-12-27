# Campbell Scientific Station Setup Guide

Complete guide for connecting and configuring Campbell Scientific dataloggers with Stratus Weather Server.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Connection Types](#connection-types)
3. [Datalogger Configuration](#datalogger-configuration)
4. [Adding a Station](#adding-a-station)
5. [Data Collection Setup](#data-collection-setup)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Minimum Requirements
- Campbell Scientific datalogger (CR1000X, CR6, CR1000, CR300, CR800, etc.)
- Connection to datalogger via Serial, TCP/IP, or RF
- Datalogger running a CRBasic program with data tables

### Basic Setup Steps
1. Configure datalogger with PakBus address
2. Connect datalogger to computer/network
3. Add station in Stratus
4. Test connection
5. Configure data collection schedule

---

## Connection Types

### Serial Connection (RS232/RS485)

**Hardware Required:**
- RS232 cable (9-pin null modem or direct)
- USB-to-Serial adapter (if no COM port available)
- For RS485: RS485-to-USB converter

**Configuration in Stratus:**
```
Connection Type: Serial
COM Port: COM3 (or your port)
Baud Rate: 115200 (match datalogger setting)
PakBus Address: 1 (match datalogger setting)
```

**Datalogger Settings (Device Configuration Utility):**
1. Open Device Configuration Utility
2. Connect to datalogger
3. Go to Settings → ComPorts Settings
4. Set: Baud Rate = 115200, PakBus Address = 1
5. Apply settings

### TCP/IP Connection

**Hardware Required:**
- NL121 Ethernet Interface, or
- CR1000X/CR6 with built-in Ethernet, or
- CELL200 series cellular modem

**Configuration in Stratus:**
```
Connection Type: TCP/IP
Host: 192.168.1.100 (datalogger IP)
Port: 6785 (PakBus default)
PakBus Address: 1
```

**Datalogger Network Setup:**
1. Connect NL121 or datalogger to network
2. Configure static IP or DHCP
3. Enable PakBus/TCP port (default 6785)
4. Set PakBus address

### RF Connection (RF407/RF412)

**Hardware Required:**
- RF407 or RF412 radio at datalogger
- RF407 or RF412 base station radio
- Serial connection to base station

**Configuration in Stratus:**
```
Connection Type: RF
Serial Port: COM3 (base station port)
Baud Rate: 115200
RF Net Address: 100 (base station)
PakBus Address: 1 (datalogger)
```

### Cellular/GSM Connection

**Hardware Required:**
- CELL200 series modem at datalogger
- Internet connectivity
- Static IP or callback service

**Configuration in Stratus:**
```
Connection Type: TCP/IP
Host: your-static-ip or callback address
Port: 6785
PakBus Address: 1
```

---

## Datalogger Configuration

### Required PakBus Settings

In Device Configuration Utility or via CRBasic:

```basic
' Set PakBus address in CRBasic
PakBusAddress = 1

' Enable TCP/IP if using Ethernet
TCPOpen
```

### Security Code (Optional)

If security is enabled on the datalogger:
```
PakBus Security: Level 2 (or higher)
Security Code: 1234 (configure in Stratus)
```

### Program Requirements

Your CRBasic program must have data tables for collection:

```basic
' Example data table
DataTable(WeatherData, True, -1)
  DataInterval(0, 1, Min, 10)
  Average(1, AirTemp, FP2, False)
  Average(1, RelHumidity, FP2, False)
  Average(1, WindSpeed, FP2, False)
  Sample(1, WindDirection, FP2)
  Total(1, Rain_mm, FP2, False)
  Average(1, SolarRad, FP2, False)
  Average(1, BaroPressure, FP2, False)
EndTable
```

---

## Adding a Station

### Using the Station Wizard

1. **Open Station Manager**
   - Click `Station → Add Station` or press `Ctrl+N`

2. **Enter Basic Information**
   - Station Name: Descriptive name (e.g., "Main Campus Weather")
   - PakBus Address: Match datalogger setting (typically 1-4094)

3. **Configure Connection**
   
   For Serial:
   - Connection Type: Serial
   - COM Port: Select from dropdown
   - Baud Rate: 115200 (default)
   
   For TCP/IP:
   - Connection Type: TCP/IP
   - Host: IP address or hostname
   - Port: 6785 (default PakBus port)

4. **Security Settings** (if required)
   - Security Code: Enter datalogger security code
   - Leave empty if no security

5. **Test Connection**
   - Click "Test Connection"
   - Verify "Hello" response from datalogger
   - Check table definitions are retrieved

6. **Save Station**
   - Click "Add Station"
   - Station appears in station list
### Manual Configuration

You can also configure stations via the API:

```bash
curl -X POST http://localhost:5000/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Station",
    "pakbusAddress": 1,
    "connectionType": "tcp",
    "ipAddress": "192.168.1.100",
    "port": 6785
  }'
```

---

## Data Collection Setup

### Automatic Collection

1. **Select Station** from the list
2. **Go to Data Collection** tab
3. **Configure Schedule:**
   - Table: Select table name (e.g., "WeatherData")
   - Interval: Collection frequency (e.g., every 5 minutes)
   - Mode: Most Recent or Since Last Collection

4. **Enable Collection**
   - Toggle "Enable Automatic Collection"
   - Collection starts according to schedule

### Manual Collection

1. Select station
2. Click "Collect Now"
3. Choose table and record range
4. Data appears in dashboard

### Collection Modes

**Most Recent Records:**
- Collects latest N records
- Good for real-time monitoring

**Since Last Collection:**
- Collects all new records since last time
- Ensures no data gaps
- Best for archival purposes

**Specific Range:**
- Collect records between dates/record numbers
- Useful for backfilling historical data

---

## Data Processing

### Automatic Processing Rules

Configure processing for incoming data:

**Scaling:**
```
Scale Factor: 1.0
Offset: 0.0
```

**Calibration:**
Apply sensor-specific calibration coefficients.

**Quality Control:**
- Min/Max bounds checking
- Rate-of-change limits
- Stuck sensor detection

---

## Troubleshooting

### Connection Issues

**"Connection Timeout"**
- Check physical connection (cable, network)
- Verify IP address and port
- Ensure datalogger is powered on
- Try ping test to datalogger IP

**"Invalid Security Code"**
- Verify security code matches datalogger
- Check security level setting
- Try connecting with Device Config Utility first

**"PakBus Address Not Found"**
- Verify PakBus address matches datalogger
- Check for address conflicts on network
- Ensure datalogger PakBus port is enabled

### Serial Connection Issues

**"COM Port Not Found"**
- Check USB cable connection
- Install/update USB-Serial driver
- Verify port in Device Manager

**"Communication Error"**
- Verify baud rate matches datalogger
- Check cable wiring (TX/RX crossover)
- Try lower baud rate (9600)

### Data Collection Issues

**"Table Not Found"**
- Verify table name in datalogger program
- Refresh table definitions
- Check program is running

**"No New Data"**
- Check datalogger scan interval
- Verify data is being logged
- Check "Last Collection" timestamp

### Network Issues

**"Host Unreachable"**
- Check network connectivity
- Verify IP address is correct
- Check firewall settings

**"Connection Refused"**
- Verify PakBus/TCP is enabled
- Check port number (default 6785)
- Ensure no port conflicts

---

## Best Practices

### Connection Reliability
- Use static IP addresses when possible
- Configure reasonable timeout values
- Enable automatic reconnection

### Data Integrity
- Use "Since Last Collection" mode
- Configure gap filling for critical data
- Regular backup of database

### Security
- Enable PakBus security on remote stations
- Use VPN for cellular connections
- Limit API access to trusted clients

### Performance
- Collect data at appropriate intervals
- Don't poll faster than datalogger scan rate
- Use efficient table structures

---

## Support

For additional help:
- Campbell Scientific Support: campbellsci.com/support
- Stratus GitHub Issues: github.com/yourusername/stratus/issues
