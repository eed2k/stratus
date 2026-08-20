# LDS ADMIN - Remaining Work (Tasks 11 to 15)

This panel has the monthly reports, station metadata, tenant-scoped chart/strike
JSON endpoints, retention, and detector telemetry all implemented and tested.
What remains is the browser front-end for the charts, a non-regression pass, the
presentation reconciliation, and a final container verification.

Status: tasks 1 to 10 complete (56 tests pass, 1 PDF test skipped off-container).
Remaining: tasks 11 to 15 below.

Run tests: from this folder, `python -m pytest` (dev deps in requirements-dev.txt).

--------------------------------------------------------------------------------
## Task 11: Dashboard CPU chart (Recharts, self-hosted)

Backend is ready: `GET {base}/data/cpu?station=<id>&range=24h|7d|30d` returns
`{station, site, warn:70, crit:78, points:[{t, temp, load}]}`, tenant-scoped.

- [ ] 11.1 Vendor the libraries into `app/static/vendor/` (same-origin, no CDN,
      so the strict CSP `script-src 'self'` is unchanged). Pinned UMD builds:
      - react.production.min.js        (React 18 UMD)
      - react-dom.production.min.js    (ReactDOM 18 UMD)
      - recharts.min.js                (Recharts 2 UMD)
      - prop-types.min.js              (Recharts UMD peer dependency)
      Download example (run once, commit the files):
      ```
      cd app/static/vendor
      curl -L -o react.production.min.js      https://unpkg.com/react@18/umd/react.production.min.js
      curl -L -o react-dom.production.min.js  https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
      curl -L -o prop-types.min.js            https://unpkg.com/prop-types@15/prop-types.min.js
      curl -L -o recharts.min.js              https://unpkg.com/recharts@2/umd/Recharts.min.js
      ```
- [ ] 11.2 Add `app/static/js/cpu-chart.js` (external file, no inline script):
      - Read `data-endpoint` and `data-range` from `#cpu-chart` container.
      - `fetch(endpoint + '&range=' + range)` (connect-src 'self' allows it).
      - Render a Recharts LineChart via the UMD globals (window.React,
        window.ReactDOM, window.Recharts): X axis = time, left Y = temp,
        optional right Y = load; two `<Line>` series; `<Legend>`, `<Tooltip>`;
        `<ReferenceLine y={warn}>` and `<ReferenceLine y={crit}>` from the JSON.
      - Timeframe buttons (24h / 7d / 30d) update `data-range` and re-fetch.
      - Empty `points` -> show a "collecting data" placeholder.
      - Wrap in try/catch: on any failure leave the existing inline-SVG chart
        (see dashboard.html `unit_charts`) visible so the page never breaks.
- [ ] 11.3 Wire into `app/templates/dashboard.html`:
      - Per unit, add `<div id="cpu-chart-{{station}}" class="cpu-chart"
        data-endpoint="{{ base }}/data/cpu?station={{ station }}"
        data-range="24h"></div>` plus the three timeframe buttons.
      - Keep the current `unit_charts[station]` inline SVG inside a
        `<noscript>` / fallback block.
      - Add the four `<script src="/static/vendor/...">` tags then
        `<script src="/static/js/cpu-chart.js" defer></script>` (all local).
- [ ] 11.4 Verify: load a unit dashboard, confirm the interactive chart, hover
      tooltip, WARN/CRIT lines, and timeframe switching; confirm no CSP errors
      in the browser console.
- Requirements: 5.1-5.9. Property 1 (data is tenant-scoped via the endpoint).

--------------------------------------------------------------------------------
## Task 12: Storm-activity visualisation

Backend is ready: `GET {base}/data/strikes?station=<id>&window=<minutes>` returns
`{radius_km:40, rings:[10,20,30,40], bearing_measured:false,
strikes:[{t, distance_km, energy, band, colour}]}`.

- [ ] 12.1 Add `app/static/js/storm-view.js` (external, self-hosted):
      - Draw concentric distance range-rings (10/20/30/40 km) on a `<canvas>`
        or inline SVG, station marker at centre.
      - Plot each strike by distance only; spread angle deterministically.
      - Colour each strike by `colour` (energy band); render an energy legend.
      - Animate a short pulse when a new strike appears on refresh (poll
        `/data/strikes` every ~30 s).
      - Respect `prefers-reduced-motion`: no animation, static plot.
      - Show the note "Distance only - bearing not measured by the sensor".
      - On fetch/JS failure, fall back to a static list of recent strikes.
- [ ] 12.2 Add a subtle cloud/storm backdrop in `app/static/style.css`
      (CSS gradients/keyframes, paused under reduced-motion). Keep it behind the
      data and within the white/navy theme; do not obscure readings.
- [ ] 12.3 Wire a storm-activity card into `dashboard.html` (a `<div>` container
      with a `data-endpoint` attribute + the `<script src>`).
- [ ] 12.4 Note: `app/charts.py::storm_rings_svg()` already renders the same
      idea server-side (used in the PDF); reuse its ring/energy conventions for
      visual consistency.
