"""Independent confirmation of the two panel fixes. Read-only.

The deploy script's own verdict was wrong: `grep -c` prints 0 AND exits 1 when
there are no matches, so the `|| echo 0` fallback fired as well and the count
came back as "0\n0". Counting with a method that cannot do that.
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

out: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    out.append(m)


def ck(ok: bool, label: str, detail: str = "") -> None:
    checks.append((ok, label))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<50} {detail}")


def sh(cmd: str, timeout: int = 600) -> str:
    for attempt in (1, 2, 3):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect(HOST, username=USER, password=PW, timeout=60,
                      look_for_keys=False, allow_agent=False,
                      banner_timeout=60, auth_timeout=60)
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
    say("#" * 74)
    say("# Confirming the panel fixes")
    say("#" * 74)
    say()

    b64 = base64.b64encode(MINT.encode()).decode()
    res = sh(f"echo {b64} | base64 -d | docker exec -i {CT} python - 2>&1", 300)
    line = [l for l in res.splitlines() if "|" in l]
    if not line:
        say("could not mint a session:")
        say(res)
        return
    nm, cookie = line[-1].split("|", 1)

    say("=" * 74)
    say("1. The 500 on /gwld1/ is gone")
    say("=" * 74)
    for path, want in (("/gwld1/", "200"), ("/gwld1/stations", "200"),
                       ("/gwld1/events", "200"), ("/gwld1/settings", "200"),
                       ("/tenants", "200"), ("/", "200")):
        code = sh("curl -s -o /dev/null -w '%{http_code}' --max-time 25 "
                  f"-b '{nm}={cookie}' '{BASE}{path}'").strip()
        ck(code == want, f"GET {path}", code)

    say()
    say("=" * 74)
    say("2. Client list contains only real clients")
    say("=" * 74)
    body = sh("curl -s --max-time 25 " f"-b '{nm}={cookie}' '{BASE}/tenants'")
    ck("GWLD1" in body or "gwld1" in body, "GWLD1 present")
    ck("platform" not in body.lower() or "Stratus Weather (platform)" not in body,
       "no 'Stratus Weather (platform)' row")
    ck("<code>/stratus</code>" not in body, "no /stratus address row")

    say()
    say("=" * 74)
    say("3. Never-seen units render safely on the dashboard")
    say("=" * 74)
    dash = sh("curl -s --max-time 25 " f"-b '{nm}={cookie}' '{BASE}/gwld1/'")
    ck("Internal Server Error" not in dash, "no error page")
    ck("Last seen: never" in dash, "'Last seen: never' shown")
    for sid in ("GLENCORE WONDERKOP", "GWLD1", "GWLD1-DEMO"):
        say(f"        unit '{sid}' rendered: {sid in dash}")

    say()
    say("=" * 74)
    say("4. No tracebacks (counted without the grep -c pitfall)")
    say("=" * 74)
    raw = sh(f"docker logs --since 300s {CT} 2>&1")
    n = raw.count("Traceback (most recent call last)")
    ck(n == 0, "tracebacks in the last 5 minutes", str(n))
    n500 = raw.count(" 500 Internal Server Error")
    ck(n500 == 0, "500 responses in the last 5 minutes", str(n500))

    say()
    say("=" * 74)
    say("5. Nothing else regressed")
    say("=" * 74)
    for path in ("/api/v1/health", "/gwld1/api/v1/health", "/login"):
        code = sh("curl -s -o /dev/null -w '%{http_code}' --max-time 25 "
                  f"'{BASE}{path}'").strip()
        ck(code == "200", f"GET {path}", code)
    ml = sh(f"docker exec {CT} python -c "
            "\"import sys; sys.path.insert(0,'/app'); "
            "from app.db import SessionLocal; from app.models import MessageLog; "
            "d=SessionLocal(); print(d.query(MessageLog).count()); d.close()\"")
    ck(ml.strip() == "0", "message_log still empty", ml.strip())
    st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' " + CT)
    ck("healthy" in st, "panel healthy", st)

    say()
    say("=" * 74)
    bad = [c for c in checks if not c[0]]
    say(f"{len(checks) - len(bad)} of {len(checks)} checks passed")
    for _, label in bad:
        say(f"  FAIL  {label}")
    say("=" * 74)

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_confirm_panel_fix.txt").write_text("\n".join(out),
                                                      encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_confirm_panel_fix.txt").write_text(
            "\n".join(out) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
