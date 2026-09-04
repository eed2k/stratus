"""Deploy the internal-server-error fix and the new cloud/bolt artwork.

WHAT CHANGES

  Root cause of the 500 on POST /tenants/create
    The live database carries a table-level UNIQUE(groups.name) left by an older
    models.py, which the current models deliberately do not declare: group names
    are unique per tenant, because two clients may each have a "control room".
    Every tenant is seeded with a group called "default", so creating the second
    client panel violated it and the request 500'd.

    app/bootstrap.py    drop_stale_unique_constraints() removes it. SQLite cannot
                        ALTER a table-level UNIQUE away, so `groups` is rebuilt
                        from current ORM metadata and the rows copied across.
                        ensure_tenant_defaults() then repairs any panel left
                        without its default group.
    app/main.py         runs both at startup, before anything seeds a group, and
                        adds a last-resort error page so an unexpected failure
                        is a readable page with a reference rather than a bare
                        "Internal Server Error".
    app/routes/web.py   tenant_create is now ONE transaction: it used to commit
                        the tenant, then the admin user and group separately, so
                        a failure on the second commit left a panel nobody could
                        sign in to. group_create, recipient_create and
                        users_create now report duplicates on the form instead of
                        raising.

  Artwork, panel and demo identical
    smaller cloud (viewBox 104x78, width capped), one zigzag, blue-white channel,
    60% thicker (5.4 units at the base, was 3.4), and a flash that stays visible
    for 2260 ms instead of 260 ms.

THIS TOUCHES THE LIVE DATABASE
  The `groups` table is rebuilt in place. data/panel.db is copied to
  /root/panel-backups first, row counts are compared before and after, and the
  previous image is tagged for rollback. Nothing here sends an SMS or an email.
"""
from __future__ import annotations

import base64
import io
import os
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

PANEL_DIR, PANEL_CF, PANEL_SVC, PANEL_CT = ("/opt/lightning-panel",
                                            "docker-compose.traefik.yml",
                                            "panel", "lightning-alert-panel")
DEMO_DIR = "/opt/lightning-demo"
BASE = "https://adminpanel.stratusweather.co.za"
DEMO = "https://lightningdemo.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/panelfix.log", "/root/panelfix.done"
OUT = Path("backups/_deploy_panel_fixes.txt")

PANEL_ROOT = Path("LDS ADMIN")
PANEL_FILES = [
    "app/bootstrap.py",
    "app/main.py",
    "app/routes/web.py",
    "app/charts.py",
    "app/static/style.css",
    "app/static/js/storm-view.js",
    "app/templates/groups.html",
    "app/templates/recipients.html",
    "app/templates/users.html",
    "tests/test_create_routes.py",
]
DEMO_ROOT = Path("lightning-demo")
DEMO_FILES = ["site/index.html", "site/demo.js", "site/demo.css",
              "site/style.css"]

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


def incontainer(py: str, timeout=600):
    """Run python inside the panel container, so the RUNNING code is measured."""
    return sh(f"echo {base64.b64encode(py.encode()).decode()} "
              f"| base64 -d | docker exec -i {PANEL_CT} python - 2>&1", timeout)


def upload(root: Path, files, dest: str, tag: str) -> None:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in files:
            tf.add(root / f, arcname=f)
    payload = buf.getvalue()
    say(f"  {tag}: {len(payload):,} B")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(payload), f"/tmp/{tag}-{STAMP}.tar.gz")
    finally:
        c.close()
    say(bash(f"""
cd {dest}
mkdir -p /root/panel-backups
tar -czf /root/panel-backups/before-{tag}-{STAMP}.tar.gz {' '.join(files)} 2>/dev/null \
  && echo "  code backup /root/panel-backups/before-{tag}-{STAMP}.tar.gz"
tar -xzf /tmp/{tag}-{STAMP}.tar.gz && echo "  extract ok"
rm -f /tmp/{tag}-{STAMP}.tar.gz
"""))


