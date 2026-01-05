# Stratus Weather Server

## Professional Weather Station Management Software

Stratus is a professional desktop application for Campbell Scientific weather station management, data collection, and real-time monitoring using the PakBus protocol.

---

## Features & Capabilities

### Campbell Scientific Integration

- **PakBus Protocol Support** - Native implementation of Campbell Scientific's PakBus protocol
- **Multi-Connection Types** - Serial (RS232/RS485), TCP/IP, GSM modems, LoRa, RF407
- **Data Collection** - Scheduled and on-demand data collection from datalogger tables
- **Program Management** - Upload, download, and manage CRBasic programs
- **File Operations** - Browse, transfer, and manage datalogger files
- **Clock Synchronization** - Automatic and manual clock sync with stations

### Supported Dataloggers

- CR1000X, CR1000
- CR6
- CR3000
- CR800, CR850
- CR300
- CR200X

### Communication Options

- **Serial** - RS232, RS485 direct connection
- **TCP/IP** - Ethernet, WiFi via NL121 or similar
- **RF** - RF407/RF412 spread spectrum radios
- **Cellular** - CELL200 series modems
- **LoRa** - Long-range IoT connectivity

---

## Real-Time Monitoring Dashboard

### Live Weather Display

- Real-time weather data visualization
- Connection health monitoring
- Data validation with automatic QC checks
- Alerts & alarms for data thresholds and connection issues

### Solar Position Tracking

The dashboard displays real-time solar position calculated from station coordinates:

- **Sun Elevation** - Degrees above/below horizon (-90° to +90°)
- **Sun Azimuth** - Degrees from north (0° to 360°)
- **Nautical Dawn/Dusk** - When sun is 12° below horizon
- **Sunrise/Sunset** - Actual rise and set times
- **Day Length** - Hours of daylight

*Calculations use NOAA solar position algorithms.*

### Air Density

Real-time air density calculated from:
- Temperature (°C)
- Pressure (hPa)
- Relative Humidity (%)

Uses the ideal gas law with humidity correction. Standard reference: 1.225 kg/m³ at sea level.

### Barometric Pressure

Dual display showing:

1. **Station Pressure** - Raw pressure at station altitude (hPa)
2. **Sea Level Pressure (QNH)** - Pressure calibrated to sea level (hPa)

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

## Wind Analysis (WMO/Beaufort Scale)

### Wind Rose Charts

Traditional wind direction frequency distribution showing:
- **Wind Rose (Last 60 min)** - Recent wind patterns
- **Wind Rose (Today)** - Daily wind direction distribution
- **Wind Rose (Yesterday)** - Previous day comparison

Each rose displays direction frequency with speed-coded segments using WMO/Beaufort scale colors.

### Wind Speed Scatter Plots

Individual wind speed observations plotted on a polar coordinate system:
- **Wind Speed (Last 30 min)** - Recent observations with tight clustering
- **Wind Speed (Today)** - All today's observations
- **Wind Speed (Yesterday)** - Previous day observations

**Features:**
- Points plotted by direction (angle) and speed (radius)
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

### Wind Compass

Real-time wind direction and speed display with compass rose.

### Wind Power Analysis

Wind energy potential calculations for assessment purposes.

---

## Data Management

### Local Database

- **SQLite Storage** - All data stored locally for offline access
- **Data Export** - Export to CSV, JSON, or connect to external databases
- **Historical Charts** - View and analyze historical weather data
- **Backup & Restore** - Backup station configurations and data

### Dashboard Export

Export the complete dashboard as a multi-page PDF report:

1. Click the **Export** button in the dashboard header
2. Select **Save as PDF**
3. The system will:
   - Capture the full dashboard with white background
   - Split content across multiple A4 pages
   - Add station name, date, and page numbers
   - Generate a downloadable PDF file

---

## Station Setup

### Adding a Station

1. **Open Station Manager** - Click `Station → Add Station` or press `Ctrl+N`

