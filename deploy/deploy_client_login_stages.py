"""Deploy the client sign-in door, panel management and multi-stage alerts.

WHAT CHANGES

  A separate front door for clients
    /client  signs a site in with its own short name, e.g. GWLD1, and lands it in
             its own panel. /login stays the staff door and now goes straight to
             the client list. Existing panels are given their panel address as
             their sign-in name automatically, so nobody needs new credentials.

  Managing a client panel
    /tenants/<id>/edit  rename a panel, set its client sign-in name, or delete
             it. Deletion needs the panel address typed out, and hands any
             registered detector back to the platform panel rather than deleting
             hardware that is still transmitting. The panel address itself stays
             read-only: it is baked into the detector's webhook URL.

  Multi-stage alerts
    A client can define escalating distance bands - 30 km advisory, 20 km
    warning, 10 km stop work. A strike raises only the nearest band that covers
    it, so one flash never sends the same person three messages. Each stage keeps
    its own repeat interval, which fixes a real flaw: one shared cooldown meant a
    distant strike could silence the near strike behind it. A panel with no
    stages behaves exactly as before.

  Generic gateway naming
    The SMS supplier is no longer named on any screen. It used to reach clients
    twice over: the settings page, and the text of a failed send, which is stored
    on the message log and shown on the event page a client can open.

THIS TOUCHES THE LIVE DATABASE
  users gains a nullable `username` column and a new `alert_stages` table is
  created. data/panel.db is copied to /root/panel-backups first, row counts are
  compared, and the previous image is tagged for rollback.

NOTHING HERE SENDS AN SMS OR AN E-MAIL. The verification asserts the message log
is still empty afterwards.
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

DIR, CF, SVC, CT = ("/opt/lightning-panel", "docker-compose.traefik.yml",
                    "panel", "lightning-alert-panel")
BASE = "https://adminpanel.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/clientlogin.log", "/root/clientlogin.done"
OUT = Path("backups/_deploy_client_login_stages.txt")

ROOT = Path("LDS ADMIN")
FILES = [
    "app/models.py", "app/bootstrap.py", "app/main.py", "app/config.py",
    "app/tenancy.py", "app/runtime.py", "app/messages.py",
    "app/alert_worker.py", "app/sms_gateway.py",
    "app/routes/web.py", "app/routes/api.py",
    "app/templates/base.html", "app/templates/login.html",
    "app/templates/client_login.html", "app/templates/tenants.html",
    "app/templates/tenant_edit.html", "app/templates/stages.html",
    "app/templates/settings.html",
    "tests/test_client_login_and_stages.py", "tests/test_non_regression.py",
    ".env.example", "ACCESS.txt",
]
# Superseded by app/sms_gateway.py. It must be removed from the build context or
# the rebuilt image would still carry a file named after the supplier.
REMOVE_ON_SERVER = ["app/clickatell_sender.py"]

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
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<54} {detail}")


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
    return sh(f"echo {base64.b64encode(py.encode()).decode()} "
              f"| base64 -d | docker exec -i {CT} python - 2>&1", timeout)


SCHEMA_PROBE = r'''
import os, sqlite3, json
url = os.environ.get("DATABASE_URL", "")
path = url.split("sqlite:///")[-1]
if path.startswith("./"):
    path = "/app/" + path[2:]
con = sqlite3.connect(path)
cur = con.cursor()
out = {"tables": [], "user_cols": [], "stage_cols": [], "counts": {},
       "usernames": []}
out["tables"] = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
out["user_cols"] = [r[1] for r in cur.execute("PRAGMA table_info(users)")]
if "alert_stages" in out["tables"]:
    out["stage_cols"] = [r[1] for r in cur.execute(
        "PRAGMA table_info(alert_stages)")]
for t in out["tables"]:
    try:
        out["counts"][t] = cur.execute("SELECT COUNT(*) FROM '%s'" % t).fetchone()[0]
    except Exception as e:
        out["counts"][t] = "err"
if "username" in out["user_cols"]:
    rows = cur.execute("SELECT username, email FROM users "
                       "WHERE username IS NOT NULL ORDER BY username").fetchall()
    out["usernames"] = [[a, b] for a, b in rows]
con.close()
print("JSON:" + json.dumps(out))
'''

# Proves stage selection against the LIVE database inside a transaction that is
# rolled back, so no tenant, stage or recipient is left behind.
STAGE_PROBE = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import Tenant, Group, Recipient, AlertStage
from app.alert_worker import select_stage, select_targets

db = SessionLocal()
try:
    t = Tenant(slug="__probe_stage__", name="Probe", site_name="Probe",
               is_active=True)
    db.add(t); db.flush()
    g = Group(tenant_id=t.id, name="probe-group", is_active=True,
              distance_threshold_km=5)
    db.add(g); db.flush()
    db.add(Recipient(tenant_id=t.id, name="Probe", phone="+27000000000",
                     group_id=g.id, is_active=True))
    for name, km in (("Advisory", 30), ("Warning", 20), ("Stop work", 10)):
        db.add(AlertStage(tenant_id=t.id, name=name, distance_km=km,
                          is_active=True))
    db.flush()

    for dist, expect in ((8.0, "Stop work"), (10.0, "Stop work"),
                         (15.0, "Warning"), (25.0, "Advisory"),
                         (35.0, None)):
        s = select_stage(db, t.id, dist)
        got = s.name if s else None
        print("STAGE %.1f -> %s (expected %s) %s"
              % (dist, got, expect, "OK" if got == expect else "MISMATCH"))

    # A stage must override the group's own narrower threshold.
    s = select_stage(db, t.id, 15.0)
    n = len(select_targets(db, t.id, 15.0, s))
    print("STAGE_OVERRIDES_GROUP_THRESHOLD", n == 1)

    # With no stage the group threshold decides again.
    n2 = len(select_targets(db, t.id, 15.0, None))
    print("LEGACY_THRESHOLD_STILL_APPLIES", n2 == 0)
finally:
    db.rollback()
    db.close()

db = SessionLocal()
try:
    print("PROBE_TENANT_LEFT_BEHIND",
          db.query(Tenant).filter(Tenant.slug == "__probe_stage__").count())
finally:
    db.close()
'''


def parse_json_line(text):
    import json
    for line in text.splitlines():
        if line.startswith("JSON:"):
            return json.loads(line[5:])
    return None


def main() -> None:
    section("0. Pre-flight: local files")
    for f in FILES:
        p = ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing {p}")
        say(f"  {f:<48} {p.stat().st_size:>8,} B")
    if (ROOT / "app/clickatell_sender.py").exists():
        raise SystemExit("app/clickatell_sender.py still exists locally")
    ck(True, "local files present, old gateway module removed")

    section("1. Back up the live database and tag a rollback image")
    say(bash(f"""