# Reads the live schema. Run before and after so the migration is proven, not
# assumed.
SCHEMA_PROBE = r'''
import os, sqlite3, json
url = os.environ.get("DATABASE_URL", "")
path = url.split("sqlite:///")[-1]
if path.startswith("./"):
    path = "/app/" + path[2:]
con = sqlite3.connect(path)
cur = con.cursor()
out = {"unique": [], "counts": {}, "recipients_fk": [], "tenants": []}
tables = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
for t in tables:
    for (seq, name, uniq, origin, partial) in cur.execute(
            "PRAGMA index_list('%s')" % t).fetchall():
        if uniq:
            cols = [r[2] for r in cur.execute(
                "PRAGMA index_info('%s')" % name).fetchall()]
            out["unique"].append([t, name, cols, origin])
    try:
        out["counts"][t] = cur.execute("SELECT COUNT(*) FROM '%s'" % t).fetchone()[0]
    except Exception as e:
        out["counts"][t] = "err:%s" % e
row = cur.execute("SELECT sql FROM sqlite_master WHERE type='table' "
                  "AND name='recipients'").fetchone()
out["recipients_sql"] = row[0] if row else ""
# fetchall() first, and a separate cursor for the per-tenant counts. Running the
# inner queries on `cur` while iterating it replaces the result set mid-loop, so
# only the first tenant is ever seen and the numbers are meaningless.
tenant_rows = cur.execute("SELECT id, slug FROM tenants ORDER BY id").fetchall()
cur2 = con.cursor()
for (tid, slug) in tenant_rows:
    nu = cur2.execute("SELECT COUNT(*) FROM users WHERE tenant_id=?",
                      (tid,)).fetchone()[0]
    ng = cur2.execute("SELECT COUNT(*) FROM groups WHERE tenant_id=?",
                      (tid,)).fetchone()[0]
    out["tenants"].append([tid, slug, nu, ng])
out["stale_tables"] = [t for t in tables if t.endswith("__stale")]
con.close()
print("JSON:" + json.dumps(out))
'''

# Exercises the fixed code paths against the live database inside a rolled-back
# transaction, so the 500 is proven fixed WITHOUT leaving test tenants behind.
BEHAVIOR_PROBE = r'''
import sys
sys.path.insert(0, "/app")
from sqlalchemy.exc import IntegrityError
from app.db import SessionLocal
from app.models import Tenant, User, Group

db = SessionLocal()
try:
    # The exact insert that used to fail: a second group named "default".
    existing = db.query(Group).filter(Group.name == "default").count()
    print("EXISTING_DEFAULT_GROUPS", existing)
    t = Tenant(slug="__probe_only__", name="Probe", site_name="Probe",
               is_active=True)
    db.add(t)
    db.flush()
    db.add(Group(tenant_id=t.id, name="default",
                 description="probe", distance_threshold_km=15, is_active=True))
    db.add(User(email="__probe_only__@invalid.test",
                password_hash="x", role="admin", is_active=True,
                tenant_id=t.id, is_platform_admin=False))
    db.flush()
    print("DUPLICATE_DEFAULT_GROUP_ACCEPTED True")
except IntegrityError as exc:
    print("DUPLICATE_DEFAULT_GROUP_ACCEPTED False", str(exc)[:160])
finally:
    # Never committed: the probe leaves no tenant, user or group behind.
    db.rollback()
    db.close()

db = SessionLocal()
try:
    print("PROBE_TENANT_LEFT_BEHIND",
          db.query(Tenant).filter(Tenant.slug == "__probe_only__").count())
    print("PROBE_USER_LEFT_BEHIND",
          db.query(User).filter(
              User.email == "__probe_only__@invalid.test").count())
    # Every tenant must now own a default group.
    missing = [t.slug for t in db.query(Tenant).all()
               if db.query(Group).filter(Group.tenant_id == t.id).count() == 0]
    print("TENANTS_WITHOUT_A_GROUP", missing)
finally:
    db.close()
'''

