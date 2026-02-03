Stratus Weather Station

Version 1.0.0
Developer: Lukas Esterhuizen
Contact: esterhuizen2k@proton.me

A professional web application for Campbell Scientific weather station management, data collection, and real-time monitoring.

---

Access Stratus: https://stratus.dynv6.net

Server IP: 129.151.183.183

---

Campbell Scientific Integration

- PakBus Protocol Support - Native implementation of Campbell Scientific's PakBus protocol
- Multi-Connection Types - TCP/IP, Cellular (4G/LTE), LoRaWAN, HTTP POST, Dropbox sync
- Data Collection - Scheduled and on-demand data collection from datalogger tables
- Clock Synchronization - Automatic and manual clock sync with stations
- Supported Dataloggers: CR1000X, CR1000, CR6, CR3000, CR800, CR850, CR300, CR200X

---

Real-Time Monitoring Dashboard

- Live Dashboard - Real-time weather data visualization with auto-refresh
- Solar Position Tracking - Sun elevation, azimuth, nautical dawn/dusk calculations
- Air Density Calculations - Real-time air density from temperature, pressure, humidity
- Reference Evapotranspiration - FAO Penman-Monteith ETo calculations
- Barometric Pressure - Dual display showing station level and sea level QNH
- Battery Monitoring - Logger battery voltage with status indicators
- Fire Danger Index - Real-time fire risk assessment
- Connection Health - Monitor connection status and data freshness
- Alerts and Alarms - Configurable alerts for data thresholds
- Data Staleness Detection - Visual warnings when live data stops flowing

---

Wind Analysis (WMO/Beaufort Scale)

- Wind Rose Charts - Traditional wind direction frequency distribution (60 min, 24h, 48h periods)
- Wind Speed Scatter Plots - Individual wind observations on polar chart with color-coded speed classes
- Wind Compass - Real-time wind direction and speed display with cardinal directions
- Wind Power Analysis - Wind energy potential and power density calculations

---

Dashboard Features

- Quick Time Range Selection - Buttons for 1h, 6h, 12h, 24h, 48h, and 7d data views
- Auto-Adjusting Sections - Dashboard automatically hides charts when data fields are unavailable
- Interactive Charts - Temperature, humidity, pressure, solar radiation, rainfall history
- Station Map - OpenStreetMap integration showing station location
- Current Conditions Card - All current readings at a glance with last update time

---

Data Sources

Stratus supports multiple data ingestion methods:

- Direct Connection (PakBus) - Real-time connection to Campbell Scientific dataloggers
- HTTP POST - Datalogger pushes data directly to Stratus server endpoint
- Dropbox Integration - Automatic import from Dropbox folders (ideal for cellular modems uploading to cloud)
- Manual File Import - Upload TOA5 CSV files for bulk historical data import

---

Data Management

- PostgreSQL Database - All weather data stored with full historical access
- Historical Charts - View and analyze data across configurable time ranges
- Report Generation - Export data to CSV and PDF formats
- Compliance Tracking - Calibration records, data quality flags, certifications

---

User Management

- Admin and User Roles - Admins have full access, users view assigned stations only
- Station Assignment - Assign specific stations to individual users
- Secure Authentication - PBKDF2 password hashing with automatic legacy migration
- Session Management - Secure tokens with proper expiration

---

Calculated Metrics

The dashboard calculates and displays derived meteorological values:

- Dew Point - From temperature and humidity
- Sea Level Pressure (QNH) - Adjusted from station pressure and altitude
- Air Density - From temperature, pressure, and humidity
- Reference Evapotranspiration (ETo) - FAO Penman-Monteith method
- Wind Power Density - Energy available in wind (W/m squared)
- Fire Danger Index - Based on temperature, humidity, and wind speed
- Heat Index / Wind Chill - Apparent temperature calculations

---

Shared Dashboards

- Public Sharing - Generate shareable links for stations
- Password Protection - Optional password for shared dashboards
- Expiration Control - Set expiry dates for shared links
- View-Only Access - Shared users see data without editing capabilities

---

Hosting

Stratus Weather Station is designed for cloud VPS deployment for 24/7 availability.

- Recommended: Hetzner CX22, Linode, DigitalOcean, or Vultr
- 1-2 vCPU, 2-4 GB RAM sufficient
- Continuous operation with PM2 process manager
- Automatic restart on failure

---

Credits

Developed by Lukas Esterhuizen (esterhuizen2k@proton.me)

Campbell Scientific and PakBus are trademarks of Campbell Scientific, Inc.
