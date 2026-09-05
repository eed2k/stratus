# Security

## Reporting a vulnerability

Email **esterhuizen2k@proton.me** with the details. Please do not open a public
issue for a security problem. Include the affected host, what you did and what
you observed; a proof of concept helps but is not required.

Surfaces in scope: `stratusweather.co.za`, `adminpanel.stratusweather.co.za`,
`forecast.stratusweather.co.za`, `info.stratusweather.co.za`,
`lightningdemo.stratusweather.co.za`, and the Raspberry Pi lightning detectors.

---

## What is in place

All five sites sit behind one Traefik instance with Let's Encrypt certificates.
TLS 1.3 everywhere, HTTP redirects to HTTPS, and nothing is served in the clear.

| Control | Stratus app | Admin panel | Forecast | Static sites |
|---|---|---|---|---|
| HSTS | yes | yes | yes | yes |
| CSP | yes | yes | yes | yes |
| `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` | yes | yes | yes | yes |
| `Permissions-Policy` | yes | yes | yes | yes |
| CSRF on state-changing POSTs | yes | yes (all routes) | yes (all routes) | n/a |
| Login throttling | yes | yes | yes | n/a |
| Session cookie `HttpOnly` + `Secure` + `SameSite=Lax` | yes | yes | yes | n/a |
| Rate limiting | per-endpoint + baseline | ingest/login | Traefik middleware | n/a |

Other measures:

- SQL injection is low risk by construction: Drizzle on the Node side, SQLAlchemy
  and bound parameters on the Python side, no string-built SQL.
- Output escaping: React on the client, Jinja2 autoescaping in both Python apps.
  The forecast injects chart SVG with `|safe`, so `forecast/app/charts.py` escapes
  every text insertion and `forecast/tests/test_chart_escaping.py` asserts a
  hostile station name cannot open an element or break out of an attribute.
- Ingest payloads are validated with explicit physical bounds and length caps.
- Detector ingest is token-authenticated over HTTPS with certificate
  verification left on.
- Credentials are kept out of the repository by design: anything holding a real
  secret is gitignored and shipped as a `.example` template. A credential
  committed once stays recoverable from history, so the safer default is never to
  commit it. `python deploy/scan_secrets.py` checks every file git could commit
  and exits non-zero on a finding.
- Container logs are bounded so an unbounded log cannot fill the disk.

---

## Known gaps

Listed honestly rather than omitted. Ranked by risk over effort.

### Needs an operator, not a code change

1. **Rotate the credentials that were shared in plain text during development.**
   Treat these as compromised until rotated: VPS root password, GitHub personal
   access tokens, Vaisala Xweather client secret, forecast operator password,
   the GWLD1 detector webhook token (it was committed to a config file at one
   point), and the Dropbox app secret and refresh token. This is the single most
   important item on this page and it cannot be done from the codebase.
2. **Decide on HSTS preload.** Every site now sends `includeSubDomains`, but
   preload is deliberately not claimed: submitting the domain is a one-way door
   that commits every future subdomain to HTTPS from its first minute.
3. **Certificate expiry monitoring.** Renewal is automatic; failure is silent and
   would take all five sites down together.
4. **External uptime monitoring.** If the VPS goes down, nothing outside it
   notices.
5. **Patching.** No unattended-upgrades on the host, no scheduled base-image
   rebuilds, and no patch story for detectors already in the field. Traefik v2.11
   is a maintenance branch; the v3 migration should be planned, not forced.

### Needs development work

6. **No alerting for operational failures.** An offline detector, a failed
   antenna check, an error spike or an exhausted SMS balance are visible only if
   someone opens a page. For a life-safety product this is the most serious
   development gap.
7. **Per-detector API keys.** One shared `ALERT_WEBHOOK_TOKEN` covers every unit
   at every client, so anyone holding it can inject a false alert at any site.
   Keys should be per unit and individually revocable.
8. **No audit trail of who changed what.** Message delivery is logged; operator
   actions are not.
9. **No roles on the forecast.** It is one shared operator password, which is
   acceptable for a single operator and not once a colleague or client needs
   access. It should adopt the panel's user model rather than growing its own.
10. **No session revocation** in either app, and no multi-factor authentication
    on admin logins.
11. **No centralized log aggregation.** Logs are per container and lost on
    recreation, so "what happened at 03:00 last Tuesday" cannot be answered
    across services.
12. **No dependency or image vulnerability scanning in CI.** Dependencies are
    pinned, which makes updates deliberate but means a published CVE stays
    pinned and vulnerable until someone looks.
13. **Forecast upload hardening.** Size is capped and parsing is defensive, but
    there is no content-type enforcement and a crafted file with a very large
    number of columns is a plausible denial of service.
14. **No replay protection on detector ingest.** A duplicated POST creates a
    duplicate alert event.
