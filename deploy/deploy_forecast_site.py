"""Publish the nano-climate forecast at forecast.stratusweather.co.za.

WHAT IT CREATES

  /opt/stratus-forecast/          its own compose project
    docker-compose.yml            python:3.12-slim + Traefik labels
    Dockerfile
    requirements.txt
    app/                          the application
  A named volume, forecast-data, holds the SQLite file and the provider cache
  so a rebuild never destroys an uploaded record.

ISOLATION

  A separate compose project joining the existing Traefik network as external.
  No existing compose file, container or label is modified, so the panel, the
  main Stratus app, the demo and the information center are all untouched. The
  container is capped at 320 MB because this host has 951 MB in total and the
  panel must not be starved.

ACCESS CONTROL

  The service stores uploaded files, so it is not published open. A single
  operator password is required in FORECAST_PASSWORD; without it the app answers
  every request with a 503 explaining that it is unconfigured, rather than
  serving an anonymous upload endpoint on a public hostname. This script
  generates a password if one is not supplied and prints it once.

THERE IS NO SEED DATA

  Nothing is inserted. The site comes up with an empty station list and an
  upload form, and the verification page stays empty until real forecasts have
  real observations to be scored against.

NOTHING HERE SENDS AN SMS OR AN EMAIL.
"""
from __future__ import annotations

import base64
import io
import os
import secrets
import ssl
import sys
import tarfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import paramiko
from scp import SCPClient

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HOST = os.environ.get("DEPLOY_HOST", "139.84.242.126")
USER = os.environ.get("DEPLOY_USER", "root")
PW = os.environ.get("DEPLOY_PW", "")
if not PW:
    sys.exit("Set DEPLOY_PW")

DIR = "/opt/stratus-forecast"
CT = "stratus-forecast"
SVC = "forecast"
URL = "https://forecast.stratusweather.co.za"
LOCAL = Path("forecast")
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/forecast-build.log", "/root/forecast-build.done"
OUT = Path("backups/_deploy_forecast.txt")

# The operator password. Supplied, or generated once and printed.
FORECAST_PASSWORD = os.environ.get("FORECAST_PASSWORD", "").strip()
GENERATED = False
if not FORECAST_PASSWORD:
    FORECAST_PASSWORD = secrets.token_urlsafe(18)
    GENERATED = True
# A fixed session secret so a container restart does not sign everyone out.
FORECAST_SECRET = os.environ.get("FORECAST_SECRET", "").strip() \
    or secrets.token_hex(32)

XW_ID = os.environ.get("XWEATHER_CLIENT_ID", "").strip()
XW_SECRET = os.environ.get("XWEATHER_CLIENT_SECRET", "").strip()
# The global on/off switch. Credentials being present is not consent to spend
# the operator's access budget, so this is read separately and defaults off.
XW_ENABLED = os.environ.get("XWEATHER_ENABLED", "false").strip().lower() in (
    "1", "true", "yes", "on")
DBX_KEY = os.environ.get("DROPBOX_APP_KEY", "").strip()
DBX_SECRET = os.environ.get("DROPBOX_APP_SECRET", "").strip()
DBX_REFRESH = os.environ.get("DROPBOX_REFRESH_TOKEN", "").strip()

SKIP = ("__pycache__", ".pyc", "/data/", "nwp-cache", ".pytest_cache")

log: list[str] = []
checks: list[tuple[bool, str]] = []
CTX = ssl.create_default_context()


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)
    try:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text("\n".join(log), encoding="utf-8")
    except Exception:
        pass


def section(t: str) -> None:
    say()
    say("=" * 76)
    say(t)
    say("=" * 76)


def ck(ok: bool, label: str, detail: str = "") -> None:
    checks.append((bool(ok), label))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<52} {detail}")


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd, timeout=1200):
    for attempt in (1, 2, 3):
        try:
            c = fresh()
            try:
                _i, o, e = c.exec_command(cmd, timeout=timeout)
                a = o.read().decode(errors="replace")
                b = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                return (a or b).rstrip()
            finally:
                c.close()
        except Exception as exc:
            if attempt == 3:
                return f"[conn failed: {type(exc).__name__}]"
            time.sleep(8)
    return ""


def bash(script: str, timeout=1200):
    return sh(f"echo {base64.b64encode(script.encode()).decode()} "
              f"| base64 -d | bash -s", timeout=timeout)


