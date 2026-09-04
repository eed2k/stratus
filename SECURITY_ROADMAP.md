# Stratus Weather: security roadmap

Project-wide security work across all five deployed surfaces. Every "current
state" line below was measured against the live sites, not assumed. The audit
script is `backups/_audit_security_live.py` and its output is
`backups/security_audit.txt`.

Surfaces in scope:

| Surface | Host | Stack |
|---|---|---|
| Stratus app | `stratusweather.co.za` | Node/Express + React, Postgres |
| LDS panel | `adminpanel.stratusweather.co.za` | FastAPI + Jinja, SQLite |
| Forecast | `forecast.stratusweather.co.za` | FastAPI + Jinja, SQLite |
| Information Center | `info.stratusweather.co.za` | nginx static |
| Lightning demo | `lightningdemo.stratusweather.co.za` | nginx static |

All five sit behind one Traefik v2.11 instance on a single 951 MB VPS.

---

## Measured state, 30 August 2026

| Surface | TLS | HTTP redirect | Missing security headers |
|---|---|---|---|
| Stratus app | TLS 1.3 | yes | `permissions-policy` |
| LDS panel | TLS 1.3 | yes | none |
| LDS client door | TLS 1.3 | yes | none |
| **Forecast** | TLS 1.3 | yes | **all six** |
| Information Center | TLS 1.3 | yes | `strict-transport-security`, `permissions-policy` |
| Lightning demo | TLS 1.3 | yes | `strict-transport-security`, `permissions-policy` |