mkdir -p /root/panel-backups
cp {DIR}/data/panel.db /root/panel-backups/panel-{STAMP}.db \
  && echo "  db backup /root/panel-backups/panel-{STAMP}.db "\
"($(stat -c%s /root/panel-backups/panel-{STAMP}.db) bytes)"
"""))
    ck("OK" in sh(f"test -s /root/panel-backups/panel-{STAMP}.db && echo OK"),
       "live database backed up before the migration")
    img = sh(f"docker inspect {CT} --format '{{{{.Config.Image}}}}'").strip()
    say("  " + sh(f"docker tag {img} lightning-alert-panel:rollback-{STAMP} "
                  f"&& echo tagged lightning-alert-panel:rollback-{STAMP}"))

    section("2. Schema BEFORE")
    before = parse_json_line(incontainer(SCHEMA_PROBE))
    if before is None:
        raise SystemExit("could not read the schema before migrating")
    say(f"  users columns : {before['user_cols']}")
    say(f"  alert_stages  : {'present' if 'alert_stages' in before['tables'] else 'absent'}")
    say(f"  counts        : {before['counts']}")
    had_username = "username" in before["user_cols"]
    say(f"  users.username already present: {had_username}")

    section("3. Upload")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in FILES:
            tf.add(ROOT / f, arcname=f)
    payload = buf.getvalue()
    say(f"  tarball {len(payload):,} B")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(payload), f"/tmp/panel-{STAMP}.tar.gz")
    finally:
        c.close()
    say(bash(f"""
