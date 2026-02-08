# Stratus Weather Server

## Professional Weather Station Management Software

Stratus is a professional desktop and server application for weather station management, data collection, and real-time monitoring. Built with modern web technologies, Stratus provides comprehensive weather data visualization and analysis capabilities.

> **CLOUD DEPLOYMENT NOTE**
> Stratus can be deployed on cloud platforms (Hetzner, Linode, DigitalOcean, Vultr, etc.) or self-hosted.
> All connections use TCP/IP - serial/RS232 connections are not available in cloud deployments.

---

## Features & Capabilities

### Weather Station Integration

- **Multi-Protocol Support** - PakBus, HTTP/REST, LoRaWAN
- **Multi-Connection Types** - TCP/IP, WiFi, Cellular (4G/LTE), LoRaWAN
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
- Generic HTTP stations

### Communication Options

- **TCP/IP** - Ethernet, WiFi via NL121 or similar
- **Cellular** - 4G/LTE modems with TCP gateway
- **LoRa/LoRaWAN** - Long-range IoT connectivity via network server
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
- Barometric Pressure (hPa)
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

## Dew Point Calculation

When the station does not report dew point directly, Stratus calculates it automatically using the **Magnus formula**:

- Inputs: Temperature (°C) and Relative Humidity (%)
- Constants: a = 17.625, b = 243.04°C
- Formula: Td = b × [ln(RH/100) + aT/(b+T)] / [a − ln(RH/100) − aT/(b+T)]

This provides accurate dew point values (±0.4°C) for temperatures between −45°C and +60°C.

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
- Wind Power Density (W/m²) using station-specific air density
- Gust Power Density (W/m²) from peak wind gusts
- Cumulative Daily Energy Potential (kWh/m²) with proper time-interval integration
- Air density calculated from live temperature, pressure, and humidity (not hardcoded)

---

## Weather Map

Interactive weather forecast map powered by the Windy API:

- **Temperature Overlay** - Colour-coded surface temperature map
- **Wind Overlay** - Animated wind flow visualisation with speed colours
- **GFS Model** - Global Forecast System (NOAA) weather model
- **Location Search** - Search any location by name with geocoding
- **7-Day Forecast** - Hourly charts for temperature, wind, dew point, precipitation, and pressure

Access via the **Weather** page in the sidebar.

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
- **Historical Charts** - Interactive charts with zoom and pan
- **Data Retention** - Configurable retention policies

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
| Pressure | hPa, inHg, mmHg |
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
- Cloud platforms (Hetzner, Linode, DigitalOcean, Vultr, etc.) or self-hosted
- Multi-user web access
- Remote station monitoring

### Remote Access

- Cloud deployment for secure public access
- Custom domain support with dynv6 or similar DNS
- Auto-restart services with PM2 for 24/7 reliability
- HTTPS encryption (with reverse proxy)

---

## Technical Specifications

### Technology Stack

- **Frontend:** React, TypeScript, Tailwind CSS, Recharts
- **Backend:** Node.js, Express, SQLite
- **Desktop:** Electron for native Windows application
- **Maps:** Leaflet with OpenStreetMap tiles

### System Requirements

**Desktop:**
- Windows 10/11 (64-bit)
- 4GB RAM minimum
- 100MB disk space

**Server:**
- Node.js 18+
- 512MB RAM minimum
- SQLite or PostgreSQL database

---


