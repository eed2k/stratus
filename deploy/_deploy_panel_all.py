"""Deploy the queued panel changes, then verify over ONE ssh connection.

Files:
  app/templates/base.html      platform-console nav split; gateway footer gated
  app/templates/settings.html  gateway card gated to the platform admin
  app/routes/web.py            platform admin on "/" lands on /tenants
  app/charts.py                larger geometry, no legend glyphs
  app/static/style.css         unit-grid column, chart fills width and height
  app/static/js/cpu-chart.js   range selector gone, tiny dot legend, blue load

Verification runs as a single remote script over a single connection. An earlier
attempt opened a fresh connection per check, fired dozens in seconds, tripped
sshd rate limiting, and the tail reported NoValidConnectionsError for checks that
were actually fine.
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

DIR, CF, SVC, CT = "/opt/lightning-panel", "docker-compose.traefik.yml", "panel", \
    "lightning-alert-panel"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/panel-all.log", "/root/panel-all.done"
FILES = ["app/templates/base.html", "app/templates/settings.html",
         "app/routes/web.py", "app/charts.py",
         "app/static/style.css", "app/static/js/cpu-chart.js"]
ROOT = Path("LDS ADMIN")

log: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


def conn():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh_on(c, cmd, timeout=900):
    _i, o, e = c.exec_command(cmd, timeout=timeout)
    a = o.read().decode(errors="replace")
    b = e.read().decode(errors="replace")
    o.channel.recv_exit_status()
    return (a or b).rstrip()


def sh(cmd, timeout=900):
    """One short-lived connection, with generous backoff if sshd is throttling."""
    last = None
    for attempt in (1, 2, 3, 4):
        try:
            c = conn()
            try:
                return sh_on(c, cmd, timeout)
            finally:
                c.close()
        except Exception as exc:
            last = exc
            time.sleep(15 * attempt)
    return f"[conn failed: {type(last).__name__}]"


VERIFY = r'''
set -u
CT=lightning-alert-panel
BASE=https://adminpanel.stratusweather.co.za
cat > /tmp/_m.py <<'PYEOF'
import base64, json, sys
sys.path.insert(0, "/app")
import itsdangerous
from app.config import settings
from app.db import SessionLocal
from app.models import User
db = SessionLocal()
s = itsdangerous.TimestampSigner(str(settings.APP_SECRET_KEY))
print("NAME=" + ("__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session"))
for tag, email in (("PLAT", "admin@stratusweather.co.za"),
                   ("CLI", "admin@gwld1.stratusweather.co.za")):
    u = db.query(User).filter(User.email == email).first()
    if u:
        d = base64.b64encode(json.dumps({"uid": u.id, "tid": u.tenant_id, "csrf": "x"}).encode())
        print(tag + "=" + s.sign(d).decode())
db.close()
PYEOF
docker cp /tmp/_m.py $CT:/tmp/_m.py >/dev/null
eval "$(docker exec $CT python /tmp/_m.py)"
docker exec $CT rm -f /tmp/_m.py; rm -f /tmp/_m.py
P="-b ${NAME}=${PLAT}"
C="-b ${NAME}=${CLI}"

echo "container: $(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' $CT)"

echo
echo "--- platform console ---"
echo "GET /          $(curl -s -o /dev/null -w '%{http_code}' $P "$BASE/")  (want 303)"
curl -s -o /dev/null -D - $P "$BASE/" | grep -i '^location:' | tr -d '\r' | sed 's/^/  /'
curl -s $P "$BASE/tenants" > /tmp/t.html
echo "GET /tenants   $(curl -s -o /dev/null -w '%{http_code}' $P "$BASE/tenants")"
echo "  create form present : $(grep -c 'tenants/create' /tmp/t.html)"
sed -n '/<nav>/,/<\/nav>/p' /tmp/t.html | grep -o '>[A-Za-z ]\+</a>' \
  | sed 's/[></a]//g' | sed 's/^/    nav: /'

echo
echo "--- CLIENT admin must NOT see the gateway ---"
curl -s $C "$BASE/gwld1/settings" > /tmp/cs.html
echo "GET /gwld1/settings (client) $(curl -s -o /dev/null -w '%{http_code}' $C "$BASE/gwld1/settings")"
echo "  'Clickatell' occurrences : $(grep -ci clickatell /tmp/cs.html)   (want 0)"
echo "  'Messaging gateway'      : $(grep -c 'Messaging gateway' /tmp/cs.html)   (want 0)"
curl -s $C "$BASE/gwld1/" > /tmp/cd.html
echo "  footer gateway on dash   : $(grep -c 'SMS gateway' /tmp/cd.html)   (want 0)"
echo "  client nav:"
sed -n '/<nav>/,/<\/nav>/p' /tmp/cd.html | grep -o '>[A-Za-z ]\+</a>' \
  | sed 's/[></a]//g' | sed 's/^/    /'

echo
echo "--- PLATFORM admin still sees the gateway ---"
curl -s $P "$BASE/settings" > /tmp/ps.html
echo "  'Clickatell' occurrences : $(grep -ci clickatell /tmp/ps.html)   (want >0)"

echo
echo "--- charts ---"
echo "  viewBox 960x300      : $(grep -c 'viewBox=\"0 0 960 300\"' /tmp/cd.html)"
echo "  square glyphs        : $(grep -c '&#9632;' /tmp/cd.html)   (want 0)"
curl -s "$BASE/static/style.css" > /tmp/s.css
echo "  flex-direction column: $(grep -c 'flex-direction: column' /tmp/s.css)"
echo "  align-items: stretch : $(grep -c 'align-items: stretch' /tmp/s.css)"
echo "  min-height: 300px    : $(grep -c 'min-height: 300px' /tmp/s.css)"
echo "  old height: 220px    : $(grep -c 'height: 220px' /tmp/s.css)   (want 0)"
curl -s "$BASE/static/js/cpu-chart.js" > /tmp/c.js
echo "  RANGES removed       : $(grep -c 'RANGES' /tmp/c.js)   (want 0)"
echo "  chart-range removed  : $(grep -c 'chart-range' /tmp/c.js)   (want 0)"
echo "  legend content fn    : $(grep -c 'verticalAlign: \"bottom\"' /tmp/c.js)"
echo "  dot markers          : $(grep -c 'borderRadius: \"50%\"' /tmp/c.js)"
echo "  blue load colour     : $(grep -c '2c7fb8' /tmp/c.js)"

echo
echo "--- other pages ---"
for p in /gwld1/stations /gwld1/events /gwld1/reports /gwld1/test /settings /users /tenants; do
  printf '  %-20s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $P "$BASE$p")"
done
printf '  %-20s %s\n' "/api/v1/health" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/health")"

echo
echo "--- safety ---"
docker exec $CT python -c "import sys;sys.path.insert(0,'/app');from app.db import SessionLocal;from app.models import MessageLog;d=SessionLocal();print('message_log rows:',d.query(MessageLog).count());d.close()"
echo "tracebacks (5 min): $(docker logs --since 300s $CT 2>&1 | grep -c 'Traceback (most recent call last)' || true)"
rm -f /tmp/t.html /tmp/cs.html /tmp/cd.html /tmp/ps.html /tmp/s.css /tmp/c.js
echo "disk: $(df -h / | tail -1)"
'''


def main() -> None:
    section("0. Pre-flight")
    for f in FILES:
        p = ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing: {p}")
        say(f"  {f:<32} {p.stat().st_size:>8,} B")

    section("1. Upload + rollback tag")
    cur = sh(f"docker inspect {CT} --format '{{{{.Config.Image}}}}'")
    say("  " + sh(f"docker tag {cur} lightning-alert-panel:rollback-{STAMP} "
                  f"&& echo tagged rollback-{STAMP}"))
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in FILES:
            tf.add(ROOT / f, arcname=f)
    c = conn()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(buf.getvalue()), f"/tmp/all-{STAMP}.tar.gz")
    finally:
        c.close()
    say("  " + sh(f"cd {DIR} && tar -xzf /tmp/all-{STAMP}.tar.gz && "
                  f"rm -f /tmp/all-{STAMP}.tar.gz && echo extracted"))

    section("2. Build (detached)")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose -f {CF} build {SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' >/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code = None
    for _ in range(80):
        time.sleep(20)
        d = sh(f"cat {DONE} 2>/dev/null || true")
        if d.strip():
            code = int(d.strip()) if d.strip().isdigit() else -1
            break
        say(f"    [poll] {sh(f'stat -c%s {LOG} 2>/dev/null || echo 0').strip()} B")
    if code is None:
        say("  still building; panel untouched. Re-check " + LOG)
        Path("backups/_panel_all.txt").write_text("\n".join(log), encoding="utf-8")
        return
    say(f"  build exit {code}")
    if code != 0:
        for line in sh(f"tail -25 {LOG}").splitlines():
            say(f"    {line}")
        Path("backups/_panel_all.txt").write_text("\n".join(log), encoding="utf-8")
        return

    section("3. Recreate")
    say(sh(f"cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC} 2>&1 | tail -6", 900))
    for i in range(40):
        st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                f"{CT} 2>/dev/null")
        if "healthy" in st:
            say(f"  healthy after {i*6}s")
            break
        time.sleep(6)

    section("4. Verify (single connection)")
    time.sleep(20)          # let sshd settle before the one big call
    b64 = base64.b64encode(VERIFY.encode()).decode()
    last = None
    for attempt in (1, 2, 3, 4, 5):
        try:
            c = conn()
            try:
                say(sh_on(c, f"echo {b64} | base64 -d | bash 2>&1", 600))
                break
            finally:
                c.close()
        except Exception as exc:
            last = exc
            say(f"  attempt {attempt} failed ({type(exc).__name__}); backing off")
            time.sleep(25 * attempt)
    else:
        say(f"  verification could not connect: {last}")

    say()
    say(f"  rollback  lightning-alert-panel:rollback-{STAMP}")
    Path("backups").mkdir(exist_ok=True)
    Path("backups/_panel_all.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_panel_all.txt").write_text(
            "\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
