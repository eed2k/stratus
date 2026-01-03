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

### CR200/CR200X Serial & Modem Setup

**Supported Methods:**
- Direct Serial (RS232, null modem cable)
- Modem (GSM, cellular, or dial-up)

**Serial Connection:**
- Use a 9-pin null modem cable or direct RS232 cable from the CR200(X) to your PC or a USB-to-Serial adapter.
- In Stratus, set:
   - Connection Type: Serial
   - COM Port: (e.g., COM3)
   - Baud Rate: Match logger (default 9600 or 115200)
   - PakBus Address: Match logger
- On the logger, set matching baud rate and PakBus address in Device Config Utility.

**Modem Connection:**
- Connect a compatible modem (e.g., Campbell CELL200, Sierra Wireless, or standard AT-command modem) to the CR200(X) RS232 port.
- In Stratus, set:
   - Connection Type: Serial (for direct dial) or TCP/IP (for cellular modems with IP)
   - COM Port: (for direct serial modem)
   - Phone Number: (for dial-up)
   - APN: (for cellular, if required)
   - PakBus Address: Match logger
- Stratus will:
   - Initialize the modem using AT commands
   - Dial the configured number (for dial-up)
   - Wait for CONNECT
   - Start PakBus or Modbus protocol over the serial stream

**How Stratus Handles Modem Connections:**
- Stratus backend (see gsmAdapter.ts, connectionManager.ts) manages modem negotiation:
   - Sends AT commands to configure and dial
   - Waits for CONNECT response
   - On connection, switches to PakBus/Modbus protocol for data collection
   - Handles disconnection and retries automatically
- For cellular modems with IP, use TCP/IP connection as above.

**Troubleshooting:**
- Ensure baud rate and PakBus address match on both sides
- Use null modem cable for direct serial
- For modems, verify SIM card, APN, and signal
- Check Stratus logs for connection and AT command errors

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
- Color-coded by wind speed according to WMO/Beaufort scale:
  - Light blue: Calm/Light (0-6 km/h)
  - Sky blue: Light Breeze (6-12 km/h)
  - Blue: Gentle Breeze (12-20 km/h)
  - Deep blue: Moderate (20-29 km/h)
  - Dark blue: Fresh (29-39 km/h)
  - Green: Strong (39-50 km/h)
  - Yellow: Near Gale (50-62 km/h)
  - Orange: Gale (62-75 km/h)
  - Red: Strong Gale (75-89 km/h)
  - Dark red: Storm+ (>89 km/h)
- Statistics: Average, Max, Min speed, Dominant direction
- Interactive tooltips showing exact values

#### Wind Compass
Real-time wind direction and speed display with compass rose.

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

**Conversion Formula:**
```
QNH = Station_Pressure × (1 - (L × altitude) / T)^(-(g × M) / (R × L))
```

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

### Dashboard Export

Export the complete dashboard as a multi-page PDF report:

1. Click the **Export** button in the dashboard header
2. Select **Save as PDF**
3. The system will:
   - Capture the full dashboard with white background
   - Split content across multiple A4 pages
   - Add station name, date, and page numbers
   - Generate a downloadable PDF file

**Note:** Image export (PNG) has been removed in favor of the more comprehensive PDF export which captures the entire dashboard across multiple pages.

---

## 24/7 Remote Access Setup

### Cloudflare Tunnel Configuration

For public internet access to your Stratus server:

1. **Install cloudflared:**
   ```powershell
   winget install Cloudflare.cloudflared
   ```

2. **Run setup script:**
   ```powershell
   # As Administrator
   cd scripts
   .\setup-cloudflare-tunnel.ps1 -Domain "yourdomain.com" -InstallService
   ```

3. **Configure 24/7 operation:**
   ```powershell
   .\setup-production-24-7.ps1
   ```

4. **Verify status:**
   ```powershell
   .\setup-production-24-7.ps1 -CheckStatus
   ```

### Weather Station Data Ingestion

Configure your datalogger to POST data to:
```
https://api.yourdomain.com/api/weather-data
```

See `examples/crbasic/stratus_http_post_station.cr1x` for CRBasic example.

---

## Support

For additional help:
- Campbell Scientific Support: campbellsci.com/support
- Lukas Esterhuizen (esterhuizen2k@proton.me) (Developer)