2. **Enter Basic Information**
   - Station Name: Descriptive name (e.g., "Main Campus Weather")
   - PakBus Address: Match datalogger setting (typically 1-4094)

3. **Configure Connection**
   
   **For Serial:**
   - Connection Type: Serial
   - COM Port: Select from dropdown
   - Baud Rate: 115200 (default)
   
   **For TCP/IP:**
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

6. **Save Station** - Click "Add Station"

### Data Collection Setup

**Automatic Collection:**
1. Select Station from the list
2. Go to Data Collection tab
3. Configure Schedule:
   - Table: Select table name (e.g., "WeatherData")
   - Interval: Collection frequency (e.g., every 5 minutes)
   - Mode: Most Recent or Since Last Collection
4. Enable Collection - Toggle "Enable Automatic Collection"

**Collection Modes:**
- **Most Recent Records** - Collects latest N records (good for real-time monitoring)
- **Since Last Collection** - Collects all new records since last time (ensures no data gaps)
- **Specific Range** - Collect records between dates/record numbers

---

## Remote Access (Cloudflare Tunnel)

### 24/7 Public Access Features

- Secure HTTPS access via Cloudflare Tunnel
- Custom domain support (e.g., api.yourdomain.com)
- Auto-restart Windows services for reliability

### Setup

```powershell
# Run as Administrator
cd scripts

# 1. Initial tunnel setup
.\setup-cloudflare-tunnel.ps1 -Domain "yourdomain.com" -InstallService

# 2. Configure 24/7 production mode
.\setup-production-24-7.ps1

# 3. Check status
.\setup-production-24-7.ps1 -CheckStatus
```

### Endpoints

- **Dashboard**: `https://yourdomain.com`
- **API**: `https://api.yourdomain.com`
- **Data Ingestion**: `https://api.yourdomain.com/api/weather-data`

---

## Settings & Configuration

### User Preferences

- **Temperature Unit** - Celsius or Fahrenheit
- **Wind Speed Unit** - km/h, m/s, mph, knots
- **Pressure Unit** - hPa, mbar, inHg, mmHg
- **Precipitation Unit** - mm or inches
- **Theme** - Light or Dark mode

### Notification Settings

- Email notifications for alerts
- Push notifications
- Configurable temperature and wind thresholds

### Data Processing Rules

**Scaling:**
- Scale Factor and Offset configuration
- Sensor-specific calibration coefficients

**Quality Control:**
- Min/Max bounds checking
- Rate-of-change limits
- Stuck sensor detection

---

## Troubleshooting

### Connection Issues

| Problem | Solution |
|---------|----------|
| Connection Timeout | Check physical connection, verify IP/port, ensure datalogger is powered |
| Invalid Security Code | Verify code matches datalogger, check security level setting |
| PakBus Address Not Found | Verify address matches, check for conflicts, ensure port is enabled |
| COM Port Not Found | Check USB cable, install/update drivers, verify in Device Manager |
| Communication Error | Verify baud rate, check cable wiring (TX/RX crossover) |

### Data Collection Issues

| Problem | Solution |
|---------|----------|
| Table Not Found | Verify table name in program, refresh table definitions |
| No New Data | Check datalogger scan interval, verify data is being logged |
| Host Unreachable | Check network connectivity, verify IP address, check firewall |
| Connection Refused | Verify PakBus/TCP is enabled, check port number (default 6785) |

---

## Best Practices

### Connection Reliability
- Use static IP addresses when possible
- Configure reasonable timeout values
- Enable automatic reconnection

### Data Integrity
- Use "Since Last Collection" mode for critical data
- Configure gap filling
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

## About

**Stratus Weather Server**  
Version 1.0.0

**Developer:** Lukas Esterhuizen  
**Contact:** esterhuizen2k@proton.me  
**License:** MIT

Campbell Scientific and PakBus are trademarks of Campbell Scientific, Inc.

---

*For additional help, visit Campbell Scientific Support at campbellsci.com/support*