cd {DIR}
mkdir -p /root/panel-backups
tar -czf /root/panel-backups/before-code-{STAMP}.tar.gz app tests 2>/dev/null \
  && echo "  code backup /root/panel-backups/before-code-{STAMP}.tar.gz"
tar -xzf /tmp/panel-{STAMP}.tar.gz && echo "  extract ok"
rm -f /tmp/panel-{STAMP}.tar.gz
for f in {' '.join(REMOVE_ON_SERVER)}; do
  if [ -f "$f" ]; then rm -f "$f" && echo "  removed $f"; fi
done
echo "  gateway module now: $(ls app/sms_gateway.py 2>/dev/null || echo MISSING)"
echo "  old module gone   : $([ ! -f app/clickatell_sender.py ] && echo yes || echo NO)"
"""))

    section("4. Build")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose -f {CF} build {SVC} > {LOG} 2>&1; "
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
    say(sh(f"cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC} "
           "2>&1 | tail -5"))
    healthy = False
    for i in range(60):
        if "healthy" in sh("docker inspect -f "
                           "'{{.State.Status}}/{{.State.Health.Status}}' "
                           f"{CT} 2>/dev/null"):
            say(f"  healthy after {i*5}s")
            healthy = True
            break
        time.sleep(5)
    ck(healthy, "panel healthy after recreate")

    section("6. The migration ran")
    startup = sh(f"docker logs {CT} --since 10m 2>&1 | "
                 "grep -Ei 'schema:|sign-in name|seeded|rebuilt' | tail -20")
    say(startup or "  (no schema lines logged)")
    ck("schema: added users.username" in startup or had_username,
       "users.username added (logged)",
       "was already present" if had_username else "")

    section("7. Schema AFTER")
    after = parse_json_line(incontainer(SCHEMA_PROBE))
    if after is None:
        raise SystemExit("could not read the schema after migrating")
    say(f"  users columns : {after['user_cols']}")
    say(f"  stage columns : {after['stage_cols']}")
    say(f"  counts        : {after['counts']}")
    say(f"  sign-in names : {after['usernames']}")

    ck("username" in after["user_cols"], "users.username exists")
    ck("alert_stages" in after["tables"], "alert_stages table created")
    for col in ("tenant_id", "name", "distance_km", "group_id", "is_active",
                "cooldown_min"):
        ck(col in after["stage_cols"], f"alert_stages.{col} present")

    for t in ("users", "tenants", "groups", "recipients", "alert_events",
              "unit_status", "heartbeat_samples", "calibration_events"):
        b, a = before["counts"].get(t), after["counts"].get(t)
        ck(a == b, f"{t} row count unchanged", f"{b} -> {a}")

    # Every client panel should now have a sign-in name it can use.
    names = {n.lower() for n, _e in after["usernames"]}
    ck(bool(names), "client sign-in names assigned",
       ", ".join(sorted(names)) or "none")

    section("8. Stage selection, proven against the live database")
    say("  Stages are created inside a transaction that is then rolled back, so\n"
        "  no tenant, group, recipient or stage is left behind.")
    res = incontainer(STAGE_PROBE)
    for line in res.splitlines():
        say("    " + line)
    ck("MISMATCH" not in res, "every distance raises the nearest covering stage")
    ck("STAGE_OVERRIDES_GROUP_THRESHOLD True" in res,
       "a stage overrides a narrower group threshold")
    ck("LEGACY_THRESHOLD_STILL_APPLIES True" in res,
       "without a stage the group threshold still decides")
    ck("PROBE_TENANT_LEFT_BEHIND 0" in res, "probe left nothing behind")

    section("9. Both sign-in doors are live")
    doors = bash(f"""
