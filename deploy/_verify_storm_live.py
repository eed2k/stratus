"""Close out two loose ends from the storm-bands deploy.

1. The deploy script reported "test suite green in the image", but the output was
   actually "No module named pytest". The production image has no test deps, so
   that check was meaningless and its PASS was false. Confirm that explicitly.
2. GET / returned 303 for a platform-admin session. Confirm where it redirects
   and that the destination is a real page, rather than assuming it is fine.

Also samples the live storm payload so we know what the dashboard will draw.
Read-only: no sends, no writes, no restarts.
"""
from __future__ import annotations

import base64
import json
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
OUT = Path("backups/_verify_storm_live.txt")

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
print("TENANT", u.tenant_id, u.role)
print(("__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session")
      + "|" + s.sign(d).decode())
db.close()
'''


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd, timeout=600):
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


def bash(script, timeout=600):
    b64 = base64.b64encode(script.encode()).decode()
    return sh(f"echo {b64} | base64 -d | bash -s", timeout=timeout)


lines: list[str] = []


def say(m=""):
    print(m, flush=True)
    lines.append(m)
    OUT.write_text("\n".join(lines), encoding="utf-8")


res = sh(f"echo {base64.b64encode(MINT.encode()).decode()} "
         f"| base64 -d | docker exec -i {CT} python - 2>&1")
tenant_line = [l for l in res.splitlines() if l.startswith("TENANT")]
cookie_line = [l for l in res.splitlines() if "|" in l and "__Host" in l or
               ("|" in l and "stratus_session" in l)]
say("session: " + (tenant_line[0] if tenant_line else "?"))
if not cookie_line:
    say("could not mint a cookie:\n" + res)
    sys.exit(1)
nm, cookie = cookie_line[-1].split("|", 1)

say("")
say("--- 1. Is pytest actually absent from the production image? ---")
say(bash(f"""
docker exec {CT} python -c "import importlib.util as u; \
print('pytest present:', u.find_spec('pytest') is not None)" 2>&1
echo "requirements has pytest: $(grep -ci pytest /opt/lightning-panel/requirements.txt || echo 0)"
"""))

say("")
say("--- 2. Where does GET / redirect a platform admin? ---")
say(bash(f"""
echo "--- headers for / ---"
curl -s -D - -o /dev/null --max-time 25 -b '{nm}={cookie}' '{BASE}/' | \
  grep -Ei '^(HTTP/|location:)'
echo "--- following the redirect ---"
curl -s -L -o /dev/null -w 'final=%{{url_effective}} code=%{{http_code}}\\n' \
  --max-time 30 -b '{nm}={cookie}' '{BASE}/'
echo "--- anonymous / (should go to login) ---"
curl -s -D - -o /dev/null --max-time 25 '{BASE}/' | grep -Ei '^(HTTP/|location:)'
"""))

say("")
say("--- 3. What will the live dashboard actually draw? ---")
raw = sh("curl -s --max-time 30 "
         f"-b '{nm}={cookie}' '{BASE}/gwld1/data/strikes?window=1440'")
try:
    p = json.loads(raw)
    say(f"total={p['total']}  unplaced={p['unplaced']}  window_min={p['window_min']}")
    for b in p["bands"]:
        say(f"  {b['range']:<10} count={b['count']:<3} peak={b['peak']} "
            f"mean={b['mean']} band={b['band']} colour={b['colour']}")
    say(f"raw strikes returned: {len(p.get('strikes') or [])}")
    if p["total"] == 0:
        say("  NOTE: every band is idle because no strike is on record in this")
        say("        window. The cells will render grey with 'no strikes")
        say("        recorded'. That is the correct empty state, not a fault.")
except Exception as exc:
    say(f"could not parse payload: {exc}\n{raw[:300]}")

say("")
say("--- 4. Total events on record, for context ---")
say(sh(f"docker exec {CT} python -c \""
       "import sys; sys.path.insert(0,'/app');"
       "from app.db import SessionLocal; from app.models import AlertEvent, Recipient;"
       "d=SessionLocal();"
       "print('alert_events:', d.query(AlertEvent).count());"
       "print('recipients:', d.query(Recipient).count());"
       "e=d.query(AlertEvent).order_by(AlertEvent.timestamp.desc()).first();"
       "print('newest event:', e.timestamp if e else None);"
       "d.close()\""))
