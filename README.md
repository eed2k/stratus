Stratus Weather Server

Version 2.1.0
Developer: Lukas Esterhuizen
Contact: esterhuizen2k@proton.me

A professional, multi-vendor web application for weather station management, data collection, and real-time monitoring. Stratus connects to Campbell Scientific dataloggers and a range of IoT/cloud weather platforms, then turns raw observations into rich meteorological, agricultural, aviation, fire-risk and wind-energy analytics.

---

Station & Protocol Support

Stratus is no longer Campbell-only. It ingests data from many station types through a unified protocol manager:

- Campbell Scientific (PakBus) - Native PakBus implementation over TCP/IP, Cellular (4G/LTE), and LoRaWAN
  - Supported dataloggers: CR1000X, CR1000, CR6, CR3000, CR800, CR850, CR300, CR200X, Aspen 10
- RikaCloud (v2 API) - Session-based login with automatic farm/device discovery, polled every 30 minutes
- Arduino IoT Cloud - OAuth2 client-credentials access to Thing properties
- CampbellCloud / Konect - Campbell Scientific cloud service
- WeatherLink Cloud (Davis) - Davis Vantage Pro2 / Vue via the WeatherLink API
- Blynk IoT and ThingSpeak - Generic IoT platform polling
- OpenWeatherMap - Reference/comparison data
- Generic HTTP/REST and MQTT endpoints for custom loggers (ESP32, ESP8266, Raspberry Pi Pico W, etc.)

Connection methods:

- Direct PakBus connection (TCP/IP, 4G/LTE, LoRaWAN)
- HTTP POST - Datalogger pushes data to a Stratus ingest endpoint
- Cloud API polling - RikaCloud, Arduino IoT, CampbellCloud, WeatherLink, Blynk, ThingSpeak
- Dropbox sync - Automatic import from Dropbox folders (ideal for cellular modems uploading to cloud storage)
- MQTT subscription - Broker-based IoT messaging
- Manual file import - Upload TOA5 CSV files for bulk historical data

Stratus also supports automatic clock synchronization and scheduled/on-demand data collection for Campbell dataloggers.

---

Real-Time Monitoring Dashboard

- Live Dashboard - Real-time weather visualization with auto-refresh and data-freshness indicators
- Configurable Layout - Per-user dashboard configuration panel to show/hide and reorder cards
- Auto-Adjusting Sections - Cards and charts hide automatically when their data fields are unavailable
- Current Conditions - All current readings at a glance with last-update time
- Station Map - OpenStreetMap integration showing station location
- Connection Health - Connection status, data freshness, and staleness warnings
- Alarms - Configurable threshold alarms with optional email notifications
- Quick Time Ranges - 1h, 6h, 12h, 24h, 48h, and 7d views
- Interactive Charts - Temperature, humidity, pressure, solar radiation, and rainfall history

---

Meteorological & Derived Metrics

Stratus computes a large set of derived values from raw observations:

- Dew Point - Magnus formula when not reported by the station
- Sea Level Pressure (QNH) - Hypsometric adjustment from station pressure and altitude (RIKA stations that report SLP directly are handled in reverse)
- Air Density - From temperature, pressure, and humidity
- Density Altitude - With METAR-style flight-category classification
- Reference Evapotranspiration (ETo) - FAO-56 Penman-Monteith
- Water Balance - Rainfall versus ETo
- Heat Index / Wind Chill / Feels-Like - Apparent temperature calculations
- Heat Stress (WBGT) - Wet Bulb Globe Temperature
- Atmospheric Stability - Pasquill-Gifford stability class
- Air Quality Index - AQI from PM2.5 / PM10 (e.g. RIKA particulate sensors)
- Rainfall Intensity & Yearly Totals - With per-station cumulative-counter offset correction
- Weather Trend Analysis - Current values versus historical average

Agriculture:

