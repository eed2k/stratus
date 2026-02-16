Stratus Weather Station

Version 1.1.0
Developer: Lukas Esterhuizen
Contact: esterhuizen2k@proton.me

A professional web application for Campbell Scientific weather station management, data collection, and real-time monitoring.

---

Live Demo: https://stratusweather.co.za

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
- Barometric Pressure - Dual display showing station level and sea level QNH (hPa)
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

Security Features

- Rate Limiting - Protection against brute force attacks on login and password reset
- Secure JWT Tokens - Cryptographically signed tokens with environment-configurable secrets
- Password Hashing - bcrypt with configurable salt rounds
- Input Validation - Zod schema validation on all API endpoints
- HTTPS Enforcement - TLS encryption for all traffic
- Session Management - Secure session handling with automatic recovery
- Audit Logging - Comprehensive logging of security-relevant events

---

User Management

- Admin and User Roles - Admins have full access, users view assigned stations only
- Station Assignment - Assign specific stations to individual users
- User Invitation System - Invite users via email with secure setup links
- Password Reset - Self-service password reset via email (rate limited)
- Secure Authentication - bcrypt password hashing
- Session Management - Secure tokens with proper expiration

---

Email Notifications

Stratus supports email notifications via MailerSend:

- User Invitations - Send email invitations to new users with password setup links
- Password Reset - Self-service password reset emails
- Alarm Notifications - Email alerts when alarm thresholds are triggered
- Professional HTML Templates - Branded email templates with clear instructions

---

Calculated Metrics

The dashboard calculates and displays derived meteorological values:

- Dew Point - Calculated via Magnus formula from temperature and humidity when not reported by the station
- Sea Level Pressure (QNH) - Adjusted from station pressure and altitude using the hypsometric equation
- Air Density - From temperature, pressure, and humidity (used throughout wind energy calculations)
- Reference Evapotranspiration (ETo) - FAO Penman-Monteith method (FAO-56 standard)
- Wind Power Density - Energy available in wind (W/m²) using station-specific air density
- Cumulative Wind Energy Potential - Daily kWh/m² with proper time-interval integration
- Fire Danger Index - McArthur FFDI/GFDI based on temperature, humidity, and wind speed
- Heat Index / Wind Chill - Apparent temperature calculations
- Trend Analysis - Absolute difference comparison of current values versus historical average

---

Shared Dashboards

- Public Sharing - Generate shareable links for stations
- Password Protection - Optional password for shared dashboards
- Expiration Control - Set expiry dates for shared links
- View-Only Access - Shared users see data without editing capabilities

---

Hosting

Stratus Weather Station is designed for cloud VPS deployment for 24/7 availability.

- Recommended: Vultr, Hetzner, Linode, DigitalOcean
- 1-2 vCPU, 2-4 GB RAM sufficient
- Docker containerized deployment
- PostgreSQL database (Neon serverless supported)
- Automatic restart on failure

---

Environment Variables

Required environment variables for deployment:

```
# Database (Required)
DATABASE_URL=postgresql://user:password@host/database

# Security (Required in production)
CLIENT_JWT_SECRET=<generate with: openssl rand -hex 32>
APP_BASE_URL=https://yourdomain.com

# Email (MailerSend)
MAILERSEND_API_KEY=your_api_key
MAILERSEND_FROM_EMAIL=noreply@yourdomain.com
MAILERSEND_ALERTS_EMAIL=alerts@yourdomain.com

# Dropbox Integration (optional)
DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REFRESH_TOKEN=your_refresh_token
DROPBOX_FOLDER_PATH=/CR300/Data

# Admin Account
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=secure_password
ADMIN_FIRST_NAME=Admin
ADMIN_LAST_NAME=User
```

---

Credits

Developed by Lukas Esterhuizen (esterhuizen2k@proton.me)

Campbell Scientific and PakBus are trademarks of Campbell Scientific, Inc.
