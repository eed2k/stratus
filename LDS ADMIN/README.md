# Lightning Alert Admin Panel

Self-hosted FastAPI admin panel that receives lightning alerts from the
detector and fans them out to recipients over SMS via the Clickatell One
API. The messaging gateway runs entirely in the background; the client only
ever sees your panel.

## Features
- Recipients CRUD (SMS only; E.164 mobile numbers)
- Groups with per-group distance threshold (km)
- Webhook ingest from the Pi (`POST /api/v1/lightning`)
- Asynchronous fan-out (each event is dispatched in a worker thread)
- Global alert on/off switch (suppress SMS while still recording strikes)
- **Test alert** page (admin/operator): fire a live test to all eligible
  recipients or to a single number, then watch per-message delivery status
- Per-message delivery log with provider message ID and error
- Delivery-receipt callback endpoint (`POST /api/clickatell/dlr`)
- Multi-user authentication with roles: admin, operator, viewer
- Monthly reports per station: technical, client summary, calibration
  certificate. The calibration record also downloads as an aligned CSV built
  from the same figures as the PDF, so the two cannot disagree
- **Detector test mode** (Stratus Admin only, per station, capped at 60
  minutes): lets a detector being commissioned report the events it normally
  filters out. Events are stored and tagged, and no SMS is sent for that
  detector while it is on
- All timestamps stored and displayed in SAST (South African time, UTC+2)
- Security: CSRF protection, login throttling, hardened cookies, CSP/HSTS
- Single-container Docker deploy

## Testing alerts
Log in as the admin (`admin@stratusweather.co.za`), open **Test alert** in the
nav, and either:
- **Send to recipients**: runs the exact production fan-out so every active
  recipient whose group threshold covers the test distance gets a real SMS
  via Clickatell, or
- **Send to a single number**: a one-off send to a number you control, useful
  for first-time verification of the Clickatell connection.

Either way you are redirected to the event page showing each message's status
(`queued` / `sent` / `delivered` / `failed`) and any provider error. A real
`CLICKATELL_API_KEY` must be set in `.env` for messages to actually leave the
gateway; without it the log shows `Clickatell API key not configured`.

## Architecture
```
Pi (lightning_detector.py)
   │  POST /api/v1/lightning  (X-Auth-Token)
   ▼
Admin Panel (this repo, on your VPS)
   │  match recipients by group + threshold
   │  fan out per recipient
   ▼
Clickatell One API  ->  SMS delivery
```

---

## Local quick start

```bash
cd admin_panel
cp .env.example .env
# edit .env -- at minimum APP_SECRET_KEY, ALERT_WEBHOOK_TOKEN, INITIAL_ADMIN_*
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000 and log in with `INITIAL_ADMIN_EMAIL` / password.

---

> **Recommended production stack:** Vultr VPS + Neon Postgres + dynv6
> hostname + Caddy (auto-HTTPS). Step-by-step in
> [deploy/VULTR_NEON_DYNV6.md](deploy/VULTR_NEON_DYNV6.md).

## Deploy to a VPS (Docker)

1. Install Docker + Docker Compose on the VPS.
2. Copy this `admin_panel/` folder to the VPS, e.g. `/opt/lightning-panel`.
3. Create the production `.env` from `.env.example` and fill in:
   - `APP_SECRET_KEY`: 64+ random chars (`openssl rand -hex 48`)
   - `ALERT_WEBHOOK_TOKEN`: shared secret (also goes into the Pi config)
   - `CLICKATELL_API_KEY`: from the Clickatell One API (SMS) setup
   - `CLICKATELL_DLR_TOKEN`: optional shared secret expected on inbound
     delivery-receipt callbacks (configure the same value in Clickatell)
   - `SECURE_COOKIES`: leave as true (HTTPS); only set false for local HTTP
4. `docker compose up -d --build`
5. Put a reverse proxy (Caddy / Nginx Proxy Manager / Traefik) in front of
   port 8000 for HTTPS. The container binds only to `127.0.0.1:8000` by
   default so the reverse proxy is the only public entry.

### Sample Caddyfile
```
panel.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

---

## Wire the Pi to the panel

In `lightning_config.json` on the Pi:
```json
{
  "alert_webhook_enabled": true,
  "alert_webhook_url":   "https://panel.example.com/api/v1/lightning",
  "alert_webhook_token": "<same as ALERT_WEBHOOK_TOKEN in .env>",
  "alert_webhook_timeout": 5,
  "alert_distance_km": 15
}
```
Restart: `sudo systemctl restart lightning-detector.service`

The Pi will POST JSON like:
```json
{
  "station_id":  "GENERIC-LD-001",
  "distance_km": 8,
  "energy":      84230,
  "timestamp":   "2026-05-09T12:34:56Z"
}
```

---

## Detector test mode (commissioning)

Proving a new installation means proving the whole path: sensor, interrupt, POST,
event row. The AS3935 will not fire on a bench without a spark source, and waiting
for a thunderstorm is not a commissioning plan, so the detector has to be allowed
to report the events it normally discards.