- Growing Degree Days (GDD) - Accumulated heat units for crop modeling
- Chill Units - Accumulated cold-hours for dormancy/fruiting models

Fire risk:

- Lowveld Fire Danger Index (LFDI) - Official SAWS/Namibia AFIS formula: (BI + WF) x RCF
- Fuel moisture estimation and component fire-danger scoring

---

Wind Analysis & Wind Energy

- Wind Rose Charts - Direction-frequency distribution over 60 min, 24h, 48h periods
- Wind Speed vs Gust (24h) - Fixed 24-hour comparison chart
- Wind Speed Scatter - Polar plot with color-coded speed classes
- Wind Compass - Real-time direction and speed with cardinal labels
- Beaufort Scale - WMO Beaufort classification of current wind
- Crosswind / Headwind - Runway-relative components for aviation
- Turbulence Intensity - From wind-speed standard deviation
- Wind Power Density - Available wind energy (W/m²) using station-specific air density
- Cumulative Wind Energy Potential - Daily kWh/m² with time-interval integration
- Weibull Distribution - Fitted wind-speed distribution
- Annual Energy Production (AEP) - Estimated turbine yield from the Weibull fit

---

Solar & Power Monitoring

- Solar Position Tracking - Sun elevation, azimuth, nautical dawn/dusk
- Solar Radiation - Incoming shortwave with history
- Solar Power Harvest - Estimated harvestable solar energy
- MPPT Charger Monitoring - Solar charge-controller telemetry
- Battery Monitoring - Logger battery voltage with LiFePO4 status and charging detection

---

Reports & Data Export

- History & Analysis - View and analyze data across configurable time ranges
- Report Generation - Export to CSV and PDF (server-side PDF with charts, wind roses, summary tables)
- Scheduled Reports - Password-protected /reports portal; daily/weekly/monthly schedules run via node-cron and email PDF reports
- Stratus Digest - Optional scheduled plain-text/HTML digest email (station status, alarms, temperature, rainfall, wind)
- Data Completeness - Coverage metrics highlighting gaps in the record

---

Calibration & Compliance

- Calibration Management - Track calibration records, due dates, and resolution presets (e.g. rainfall tipping-bucket resolution)
- Per-Station Rainfall Offsets - Suppress phantom rain from cumulative counters that pre-date integration
- Compliance Tracking - Data quality flags and certifications
- Audit Logging - Comprehensive logging of security-relevant events

---

Monitoring & Notifications

Email delivery is handled via MailerSend:

- User Invitations - Email invites with secure setup links
- Password Reset - Self-service reset emails (rate limited)
- Alert Notifications - Email alerts when alert thresholds trigger
- Staleness / Downtime Monitor - Optional admin alerts when a station stops sending data
  - Disabled by default (STALENESS_ALERTS_ENABLED=false); enable explicitly per deployment
- Scheduled Reports & Digest - Automated PDF/text emails on a cron schedule
- Professional HTML Templates - Branded, clearly worded messages

---

Shared Dashboards

- Public Sharing - Generate shareable links for stations
- Compact Dashboards - Optional single-screen share links (no scrolling) with primary metric tiles, 1h and 24h wind roses, and live temperature/humidity and battery/solar charts. Ideal for TVs, monitors and laptops
- Password Protection - Optional password for shared dashboards
- Expiration Control - Set expiry dates for shared links
- View-Only Access - Shared viewers cannot edit

---

Security Features

- Rate Limiting - Protection against brute-force login and password-reset attempts
- Secure JWT Tokens - Cryptographically signed tokens with environment-configurable secrets
- Password Hashing - bcrypt with configurable salt rounds
- Input Validation - Zod schema validation on API endpoints
- HTTPS Enforcement - TLS for all traffic
- Session Management - Secure sessions with automatic recovery
- Audit Logging - Security-event logging

---

User Management

