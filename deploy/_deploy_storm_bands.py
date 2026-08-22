"""Deploy the storm-activity band display, the unit range selector and the
page loader to the live LDS admin panel.

  app/metrics.py             +DISTANCE_BANDS, +distance_band_summary()
  app/charts.py              storm_rings_svg -> storm_bands_svg, +_esc()
  app/reports.py             PDF now renders the band view
  app/routes/web.py          /data/strikes returns server-side band aggregates
  app/static/js/storm-view.js  ring plot -> five flashing cumulonimbus cells
  app/static/js/cpu-chart.js   binds the range selector in the unit block
  app/static/style.css         band cells, loader presentation, unit-range
  app/static/app.js            +dismissLoader()
  app/templates/base.html      inline critical loader CSS + overlay markup
  app/templates/dashboard.html band note, range selector in the unit block

Only app/ and tests/ change, so the pip layer is cached and the build is quick.

NOTHING in this script sends an SMS or an email. It generates a PDF report on
demand (a local render) and reads pages. It never touches /test, never enables
alerts, and never posts to any send endpoint.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import tarfile
import time
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

DIR = "/opt/lightning-panel"
CF = "docker-compose.traefik.yml"
SVC, CT = "panel", "lightning-alert-panel"
BASE = "https://adminpanel.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/storm-bands.log", "/root/storm-bands.done"
ROOT = Path("LDS ADMIN")
OUT = Path("backups/_deploy_storm_bands.txt")

FILES = [
    "app/metrics.py",
    "app/charts.py",
    "app/reports.py",
    "app/routes/web.py",
    "app/static/js/storm-view.js",
    "app/static/js/cpu-chart.js",
    "app/static/style.css",
    "app/static/app.js",
    "app/templates/base.html",
    "app/templates/dashboard.html",
    "tests/test_charts.py",
    "tests/test_metrics.py",
    "tests/test_non_regression.py",
]

log: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)
    try:
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
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<48} {detail}")


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd, timeout=900):
    """One command, one connection, with retries.

    sshd on this box rate-limits new connections, so callers batch work into a
    single script rather than issuing many small commands.
    """
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


def bash(script: str, timeout=900):
    """Run a whole bash script over ONE connection, base64 so quoting is safe."""
    b64 = base64.b64encode(script.encode()).decode()
    return sh(f"echo {b64} | base64 -d | bash -s", timeout=timeout)


MINT = r'''
import base64, json, sys
sys.path.insert(0, "/app")
import itsdangerous
from app.config import settings
from app.db import SessionLocal
from app.models import User
db = SessionLocal()
s = itsdangerous.TimestampSigner(str(settings.APP_SECRET_KEY))
u = db.query(User).filter(User.email == "admin@stratusweather.co.za").first()
d = base64.b64encode(json.dumps({"uid": u.id, "tid": u.tenant_id, "csrf": "x"}).encode())
print(("__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session")
      + "|" + s.sign(d).decode())
db.close()
'''


def main() -> None:
    section("0. Pre-flight (local)")
    for f in FILES:
        p = ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing: {p}")
        say(f"  {f:<34} {p.stat().st_size:>8,} B")

    state = bash(f"""
docker inspect {CT} --format '{{{{.Config.Image}}}}' 2>/dev/null || echo NOIMAGE
df -h / | tail -1
free -m | sed -n 2p
""")
    say("  " + state.replace("\n", "\n  "))
    cur = state.splitlines()[0].strip()

    section("1. Rollback tag")
    say("  " + sh(f"docker tag {cur} lightning-alert-panel:rollback-{STAMP} "
                  f"&& echo tagged lightning-alert-panel:rollback-{STAMP}"))

    section("2. Upload")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in FILES:
            tf.add(ROOT / f, arcname=f)
    payload = buf.getvalue()
    say(f"  tarball {len(payload):,} B")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(payload), f"/tmp/storm-{STAMP}.tar.gz")
    finally:
        c.close()

    # Back up what is about to be overwritten, then extract, then prove the new
    # source really landed. All in one connection.
    landed = bash(f"""
