# Implementation Plan

- [x] 1. Set up test infrastructure and pure helper functions
- [x] 1.1 Add test tooling and structure
  - Add `pytest` and `hypothesis` to a dev requirements file for the panel
  - Create a `tests/` package under `LDS ADMIN` with a shared fixtures module
    (in-memory SQLite, seeded tenants and users)
  - _Requirements: 10.2_
- [x] 1.2 Implement pure metrics helpers in `app/metrics.py`
  - `energy_band(e)` returning band name, index, and accent color over
    [0, 2,097,151] using the tabulated boundaries and the 1,000,000 fire marker
  - `valid_coords(lat, lon)` range check
  - `uptime_pct(received, expected)` clamped to 0..100
  - `sast_month_window(year, month)` returning [start, next_start) in SAST
  - `samples_to_prune(now, retention_days)` cutoff helper
  - _Requirements: 1.1, 1.2, 2.1, 4.2, 7.1_
- [x] 1.3 Write property-based tests for the helpers
  - Cover Properties 2, 3, 4, 5, 6 with hypothesis strategies
  - _Requirements: 1.1, 1.2, 4.2, 7.1, 7.2_
  - _Properties: 2, 3, 4, 5, 6_

- [x] 2. Data model and schema migration
- [x] 2.1 Add per-station metadata columns to `UnitStatus`
  - Add `latitude`, `longitude` (Float, nullable), `site_label` (String(120), nullable)
  - Register the three columns in `bootstrap._ADDED_COLUMNS["unit_status"]`
  - _Requirements: 4.1, 4.3_
- [x] 2.2 Add the `CalibrationEvent` model
  - Fields per design (tenant_id, station_id, ts, kind, reason, cpu_temp_c,
    freq_hz, in_tolerance, tune_cap_before, tune_cap_after) with indexes
  - Confirm `Base.metadata.create_all` builds it on startup
  - _Requirements: 1.4_
- [x] 2.3 Add `HEARTBEAT_RETENTION_DAYS` (default 70) to config/settings
  - _Requirements: 7.1, 7.3_
- [x] 2.4 Integration test: `add_missing_columns` is idempotent on a populated DB
  - _Requirements: 4.1, 10.2_

- [x] 3. Extend telemetry retention in heartbeat ingest
  - Replace the fixed 48h prune with a window of `HEARTBEAT_RETENTION_DAYS`
  - Prune `calibration_events` on a longer window (about 400 days)
  - Test that samples within the window survive and older ones are removed
  - _Requirements: 7.1, 7.2, 7.3_
  - _Properties: 6_

- [x] 4. Calibration ingest endpoint (panel)
  - Add `CalibrationPayload` and `POST /api/v1/calibration` with the same token
    check as heartbeat; resolve tenant via `unit_tenant_id`; insert a row
  - Best-effort store with rollback and logging on failure
  - Test: valid post inserts under the correct tenant; bad token rejected
  - _Requirements: 1.4, 10.3_

- [x] 5. Detector telemetry changes (`detector/lightning_detector.py`)
- [x] 5.1 Report CPU load in the heartbeat
  - Add `get_cpu_load()` from `/proc/loadavg` divided by CPU count (percent),
    returning None on failure; include `cpu_load_pct` in `_heartbeat_webhook`
  - _Requirements: 6.1, 6.3_
- [x] 5.2 Emit calibration events
  - Add a short-timeout, error-swallowing `_calibration_webhook(...)` helper
  - Call it from `_temperature_compensation` (rc_recal) and
    `_antenna_frequency_check` (antenna_check with freq, tolerance, tune_cap
    before/after); gate with an enable flag defaulting on
  - _Requirements: 1.4_
- [x] 5.3 Detector unit tests
  - Test `get_cpu_load()` parsing and payload construction with network mocked
  - _Requirements: 6.1, 6.3_

- [x] 6. Session JSON endpoints for the browser (tenant-scoped)
- [x] 6.1 `GET {base}/data/cpu`
  - Depend on `current_user`/`tenant_id`; map range 24h/7d/30d to a window;
    filter `HeartbeatSample` with `scope()`; return the CPU series shape
  - _Requirements: 5.1, 5.4, 5.8_
- [x] 6.2 `GET {base}/data/strikes`
  - Tenant-scoped recent in-range `AlertEvent` rows with computed energy band
    and ring distances for the storm view
  - _Requirements: 8.1, 8.3_
- [x] 6.3 Tests: tenant isolation and auth
  - Two seeded tenants cannot see each other's series; unauthenticated
    requests redirect to login
  - _Requirements: 3.3, 3.4, 5.8_
  - _Properties: 1_