The LDS panel is the reference implementation. It already sets HSTS, CSP,
`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and
`Permissions-Policy` in `LDS ADMIN/app/main.py`, and carries CSRF tokens on all
33 state-changing routes. Where a gap is listed below, the fix is usually to
copy what the panel already does.

---

## 1. HTTPS and SSL/TLS encryption

**Largely done.** Traefik terminates TLS 1.3 on every host with Let's Encrypt
certificates over the HTTP-01 challenge, and plain HTTP on port 80 redirects to
HTTPS on all six endpoints tested. Nothing is served in the clear.

Outstanding:

- [ ] **HSTS on the three sites that lack it** (Forecast, Information Center,
      Lightning demo). Without it, the very first request of a session can still
      be downgraded before the redirect is followed. Set it as a Traefik
      middleware so a static nginx site gets it without an app change.
- [ ] **Decide on HSTS preload.** `includeSubDomains` plus preload is a one-way
      door: every future subdomain must be HTTPS from its first minute. Worth
      doing, but deliberately, not by accident.
- [ ] **Certificate expiry monitoring.** Renewal is automatic; failure is
      currently silent. A renewal that quietly stops working takes every site
      down at once, and nothing would tell us first.
- [ ] **Detector to panel transport.** The Raspberry Pi units post over HTTPS,
      but confirm certificate verification is not disabled anywhere in
      `lightning_detector.py` and `quaggasklip_detector.py`.
- [ ] Pin a minimum TLS version explicitly in Traefik rather than relying on
      the default, so a future upgrade cannot silently permit TLS 1.0/1.1.

## 2. Role-based access control

**Strong on the LDS panel, absent on the Forecast.**

The panel has a real model: `admin | operator | viewer` plus an
`is_platform_admin` flag, every query filtered by `tenant_id`, `require_admin` /
`require_writer` dependencies, and last-admin protection on delete. Tenant
isolation is enforced in the data layer through `scope()` and `scoped_get()`,
not just in the UI.

Outstanding:

- [ ] **Forecast has no roles at all.** It is one shared operator password with
      a 12 hour session. Anyone who can sign in can upload, reconfigure a
      Dropbox feed, change coordinates, and delete a station and all its
      history. Acceptable for a single-operator tool; not acceptable once a
      client or a colleague needs access. It should move to the panel's user
      model rather than growing its own.
- [ ] **No audit of who did what, anywhere.** The panel logs messages sent, but
      not "user X deleted recipient Y at 14:32". For a safety system that is the
      record you will eventually be asked for.
- [ ] **No per-station API keys for detector ingest.** One shared
      `ALERT_WEBHOOK_TOKEN` covers every unit at every client. Anyone holding it
      can inject a false stop-work alert at any site. Each detector should carry
      its own key, revocable individually.
- [ ] `viewer` role exists but its restrictions are partly ad hoc
      (`_is_viewer` checks scattered through `web.py`). Worth consolidating so a
      new page cannot forget to apply them.
- [ ] No multi-factor authentication on admin logins.

## 3. Input validation and sanitization

**Good foundations, one real gap.**

SQL injection risk is low by construction: both Python apps use SQLAlchemy with
bound parameters and no string-built SQL. The Node app uses Drizzle. XSS is
mitigated by Jinja2 autoescaping in both Python apps and by React escaping in
the client. Ingest payloads are validated by Pydantic models with explicit
bounds (`distance_km` 0 to 99, `energy` >= 0, field length caps). The forecast
ingest validates and clamps physical ranges and reports what it rejected.

Outstanding:

- [ ] **Audit every `|safe` in the Forecast templates.** The chart HTML is
      injected with `|safe`, which means `forecast/app/charts.py` is the only
      thing preventing XSS on those pages. It does escape via `_esc()` on all
      text, and the values reaching it are numeric or come from fixed
      dictionaries, so the current risk is low, but the invariant is undocumented
      and one careless edit breaks it. Add a test that asserts a hostile station
      name cannot escape the SVG.
- [ ] **File upload hardening on the Forecast.** Size is capped at 64 MB and
      parsing is defensive, but there is no content-type enforcement and an
      uploaded file is parsed in the request thread. A crafted file with
      millions of columns is a plausible denial of service.
- [ ] **No request rate limiting on the LDS ingest endpoint**, and no replay
      protection or idempotency key. A duplicate POST creates a duplicate alert
      event.
- [ ] Traefik rate limiting exists on the Forecast only (30 average, 60 burst).
      Extend to the panel's login and ingest routes.
- [ ] The Forecast has no CSP, so it has no defense-in-depth behind Jinja
      autoescaping. See item 1 and item 6.

## 4. Secure session management

**Both Python apps do the basics correctly; the Forecast is missing CSRF.**

The panel: `SECURE_COOKIES`, `SESSION_MAX_AGE`, CSRF tokens on every POST, and
login throttling by IP (`LOGIN_MAX_FAILURES` / `LOGIN_FAILURE_WINDOW`). The
Forecast: HMAC-SHA256 signed session token, `HttpOnly`, `Secure`,
`SameSite=Lax`, 12 hour expiry, and a constant-time password compare.

Outstanding:

- [ ] **The Forecast has no CSRF protection.** Confirmed by search: zero
      occurrences of `csrf` in `forecast/app/`. Its state-changing POSTs
      (upload, create station, delete station, settings, Dropbox config) rest
      entirely on `SameSite=Lax` to stop a cross-site form post. Lax does block
      the common case in current browsers, so this is a defense-in-depth gap
      rather than an open door, but it is the one item on this page I would fix
      first because a delete-station route is protected by browser behavior
      alone.
- [ ] **No login throttling on the Forecast.** The panel has it; the Forecast
      will accept unlimited password attempts. With a single shared password
      that is the whole authentication surface.
- [ ] **No session revocation.** Neither app can invalidate a specific session;
      the Forecast can only rotate `FORECAST_SECRET`, which signs everyone out.
- [ ] Sessions do not rotate their token on privilege change or sign-in.
- [ ] Consider shortening the Forecast's 12 hour window, or making it idle-based
      rather than absolute.

## 5. Regular security patching

**Nothing automated. This is the weakest area.**

Dependencies are pinned, which is correct and makes updates deliberate:
`fastapi==0.115.6`, `uvicorn==0.34.0`, `jinja2==3.1.5`,
`python-multipart==0.0.20`, `nginx:1.27-alpine`, `python:3.12-slim`,
Traefik v2.11.

Outstanding:

- [ ] **No vulnerability scanning at all.** No Dependabot, no `pip-audit`, no
      `npm audit` in CI, no container image scanning. A pinned dependency with a
      published CVE stays pinned and vulnerable indefinitely, which is the exact
      failure mode of pinning without monitoring.
- [ ] **Base images are not rebuilt on a schedule.** `python:3.12-slim` and
      `nginx:1.27-alpine` receive OS patches upstream that only land here on a
      manual rebuild.
- [ ] **Traefik v2.11 is a maintenance branch.** Plan the v3 migration
      deliberately rather than under pressure.
- [ ] **The VPS itself.** Ubuntu 22.04 with no unattended-upgrades confirmed,
      and disk at 80 percent, which will eventually block a kernel update.
- [ ] **Raspberry Pi units in the field.** No patch story at all for deployed
      detectors, and they hold a webhook token.
- [ ] Add a `SECURITY.md` with a disclosure contact.

## 6. Comprehensive logging and monitoring

**Records exist; monitoring does not.**

The panel keeps `MessageLog` with per-recipient delivery status reconciled
against gateway receipts, `AlertEvent` history, `HeartbeatSample` telemetry and
`CalibrationEvent` audit records. Both apps log to stdout, captured by Docker.
The Forecast has a catch-all error handler that returns a reference code and
prints the matching line.

Outstanding:

- [ ] **Nothing alerts a human about anything.** An offline detector, a CPU over
      critical, a failed antenna check, an exhausted SMS balance, a 500 storm, a
      failed certificate renewal: all are visible only if someone opens a page.
      For a life-safety product this is the most serious item in this document
      after the missing all-clear.
- [ ] **No centralized log aggregation.** Logs live in each container and are
      lost on recreation. There is no way to answer "what happened at 03:00 last
      Tuesday" across five services.
- [ ] **No security event logging.** Failed logins are throttled but not
      recorded as events, so a distributed attempt is invisible.
- [ ] **No uptime monitoring** from outside the host. If the VPS goes down,
      nothing external notices.
- [ ] **No log retention policy** and no scrubbing. Verify tokens and phone
      numbers are not being written to logs.
- [ ] Disk is at 80 percent with unbounded container logs. Set `max-size` and
      `max-file` on the Docker logging driver before it fills.

---

## Suggested order

Ranked by risk over effort, not by the order of the headings above.

1. **Forecast CSRF tokens** and login throttling. Small, and it closes the one
   gap where a destructive route is protected by browser behavior alone.
2. **Security headers on the Forecast**, plus HSTS on the two static sites. One
   Traefik middleware and one FastAPI middleware; the panel already shows how.
3. **Health and error alerting.** Detector offline, certificate renewal failure,
   error-rate spike. Stops the whole estate being fail-silent.
4. **Docker log rotation and disk headroom.** Prevents a self-inflicted outage.
5. **Dependency and image scanning in CI**, plus scheduled base-image rebuilds.
6. **Per-station detector API keys.** Removes the shared-secret blast radius.
7. **Credential rotation**, then **RBAC on the Forecast**, then **centralized
   logging**.

## Immediate: credentials to rotate

These have been shared in plain text during development and should be treated as
compromised regardless of what else is done:

- [ ] VPS root password
- [ ] GitHub personal access tokens
- [ ] Vaisala Xweather client secret
- [ ] Forecast operator password (`FORECAST_PASSWORD`)
- [ ] GWLD1 detector webhook token, which was committed to
      `Lightning Detector/detector/lightning_config.json`
- [ ] Dropbox app secret and refresh token