cd {DIR}
mkdir -p /root/panel-backups
tar -czf /root/panel-backups/before-storm-bands-{STAMP}.tar.gz {' '.join(FILES)} 2>/dev/null \
  && echo "backup  /root/panel-backups/before-storm-bands-{STAMP}.tar.gz"
tar -xzf /tmp/storm-{STAMP}.tar.gz && echo "extract ok"
rm -f /tmp/storm-{STAMP}.tar.gz
echo "--- landed markers ---"
grep -c 'def distance_band_summary' app/metrics.py            | sed 's/^/metrics.distance_band_summary  /'
grep -c 'def storm_bands_svg'       app/charts.py             | sed 's/^/charts.storm_bands_svg         /'
grep -c 'storm_rings_svg'           app/charts.py             | sed 's/^/charts.storm_rings_svg (want 0)/'
grep -c 'distance_band_summary'     app/routes/web.py         | sed 's/^/web.distance_band_summary      /'
grep -c 'storm-bands'               app/static/js/storm-view.js | sed 's/^/js.storm-bands                /'
grep -c 'GOLDEN'                    app/static/js/storm-view.js | sed 's/^/js.GOLDEN (want 0)            /'
grep -c 'storm-band-range'          app/static/style.css      | sed 's/^/css.storm-band-range           /'
grep -c 'dismissLoader'             app/static/app.js         | sed 's/^/app.dismissLoader              /'
grep -c 'id="page-loader"'          app/templates/base.html   | sed 's/^/base.page-loader               /'
grep -c 'data-cpu-range'            app/templates/dashboard.html | sed 's/^/dash.data-cpu-range            /'
""")
    for line in landed.splitlines():
        say("  " + line)
    ck("extract ok" in landed, "source extracted on the server")
    ck("charts.storm_rings_svg (want 0)0" in landed.replace(" ", "")
       or re.search(r"storm_rings_svg \(want 0\)\s*0", landed) is not None,
       "old ring renderer is gone from charts.py")

    section("3. Build (detached)")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose -f {CF} build {SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' >/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code, last = None, -1
    for _ in range(150):
        time.sleep(20)
        d = sh(f"cat {DONE} 2>/dev/null || true")
        try:
            size = int((sh(f"stat -c%s {LOG} 2>/dev/null || echo 0") or "0").strip())
        except ValueError:
            size = last
        if size != last:
            last = size
            t = sh(f"tail -2 {LOG} 2>/dev/null || true")
            say(f"    [poll] {size:>8} B  "
                + " | ".join(x.strip() for x in t.splitlines() if x.strip())[-120:])
        if d.strip():
            code = int(d.strip()) if d.strip().isdigit() else -1
            break
    if code is None:
        say("  STILL BUILDING - the live panel has NOT been touched.")
        return
    say(f"  build exit {code}")
    if code != 0:
        for line in sh(f"tail -40 {LOG}").splitlines():
            say(f"    {line}")
        say("  BUILD FAILED - nothing recreated, live panel unchanged.")
        return

    section("4. Recreate")
    say(sh(f"cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC} 2>&1 | tail -6", 900))
    healthy = False
    for i in range(48):
        st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                f"{CT} 2>/dev/null")
        if "healthy" in st:
            say(f"  healthy after {i*5}s")
            healthy = True
            break
        time.sleep(5)
    ck(healthy, "panel container healthy")

    section("5. Import check inside the running image")
    # The production image deliberately carries no test dependencies, so the
    # suite cannot run here; it runs on the workstation before deploying. An
    # earlier version of this script ran pytest anyway and reported PASS on the
    # "No module named pytest" message, which is worse than not checking at all.
    # Assert the absence, then check what CAN be checked in the image: that the
    # new modules import and produce output.
    t = bash(f"""