- Admin and User Roles - Admins have full access; users see only assigned stations
- Station Assignment - Assign specific stations to individual users
- User Invitation System - Invite via email with secure setup links
- Password Reset - Self-service reset via email (rate limited)
- Account Settings - Self-service profile and password management

---

Hosting

Stratus is designed for cloud VPS deployment for 24/7 availability.

- Recommended: Vultr, Hetzner, Linode, DigitalOcean
- 1-2 vCPU, 2-4 GB RAM sufficient
- Docker containerized deployment (Traefik reverse proxy)
- PostgreSQL database (Neon serverless supported; SQLite supported for local development)
- Automatic restart on failure

---

Environment Variables

Key environment variables (see .env.example for the full annotated list):

```
# Database (Required)
DATABASE_URL=postgresql://user:password@host:port/database

# Server
PORT=5000
NODE_ENV=production

# Security (Required in production)
CLIENT_JWT_SECRET=<generate with: openssl rand -hex 32>
APP_BASE_URL=https://yourdomain.com

# Admin Account (Required in production)
STRATUS_ADMIN_EMAIL=admin@example.com
STRATUS_ADMIN_PASSWORD=<strong-password>
STRATUS_ADMIN_NAME=Admin User

# Email (MailerSend - optional)
MAILERSEND_API_KEY=your_api_token
MAILERSEND_FROM_EMAIL=noreply@yourdomain.com
MAILERSEND_FROM_NAME=Stratus Weather
MAILERSEND_ALERTS_EMAIL=alerts@yourdomain.com

# Scheduled Digest (optional, requires MailerSend)
DIGEST_ENABLED=true
DIGEST_RECIPIENT=recipient@yourdomain.com
DIGEST_CRON=0 8 * * 1,5   # Mon/Fri 08:00 (Africa/Johannesburg)

# Staleness / Downtime Monitor (optional, disabled by default)
STALENESS_ALERTS_ENABLED=false
STALENESS_CHECK_INTERVAL=900000   # 15 min
STALENESS_THRESHOLD=7200000       # 2 h
STALENESS_COOLDOWN=21600000       # 6 h

# Dropbox Integration (optional)
DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REFRESH_TOKEN=your_refresh_token
DROPBOX_FOLDER_PATH=/CR300/Data
```

---

Project Structure

```
client/             React frontend (Vite + TypeScript + Tailwind)
  src/
    components/     UI components (dashboard cards, charts, station setup, sidebar)
    pages/          Route pages (Dashboard, History, Reports, Alarms, Calibration, Settings, ...)
    hooks/          Custom React hooks (useAuth, useMobile)
    lib/            Utility functions and constants
server/             Express backend (TypeScript)
  campbell/         PakBus protocol and datalogger management
  compliance/       Audit and compliance routes
  parsers/          TOA5/Campbell data parsers
  protocols/        Protocol manager + HTTP/LoRa adapters (Rika, Arduino, Campbell, WeatherLink, ...)
  services/         Dropbox sync, email, staleness monitor, report scheduler, digest, PDF, calibration
  shares/           Shared dashboard routes
  station-setup/    Connection validation, service detection, integration service
shared/             Shared types and utilities
  utils/            Calculation functions (LFDI, solar, ETo, air density, AQI, WBGT, Weibull, AEP, ...)
assets/             Application icons
deploy/             Deployment scripts and Docker config
scripts/            Dropbox auth and documentation generation
docs/               User documentation
examples/           CRBasic example programs
```

---

Tech Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts
- Backend: Express, TypeScript, Drizzle ORM, node-cron
- Database: PostgreSQL (Neon serverless supported), SQLite for local development
- Email: MailerSend
- Deployment: Docker, Traefik reverse proxy

---

Credits

Developed by Lukas Esterhuizen (esterhuizen2k@proton.me)

Campbell Scientific and PakBus are trademarks of Campbell Scientific, Inc. RIKA, Davis Instruments, Arduino, and other product names are trademarks of their respective owners.
