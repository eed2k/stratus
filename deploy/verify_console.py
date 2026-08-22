"""Verify the panel console deploy using ONE SSH connection.

The previous run opened a new SSH connection per command and fired dozens within
seconds, which tripped sshd rate limiting; the tail of the verification then
reported NoValidConnectionsError and every dependent check looked like a
regression. All the checking now happens in a single remote script executed over
a single connection.
"""
from __future__ import annotations

import base64
import os
import sys
import time
from pathlib import Path

import paramiko

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

CT = "lightning-alert-panel"
BASE = "https://adminpanel.stratusweather.co.za"

# Runs entirely on the VPS. Mints sessions, then curls everything locally.
REMOTE = r'''
set -u
CT=lightning-alert-panel
BASE=https://adminpanel.stratusweather.co.za

cat > /tmp/_mint.py <<'PYEOF'
import base64, json, sys
sys.path.insert(0, "/app")
import itsdangerous
from app.config import settings
from app.db import SessionLocal
from app.models import User
db = SessionLocal()
s = itsdangerous.TimestampSigner(str(settings.APP_SECRET_KEY))
print("NAME=" + ("__Host-stratus_session" if settings.SECURE_COOKIES
                 else "stratus_session"))
u = db.query(User).filter(User.email == "admin@stratusweather.co.za").first()
d = base64.b64encode(json.dumps({"uid": u.id, "tid": u.tenant_id, "csrf": "x"}).encode())
print("PLAT=" + s.sign(d).decode())
db.close()
PYEOF
docker cp /tmp/_mint.py $CT:/tmp/_mint.py >/dev/null
eval "$(docker exec $CT python /tmp/_mint.py)"
docker exec $CT rm -f /tmp/_mint.py
rm -f /tmp/_mint.py
C="-b ${NAME}=${PLAT}"

echo "=== container ==="
docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' $CT
echo "image: $(docker inspect $CT --format '{{.Image}}' | cut -c1-26)"

echo
echo "=== platform console (unprefixed) ==="
echo -n "GET /            -> "; curl -s -o /dev/null -w '%{http_code}' $C "$BASE/"; echo
echo -n "  redirect to    : "; curl -s -o /dev/null -D - $C "$BASE/" | grep -i '^location:' | tr -d '\r'; echo
curl -s $C "$BASE/tenants" > /tmp/t.html
echo -n "GET /tenants     -> "; curl -s -o /dev/null -w '%{http_code}' $C "$BASE/tenants"; echo
echo "  create form      : $(grep -c 'tenants/create' /tmp/t.html)"
echo "  gwld1 listed     : $(grep -c 'gwld1' /tmp/t.html)"
sed -n '/<nav>/,/<\/nav>/p' /tmp/t.html > /tmp/nav.html
echo "  nav entries:"
grep -o '>[A-Za-z ]\+</a>' /tmp/nav.html | tr -d '></a' | sed 's/^/    - /'

echo
echo "=== client panel /gwld1/ ==="
curl -s $C "$BASE/gwld1/" > /tmp/g.html
echo -n "GET /gwld1/      -> "; curl -s -o /dev/null -w '%{http_code}' $C "$BASE/gwld1/"; echo
sed -n '/<nav>/,/<\/nav>/p' /tmp/g.html > /tmp/gnav.html
echo "  nav entries:"
grep -o '>[A-Za-z ]\+</a>' /tmp/gnav.html | tr -d '></a' | sed 's/^/    - /'

echo
echo "=== charts and legend on /gwld1/ ==="
echo "  viewBox 960x300  : $(grep -c 'viewBox=\"0 0 960 300\"' /tmp/g.html)"
echo "  square glyphs    : $(grep -c '&#9632;' /tmp/g.html)"
echo "  legend Temp text : $(grep -c 'Temp &deg;C' /tmp/g.html)"
echo "  legend Load text : $(grep -c 'Load %' /tmp/g.html)"
echo "  gridline count   : $(grep -o 'stroke=\"#eaeef2\"' /tmp/g.html | wc -l)"
echo "  time labels      : $(grep -o 'fill=\"#8a929b\"' /tmp/g.html | wc -l)"

echo
echo "=== served CSS ==="
curl -s "$BASE/static/style.css" > /tmp/s.css
echo "  flex-direction: column : $(grep -c 'flex-direction: column' /tmp/s.css)"
echo "  flex: 1 1 520px        : $(grep -c 'flex: 1 1 520px' /tmp/s.css)"
echo "  min-height: 220px      : $(grep -c 'min-height: 220px' /tmp/s.css)"

echo
echo "=== other pages ==="
for p in /gwld1/stations /gwld1/events /gwld1/reports /gwld1/test /settings /users /tenants; do
  printf '  %-20s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $C "$BASE$p")"
done
echo -n "  /api/v1/health       "; curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/health"; echo
echo -n "  /gwld1/api/v1/health "; curl -s -o /dev/null -w '%{http_code}' "$BASE/gwld1/api/v1/health"; echo

echo
echo "=== safety ==="
docker exec $CT python -c "import sys;sys.path.insert(0,'/app');from app.db import SessionLocal;from app.models import MessageLog;d=SessionLocal();print('message_log rows:',d.query(MessageLog).count());d.close()"
echo "tracebacks in last 5 min: $(docker logs --since 300s $CT 2>&1 | grep -c 'Traceback (most recent call last)' || true)"
rm -f /tmp/t.html /tmp/g.html /tmp/nav.html /tmp/gnav.html /tmp/s.css
echo
echo "disk: $(df -h / | tail -1)"
'''


def main() -> None:
    b64 = base64.b64encode(REMOTE.encode()).decode()
    last = None
    for attempt in (1, 2, 3, 4, 5):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect(HOST, username=USER, password=PW, timeout=60,
                      look_for_keys=False, allow_agent=False,
                      banner_timeout=60, auth_timeout=60)
            try:
                # One command, one channel, one connection.
                _i, o, e = c.exec_command(
                    f"echo {b64} | base64 -d | bash 2>&1", timeout=600)
                out = o.read().decode(errors="replace")
                err = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                txt = out or err
                print(txt)
                Path("backups").mkdir(exist_ok=True)
                Path("backups/_verify_console.txt").write_text(txt, encoding="utf-8")
                return
            finally:
                c.close()
        except Exception as exc:
            last = exc
            wait = 20 * attempt
            print(f"  attempt {attempt} failed ({type(exc).__name__}); "
                  f"backing off {wait}s to let sshd recover", flush=True)
            time.sleep(wait)
    print(f"could not connect after 5 attempts: {last}")
    Path("backups").mkdir(exist_ok=True)
    Path("backups/_verify_console.txt").write_text(
        f"could not connect: {last}", encoding="utf-8")


if __name__ == "__main__":
    main()
