Stratus Weather Server

Version 2.2.1
Developer: Lukas Esterhuizen
Contact: esterhuizen2k@proton.me

Stratus, all software forming part of Stratus, and all associated hardware
designs are the property of METRON (PTY) LTD | Inteltronics. All rights
reserved.

A professional, multi-vendor web application for weather station management, data collection, and real-time monitoring. Stratus connects to Campbell Scientific dataloggers and a range of IoT/cloud weather platforms, then turns raw observations into rich meteorological, agricultural, aviation, fire-risk and wind-energy analytics.

---

Station & Protocol Support

This section is deliberately split into what is running against real hardware
today and what is implemented and mapped but not yet in service here, because the
difference matters when you are choosing how to connect a station.

In production use, exercised against real hardware:

- Campbell Scientific (PakBus) over TCP/IP - native PakBus implementation, including clock sync and scheduled or on-demand collection
  - Supported dataloggers: CR300, CR310, CR350, CR1000, CR1000X, CR1000Xe
- Dropbox sync - watches a folder and ingests a logger export whenever it changes. This is how the cellular sites actually deliver data: the logger writes to Dropbox and Stratus reads it. Read-only; Stratus never writes to your Dropbox
- HTTP POST ingest - the station pushes readings to a per-station endpoint
- Manual file import - TOA5 or CSV upload for bulk history
- RIKA cloud (v2 API) - session login with farm/device discovery, polled every 30 minutes to match the vendor's own update rate

On the RIKA poll specifically: the device endpoint is intermittently slow, and a
half-hourly poll means a single slow response used to cost a full half-hour of
data. Transient faults (timeouts, connection resets, transient DNS, and the busy
gateway statuses 429/502/503/504) are now retried three times with backoff inside
a budget that cannot overlap the next poll. Conditions that would fail identically
on a retry, such as bad credentials, are surfaced immediately instead. A
successful read also clears the last-error line on the settings panel, which
previously persisted through every later healthy poll because it was only ever
cleared when a station reconnected.

Vendor-mapped, implemented but not in production use here:

Each of these has its own response parser and field mapping in
`server/protocols/httpAdapter.ts`, including the unit conversions the vendor's
own units require. They are not bare REST endpoints.

- Arduino IoT Cloud - OAuth2 client-credentials against Thing properties. Properties are matched by name onto temperature, humidity, pressure, wind speed and direction, gust, rainfall, solar radiation, UV, dew point, battery, soil temperature and moisture, PM2.5, PM10 and CO2
- Stratus Logger - Metron's own datalogger board, reporting over LoRa or Sigfox. The LoRa uplink decoder and the generic MQTT/HTTP REST path exist for this board; the hardware design lives in `StratusLoggerV1[metron]/`
- WeatherLink (Davis) - authenticated with an API key and secret, sensor blocks mapped per sensor, with Fahrenheit to Celsius, inches of mercury to hPa and miles per hour to metres per second applied
- CampbellCloud - bearer token, Campbell field names (`AirTemp_C`, `RH`, `BP_mbar`, `WS_ms`, `WD`, `WS_max`, `Rain_mm`, `Solar_Wm2`, `BattV`) mapped to the canonical fields
- ThingSpeak - channel feeds, `field1` through `field8` mapped in the conventional order
- Blynk - token in the query string, virtual pins `V0` through `V5` mapped in order
- OpenWeatherMap - key sent as `appid`, `units=metric` requested when the endpoint does not already specify it, station pressure (`grnd_level`) preferred over the sea-level value, wind direction taken from `wind.deg`, precipitation from the one or three hour rain or snow total, and temperature normalized whether the endpoint returns Celsius, Fahrenheit or Kelvin

One gap, stated plainly rather than implied: bulk station **discovery**
against Campbell Cloud is not implemented. `fetchCampbellStations` raises an
explicit error telling you to use a direct PakBus connection. Collecting data
from a Campbell Cloud endpoint you configure yourself does work, per the mapping
above; it is only the "list every station on the account for me" step that is
absent.

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

Navigation:

The sidebar is text only, with no icons, and every section is permanently
expanded: no disclosure arrows and nothing to collapse. Every destination stays
visible in the same place on every visit, so the menu can be navigated from
memory rather than by opening things to look inside. Indentation carries the
grouping.

Order runs from live monitoring, through what you produce from the data, to
configuration:

1. Active Stations (the landing page, and where every session starts)
2. AS3935 - admin panel, lightning demo, information centre
3. Forecast - overview, dashboard, accuracy
4. Data and Reports - historical export, report generation, report scheduling
5. Settings - station setup, user management, alerts, system settings
6. About Stratus

Chart styling is shared across the estate. The lightning console is Python with
no bundler, but it vendors the same chart library and mirrors the Stratus
conventions (dashed grid at low opacity, no tick marks, no axis lines, matching
stroke weights and the same palette from `shared/chartColors.ts`), so moving
between the two consoles does not feel like moving between two products.

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

Nano-Climate Forecast

A separate service at forecast.stratusweather.co.za. Pure-Python FastAPI with
server-rendered SVG, no bundler, capped at 320 MB.

The method is a station's own record CORRECTING a model background, which is why
it is called nano-climate rather than a forecast feed. A mesoscale model knows a
front arrives on Thursday; it does not know this mast sits in a hollow that pools
cold air. The station record is the part that knows.

- Model background - Vaisala Xweather, on by default for a new station with all nine engine variables. Nothing is fetched until a station has coordinates, so an unpositioned station cannot spend the access budget
- Station history - harmonic climatology, damped anomaly persistence and an analog ensemble over a rolling 35-day window. Data older than that does not enter a forecast; the window is deliberate, so a season-old regime cannot dominate the current one
- Learned site correction - `adaptive.py`. A decaying average per station, variable, provider, lead bucket and time-of-day bucket, updated from the station's own verified forecasts
- Verification - MAE, bias, CRPS, rank histograms and reliability diagrams, scored against the station's own observations, with a method-version hash so a change of method is visible rather than averaged into the history

On the learned correction, measured rather than claimed. Across eight months of
Quaggasklip's record, over identical base hours with and without it, at lead
1-24h: solar radiation error fell 17 percent, humidity 2 percent, pressure and
temperature 1 percent each, wind direction unchanged, and wind speed and gust
each rose about 2 percent. It only acts where an offset is a meaningful share of
the error, which is why it declines to touch a variable whose error is mostly
scatter. Rainfall is excluded outright: its error is intermittency, not offset,
and shifting every hour by a learned millimetre invents drizzle on dry days.

Backfilling is how a new station gets a skill history without waiting: forecasts
are re-issued from past base hours using only the data that existed before each
one, so they can be scored immediately. Issued oldest first, which makes a
backfill with the correction enabled a walk-forward test rather than a claim.

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

Lightning Detection System (LDS)

A separate but linked subsystem: an AS3935 lightning sensor on a Raspberry Pi
Zero W reporting into a multi-tenant FastAPI console (Lightning Alert Console
v1.0), deployed alongside Stratus behind the same Traefik proxy.

Detector (Raspberry Pi Zero W + AS3935):

- SPI-attached AS3935 franklin lightning sensor with startup calibration self-check
- Hourly heartbeat plus an immediate ping on every in-range strike, reporting CPU temperature and load
- Low-power configuration: HDMI, Bluetooth and onboard LEDs disabled, CPU governor tuned
- USB gadget ethernet on a fixed address, so a card with no working wifi is still recoverable over the single USB cable
- Provisioned by cloud-init from the SD card boot partition (see `RPiZero SD Card/`)

Admin console:

- Multi-tenant: each client gets its own panel at `/<slug>/`, with a platform-level management console at the root for creating clients and assigning newly-reporting detectors
- Recipients, groups and per-tenant alert configuration with an alert cooldown
- SMS alerts via Clickatell, with a master on/off switch. The gateway is platform infrastructure and is not exposed in client panels
- Monthly PDF reports (WeasyPrint) with vector charts: CPU trend, distance histogram, energy bands, uptime gauge and storm activity
- Event history with per-event delivery detail