# The report renderer, from the running image.
ART_PROBE = r'''
import sys, re, xml.etree.ElementTree as ET
sys.path.insert(0, "/app")
from app import charts

out, center = charts._bolt_geometry(52.0, 43.0, 72.0, 0)
pairs = re.findall(r"[-\d.]+ [-\d.]+", out)
print("CENTER_POINTS", len(center.split()))
print("OUTLINE_POINTS", len(pairs))
print("TIP_SHARED", pairs[2] == pairs[3])
xs = [float(p.split(" ")[0]) for p in pairs]
print("BASE_WIDTH", round(abs(xs[-1] - xs[0]), 2))
print("CLOSED", out.endswith("Z"))

class S:
    def __init__(s, km, e):
        s.distance_km = km; s.energy = e
        from app.timeutil import now_sast
        s.timestamp = now_sast()

svg = charts.storm_bands_svg([S(0.5, 1900000), S(6, 1200000), S(15, 700000),
                              S(24, 400000), S(36, 250000)])
ET.fromstring(svg)
print("SVG_WELL_FORMED True")
print("BOLT_COLOR_IN_SVG", charts._BOLT_MAIN in svg)
print("CORE_WIDTH_13", 'stroke-width="1.3"' in svg)
print("NO_NAN", not re.search(r"NaN|None|Infinity", svg))
print("DETERMINISTIC", svg == charts.storm_bands_svg(
    [S(0.5, 1900000), S(6, 1200000), S(15, 700000),
     S(24, 400000), S(36, 250000)]))
'''


def parse_json_line(text):
    import json
    for line in text.splitlines():
        if line.startswith("JSON:"):
            return json.loads(line[5:])
    return None