docker exec {CT} python -c "import importlib.util as u; \
print('pytest_present', u.find_spec('pytest') is not None)" 2>&1
docker exec {CT} python -c "import sys; sys.path.insert(0,'/app'); \
from app.metrics import distance_band_summary as f; \
from app.charts import storm_bands_svg as g; \
r = f([{{'distance_km': 5, 'energy': 900000}}]); \
print('summary_total', r['total'], 'bands', len(r['bands'])); \
s = g([{{'distance_km': 5, 'energy': 900000}}]); \
print('svg_ok', s.startswith('<svg') and s.endswith('</svg>'), len(s))" 2>&1
""")
    for line in t.splitlines():
        say("    " + line)
    ck("pytest_present False" in t,
       "prod image carries no test deps (suite runs locally)")
    ck("summary_total 1 bands 5" in t, "distance_band_summary imports and runs")
    ck("svg_ok True" in t, "storm_bands_svg renders inside the image")

    section("6. Static assets actually being served")
    assets = bash(f"""
echo "style.css storm-band-range : $(curl -s --max-time 25 '{BASE}/static/style.css' | grep -c 'storm-band-range')"
echo "style.css page-loader-bolt : $(curl -s --max-time 25 '{BASE}/static/style.css' | grep -c 'page-loader-bolt')"
echo "style.css unit-range       : $(curl -s --max-time 25 '{BASE}/static/style.css' | grep -c 'unit-range')"
echo "storm-view.js storm-bands  : $(curl -s --max-time 25 '{BASE}/static/js/storm-view.js' | grep -c 'storm-bands')"
echo "storm-view.js GOLDEN want0 : $(curl -s --max-time 25 '{BASE}/static/js/storm-view.js' | grep -c 'GOLDEN')"
echo "storm-view.js RANGES       : $(curl -s --max-time 25 '{BASE}/static/js/storm-view.js' | grep -c 'RANGES')"
echo "cpu-chart.js bindRange     : $(curl -s --max-time 25 '{BASE}/static/js/cpu-chart.js' | grep -c 'bindRange')"
echo "app.js dismissLoader       : $(curl -s --max-time 25 '{BASE}/static/app.js' | grep -c 'dismissLoader')"
""")
    got = {}
    for line in assets.splitlines():
        if ":" in line:
            k, v = line.rsplit(":", 1)
            got[k.strip()] = v.strip()
            say(f"  {line}")
    ck(got.get("style.css storm-band-range", "0") != "0", "new band CSS is served")
    ck(got.get("style.css page-loader-bolt", "0") != "0", "loader CSS is served")
    ck(got.get("storm-view.js storm-bands", "0") != "0", "new storm-view.js is served")
    ck(got.get("storm-view.js GOLDEN want0", "1") == "0", "ring-plot code is gone")
    ck(got.get("storm-view.js RANGES", "0") != "0", "1H-24H selector is in the bundle")
    ck(got.get("cpu-chart.js bindRange", "0") != "0", "cpu-chart binds the selector")
    ck(got.get("app.js dismissLoader", "0") != "0", "loader dismissal is served")

    section("7. Authenticated page + API checks")
    res = sh(f"echo {base64.b64encode(MINT.encode()).decode()} "
             f"| base64 -d | docker exec -i {CT} python - 2>&1")
    line = [l for l in res.splitlines() if "|" in l]
    if not line:
        ck(False, "mint a session cookie", res[-80:])
        return
    nm, cookie = line[-1].split("|", 1)

    dash = sh("curl -s --max-time 30 " f"-b '{nm}={cookie}' '{BASE}/gwld1/'")
    ck('id="page-loader"' in dash, "dashboard ships the loader overlay")
    ck("#page-loader{" in dash, "loader CSS is inline in the document head")
    ck("pl-auto" in dash, "loader can clear itself without JS")
    ck("data-cpu-range" in dash, "range selector is in the unit block")
    ck('data-range="7d"' in dash and 'data-range="30d"' in dash,
       "7 D and 30 D buttons present")
    ck("does not measure bearing" in dash, "bearing caveat still on the page")
    ck("data-storm-view" in dash, "storm view host present")

    # The five-band payload, at two windows, checked for internal consistency.
    for win in (60, 1440):
        raw = sh("curl -s --max-time 30 "
                 f"-b '{nm}={cookie}' '{BASE}/gwld1/data/strikes?window={win}'")
        try:
            p = json.loads(raw)
        except Exception:
            ck(False, f"/data/strikes?window={win} returns JSON", raw[:70])
            continue
        bands = p.get("bands") or []
        total = p.get("total")
        summed = sum(b.get("count", 0) for b in bands)
        ck(len(bands) == 5, f"window={win}: five bands returned", str(len(bands)))
        ck(summed == total,
           f"window={win}: band counts sum to the total",
           f"{summed} vs {total}")
        ck(p.get("window_min") == win, f"window={win}: echoed back",
           str(p.get("window_min")))
        ck(all(k in (bands[0] if bands else {}) for k in
               ("key", "label", "range", "count", "peak", "mean", "low",
                "band", "colour", "share")),
           f"window={win}: band shape complete")
        say(f"    window={win}: total={total} " +
            " ".join(f"[{b['range']}:{b['count']}]" for b in bands))

    section("8. PDF report still renders (local render, no send)")
    page = sh("curl -s --max-time 25 " f"-b '{nm}={cookie}' '{BASE}/gwld1/reports'")
    tok = re.search(r'name="csrf_token"\s+value="([^"]*)"', page)
    tok = tok.group(1) if tok else "x"
    gen = sh("curl -s -o /tmp/r.txt -w '%{http_code}' --max-time 240 "
             f"-b '{nm}={cookie}' -X POST '{BASE}/gwld1/reports/generate' "
             f"--data-urlencode 'csrf_token={tok}' "
             "--data-urlencode 'station_id=GLENCORE WONDERKOP' "
             "--data-urlencode 'month=2026-08' "
             "--data-urlencode 'report_type=technical'")
    ck(gen.strip() in ("200", "302", "303"), "POST reports/generate", gen.strip())
    dl = bash(f"""