Detector provisioning:

A detector files itself under the platform tenant on its first heartbeat and is
invisible to every client panel until an admin assigns it on the platform
console's Detectors page. That is deliberate rather than incidental: an unclaimed
unit has no owning client, so there is no recipient list to consult and no alert
is sent for it. Assigning a unit also re-files its strike history, heartbeat
samples and calibration records, so a client is not handed a live detector whose
past begins on the day of the handover.

Who can see what:

- Stratus Admin may enter any panel. The session is not pinned for them, so their effective tenant follows the URL
- A client login is pinned to its own tenant. A mismatch between the cookie, the user record and the URL is treated as not-signed-in for that panel rather than an error that would confirm the panel exists
- A client admin sees every login in their own panel and may add and remove them
- An operator sees operator and viewer logins only, never administrators, and has no add or remove controls. Knowing which accounts hold admin rights is the useful half of an attack on them
- A viewer sees no login list, matching how the panel already treats a read-only account elsewhere

Creating a login sends nothing. There is no outbound mail path in this console at
all, which a test enforces by asserting no mail library is importable anywhere in
the package: an operator is created with a password the admin chooses and is told
by whatever means the client prefers. Adding an SMS recipient likewise sends no
confirmation message to that number.

POPIA: a recipient's number is masked to its country prefix and last two digits
before it reaches a log, because container logs are rotated to disk, swept into
backups and read by platform staff who have no relationship with the client's
staff. The full number stays in the message log the client is entitled to see on
their own event page, scoped to their tenant.

Storm activity display:

Recorded strikes are grouped into five proximity bands, nearest first, each drawn
as a small cumulonimbus that flashes more often the busier the band. The block
under each cloud gives the strike count with the peak, mean and lowest intensity
recorded in that band.

- Distance bands: `<= 1 km` (overhead), `< 10 km`, `< 20 km`, `< 30 km`, `30-40 km`
- Selectable window from 1 h to 24 h
- Energy bands (Low / Moderate / High / Extreme) are quarters of the sensor's 21-bit full scale

Two measurement caveats are stated on the display itself rather than left to the
reader to discover:

- The AS3935 measures distance but **not bearing**. Nothing in the display is placed in a compass direction, because any angle would be invented. This is why the view is a proximity ordering and not a map.
- Reported "energy" is a relative sensor value for comparing strikes with each other. It is not joules, and it is not calibrated to any physical unit.

Distance is reported in 15 discrete steps at a manufacturer-rated accuracy of
+/- 4 km, so a strike can legitimately land in an adjacent band.

The band aggregation lives in one place, `LDS ADMIN/app/metrics.py::distance_band_summary`.
Both the live dashboard (`/data/strikes`) and the PDF renderer
(`charts.py::storm_bands_svg`) consume it, so the panel and the report cannot
disagree about how many strikes fell in each band.

---

Reports & Data Export

- History & Analysis - View and analyze data across configurable time ranges
- Report Generation - Export to CSV and PDF (server-side PDF with charts, wind roses, summary tables)
- Scheduled Reports - Password-protected /reports portal; daily/weekly/monthly schedules run via node-cron and email PDF reports
- Stratus Digest - Optional scheduled plain-text/HTML digest email (station status, alarms, temperature, rainfall, wind)
- Data Completeness - Coverage metrics highlighting gaps in the record

How a PDF report is laid out:

Page one is ordered so the document identifies itself before it presents any
figures, and so a reader who only wants the numbers never has to page past the
artwork to reach them.

1. Title: `<Station> Weather Data Report | <period>`
2. Site details, one fact per line and no bullets: location, coordinates, elevation in metres AMSL, and the reporting period as absolute dates
3. Two views of the site side by side, each half the text width, both pinned at the station: a close satellite frame for mast surroundings and exposure, and a wider street map for roads and nearby settlements
4. The min / average / maximum / total statistics table