def main() -> None:
    section("0. Pre-flight: local files")
    for f in PANEL_FILES:
        p = PANEL_ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing {p}")
        say(f"  panel  {f:<40} {p.stat().st_size:>8,} B")
    for f in DEMO_FILES:
        p = DEMO_ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing {p}")
        say(f"  demo   {f:<40} {p.stat().st_size:>8,} B")

    section("1. Back up the live database and tag a rollback image")
    say(bash(f"""
mkdir -p /root/panel-backups
cp {PANEL_DIR}/data/panel.db /root/panel-backups/panel-{STAMP}.db \
  && echo "  db backup /root/panel-backups/panel-{STAMP}.db "\
"($(stat -c%s /root/panel-backups/panel-{STAMP}.db) bytes)"
ls -la {PANEL_DIR}/data/panel.db | sed 's/^/  live  /'
"""))
    bkp = sh(f"test -s /root/panel-backups/panel-{STAMP}.db && echo OK")
    ck("OK" in bkp, "live database backed up before the migration")

    img = sh(f"docker inspect {PANEL_CT} --format '{{{{.Config.Image}}}}'").strip()
    say("  " + sh(f"docker tag {img} lightning-alert-panel:rollback-{STAMP} "
                  f"&& echo tagged lightning-alert-panel:rollback-{STAMP}"))

    section("2. Schema BEFORE the migration")
    before = parse_json_line(incontainer(SCHEMA_PROBE))
    if before is None:
        raise SystemExit("could not read the schema before migrating")
    for t, name, cols, origin in before["unique"]:
        say(f"  unique  {t:<20} {name:<34} {cols}")
    say(f"  counts  {before['counts']}")
    for tid, slug, nu, ng in before["tenants"]:
        flag = "  <-- no group" if ng == 0 else ""
        say(f"  tenant  {tid:<3} {slug:<16} users={nu} groups={ng}{flag}")
    had_stale = any(t == "groups" and "name" in cols
                    for t, _n, cols, _o in before["unique"])
    say(f"  stale UNIQUE(groups.name) present: {had_stale}")
    groups_before = before["counts"].get("groups")
    incomplete_before = [s for _i, s, _u, g in before["tenants"] if g == 0]
    say(f"  tenants with no group: {incomplete_before or 'none'}")

    section("3. Upload")
    upload(PANEL_ROOT, PANEL_FILES, PANEL_DIR, "panel")

    section("4. Build")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {PANEL_DIR} && setsid nohup sh -c "
                  f"'docker compose -f {PANEL_CF} build {PANEL_SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' >/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code = None
    for _ in range(150):
        time.sleep(20)
        d = sh(f"cat {DONE} 2>/dev/null || true")
        if d.strip():
            code = int(d.strip()) if d.strip().isdigit() else -1
            break
    say(f"  build exit {code}")
    if code != 0:
        say(sh(f"tail -30 {LOG}"))
        ck(False, "panel image built")
        say("  BUILD FAILED - the running container was NOT replaced.")
        return
    ck(True, "panel image built")

    section("5. Recreate and wait for health")
    say(sh(f"cd {PANEL_DIR} && docker compose -f {PANEL_CF} up -d --no-deps "
           f"{PANEL_SVC} 2>&1 | tail -5"))
    healthy = False
    for i in range(60):
        if "healthy" in sh("docker inspect -f "
                           "'{{.State.Status}}/{{.State.Health.Status}}' "
                           f"{PANEL_CT} 2>/dev/null"):
            say(f"  healthy after {i*5}s")
            healthy = True
            break
        time.sleep(5)
    ck(healthy, "panel healthy after recreate")

    section("6. The migration actually ran")
    startup = sh(f"docker logs {PANEL_CT} --since 10m 2>&1 | "
                 "grep -Ei 'schema:|seeded|bootstrap|rebuilt|stale' | tail -20")
    say(startup or "  (no schema lines logged)")
    ck("rebuilt groups" in startup or not had_stale,
       "stale constraint removed (logged)",
       "was already absent" if not had_stale else "")

    section("7. Schema AFTER the migration")
    after = parse_json_line(incontainer(SCHEMA_PROBE))
    if after is None:
        raise SystemExit("could not read the schema after migrating")
    for t, name, cols, origin in after["unique"]:
        say(f"  unique  {t:<20} {name:<34} {cols}")
    say(f"  counts  {after['counts']}")
    for tid, slug, nu, ng in after["tenants"]:
        say(f"  tenant  {tid:<3} {slug:<16} users={nu} groups={ng}")

    still = [(t, cols) for t, _n, cols, _o in after["unique"]
             if t == "groups" and "name" in cols]
    ck(not still, "UNIQUE(groups.name) is gone", str(still) or "none")

    # Genuinely unique things must survive.
    slug_u = any(t == "tenants" and "slug" in cols
                 for t, _n, cols, _o in after["unique"])
    email_u = any(t == "users" and "email" in cols
                  for t, _n, cols, _o in after["unique"])
    ck(slug_u, "UNIQUE(tenants.slug) preserved")
    ck(email_u, "UNIQUE(users.email) preserved")

    ck(after["counts"].get("groups", -1) >= (groups_before or 0),
       "no groups lost in the rebuild",
       f"{groups_before} -> {after['counts'].get('groups')}")
    for t in ("users", "tenants", "heartbeat_samples", "calibration_events",
              "alert_events", "unit_status"):
        b, a = before["counts"].get(t), after["counts"].get(t)
        ck(a == b, f"{t} row count unchanged", f"{b} -> {a}")

    ck(not after.get("stale_tables"), "no leftover __stale table",
       str(after.get("stale_tables")) or "none")
    ck("REFERENCES groups" in after.get("recipients_sql", "")
       and "groups__stale" not in after.get("recipients_sql", ""),
       "recipients.group_id still references groups")

    incomplete_after = [s for _i, s, _u, g in after["tenants"] if g == 0]
    ck(not incomplete_after, "every tenant now has a default group",
       f"repaired {incomplete_before}" if incomplete_before else "none needed")

    section("8. The 500 is fixed, proven against the live database")
    say("  A duplicate 'default' group is inserted inside a transaction that is "
        "then\n  rolled back, so this proves the constraint without creating a "
        "tenant.")
    beh = incontainer(BEHAVIOR_PROBE)
    for line in beh.splitlines():
        say("    " + line)
    ck("DUPLICATE_DEFAULT_GROUP_ACCEPTED True" in beh,
       "a second tenant may have a group named 'default'")
    ck("PROBE_TENANT_LEFT_BEHIND 0" in beh, "probe left no tenant behind")
    ck("PROBE_USER_LEFT_BEHIND 0" in beh, "probe left no user behind")
    ck("TENANTS_WITHOUT_A_GROUP []" in beh, "no tenant is missing a group")

    section("9. Report renderer, from the running image")
    art = incontainer(ART_PROBE)
    for line in art.splitlines():
        say("    " + line)
    ck("CENTER_POINTS 3" in art, "one zigzag in the report bolt")
    ck("OUTLINE_POINTS 6" in art, "outline has 6 points")
    ck("TIP_SHARED True" in art, "report bolt tip converges to a point")
    ck("BASE_WIDTH 5.4" in art, "report bolt is 5.4 units wide (60% thicker)")
    ck("SVG_WELL_FORMED True" in art, "report SVG well formed")
    ck("BOLT_COLOR_IN_SVG True" in art, "report bolt uses the lightning blue")
    ck("CORE_WIDTH_13 True" in art, "report core stroke is 1.3")
    ck("NO_NAN True" in art, "no NaN in the report SVG")
    ck("DETERMINISTIC True" in art, "report SVG still deterministic")

    section("10. Served assets carry the new artwork")
    served = bash(f"""
CSS=$(curl -s --max-time 30 '{BASE}/static/style.css')
JS=$(curl -s --max-time 30 '{BASE}/static/js/storm-view.js')
echo "css max-width 104px : $(printf '%s' \"$CSS\" | grep -c 'max-width: 104px')"
echo "css 2260ms          : $(printf '%s' \"$CSS\" | grep -c '2260ms')"
echo "css bolt blue-white : $(printf '%s' \"$CSS\" | grep -c '#eaf4ff')"
echo "css warm yellow was0: $(printf '%s' \"$CSS\" | grep -c 'fff6cc')"
echo "js viewBox 104x78   : $(printf '%s' \"$JS\" | grep -c 'VB_W = 104, VB_H = 78')"
echo "js one kink         : $(printf '%s' \"$JS\" | grep -c 'k1, y1\\], \\[0, H\\]')"
echo "js widths 5.4       : $(printf '%s' \"$JS\" | grep -c '5.4, 3.7, 0')"
echo "js hold 2260        : $(printf '%s' \"$JS\" | grep -c 'FLASH_HOLD_MS = 2260')"
echo "js BOLT_MAIN        : $(printf '%s' \"$JS\" | grep -c 'BOLT_MAIN')"
echo "js two-kink k2 was0 : $(printf '%s' \"$JS\" | grep -c 'var k2')"
""")
    got = {}
    for line in served.splitlines():
        if ":" in line:
            k, v = line.rsplit(":", 1)
            got[k.strip()] = v.strip()
            say(f"  {line}")
    ck(got.get("css max-width 104px") != "0", "served CSS caps the cloud width")
    ck(got.get("css 2260ms") != "0", "served CSS holds the flash 2260ms")
    ck(got.get("css bolt blue-white") != "0", "served CSS has the blue-white bolt")
    ck(got.get("css warm yellow was0") == "0", "warm yellow flash gone")
    ck(got.get("js viewBox 104x78") != "0", "served JS has the smaller viewBox")
    ck(got.get("js one kink") != "0", "served JS bolt has one kink")
    ck(got.get("js widths 5.4") != "0", "served JS bolt is 60% thicker")
    ck(got.get("js hold 2260") != "0", "served JS knows the 2260ms hold")
    ck(got.get("js two-kink k2 was0") == "0", "second kink removed")

    section("11. Demo updated in step (bind mount, no rebuild)")
    # The demo's stylesheet IS the console's. Copy it before uploading, exactly
    # as deploy_demo_site.py does: the checked-in copy under lightning-demo is a
    # build artifact, and uploading it unrefreshed shipped the demo a stylesheet
    # without the width cap or the 2260 ms flash.
    import shutil
    src = PANEL_ROOT / "app/static/style.css"
    dst = DEMO_ROOT / "site/style.css"
    shutil.copyfile(src, dst)
    say(f"  copied {src.name} -> {dst} ({dst.stat().st_size:,} B)")
    ck(dst.read_bytes() == src.read_bytes(),
       "demo stylesheet refreshed from the console's")
    upload(DEMO_ROOT, DEMO_FILES, DEMO_DIR, "demo")
    dserved = bash(f"""
DJS=$(curl -s --max-time 30 '{DEMO}/demo.js')
DCSS=$(curl -s --max-time 30 '{DEMO}/style.css')
echo "demo viewBox 104x78 : $(printf '%s' \"$DJS\" | grep -c 'VB_W = 104, VB_H = 78')"
echo "demo widths 5.4     : $(printf '%s' \"$DJS\" | grep -c '5.4, 3.7, 0')"
echo "demo hold 2260      : $(printf '%s' \"$DJS\" | grep -c 'FLASH_HOLD_MS = 2260')"
echo "demo css 2260ms     : $(printf '%s' \"$DCSS\" | grep -c '2260ms')"
echo "demo css maxwidth   : $(printf '%s' \"$DCSS\" | grep -c 'max-width: 104px')"
echo "demo state gone was0: $(curl -s --max-time 30 '{DEMO}/' | grep -c 'Detector state')"
echo "demo title          : $(curl -s --max-time 30 '{DEMO}/' | grep -o '<title>[^<]*</title>')"
""")
    d = {}
    for line in dserved.splitlines():
        if ":" in line:
            k, v = line.rsplit(":", 1)
            d[k.strip()] = v.strip()
            say(f"  {line}")
    ck(d.get("demo viewBox 104x78") != "0", "demo matches the panel viewBox")
    ck(d.get("demo widths 5.4") != "0", "demo bolt is 60% thicker")
    ck(d.get("demo hold 2260") != "0", "demo knows the 2260ms hold")
    ck(d.get("demo css 2260ms") != "0", "demo inherited the 2260ms flash")
    ck(d.get("demo css maxwidth") != "0", "demo inherited the width cap")
    ck(d.get("demo state gone was0") == "0", "Detector state block still gone")
    ck("Lightning Data Demonstration" in d.get("demo title", ""),
       "demo tab title intact")

    section("12. No route 500s, and nothing was sent")
    routes = bash(f"""
for p in /login /static/style.css /static/js/storm-view.js /api/v1/health; do
  printf "  %-32s HTTP %s\\n" "$p" \
    "$(curl -s -o /dev/null -w '%{{http_code}}' --max-time 25 '{BASE}'$p)"
done
for u in https://stratusweather.co.za/ {DEMO}/ https://info.stratusweather.co.za/; do
  printf "  %-32s HTTP %s\\n" "$u" \
    "$(curl -s -L -o /dev/null -w '%{{http_code}}' --max-time 25 $u)"
done
echo "--- any 5xx since the restart ---"
docker logs {PANEL_CT} --since 10m 2>&1 | grep -E '" 5[0-9][0-9] ' | tail -10 \
  || echo "  none"
echo "--- tracebacks since the restart ---"
docker logs {PANEL_CT} --since 10m 2>&1 | grep -c 'Traceback' | sed 's/^/  count /'
echo "--- containers ---"
docker ps --format '  {{{{.Names}}}}  {{{{.Status}}}}' | grep -Ei 'stratus|lightning|info'
echo "--- disk ---"
df -h / | tail -1 | sed 's/^/  /'
""")
    say(routes)
    ck(routes.count("HTTP 200") >= 6, "all endpoints and sites answer 200",
       f"{routes.count('HTTP 200')} x 200")
    ck('" 500 ' not in routes and '" 502 ' not in routes,
       "no 5xx since the restart")
    ck("count 0" in routes, "no tracebacks since the restart")

    sent = incontainer(
        "import sys; sys.path.insert(0,'/app')\n"
        "from app.db import SessionLocal\n"
        "from app.models import MessageLog, AlertEvent\n"
        "d=SessionLocal()\n"
        "print('message_log rows:', d.query(MessageLog).count())\n"
        "print('alert_events rows:', d.query(AlertEvent).count())\n"
        "d.close()")
    say("  " + sent.replace("\n", "\n  "))
    ck("message_log rows: 0" in sent, "message_log still empty: nothing was sent")

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say()
    say(f"  panel      {BASE}/")
    say(f"  demo       {DEMO}/")
    say(f"  db backup  /root/panel-backups/panel-{STAMP}.db")
    say(f"  rollback   docker tag lightning-alert-panel:rollback-{STAMP} {img} "
        f"&& cd {PANEL_DIR} && docker compose -f {PANEL_CF} up -d {PANEL_SVC}")


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
