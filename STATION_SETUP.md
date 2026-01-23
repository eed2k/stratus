# Campbell Scientific Station Setup Guide

Complete guide for connecting and configuring Campbell Scientific dataloggers with Stratus Weather Server.

> **CLOUD DEPLOYMENT NOTE**
> Stratus Weather Server is designed for cloud deployment on any VPS provider (Hetzner, Linode, DigitalOcean, Vultr, etc.).
> All connections use TCP/IP, Cellular, LoRa, or Dropbox Sync for data import.

## Table of Contents
1. [Quick Start](#quick-start)
2. [Connection Types](#connection-types)
3. [Datalogger Configuration](#datalogger-configuration)
4. [Adding a Station](#adding-a-station)
5. [Data Collection Setup](#data-collection-setup)
6. [Troubleshooting](#troubleshoot) 
---

## Quick Start

### Minimum Requirements
- Campbell Scientific datalogger (CR1000X, CR6, CR1000, CR300, CR800, etc.)
- Network connectivity (Ethernet, Cellular/4G, or LoRaWAN)
- Datalogger running a CRBasic program with data tables

### Basic Setup Steps
1. Configure datalogger with PakBus address
2. Connect datalogger to network (TCP/IP, cellular, or LoRa)
3. Add station in Stratus
4. Test connection
5. Configure data collection schedule

---

## Connection Types

Stratus supports the following connection methods for cloud deployment:

### TCP/IP Connection (Recommended)

**Hardware Required:**
- NL121 Ethernet Interface, or
- CR1000X/CR6 with built-in Ethernet, or
- CELL200 series cellular modem with static IP

**Configuration in Stratus:**
```
Connection Type: TCP/IP
Host: 192.168.1.100 (datalogger IP) or public IP
Port: 6785 (PakBus default)
PakBus Address: 1
```

**Datalogger Network Setup:**
1. Connect NL121 or datalogger to network
2. Configure static IP or DHCP
3. Enable PakBus/TCP port (default 6785)
4. Set PakBus address
5. For remote access, configure port forwarding or use VPN

### Cellular/4G Connection

**Hardware Required:**
- CELL210 or CELL220 cellular modem
- Active SIM card with data plan
- Static IP address or cellular gateway service

**Configuration in Stratus:**
```
Connection Type: GSM/Cellular
Host: your-static-ip or gateway address
Port: 6785
PakBus Address: 1
Gateway Host: cellular-gateway-ip (if using gateway)
Gateway Port: gateway-port
```

**How Stratus Connects to Cellular Modems:**
- Stratus connects to the modem's TCP/IP endpoint
- For modems with static IP: direct TCP connection
- For modems behind gateway: connect via TCP gateway
- Supports Sierra Wireless RV50/RV55 with Aleos gateway
- Supports any cellular modem with TCP-to-PakBus bridge

**Cellular Modem Setup:**
1. Install SIM card in modem
2. Configure APN settings on modem
3. Enable TCP server mode or connect to gateway service
4. Note the public IP address or gateway endpoint
5. Configure firewall to allow incoming connections on PakBus port

### LoRaWAN Connection

**Hardware Required:**
- LoRa transceiver at datalogger station
- LoRaWAN gateway within range
- Account with LoRaWAN network server (TTN, ChirpStack, etc.)

**Configuration in Stratus:**
```
Connection Type: LoRa
Network Server: eu1.cloud.thethings.network
Application ID: your-app-id
Application Key: your-app-key
Device EUI: your-device-eui
```

**How LoRaWAN Works with Stratus:**
- Stratus connects to LoRaWAN network server via MQTT
- Data is received as uplink messages from your device
- Supports Cayenne LPP and custom payload formats
- Automatic decoding of weather data payloads

**LoRaWAN Setup:**
1. Register your device on The Things Network or ChirpStack
2. Configure device EUI, Application EUI, and App Key
3. Program datalogger to encode and send data via LoRa
4. Enter credentials in Stratus station configuration

### HTTP POST (Push Mode)

**Configuration:**
```
Connection Type: HTTP
API Endpoint: https://your-stratus-server.com/api/weather-data
API Key: your-api-key
```

**Datalogger Setup:**
- Program datalogger to HTTP POST data at intervals
- See `examples/crbasic/stratus_http_post_station.cr1x` for example

### Dropbox Import (File-Based)

For dataloggers that upload TOA5 files to Dropbox (common with cellular modems):

**Configuration:**
```
Connection Type: HTTP (Import-only)
Data Source: Dropbox
Dropbox Folder: /YOUR_STATION_FOLDER
```

**Setup Steps:**
1. Configure your datalogger/modem to upload files to Dropbox
2. Set up Dropbox OAuth in Stratus (see [DROPBOX_SETUP.md](DROPBOX_SETUP.md))
3. Create station with HTTP connection type
4. Specify the Dropbox folder path in connection config

**Benefits:**
- No need for public IP or port forwarding
- Works with any cellular modem that supports Dropbox uploads
- Automatic file discovery and import
- Deduplication prevents duplicate records

**File Requirements:**
- TOA5 format (Campbell Scientific standard)
- Proper timestamp column
- Field names matching Stratus conventions

See [DROPBOX_SETUP.md](DROPBOX_SETUP.md) for detailed OAuth configuration.

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
   
   For TCP/IP:
   - Connection Type: TCP/IP
   - Host: IP address or hostname
   - Port: 6785 (default PakBus port)
   
   For Cellular:
   - Connection Type: GSM/Cellular
   - Gateway Host: Cellular gateway IP
   - Gateway Port: Gateway port
   
   For LoRa:
   - Connection Type: LoRa
   - Network Server: Your LoRaWAN server
   - Application ID: Your app credentials
   - Device EUI: Your device identifier

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
curl -X POST https://your-server.com/api/stations \
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
- Check network connectivity to datalogger
- Verify IP address and port
- Ensure datalogger is powered on
- Test with ping command
- Check firewall settings

**"Invalid Security Code"**
- Verify security code matches datalogger
- Check security level setting
- Try connecting with Device Config Utility first

**"PakBus Address Not Found"**
- Verify PakBus address matches datalogger
- Check for address conflicts on network
- Ensure datalogger PakBus port is enabled

### TCP/IP Issues

**"Host Unreachable"**
- Check network connectivity
- Verify IP address is correct
- Check firewall settings
- Verify VPN connection (if applicable)

**"Connection Refused"**
- Verify PakBus/TCP is enabled on datalogger
- Check port number (default 6785)
- Ensure no port conflicts
- Check if another application is using the port

### Cellular Connection Issues

**"Gateway Connection Failed"**
- Verify cellular modem has signal
- Check APN configuration
- Verify gateway service is running
- Check static IP or gateway endpoint

**"Intermittent Connectivity"**
- Check signal strength
- Consider external antenna
- Verify data plan is active
- Check for network congestion

### LoRaWAN Issues

**"Device Not Found"**
- Verify device is registered on network server
- Check device EUI matches
- Ensure device is transmitting

**"No Uplinks Received"**
- Check LoRa gateway coverage
- Verify spreading factor settings
- Check for interference

### Data Collection Issues

**"Table Not Found"**
- Verify table name in datalogger program
- Refresh table definitions
- Check program is running

**"No New Data"**
- Check datalogger scan interval
- Verify data is being logged
- Check "Last Collection" timestamp

---

## Best Practices

### Connection Reliability
- Use static IP addresses when possible
- Configure reasonable timeout values
- Enable automatic reconnection
- Consider redundant connections for critical stations

### Data Integrity
- Use "Since Last Collection" mode
- Configure gap filling for critical data
- Regular backup of database
- Monitor collection success rates

### Security
- Enable PakBus security on remote stations
- Use VPN for cellular connections
- Limit API access to trusted clients
- Rotate API keys regularly

### Performance
- Collect data at appropriate intervals
- Don't poll faster than datalogger scan rate
- Use efficient table structures
- Monitor network latency

---

## Dashboard Features

### Solar Position Tracking

The dashboard displays real-time solar position calculated from station coordinates:

- **Sun Elevation**: Degrees above/below horizon (-90° to +90°)
- **Sun Azimuth**: Degrees from north (0° to 360°)
- **Nautical Dawn/Dusk**: When sun is 12° below horizon
- **Sunrise/Sunset**: Actual rise and set times
- **Day Length**: Hours of daylight

**Requirements:**
- Station must have latitude and longitude configured
- Calculations use NOAA solar position algorithms

### Wind Analysis (WMO/Beaufort Scale)

The dashboard provides comprehensive wind analysis with multiple visualization types:

#### Wind Rose Charts
Traditional wind direction frequency distribution showing:
- **Wind Rose (Last 60 min)**: Recent wind patterns
- **Wind Rose (Today)**: Daily wind direction distribution
- **Wind Rose (Yesterday)**: Previous day comparison

Each rose displays direction frequency with speed-coded segments using WMO/Beaufort scale colors.

#### Wind Speed Scatter Plots
Individual wind speed observations plotted on a polar coordinate system:
- **Wind Speed (Last 30 min)**: Recent observations with tight clustering
- **Wind Speed (Today)**: All today's observations
- **Wind Speed (Yesterday)**: Previous day observations

**Features:**
- Points are plotted by direction (angle) and speed (radius)
- Color-coded by wind speed according to WMO/Beaufort scale
- Statistics: Average, Max, Min speed, Dominant direction
- Interactive tooltips showing exact values

### Air Density

Real-time air density calculated from:
- Temperature (°C)
- Pressure (hPa)
- Relative Humidity (%)

Uses the ideal gas law with humidity correction. Standard reference: 1.225 kg/m³ at sea level.

### Barometric Pressure

Dual display showing:
1. **Station Pressure**: Raw pressure at station altitude (mbar)
2. **Sea Level Pressure (QNH)**: Pressure calibrated to sea level

### Reference Evapotranspiration (ETo)

Calculated using FAO Penman-Monteith method (FAO-56 standard):

**Required Inputs:**
- Air temperature
- Relative humidity
- Wind speed
- Solar radiation
- Station altitude
- Station latitude

**Outputs:**
- Hourly ETo rate (mm/hr)
- Daily ETo (mm/day)
- Weekly/Monthly cumulative ETo

### Battery Monitoring

Displays logger battery voltage with:
- Current voltage (V)
- Status indicator (Critical/Low/Fair/Good/Excellent)
- Charge percentage estimate
- 24-hour voltage history chart

**Voltage Thresholds:**
- Critical: < 11.5V
- Low: 11.5V - 12.0V
- Good: 12.0V - 13.5V
- Charging: > 13.5V

---

## 24/7 Remote Access Setup

### Cloud Deployment

For public internet access to your Stratus server, deploy to a cloud VPS (Hetzner, Linode, DigitalOcean, Vultr, etc.)

See `DEPLOYMENT_GUIDE.md` for detailed setup instructions.

**Quick Steps:**
1. Build locally: `npm run build`
2. Upload to cloud VM via SCP
3. Install Node.js and PM2 on the VM
4. Run with PM2 for 24/7 uptime
5. Configure DNS (e.g., dynv6 for free dynamic DNS)

### Weather Station Data Ingestion

Configure your datalogger to POST data to:
```
https://your-server.com/api/weather-data
```

See `examples/crbasic/stratus_http_post_station.cr1x` for CRBasic example.

---

## Support

For additional help:
- Campbell Scientific Support: campbellsci.com/support
- Lukas Esterhuizen (esterhuizen2k@proton.me) (Developer)
