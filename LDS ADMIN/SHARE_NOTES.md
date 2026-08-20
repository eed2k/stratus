# LDS ADMIN - Shareable Copy

Self-contained copy of the **Lightning Detection System (LDS) admin panel**,
packaged for handover. Nothing in this folder is referenced by the main
Stratus build; the working originals stay in `LDS ADMIN PANEL/` and were not
moved or modified.

## What this is

A FastAPI admin panel that receives lightning-strike webhooks from an AS3935
detector on a Raspberry Pi, matches each strike against recipient groups by
distance threshold, and fans out SMS alerts via the Clickatell One API.
Full feature and deploy documentation is in [README.md](README.md).

```
Pi (AS3935 detector)
   |  POST /api/v1/lightning   (X-Auth-Token)
   v
LDS Admin Panel  (this folder)
   |  match recipients by group + distance threshold
   v
Clickatell One API  ->  SMS
```

## Contents

| Path | What it is |
|------|-----------|
| `app/` | FastAPI application (routes, models, auth, alert worker, templates, static) |
| `app/routes/api.py` | Webhook ingest + Clickatell delivery-receipt callback |
| `app/routes/web.py` | Admin UI routes |
| `app/alert_worker.py` | Background fan-out of alerts to recipients |
| `app/clickatell_sender.py` | Clickatell One API client |
| `app/tenancy.py` | Multi-tenant scoping |
| `app/security.py` | CSRF, login throttling, hardened headers |
| `deploy/` | VPS deploy scripts, Caddyfile, backup/restore, Vultr+Neon+dynv6 guide |
| `Dockerfile`, `docker-compose*.yml` | Single-container deploy |
| `requirements.txt` | Pinned Python dependencies |
| `README.md` | Full setup, deploy, roles and security documentation |
| `ACCESS.txt` | Access/roles reference (passwords redacted in this copy) |
| `stratus-integration/` | The Stratus-side lightning pieces, for reference only |

### `stratus-integration/` (reference)

Not part of the panel. Included so the reader can see how strike data is
surfaced in the main Stratus weather dashboard.

- `client/LightningCard.tsx` - dashboard card: distance, strike count,
  intensity band, and a Leaflet map with 40 km detection rings
- `shared/lightning.ts` - intensity interpretation and storm-proximity helpers
- `demo-data/` - AS3935 demo data generators plus notes on the 21-bit energy
  scale and the sensor's 14 discrete distance steps

## Removed before sharing

These were stripped deliberately. **The panel will not start until you supply
your own `.env`.**

| Removed | Why |
|---------|-----|
| `.env`, `.env.vps` | Live secrets: `APP_SECRET_KEY`, `ALERT_WEBHOOK_TOKEN`, `CLICKATELL_API_KEY`, database URL |
| `deploy/keys/` | Private SSH deploy key |
| `data/panel.db` | Live SQLite database with real tenants, recipients and phone numbers |
| `ACCESS.txt` passwords | Plaintext admin/operator passwords, replaced with placeholders |
| `DEPLOY_STATUS.txt` | Stale internal deploy notes |
| `__pycache__/` | Build artefacts |

`.env.example` is included and lists every variable you need to set.

### One thing to fix on first deploy

`app/config.py` carries hardcoded fallback defaults for the seeded logins
(`INITIAL_ADMIN_PASSWORD`, `INITIAL_OPERATOR_PASSWORD`). If `.env` omits
them, the panel seeds accounts with passwords that are visible in this
source. Always set both explicitly in `.env` before the first boot, or
change the passwords in-app immediately after. This is pre-existing
behaviour, unchanged in this copy.

Note that `deploy/` scripts and `README.md` still carry the existing VPS IP
and dynv6 hostname as defaults, since the tooling is built around them.
Override them for a different target, or scrub them if this copy is going
outside your organisation.

## Running it locally

```bash
cd "LDS ADMIN"
cp .env.example .env
# fill in at minimum: APP_SECRET_KEY, ALERT_WEBHOOK_TOKEN,
# INITIAL_ADMIN_*, INITIAL_OPERATOR_*
# for local dev set DATABASE_URL=sqlite:///./data/panel.db

python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000 and log in with your `INITIAL_ADMIN_EMAIL`.

Generate a strong secret with `openssl rand -hex 48`. Keep
`SECURE_COOKIES=true` in production; set it to `false` only for local HTTP.

## Deploying

See [README.md](README.md) for the Docker path and
[deploy/VULTR_NEON_DYNV6.md](deploy/VULTR_NEON_DYNV6.md) for the full
Vultr + Neon Postgres + dynv6 + Caddy walkthrough.

The container binds to `127.0.0.1:8000` by default, so a reverse proxy
terminating HTTPS is the only public entry point. Do not expose the SQLite
file through the proxy.