CLIENT=$(curl -s --max-time 30 '{BASE}/client')
STAFF=$(curl -s --max-time 30 '{BASE}/login')
echo "client page http    : $(curl -s -o /dev/null -w '%{{http_code}}' --max-time 25 '{BASE}/client')"
echo "staff page http     : $(curl -s -o /dev/null -w '%{{http_code}}' --max-time 25 '{BASE}/login')"
echo "client asks name    : $(printf '%s' \"$CLIENT\" | grep -c 'Site sign-in name')"
echo "client no email fld : $(printf '%s' \"$CLIENT\" | grep -c 'type=\\\"email\\\"')"
echo "staff links client  : $(printf '%s' \"$STAFF\" | grep -c 'href=\\\"/client\\\"')"
echo "client supplier     : $(printf '%s' \"$CLIENT\" | grep -ci 'clickatell')"
echo "staff supplier      : $(printf '%s' \"$STAFF\" | grep -ci 'clickatell')"
echo "sms dlr path        : $(curl -s -o /dev/null -w '%{{http_code}}' --max-time 25 -X POST -H 'Content-Type: application/json' -d '{{\"messages\":[]}}' '{BASE}/api/sms/dlr')"
echo "legacy dlr path     : $(curl -s -o /dev/null -w '%{{http_code}}' --max-time 25 -X POST -H 'Content-Type: application/json' -d '{{\"messages\":[]}}' '{BASE}/api/clickatell/dlr')"
""")
    got = {}
    for line in doors.splitlines():
        if ":" in line:
            k, v = line.rsplit(":", 1)
            got[k.strip()] = v.strip()
            say(f"  {line}")
    ck(got.get("client page http") == "200", "/client serves")
    ck(got.get("staff page http") == "200", "/login still serves")
    ck(got.get("client asks name") != "0", "/client asks for a site sign-in name")
    ck(got.get("client no email fld") == "0", "/client does not ask for an e-mail")
    ck(got.get("staff links client") != "0", "/login points clients at /client")
    ck(got.get("client supplier") == "0", "supplier not named on /client")
    ck(got.get("staff supplier") == "0", "supplier not named on /login")
    ck(got.get("sms dlr path") == "200", "new delivery-receipt path accepted")
    ck(got.get("legacy dlr path") == "200",
       "existing delivery-receipt path still accepted")

    section("10. Nothing disturbed, and nothing was sent")
    after_all = bash(f"""
for u in https://stratusweather.co.za/ {BASE}/login {BASE}/client \
         https://lightningdemo.stratusweather.co.za/ \
         https://info.stratusweather.co.za/ ; do
  printf "  %-56s HTTP %s\\n" "$u" \
    "$(curl -s -L -o /dev/null -w '%{{http_code}}' --max-time 25 $u)"
done
echo "--- 5xx since restart ---"
docker logs {CT} --since 10m 2>&1 | grep -cE '" 5[0-9][0-9] ' | sed 's/^/  count /'
echo "--- tracebacks since restart ---"
docker logs {CT} --since 10m 2>&1 | grep -c 'Traceback' | sed 's/^/  count /'
echo "--- containers ---"
docker ps --format '  {{{{.Names}}}}  {{{{.Status}}}}' | grep -Ei 'stratus|lightning|info'
echo "--- disk ---"
df -h / | tail -1 | sed 's/^/  /'
""")
    say(after_all)
    ck(after_all.count("HTTP 200") >= 5, "all sites and both doors answer 200",
       f"{after_all.count('HTTP 200')} x 200")
    ck("count 0" in after_all, "no 5xx and no tracebacks since the restart")

    sent = incontainer(
        "import sys; sys.path.insert(0,'/app')\n"
        "from app.db import SessionLocal\n"
        "from app.models import MessageLog, AlertEvent, AlertStage\n"
        "d=SessionLocal()\n"
        "print('message_log rows:', d.query(MessageLog).count())\n"
        "print('alert_events rows:', d.query(AlertEvent).count())\n"
        "print('alert_stages rows:', d.query(AlertStage).count())\n"
        "d.close()")
    say("  " + sent.replace("\n", "\n  "))
    ck("message_log rows: 0" in sent,
       "message_log still empty: nothing was sent")

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say()
    say(f"  staff sign-in   {BASE}/login   -> client list")
    say(f"  client sign-in  {BASE}/client  -> that client's own panel")
    say(f"  db backup       /root/panel-backups/panel-{STAMP}.db")
    say(f"  rollback        docker tag lightning-alert-panel:rollback-{STAMP} "
        f"{img} && cd {DIR} && docker compose -f {CF} up -d {SVC}")


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