A **Stratus Admin only** switches it on per detector on the platform console's
Detectors page (`/units`), for up to 60 minutes. A client login cannot see or use
it, and the route answers 404 rather than 403 so its existence is not advertised.

While it is on, for that one detector:

- the unit reports disturbers and forwards each as a 0 km event, and stops
  applying its interference guard and validation buffer
- the panel records every event that arrives with `is_test` set, and marks it
  `[test]` on the dashboard, the events list and the event page
- **no SMS is sent, including for a genuine strike.** Each intended recipient is
  still written to the message log as `skipped` with the reason `Test mode`, so
  the audit trail shows who it would have gone to
- the test does **not** claim the cooldown slot, so it cannot silence the next
  real strike in that distance band

Pull, not push. The panel never opens a connection to a detector: the unit sits
behind a mobile APN with no inbound route, and giving a field safety device a
listening socket is not a trade worth making. The detector polls
`GET /api/v1/detector/config?station_id=...` on the same authenticated outbound
HTTPS it already uses. The reply carries a remaining time rather than an expiry,
so the two need no agreement about clocks.

Four independent things end it, and none depends on anybody remembering:

| Ends it | How |
|---|---|
| The panel's ceiling | `runtime.MAX_TEST_MODE_MIN`, and a request over it is refused rather than clamped |
| The stored expiry | A timestamp on the station's row. Nothing has to run for it to lapse |
| The detector's own ceiling | `test_mode_max_s`, enforced independently; the lower of the two wins |
| A restart of the detector | The window is held in memory only, never on disk |

Both the platform Detectors page and the client dashboard carry a banner while it
is on, and starting or ending it is logged at warning level with the admin's
e-mail and the duration.

---

## Clickatell setup (one-time, hidden from clients)

1. Sign up at https://portal.clickatell.com.
2. Create a **One API** setup: Production, SMS Service Class STANDARD,
   message parts ON. (SMS only; no WhatsApp.)
3. (Optional) Enable Delivery Notifications and point them at
   `https://<your-host>/api/clickatell/dlr` with method POST and a token
   (paste the same value in `.env` as `CLICKATELL_DLR_TOKEN`).
4. Copy the API key into `.env` as `CLICKATELL_API_KEY`.

---

## Logins & roles

Two logins are seeded automatically on first boot from `.env`
(`INITIAL_ADMIN_*` and `INITIAL_OPERATOR_*`):

- **admin** (`admin@stratusweather.co.za`): full access, including Users and
  the **Settings** page (gateway/API status; secrets stay in `.env`).
- **operator** (`gw1@stratusweather.co.za`): the site user. Can view all
  alerts, add/manage recipients, set the per-group **alert distance
  threshold**, and switch SMS alerts on/off. Cannot see Users, Settings or any
  API/gateway secrets.

| Capability                         | admin | operator | viewer |
|------------------------------------|-------|----------|--------|
| View events / dashboard            | yes   | yes      | view   |
| Recipients (add/edit/remove)       | yes   | yes      | no     |
| Groups + alert distance threshold  | yes   | yes      | no     |
| Switch SMS alerts on/off           | yes   | yes      | no     |
| Send test alert                    | yes   | yes      | no     |
| Users management                   | yes   | no       | no     |
| Settings / gateway & API status    | yes   | no       | no     |

The seeded users are idempotent: an existing login with the same email is
never overwritten, so changing the seed password later has no effect. Change
passwords in-app via **Change password**.

## SMS only

This deployment sends **SMS only** via Clickatell. No other channel is used.
Recipients need an E.164 mobile number, and the Clickatell One API key in
`.env` should be an SMS key. The **Switch alerts OFF** control suppresses SMS
delivery (e.g. during maintenance) while still recording every strike for
audit.

---

## Backups

Everything lives in `./data/panel.db` (SQLite). Snapshot that file daily.

For larger deployments, switch `DATABASE_URL` to PostgreSQL and add a `db`
service to `docker-compose.yml`. No application code changes are required.

---

## Security

Built in:
- CSRF tokens on every form (server-side verification).
- Login brute-force throttling per client IP (configurable budget/window).
- Session cookie is signed, HttpOnly, SameSite=Lax, Secure (when
  `SECURE_COOKIES=true`), with an 8-hour hard expiry; the session is rotated
  on login to defeat fixation.
- Response headers: Content-Security-Policy, HSTS, X-Frame-Options=DENY,
  X-Content-Type-Options=nosniff, Referrer-Policy=no-referrer, no-store.
- Webhook and DLR tokens compared in constant time.
- API docs (`/docs`, `/openapi.json`) disabled.
- Passwords stored with bcrypt; minimum length enforced.

Operational:
- Bind container to `127.0.0.1` and put a reverse proxy with HTTPS in front.
- Set a strong `APP_SECRET_KEY` (`openssl rand -hex 48`) and
  `ALERT_WEBHOOK_TOKEN`; keep `SECURE_COOKIES=true` in production.
- Rotate `CLICKATELL_API_KEY` periodically.
- Enable 2FA on the Clickatell account.
- Do not expose the SQLite file via the proxy.