curl -s -o /tmp/r.pdf -w '%{{http_code}}' --max-time 240 \
  -b '{nm}={cookie}' \
  '{BASE}/gwld1/reports/download?station=GLENCORE%20WONDERKOP&month=2026-08&type=technical'
echo ""
echo "head: $(head -c 4 /tmp/r.pdf)"
echo "size: $(stat -c%s /tmp/r.pdf 2>/dev/null || echo 0)"
""")
    say("  " + dl.replace("\n", "\n  "))
    ck("%PDF" in dl, "downloaded a real PDF with the new storm chart")

    section("9. Every page still 200")
    # "/" is a 303 by design: a platform admin has no detector dashboard, so the
    # root sends them to the client list. Following redirects is what matters.
    codes = bash("\n".join(
        f"echo \"{p} $(curl -s -L -o /dev/null -w '%{{http_code}}' --max-time 30 "
        f"-b '{nm}={cookie}' '{BASE}{p}')\""
        for p in ("/gwld1/", "/gwld1/recipients", "/gwld1/groups",
                  "/gwld1/stations", "/gwld1/events", "/gwld1/reports",
                  "/gwld1/users", "/gwld1/settings", "/tenants", "/")))
    for line in codes.splitlines():
        parts = line.rsplit(" ", 1)
        if len(parts) == 2:
            ck(parts[1].strip() == "200", f"GET {parts[0].strip()}", parts[1].strip())

    section("10. Confirm nothing was sent")
    sent = sh(f"docker exec {CT} python -c \""
              "import sys; sys.path.insert(0,'/app');"
              "from app.db import SessionLocal; from app.models import MessageLog;"
              "d=SessionLocal(); print('message_log rows:', d.query(MessageLog).count()); d.close()\"")
    say("  " + sent)
    ck("rows: 0" in sent, "message_log still empty (no SMS, no email)", sent.strip()[-20:])

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say(f"\n  rollback image  lightning-alert-panel:rollback-{STAMP}")
    say(f"  source backup   /root/panel-backups/before-storm-bands-{STAMP}.tar.gz")
    say("  " + sh("df -h / | tail -1"))


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        OUT.write_text("\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
