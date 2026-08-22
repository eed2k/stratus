# Requirements Document

## Introduction

This feature adds client-facing operational reporting, station metadata
management, improved live telemetry visualisation, and a storm-activity display
to the Lightning Detection System admin panel, and closes a gap in the
detector's heartbeat telemetry.

The target codebase is the multi-tenant admin panel in the `LDS ADMIN` folder
(the current integrated version), not the older single-tenant `admin_panel`.
In this panel, Stratus platform staff log in to a platform panel, create client
panels (tenants), and each client login has limited access confined to its own
tenant. The panel is served as a subdomain under stratusweather.co.za; client
panels are addressed by URL path segment (`/<slug>`) and isolated by
`tenant_id`.

Today the detector performs automatic calibration (temperature-compensated RC
oscillator recalibration and a daily antenna resonance check at 06:00 SAST), and
the panel receives hourly heartbeats carrying CPU temperature. However:

- Clients cannot obtain a periodic (monthly) record of system health, calibration
  activity, uptime, and lightning activity for audit and operational purposes.
- The live CPU chart is a static, pure-Python inline SVG rather than an
  interactive, configurable chart.
- The detector never transmits CPU load, so the panel's load series is always empty
  (the `cpu_load_pct` column exists but stays null until the unit reports it).
- Heartbeat telemetry is pruned after a short rolling window, which is insufficient
  for monthly reporting.
- Station identity has a per-tenant `site_name` but no geographic coordinates, and
  no per-station metadata to place on reports.
- Lightning energy values are recorded but never explained; there is no legend that
  describes what the relative energy scale means.

The goal is to deliver two downloadable PDF reports (a technical system/health
report and a polished client summary report), a station metadata section in the
panel, an interactive and explainable CPU chart built with Recharts, and a
storm-activity visualisation with an energy legend, inspired by Astrogenic
NexStorm/StormVue. All new capabilities respect tenant isolation. A final
documentation pass reconciles the PPTX/datasheet claims against actual behaviour,
including confirming SMS-only alerting.

## Hardware and Design Constraints

- The AS3935 sensor reports estimated **distance only**; it does **not** provide
  bearing/azimuth. Any storm visualisation uses distance range-rings and strike
  pulses, not a directional radar plot.
- The AS3935 **energy** value is a 21-bit **relative, dimensionless** number in the
  range 0 to 2,097,151. It is not calibrated to Joules, Watts, or Amperes, cannot
  be converted to absolute units, and is only meaningful for relative comparison
  within the same installation. The manufacturer flags energy above roughly
  1,000,000 (about 50 percent of full scale) as high intensity / elevated fire risk.