- Requirements: 8.1-8.8.

--------------------------------------------------------------------------------
## Task 13: Non-regression and CSP verification

- [ ] 13.1 Integration test that existing pages still return 200 after login:
      dashboard, /recipients, /groups, /events, /settings, /users, and (platform
      admin) /tenants. Add to `tests/` using the `client` fixture and
      `tests/util.py` login helper.
- [ ] 13.2 Assert no external asset references: grep the templates and static
      JS for `http://`, `https://`, or `//cdn` in `src`/`href`; a test can read
      the rendered dashboard/reports pages and assert only `/static/...` scripts.
- [ ] 13.3 Confirm report generation runs in the request path only (it does:
      `web.reports_generate` calls `reports.build_report` synchronously) and
      never touches `alert_worker`. A quick test can assert dispatch is not
      called during generation.
- Requirements: 10.1, 10.2, 10.4, 10.5.

--------------------------------------------------------------------------------
## Task 14: PPTX / datasheet reconciliation

Correct the presentation and datasheet to match the shipped code:
- [ ] Alerts are SMS only (Clickatell). Remove or clearly mark WhatsApp and
      email as not included in this deployment. (Schema keeps legacy
      whatsapp/channel columns but the panel only sends SMS.)
- [ ] CPU thresholds: WARN 70 C, CRIT 78 C (see `app/metrics.py`).
- [ ] Calibration cadence: RC recalibration on a temperature delta or interval,
      plus a daily antenna resonance check at 06:00 SAST; report values now
      flow to the panel via `POST /api/v1/calibration`.
- [ ] Energy: describe as a relative, dimensionless value (0 to 2,097,151), not
      Joules or Watts; high-intensity marker near 1,000,000.
- [ ] Detection range up to 40 km; distance only (no bearing).
- Requirements: 9.1-9.4.

--------------------------------------------------------------------------------
## Task 15: Final verification (in the container)

- [ ] Build the image: `docker build -t lds-admin .` (Dockerfile now installs
      the WeasyPrint system libraries and fonts-liberation for Arial).
- [ ] Run the suite inside the image; the currently-skipped WeasyPrint PDF test
      (`tests/test_reports.py::test_pdf_bytes_when_weasyprint_available`) should
      run and pass there, producing real `%PDF` bytes.
- [ ] Smoke test: log in, open /reports, generate a technical and a client PDF,
      confirm they open and show site name, coordinates, charts, and the energy
      legend.
- [ ] Remove any local test artifacts before shipping (data/reports/ cache,
      __pycache__, .pytest_cache).
- Requirements: 10.1, 10.2, 10.3.

--------------------------------------------------------------------------------
## What changed in this folder (inventory)

New files:
- app/metrics.py              pure helpers (energy bands, coords, uptime, month
                              window, retention) with CPU_WARN_C/CPU_CRIT_C
- app/reports.py              monthly PDF report builder (technical + client)
- app/templates/reports.html  reports listing / generate / download page
- app/templates/reports/technical.html
- app/templates/reports/client.html
- app/templates/stations.html station metadata editor
- requirements-dev.txt        pytest, hypothesis, httpx
- pytest.ini
- tests/                      conftest.py, util.py, test_metrics.py,
                              test_migration.py, test_heartbeat.py,
                              test_calibration_ingest.py, test_data_endpoints.py,
                              test_stations.py, test_charts.py, test_reports.py,
                              test_reports_routes.py

Modified files:
- app/models.py               UnitStatus: +site_label,+latitude,+longitude;
                              new CalibrationEvent model
- app/bootstrap.py            _ADDED_COLUMNS: unit_status metadata columns
- app/config.py               +HEARTBEAT_RETENTION_DAYS(70),
                              +CALIBRATION_RETENTION_DAYS(400)
- app/routes/api.py           heartbeat prune uses retention setting;
                              +POST /api/v1/calibration (CalibrationPayload)
- app/routes/web.py           +/data/cpu, +/data/strikes, +/stations (+update),
                              +/reports (+generate,+download); station_display
                              and _resolve_unit helpers
- app/charts.py               +report SVG builders: cpu_trend_svg (windowed),
                              distance_histogram_svg, energy_band_histogram_svg,
                              uptime_gauge_svg, storm_rings_svg
- app/templates/base.html     nav links: Stations, Reports
- Dockerfile                  WeasyPrint system libs + fonts-liberation
- requirements.txt            +weasyprint==62.3

Pending front-end files to add (tasks 11-12):
- app/static/vendor/react.production.min.js, react-dom.production.min.js,
  prop-types.min.js, recharts.min.js
- app/static/js/cpu-chart.js
- app/static/js/storm-view.js
- style/markup wiring in app/templates/dashboard.html and app/static/style.css

## Detector side (separate component, already updated)
`detector/lightning_detector.py` now sends `cpu_load_pct` in the heartbeat and
posts calibration events to `/api/v1/calibration` (config flag
CALIBRATION_REPORT_ENABLED, default on). Tests in `detector/tests/`.
