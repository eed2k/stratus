# Stratus Weather Server

## Professional Weather Station Management Software

Stratus is a professional desktop and server application for weather station management, data collection, and real-time monitoring. Built with modern web technologies, Stratus provides comprehensive weather data visualization and analysis capabilities.

> **CLOUD DEPLOYMENT NOTE**
> Stratus is designed for cloud deployment on Railway or similar platforms.
> All connections use TCP/IP - serial/RS232 connections are not available.

---

## Features & Capabilities

### Weather Station Integration

- **Multi-Protocol Support** - PakBus, HTTP/REST, MQTT, Modbus
- **Multi-Connection Types** - TCP/IP, WiFi, Cellular (4G/LTE), LoRaWAN, Satellite
- **Data Collection** - Scheduled and on-demand data collection from stations
- **Real-Time Monitoring** - Live data updates with configurable refresh intervals
- **Multi-Station Support** - Manage multiple stations from a single dashboard

### Supported Hardware

**Campbell Scientific Dataloggers:**
- CR1000X, CR1000, CR6, CR3000
- CR800, CR850, CR300
- CR200X series

**Other Platforms:**
- Arduino IoT Cloud compatible devices
- ESP32/ESP8266 WiFi stations
- Davis Vantage series
- Generic HTTP/MQTT stations
- Custom industrial sensors via Modbus

### Communication Options

- **TCP/IP** - Ethernet, WiFi via NL121 or similar
- **Cellular** - 4G/LTE modems with TCP gateway
- **LoRa/LoRaWAN** - Long-range IoT connectivity via network server
- **Satellite** - Remote area connectivity via IP gateway
- **HTTP API** - Direct REST API integration

---

## Real-Time Monitoring Dashboard

### Live Weather Display

- Real-time weather data visualization with auto-refresh
- Connection health monitoring
- Data validation with automatic quality control checks
- Configurable alerts & alarms for data thresholds

### Measured Parameters

**Atmospheric:**
- Temperature (°C/°F)
- Relative Humidity (%)
- Barometric Pressure (hPa/mbar)
- Dew Point (°C/°F)
- Air Density (kg/m³)

**Wind:**
- Wind Speed (km/h, m/s, mph, knots)
- Wind Direction (degrees, compass)
- Wind Gust (instantaneous maximum)
- Wind Power Density (W/m²)

**Solar:**
- Solar Radiation (W/m²)
- UV Index
- Photosynthetically Active Radiation (PAR)
- Sunshine Duration

**Precipitation:**
- Rainfall (mm/inch)
- Rain Rate (mm/hr)
- Daily/Monthly/Yearly Totals

**Soil (Agriculture):**
- Soil Temperature at multiple depths
- Soil Moisture (volumetric water content)
- Leaf Wetness

**Air Quality:**
- PM2.5 and PM10 particulate matter
- CO2 concentration
- Atmospheric visibility

**System:**
- Battery voltage and charge status
- Solar panel voltage
- Logger internal temperature

---

## Solar Position Tracking

Real-time solar position calculated from station coordinates:

- **Sun Elevation** - Degrees above/below horizon (-90° to +90°)
- **Sun Azimuth** - Degrees from north (0° to 360°)
- **Nautical Dawn/Dusk** - When sun is 12° below horizon
- **Sunrise/Sunset** - Actual rise and set times
- **Solar Noon** - Time of maximum sun elevation
- **Day Length** - Hours of daylight

*Calculations use NOAA solar position algorithms with millisecond precision.*

---

## Air Density Calculation

Real-time air density calculated from:
- Temperature (°C)
- Barometric Pressure (hPa)
- Relative Humidity (%)

Uses the ideal gas law with humidity correction. Standard reference: 1.225 kg/m³ at sea level, 15°C.

---

## Barometric Pressure

Dual display showing:

1. **Station Pressure** - Raw pressure at station altitude (hPa)
2. **Sea Level Pressure (QNH)** - Pressure calibrated to mean sea level (hPa)

The sea level correction uses the hypsometric equation accounting for station altitude and temperature.

---

## Reference Evapotranspiration (ETo)

Calculated using the **FAO Penman-Monteith method** (FAO-56 standard), the internationally recognized standard for agricultural water management:

**Required Inputs:**
- Air temperature
- Relative humidity
- Wind speed at 2m height
- Solar radiation
- Station altitude
- Station latitude

**Outputs:**
- Instantaneous ETo rate (mm/hr)
- Daily ETo (mm/day)
- Weekly cumulative ETo (mm)
- Monthly cumulative ETo (mm)

*Essential for irrigation scheduling, crop water requirements, and agricultural planning.*

---

## Battery Monitoring

Comprehensive battery status monitoring:

- Current voltage display (V)
- Visual status indicator (Critical/Low/Fair/Good/Excellent)
- Charge percentage estimation
- 24-hour voltage history chart

**Voltage Thresholds (12V systems):**
- 🔴 Critical: < 11.5V
- 🟠 Low: 11.5V - 12.0V
- 🟢 Good: 12.0V - 13.5V
- ⚡ Charging: > 13.5V

---

## Wind Analysis (WMO/Beaufort Scale)

### Wind Rose Charts