- [x] 7. Station metadata management
- [x] 7.1 Metadata route and validation
  - `GET`/`POST` metadata under the web router; `require_writer`; CSRF token;
    validate coordinates with `valid_coords`; save scoped to tenant stations
  - _Requirements: 4.1, 4.2, 4.5_
- [x] 7.2 Display-name resolver
  - Helper resolving site_label then tenant `site_name` then `station_id`, and
    an explicit "coordinates not set" state
  - _Requirements: 4.4_
- [x] 7.3 Metadata UI template and tests
  - List tenant stations with an edit form; test invalid coordinates rejected
    and cross-tenant edits blocked
  - _Requirements: 4.1, 4.2, 4.5_
  - _Properties: 3_

- [ ] 8. Server-side SVG chart builders in `app/charts.py`
  - Extend `cpu_trend_svg` for configurable windows; add
    `distance_histogram_svg`, `energy_band_histogram_svg`, `uptime_gauge_svg`,
    and `storm_rings_svg`, all vector with Arial and no em dashes
  - Unit tests assert well-formed SVG, Arial font-family, and no em dash
  - _Requirements: 1.3, 1.5, 2.3, 8.4_
  - _Properties: 2_

- [x] 9. PDF report builder
- [x] 9.1 Add WeasyPrint and fonts
  - Add `weasyprint` to panel requirements; add Pango/Cairo/GDK-Pixbuf/libffi
    to the Dockerfile; bundle Liberation Sans and map `font-family: Arial`
  - _Requirements: 2.6_
- [x] 9.2 Implement `app/reports.py`
  - `build_report(...)` gathering month data (uptime, CPU stats, WARN/CRIT
    counts, calibration activity, strike distance and energy-band histograms),
    rendering SVG charts, and producing PDF bytes; empty months produce a valid
    "no data" PDF
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2_
- [x] 9.3 Report templates
  - Lean Jinja templates for the technical report and the client summary
    (themed cover, site name and coordinates, energy legend, relative-scale
    note, in-range data note); Arial, South African English, no em dashes
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.7_
- [x] 9.4 Report builder tests
  - Populated and empty months return valid PDF bytes (PDF header); assert
    site name and coordinates present
  - _Requirements: 1.6, 2.1_
  - _Properties: 7_

- [x] 10. Report access routes (list, generate, download)
  - `GET {base}/reports` list by station, month, type; `POST {base}/reports/generate`
    (`require_writer`) building and caching under a validated tenant-scoped path;
    `GET {base}/reports/download` streaming the cached PDF as an attachment
  - Tests: viewer can download but not generate; writer and platform admin can
    generate; cross-tenant download blocked; download returns PDF magic bytes
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_
  - _Properties: 1_

- [ ] 11. Dashboard CPU chart (Recharts)
- [ ] 11.1 Vendor the libraries
  - Add React, ReactDOM, and Recharts production UMD builds under
    `app/static/vendor/` (same-origin, no CDN)
  - _Requirements: 5.7_
- [ ] 11.2 Chart script and template wiring
  - `app/static/js/cpu-chart.js` reads `data-endpoint`/`data-range`, fetches
    JSON, renders temperature and load series with axis labels, legend, and
    WARN/CRIT reference lines; timeframe buttons (24h/7d/30d); empty state; and
    graceful fallback if vendor or fetch fails
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9_

- [ ] 12. Storm-activity visualization
  - `app/static/js/storm-view.js` draws distance range-rings, plots strikes by
    distance only with a "bearing not measured" note, animates a pulse per new
    strike, color-codes by energy band, and shows an energy legend; add a
    subtle CSS cloud/storm backdrop; honor `prefers-reduced-motion` and fall
    back to a static view on failure
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [ ] 13. Non-regression and CSP verification
  - Integration test that existing platform and client pages still load
    (dashboard, events, recipients, groups, settings, tenants)
  - Assert report and chart pages reference only same-origin assets (CSP intact)
  - Confirm report generation runs in the web path and does not touch the alert
    worker
  - _Requirements: 10.1, 10.2, 10.4, 10.5_

- [ ] 14. PPTX and datasheet reconciliation
  - Produce a reconciliation note listing each claim versus the code
    (detection thresholds, calibration cadence, CPU WARN 70 / CRIT 78, alert
    channels), correct the material to SMS-only, and describe energy as a
    relative dimensionless scale
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 15. Final verification
  - Run the full test suite (unit, property-based, integration) and confirm the
    container builds with the new system libraries; remove any temporary files
  - _Requirements: 10.1, 10.2, 10.3_