def get(url: str, timeout=30):
    req = urllib.request.Request(
        url, headers={"User-Agent": "stratus-forecast-deploy"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception:
        return 0, ""


def collect() -> list[str]:
    out = []
    for p in sorted(LOCAL.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(LOCAL).as_posix()
        if any(s in f"/{rel}" for s in SKIP):
            continue
        if rel.startswith("tests/"):
            continue          # the image does not need the suite
        out.append(rel)
    return out


def main() -> None:
    section("0. Pre-flight")
    files = collect()
    ck(bool(files), "application files collected", f"{len(files)} files")
    for required in ("Dockerfile", "requirements.txt", "docker-compose.yml",
                     "app/main.py", "app/engine.py", "app/ingest.py",
                     "app/db.py", "app/forecasting.py",
                     "app/verification.py", "app/charts.py",
                     "app/static/style.css",
                     "app/templates/base.html", "app/templates/index.html"):
        ck(required in files, f"present: {required}")

    # No seed data must ride along in the image.
    stowaways = [f for f in files
                 if f.endswith((".dat", ".db", ".sqlite", ".sqlite3"))]
    ck(not stowaways, "no logger files or databases in the upload",
       ", ".join(stowaways) if stowaways else "clean")

    ck("providers/wrf_nwu.py" not in files,
       "the Lekwena/NWU adapter is not shipped")

    section("1. DNS")
    ips = sh("getent hosts forecast.stratusweather.co.za "
             "| awk '{print $1}' | tr '\\n' ' '").strip()
    say(f"  forecast.stratusweather.co.za -> {ips or 'no answer'}")
    ck(bool(ips), "the subdomain resolves", ips)

    section("2. Upload")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for rel in files:
            tf.add(LOCAL / rel, arcname=rel)
    payload = buf.getvalue()
    say(f"  tarball {len(payload):,} B")

    say(bash(f"mkdir -p {DIR} && echo '  {DIR} ready'"))
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(payload), f"/tmp/forecast-{STAMP}.tar.gz")
    finally:
        c.close()
    say(bash(f"""
cd {DIR}
tar -xzf /tmp/forecast-{STAMP}.tar.gz && echo "  extract ok"
rm -f /tmp/forecast-{STAMP}.tar.gz
ls app | tr '\\n' ' '; echo
"""))

    section("3. Environment")
    # Written with restrictive permissions: it holds the operator password and
    # the Xweather secret.
    env_lines = [
        f"FORECAST_PASSWORD={FORECAST_PASSWORD}",
        f"FORECAST_SECRET={FORECAST_SECRET}",
    ]
    if XW_ID and XW_SECRET:
        env_lines += [
            f"XWEATHER_CLIENT_ID={XW_ID}",
            f"XWEATHER_CLIENT_SECRET={XW_SECRET}",
            # The global switch. Even when true, a station still has to opt in
            # per variable and needs coordinates before any fetch happens.
            f"XWEATHER_ENABLED={'true' if XW_ENABLED else 'false'}",
        ]
    if DBX_KEY and DBX_SECRET and DBX_REFRESH:
        # The same read-only credentials the main Stratus server already uses.
        # A station still has to name a folder and switch its feed on.
        env_lines += [
            f"DROPBOX_APP_KEY={DBX_KEY}",
            f"DROPBOX_APP_SECRET={DBX_SECRET}",
            f"DROPBOX_REFRESH_TOKEN={DBX_REFRESH}",
            "DROPBOX_POLLING=true",
        ]
    env_b64 = base64.b64encode("\n".join(env_lines).encode()).decode()
    say(bash(f"""
cd {DIR}
umask 077
echo {env_b64} | base64 -d > .env
chmod 600 .env
echo "  .env written, $(wc -l < .env) settings, mode $(stat -c %a .env)"
grep -c XWEATHER .env | sed 's/^/  xweather settings: /'
"""))
    ck(True, "operator password configured",
       "generated for you" if GENERATED else "supplied")

    section("4. Build")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose build {SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' >/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code = None
    for _ in range(160):
        time.sleep(15)
        got = sh(f"cat {DONE} 2>/dev/null").strip()
        if got.isdigit():
            code = int(got)
            break
    say(sh(f"tail -8 {LOG}"))
    ck(code == 0, "image built", f"exit {code}")
    if code != 0:
        raise SystemExit("build failed")

    section("5. Start")
    say(sh(f"cd {DIR} && docker compose up -d {SVC} 2>&1 | tail -6"))
    healthy = False
    for _ in range(40):
        time.sleep(10)
        st = sh(f"docker inspect -f '{{{{.State.Health.Status}}}}' {CT} "
                f"2>/dev/null").strip()
        if st == "healthy":
            healthy = True
            break
    ck(healthy, "container healthy",
       sh(f"docker inspect -f '{{{{.State.Health.Status}}}}' {CT}"))
    if not healthy:
        say(sh(f"docker logs --tail 40 {CT} 2>&1"))

    section("6. The site answers")
    # Let Traefik obtain a certificate on first request.
    for _attempt in range(12):
        status, _ = get(f"{URL}/healthz", timeout=25)
        if status == 200:
            break
        time.sleep(10)
    status, body = get(f"{URL}/healthz")
    ck(status == 200, "/healthz answers over TLS", f"HTTP {status}")
    ck('"status":"ok"' in body.replace(" ", ""), "health payload is ok",
       body[:120])
    ck('"configured":true' in body.replace(" ", ""),
       "the app reports itself configured")
    ck('"stations":0' in body.replace(" ", ""),
       "no stations exist: nothing was seeded", body[:120])
    flat = body.replace(" ", "")
    have_dropbox = bool(DBX_KEY and DBX_SECRET and DBX_REFRESH)
    ck(f'"dropbox_configured":{str(have_dropbox).lower()}' in flat,
       f"Dropbox credentials {'present' if have_dropbox else 'absent'}",
       body[:160])
    ck('"dropbox_polling":true' in flat,
       "the continuous-feed poller is running")
    ck('"dropbox_feeds":0' in flat,
       "no folder is being watched until a station opts in")

    section("7. It is not open to the public")
    # The sign-in page matches the main stratusweather.co.za site, so it is
    # identified by its form class rather than by wording.
    marker = 'class="auth-form"'
    status, body = get(f"{URL}/")
    ck(status == 200 and marker in body,
       "the root redirects to a sign-in page", f"HTTP {status}")
    ck("auth-shell" in body and "Stratus" in body,
       "the sign-in page matches the main site")
    ck("not left open" not in body,
       "the explanatory note has been removed")

    # A deploy that leaves an old stylesheet in a browser cache looks exactly
    # like a deploy that did not happen, so the fingerprint is checked here and
    # the served CSS is checked for the rules the new markup needs.
    import re as _re
    match = _re.search(r"/static/style\.css\?v=([0-9a-f]+)", body)
    ck(bool(match), "the stylesheet link is fingerprinted",
       match.group(1) if match else "MISSING: browsers will serve a stale copy")
    version = match.group(1) if match else ""
    status, css = get(f"{URL}/static/style.css?v={version}")
    ck(status == 200, "the fingerprinted stylesheet is served", f"HTTP {status}")
    for rule in (".login-wrap", ".auth-shell", ".auth-card", ".auth-field",
                 ".auth-submit"):
        ck(rule in css, f"served stylesheet contains {rule}")
    status, body = get(f"{URL}/station/1")
    ck(marker in body or status in (303, 401, 404),
       "a station page is not readable without signing in", f"HTTP {status}")

    section("8. No demo or third-party content is served")
    status, body = get(f"{URL}/")
    low = body.lower()
    for word in ("lekwena", "potchefstroom", "demo", "sample station"):
        ck(word not in low, f"the sign-in page does not mention '{word}'")

    section("9. Nothing else disturbed")
    for u in ("https://stratusweather.co.za/",
              "https://adminpanel.stratusweather.co.za/login",
              "https://adminpanel.stratusweather.co.za/client",
              "https://lightningdemo.stratusweather.co.za/",
              "https://info.stratusweather.co.za/"):
        st, _ = get(u)
        say(f"  {u:<58} HTTP {st}")
        ck(st == 200, f"still 200: {u}", f"HTTP {st}")

    say("--- containers ---")
    say(sh("docker ps --format '{{.Names}}  {{.Status}}'"))
    say("--- forecast memory ---")
    say(sh(f"docker stats --no-stream --format "
           f"'{{{{.Name}}}}  {{{{.MemUsage}}}}' {CT}"))
    say("--- disk ---")
    say(sh("df -h / | tail -1"))

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks) - len(bad)} of {len(checks)} checks passed")
    for _, label in bad:
        say(f"    FAIL  {label}")
    say()
    say(f"  URL       {URL}")
    say(f"  Location  {DIR}")
    say(f"  Data      docker volume stratus-forecast_forecast-data")
    say(f"  Remove    cd {DIR} && docker compose down")
    if GENERATED:
        say()
        say("  " + "-" * 66)
        say(f"  OPERATOR PASSWORD: {FORECAST_PASSWORD}")
        say("  Shown once. It is stored in "
            f"{DIR}/.env on the server, mode 600.")
        say("  " + "-" * 66)
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