- The shipped alert channel is **SMS only** (via the panel's SMS sender). Legacy
  WhatsApp/email columns exist in the schema but are not live in this deployment.
- **Multi-tenant**: the panel isolates clients by `tenant_id`. Reads use the existing
  `scope()` / `scoped_get()` helpers so no query crosses a tenant boundary. Platform
  admins may act across tenants; client users are confined to their own tenant.
- **Routing**: the panel is served at a stratusweather.co.za subdomain, and client
  panels are path-based (`/<slug>`). Giving each client its own subdomain is a
  separate routing change and is out of scope for this feature.
- The panel is server-rendered (FastAPI + Jinja2) with a strict
  Content-Security-Policy (`script-src 'self'`). Any JavaScript charting or
  animation must be self-hosted to avoid CSP violations.
- No PDF or plotting library is currently a dependency. Introducing a PDF engine is
  a new dependency; if it needs system libraries, the Dockerfile must be updated.
- Detector CPU temperature thresholds are WARN 70 C and CRITICAL 78 C.
- All timestamps are handled in SAST (UTC+2).

## Report Presentation Rules (applies to all generated reports)

- Reports SHALL be generated as PDF.
- Report body text SHALL use the Arial typeface.
- Report language SHALL be South African English spelling.
- Report text SHALL NOT contain em dashes; use hyphens or restructured sentences.
- Charts, graphs, and illustrations SHALL be high-resolution vector artwork.
- Reports SHALL follow the visual theme of the admin panel and Stratus (colours,
  logo, typography) while keeping any HTML used in generation minimal.
- Layout SHALL be professional with consistent, generous spacing and alignment.
- Every report SHALL display the site name and geographic coordinates of the station.
- WHERE lightning energy is shown THEN reports SHALL include a short explanation that
  energy is a relative, dimensionless scale, not an absolute physical measurement.

## Glossary

- **SAST**: South African Standard Time (UTC+2), used throughout the system.
- **Platform admin**: A Stratus staff login (`is_platform_admin`) that can enter any
  tenant panel and manage the tenant list.
- **Client user**: A login confined to one tenant, with role admin, operator, or viewer.
- **Tenant**: A client with its own panel at `/<slug>`, isolated by `tenant_id`.
- **Heartbeat**: Hourly liveness POST from the detector to the panel carrying telemetry.
- **Calibration event**: A temperature-compensated RC recalibration or a daily antenna
  resonance check/adjustment performed by the detector.
- **Station**: A single detector unit identified by its `station_id`, owned by a tenant.
- **Station metadata**: Per-station attributes such as site label and coordinates.
- **Energy value**: The AS3935 21-bit relative, dimensionless signal-strength number
  (0 to 2,097,151) associated with a detected strike.
- **Energy band**: A named intensity range (for example low, moderate, high, extreme)
  derived from the relative energy scale for display and legend purposes.

## Requirements

### Requirement 1: Technical system and health report (PDF)

**User Story:** As a client safety/compliance officer, I want a monthly technical
report per station, so that I have an auditable record of system health and
calibration activity.

#### Acceptance Criteria

1. WHEN a monthly technical report is generated THEN the system SHALL produce a PDF
   covering one calendar month in SAST for a chosen station within the current tenant.
2. WHEN the report is generated THEN it SHALL include system uptime/availability
   derived from heartbeat continuity for the period.
3. WHEN the report is generated THEN it SHALL include CPU temperature statistics
   (minimum, maximum, average) and a count of readings that crossed the WARN (70 C)
   and CRITICAL (78 C) thresholds.
4. WHEN the report is generated THEN it SHALL include calibration activity for the
   period, including temperature-compensated recalibration count and daily antenna
   frequency check results, including any `tune_cap` adjustments.
5. WHEN the report is generated THEN it SHALL include lightning strike statistics for
   the period (total events, closest approach, distribution by distance, and
   distribution by energy band).
6. IF a station has no data for the requested month THEN the report SHALL clearly
   indicate that no data was recorded rather than failing.

### Requirement 2: Client summary report (PDF)

**User Story:** As a logged-in client user, I want a polished monthly summary report,
so that I can review system performance and lightning activity in a presentable format.

#### Acceptance Criteria

1. WHEN a client summary report is generated THEN the system SHALL produce a PDF
   covering one calendar month in SAST for a chosen station within the current tenant.
2. WHEN the report is generated THEN it SHALL include a monthly system specifications
   summary, uptime/availability, and a lightning activity overview.
3. WHEN the report is generated THEN it SHALL present data using high-resolution
   vector charts, graphs, and illustrations.
4. WHEN the report is generated THEN it SHALL display the site name and geographic
   coordinates prominently.
5. WHEN lightning activity is shown THEN it SHALL include an energy legend that
   explains the energy bands and states that energy is a relative, dimensionless scale.
6. WHEN the report is generated THEN it SHALL apply the report presentation rules
   (Arial, South African English, no em dashes, Stratus/admin theme, minimal HTML,
   professional spacing).
7. WHERE lightning activity is shown THEN it SHALL be expressed in distance terms only
   (no bearing), consistent with sensor capability.

### Requirement 3: Report access, download, and tenant isolation

**User Story:** As a logged-in user, I want to download reports for my own panel, so
that I can share them with clients and auditors without exposing other clients' data.

#### Acceptance Criteria

1. WHEN an authenticated user opens the reports area THEN the system SHALL list
   available reports for the current tenant by station, month, and report type.
2. WHEN a user selects a report THEN the system SHALL provide it as a downloadable PDF.
3. WHEN a report or its underlying data is requested THEN the system SHALL enforce
   tenant scoping so a user cannot access another tenant's report or data.
4. WHEN an unauthenticated request is made to any report endpoint THEN the system SHALL
   reject it and redirect to login.
5. WHERE on-demand report generation is exposed THEN only client admin or operator
   roles (or a platform admin) SHALL be permitted to trigger it.
6. WHERE a viewer-role client user opens the reports area THEN the user SHALL be able
   to download reports for their tenant, subject to the panel's existing demo-data
   filtering rules.
7. WHERE a platform admin enters a tenant panel THEN the platform admin SHALL be able
   to list, generate, and download that tenant's reports.

### Requirement 4: Station metadata management (site name and coordinates)

**User Story:** As an admin, I want to manage per-station metadata such as a site label
and coordinates, so that reports and displays identify the site accurately.

#### Acceptance Criteria

1. WHEN an authorised user opens the station metadata section THEN the system SHALL
   allow entry and editing of a site label, latitude, and longitude for each station
   within the current tenant.
2. WHEN coordinates are entered THEN the system SHALL validate latitude is between -90
   and 90 and longitude is between -180 and 180, rejecting invalid input with a message.
3. WHEN station metadata is saved THEN reports and displays for that station SHALL use
   the saved site label and coordinates.
4. IF a station has no site label THEN the system SHALL fall back to the tenant
   `site_name`, and then to the `station_id`, and SHALL indicate when coordinates are
   not set.
5. WHERE metadata editing is exposed THEN only client admin or operator roles (or a
   platform admin) SHALL be permitted to change it, protected by CSRF and tenant scope.

### Requirement 5: Interactive, explainable CPU chart (Recharts)

**User Story:** As an operator, I want an interactive CPU chart with selectable
timeframes and clear explanations, so that I can inspect thermal and load trends.

#### Acceptance Criteria

1. WHEN the dashboard loads for a station with telemetry THEN the system SHALL render
   an interactive CPU temperature chart using the Recharts library.
2. WHEN a user hovers over a data point THEN the chart SHALL show the timestamp and
   the CPU temperature value.
3. WHEN CPU load data is available THEN the chart SHALL display it as a second series.
4. WHEN a user selects a timeframe THEN the chart SHALL update to show that period; the
   system SHALL offer configurable timeframes (for example 24 hours, 7 days, 30 days).
5. WHEN the chart is displayed THEN it SHALL include explanatory context (axis labels,
   legend, and threshold reference lines for WARN 70 C and CRITICAL 78 C).
6. WHEN a station has no telemetry in the window THEN the chart SHALL show a clear
   empty/collecting-data state rather than a broken render.
7. WHEN the chart is served THEN it SHALL comply with the panel's Content-Security-Policy
   (self-hosted assets, no CDN/inline script violations).
8. WHEN chart data is fetched THEN it SHALL be tenant-scoped to the current panel.
9. WHERE the interactive chart cannot load THEN the dashboard SHALL still render the
   rest of the page without error.

### Requirement 6: Detector CPU load telemetry

**User Story:** As a system integrator, I want the detector to report CPU load in its
heartbeat, so that the panel chart and reports reflect real load data.

#### Acceptance Criteria

1. WHEN the detector sends an hourly heartbeat THEN it SHALL include a `cpu_load_pct`
   value alongside `cpu_temp_c`.
2. WHEN the panel receives a heartbeat containing `cpu_load_pct` THEN it SHALL persist
   it to the `heartbeat_samples` time-series.
3. IF CPU load cannot be read on the device THEN the detector SHALL omit or null the
   field without failing the heartbeat.
4. WHEN an older detector that does not send `cpu_load_pct` posts a heartbeat THEN the
   panel SHALL continue to accept it (backward compatible).

### Requirement 7: Telemetry retention for monthly reporting

**User Story:** As an operator, I want telemetry retained long enough to build monthly
reports, so that reports are complete.

#### Acceptance Criteria

1. WHEN heartbeat samples are stored THEN the system SHALL retain sufficient history to
   produce a complete report for at least the two most recent calendar months.
2. WHEN old telemetry is pruned THEN the system SHALL NOT delete data still required by
   the retention window in criterion 1.
3. WHERE retention is increased THEN the system SHALL bound table growth so the database
   does not grow without limit.

### Requirement 8: Storm-activity visualisation with energy legend (Astrogenic-inspired)

**User Story:** As an operator, I want an engaging storm-activity display on the
dashboard, so that recent lightning activity and its intensity are easy to grasp.

#### Acceptance Criteria

1. WHEN the dashboard loads THEN the system SHALL render a storm-activity display that
   shows recent strikes for the current tenant on distance range-rings relative to the
   station.
2. WHEN a new in-range strike is recorded THEN the display SHALL animate a strike pulse
   at the appropriate distance ring.
3. WHEN a strike is displayed THEN its pulse SHALL be colour-coded by energy band
   derived from the 21-bit relative energy scale.
4. WHEN the display is shown THEN it SHALL include an energy legend that names the
   energy bands and states that energy is a relative, dimensionless scale (not Joules
   or Watts), with the high-intensity marker consistent with the manufacturer guidance.
5. WHERE ambient/background animation is used THEN it SHALL be a subtle cloud/storm
   style consistent with the admin panel and Stratus theme, professionally laid out
   with good spacing, and SHALL not obscure data.
6. WHEN strikes are displayed THEN they SHALL be positioned by distance only, with a
   clear note that bearing/direction is not measured by the sensor.
7. WHEN the visualisation is served THEN it SHALL comply with the panel's
   Content-Security-Policy (self-hosted assets only).
8. WHERE the visualisation cannot load or a user prefers reduced motion THEN the
   dashboard SHALL degrade gracefully to a static distance view.

### Requirement 9: PPTX/datasheet reconciliation

**User Story:** As a sales/engineering owner, I want the presentation and datasheet
claims to match actual system behaviour, so that we do not misrepresent the product.

#### Acceptance Criteria

1. WHEN the reporting and chart features are complete THEN the PPTX/datasheet content
   SHALL be reviewed against the detector code and admin-panel behaviour.
2. WHEN a discrepancy is found THEN it SHALL be documented with the correct value from
   the code (for example detection thresholds, calibration cadence, CPU WARN/CRIT
   temperatures, and alert channels actually implemented).
3. WHEN alert channels are described THEN the material SHALL state SMS-only alerting for
   this deployment and remove or clearly mark WhatsApp/email as not included.
4. WHERE energy is described THEN the material SHALL describe it as a relative,
   dimensionless scale consistent with the AS3935 energy values documentation.

### Requirement 10: Reliability and non-regression

**User Story:** As an operator, I want the new features to not disrupt existing
alerting or tenant isolation, so that lightning detection remains dependable and secure.

#### Acceptance Criteria

1. WHEN report generation runs THEN it SHALL NOT block or delay lightning alert dispatch.
2. WHEN the new endpoints, chart, and visualisation are added THEN existing platform and
   client panel pages (dashboard, events, recipients, groups, settings, tenants) SHALL
   continue to function unchanged.
3. WHEN report generation encounters an error THEN it SHALL fail gracefully and log the
   error without crashing the panel.
4. WHEN new JavaScript or assets are added THEN they SHALL be self-hosted and SHALL NOT
   require relaxing the existing Content-Security-Policy beyond serving local assets.
5. WHEN any new data access is added THEN it SHALL preserve tenant isolation using the
   existing scoping helpers so no client can read another client's data.