Traditional wind direction frequency distribution showing:
- **Wind Rose (Last 60 min)** - Recent wind patterns
- **Wind Rose (Today)** - Daily wind direction distribution
- **Wind Rose (Yesterday)** - Previous day comparison

Each rose displays direction frequency with speed-coded segments using official WMO/Beaufort scale colors.

### Wind Speed Scatter Plots

Individual wind speed observations plotted on polar coordinates:
- **Wind Speed (Last 30 min)** - Recent observations
- **Wind Speed (Today)** - All today's observations
- **Wind Speed (Yesterday)** - Previous day observations

**Features:**
- Points plotted by direction (angle) and speed (radius)
- Color-coded by WMO/Beaufort scale:

| Beaufort | Description | km/h | Color |
|----------|-------------|------|-------|
| 0 | Calm | < 1 | Light Blue |
| 1 | Light Air | 1-6 | Sky Blue |
| 2 | Light Breeze | 6-12 | Blue |
| 3 | Gentle Breeze | 12-20 | Cyan |
| 4 | Moderate | 20-29 | Deep Blue |
| 5 | Fresh | 29-39 | Green |
| 6 | Strong | 39-50 | Yellow-Green |
| 7 | Near Gale | 50-62 | Yellow |
| 8 | Gale | 62-75 | Orange |
| 9 | Strong Gale | 75-89 | Red |
| 10 | Storm | 89-103 | Dark Red |
| 11 | Violent Storm | 103-118 | Maroon |
| 12 | Hurricane | > 118 | Black-Red |

- Statistics: Average, Max, Min speed, Dominant direction
- Interactive tooltips with exact values

### Wind Compass

Real-time wind direction and speed display with animated compass rose and direction arrow.

### Wind Power Analysis

Wind energy potential calculations for renewable energy assessment:
- Wind Power Density (W/m²)
- Available wind energy based on air density and wind speed cubed

---

## Fire Danger Index

McArthur Forest Fire Danger Index (FFDI) calculation for fire weather monitoring:

**Input Parameters:**
- Temperature (°C)
- Relative Humidity (%)
- Wind Speed (km/h)
- Drought Factor

**Danger Categories:**
- 🟢 Low: 0-12
- 🟡 Moderate: 12-25
- 🟠 High: 25-50
- 🔴 Very High: 50-75
- ⚫ Extreme: > 75

---

## Data Management

### Local Database

- **SQLite Storage** - All data stored locally for complete offline access
- **Data Export** - Export to CSV, JSON formats
- **Historical Charts** - Interactive charts with zoom and pan
- **Data Retention** - Configurable retention policies

### Dashboard Export

Export the complete dashboard as a professional multi-page PDF report:

1. Click the **Export** button in the dashboard header
2. Select **Save as PDF**
3. The system will:
   - Capture the full dashboard with print-optimized styling
   - Split content across multiple A4 pages
   - Add station name, date, and page numbers
   - Generate a downloadable PDF file

---

## Interactive Charts

### Weather Time Series

- Temperature, humidity, pressure trends
- Wind speed and direction history
- Solar radiation curves
- Precipitation accumulation

### Data Block Charts

Condensed multi-parameter display showing recent values with mini-sparklines.

### Heat Maps

24-hour × 7-day matrix showing parameter variations by time of day and day of week.

---

## Station Map

Interactive OpenStreetMap integration showing:
- Station location marker
- Coordinates display
- Altitude indicator
- Click-to-set location for new stations

---

## Settings & Configuration

### Display Units

| Parameter | Options |
|-----------|---------|
| Temperature | Celsius, Fahrenheit |
| Wind Speed | km/h, m/s, mph, knots |
| Pressure | hPa, mbar, inHg, mmHg |
| Precipitation | mm, inches |
| Solar Radiation | W/m², MJ/m²/day |

### Dashboard Configuration

- Configurable auto-refresh interval (5s to 60min)
- Chart time range selection (1hr to 7 days)
- Enable/disable individual parameter cards
- Light and Dark theme support

### Data Quality Settings

- Minimum/Maximum bounds checking
- Rate-of-change limits
- Stuck sensor detection
- Gap filling options

---

## Deployment Options

### Desktop Application

- Windows installer (EXE)
- Single-user local deployment
- No internet connection required
- All data stored locally

### Server Deployment

- Docker container support
- Railway, Render, or self-hosted
- Multi-user web access
- Remote station monitoring

### Remote Access

- Cloudflare Tunnel integration for secure public access
- Custom domain support
- Auto-restart Windows services for 24/7 reliability
- HTTPS encryption

---

## Technical Specifications

### Technology Stack

- **Frontend:** React, TypeScript, Tailwind CSS, Recharts
- **Backend:** Node.js, Express, SQLite
- **Desktop:** Electron for native Windows application
- **Maps:** Leaflet with OpenStreetMap tiles
- **PDF Export:** jsPDF with html2canvas

### System Requirements

**Desktop:**
- Windows 10/11 (64-bit)
- 4GB RAM minimum
- 100MB disk space
- USB port for serial connections

**Server:**
- Node.js 18+
- 512MB RAM minimum
- SQLite or PostgreSQL database

---