The period appears twice on purpose. The title carries the relative wording
("Last 30 days"), which is what an operator asks for but which stops being true
once the PDF is filed; the details block carries the absolute dates that keep an
archived report self-describing.

The map pin is placed from fractional Web Mercator tile coordinates, so it lands
on the mast rather than at the centre of the fetched tile block. Both frames come
from the same Esri host, which means one egress rule and one tile scheme. Imagery
is never load-bearing: if the tiles cannot be fetched the table simply moves up
the page, because a report missing its site photograph is still a usable report.

There is no heading above the statistics table. It used to repeat the station name
and period already given in the title, and the table's own column headers say what
the columns are. A table continuing onto another page is still marked, so a reader
landing mid-table knows what they are looking at.

Report text is plain regular Arial throughout, in black. No grey, no bold, and no
em or en dashes anywhere in the output.

---

Calibration & Compliance

- Calibration Management - Track calibration records, due dates, and resolution presets (e.g. rainfall tipping-bucket resolution)
- Per-Station Rainfall Offsets - Suppress phantom rain from cumulative counters that pre-date integration
- Compliance Tracking - Data quality flags and certifications
- Audit Logging - Comprehensive logging of security-relevant events

Rainfall interpretation, and why it is configured rather than guessed:

CRBasic programs and cloud vendors record rain in incompatible ways, and the same
number means different things depending on which. A per-interval field holds the
rain for that scan and must be summed. A cumulative counter holds a running depth
and must be differenced. Reading one as the other does not fail loudly; it
silently returns a plausible but wrong total.

So each station carries an explicit `rainfall_type` in `station_calibration`,
maintained from the admin calibration page, and every totalling path reads it:

- `incremental` - sum the values
- `cumulative_yearly` / `cumulative_lifetime` - sum the positive steps, rejecting counter resets and single-sample glitches larger than any real interval of rain
- `tip_count` - multiply raw tips by the station's `tipFactor`

`auto` remains only as a fallback heuristic for a station nobody has configured,
and it is genuinely unreliable on a fast logger: a one-minute per-interval field
that returns to zero between showers looks enough like a counter to be misread.
Measured on Quaggasklip over 30 days, the heuristic reported 14.5 mm where the
configured incremental reading gives 26.3 mm, which is what a direct SQL sum of
the field confirms. Configure the station.

Because that lookup is synchronous against an in-memory snapshot, an empty
snapshot is indistinguishable from "no calibration" at the call site. Report
rendering therefore awaits the snapshot load before totalling anything, so a
report generated moments after a restart cannot quietly take the fallback path.

Field totals are computed server-side with SQL over the full range, never from the
decimated series a chart is drawn from. Decimation drops records, and for an
accumulating quantity a dropped record is dropped rain.

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
- Content Security Policy - The LDS console runs under `script-src 'self'` with no exceptions: chart bundles are vendored rather than pulled from a CDN, and there are no inline scripts
- Secret Scanning - `python deploy/scan_secrets.py` checks every file git could commit (tracked plus non-ignored untracked) for credentials, and exits non-zero on a finding. Run it before pushing
- Not Indexed, Anywhere - every surface refuses search engines on every response type, not only on its HTML. A meta tag reaches a crawler that parses markup; it does nothing for a JSON endpoint, a generated PDF, a chart image or a redirect. So `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate` is set by the server on all five surfaces, backed by a meta tag on the pages and a `robots.txt` on every host. Shared dashboard links are covered by the same header

TLS is issued and renewed by Traefik alone, from its own ACME store. Nothing else
on the host may hold a certificate for these names: a second ACME client cannot
succeed, because Traefik owns ports 80 and 443, and every failed validation it
makes counts against Let's Encrypt's per-hostname failure limit for the same
names Traefik has to renew. A leftover certbot installation was doing exactly
that and is now disabled and masked.

Credentials are kept out of the repository by design. Anything holding a real
secret is gitignored and shipped as a `.example` template instead: the detector's
cloud-init files (wifi PSK, user password hash) and every `.env` variant. A
credential committed once stays recoverable from git history even after the file
is deleted, so the safer default is never to commit it.

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
deploy/             Deployment scripts, Docker config, backups, secret scanner
scripts/            Dropbox auth and documentation generation

forecast/           Nano-climate forecast service (separate deployment)
  app/              FastAPI + Jinja2, server-rendered SVG charts, no bundler
    engine.py       Blending, harmonics and the analog ensemble
    adaptive.py     Learned per-site bias correction (see below)
    plain.py        Plain-language outlook (day cards and sentences)
    providers/      NWP adapters (Xweather only) and the per-variable opt-in
  tests/            pytest suite
  README.md         What it is, which models it uses, how to read it

info-centre/        Static documentation site (nginx)
lightning-demo/     Static lightning demo site (nginx)
Beacon/             Pilot-light/beacon controller for the lightning system
Emulator/           Bench emulator for the AS3935 detector (Arduino + Pi)
BeagleBone/         Kiosk that boots a BBB into a wall dashboard over HDMI

StratusLoggerV1[metron]/  Stratus Logger hardware design (KiCad): the in-house
                          datalogger board, LoRa/Sigfox uplink
AS3935/             Lightning detector (Pi Zero W + AS3935) firmware
AS3935handheld/     Handheld lightning detector hardware design (KiCad)
RPiZero SD Card/    Detector boot partition: service, installer, config.txt with
                    SPI enabled and the low-power options, cloud-init templates
                    as *.example (the real files hold credentials and are
                    gitignored), and FLASH_FROM_SCRATCH.md

LDS ADMIN/          Lightning Alert Console (FastAPI, separate deployment)
  app/
    routes/         Web pages, JSON data endpoints, detector ingest API
    templates/      Jinja2 templates (server-rendered, no SPA)
    static/         style.css, app.js, js/cpu-chart.js, js/storm-view.js
    metrics.py      Energy bands, distance bands, uptime, coordinate validation
    charts.py       Vector SVG builders shared by the dashboard and the PDFs
    reports.py      Monthly report assembly
  tests/            pytest suite (runs on the workstation, not in the prod image)

localhost-preview/  Standalone HTML previews for iterating on visualizations
                    without deploying
```

---

Tech Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts
- Backend: Express, TypeScript, Drizzle ORM, node-cron
- Database: PostgreSQL (Neon serverless supported), SQLite for local development
- Email: MailerSend
- Deployment: Docker, Traefik reverse proxy
- Lightning console: Python 3, FastAPI, SQLAlchemy, Jinja2, WeasyPrint, pytest
- Detector: Raspberry Pi Zero W, Raspberry Pi OS, spidev, systemd, cloud-init

---

Ownership and Licensing

Stratus, every part of the software in this repository, and all associated
hardware designs are the property of **METRON (PTY) LTD | Inteltronics**. All
rights reserved.

This includes, without limitation:

- The Stratus Weather Server web application, its API and its database schema
- The nano-climate forecast service in `forecast/`
- The Lightning Alert Console in `LDS ADMIN/` and the AS3935 detector firmware
- The Stratus Logger datalogger board design in `StratusLoggerV1[metron]/`, the handheld detector design in `AS3935handheld/`, and the Beacon controller
- All documentation, deployment tooling and configuration in this repository

Every hardware source file carries the same header naming METRON (PTY) LTD |
Inteltronics as owner: the detector, the beacon, the emulator, the BeagleBone
kiosk and their installers. The web estate is covered by this file.

No part may be copied, distributed, modified or used to produce a derivative
work without the written permission of METRON (PTY) LTD | Inteltronics.

---

Credits

Developed by Lukas Esterhuizen (esterhuizen2k@proton.me) for
METRON (PTY) LTD | Inteltronics.

Campbell Scientific and PakBus are trademarks of Campbell Scientific, Inc. RIKA,
Arduino, Davis WeatherLink, Blynk, ThingSpeak, OpenWeatherMap, Vaisala, Xweather,
Dropbox, MailerSend and other product names are trademarks of their respective
owners. Naming a product here describes an interface Stratus can talk to; it does
not imply any endorsement or partnership.
