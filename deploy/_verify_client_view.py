"""Check what a real CLIENT user sees, as opposed to the platform admin.

The previous run reported that Clickatell was visible in the client panel, but it
fetched that panel using the PLATFORM ADMIN's cookie. base.html gates the gateway
line on `is_platform_admin`, not on the URL, so a platform admin browsing a client
panel is still a platform admin and legitimately sees their own infrastructure.

The requirement is that a CLIENT never sees it. That needs a client identity, so
this mints a session for a non-platform user on the gwld1 tenant and re-checks.
Read-only.
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
OUT = Path("backups/_verify_client_view.txt")

log: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)
    OUT.write_text("\n".join(log), encoding="utf-8")


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


# List every user with its tenant and platform flag, then mint a session for a
# non-platform user on gwld1.
PROBE = r'''
import base64, json, sys
sys.path.insert(0, "/app")
import itsdangerous
from app.config import settings
from app.db import SessionLocal
from app.models import User, Tenant
db = SessionLocal()
s = itsdangerous.TimestampSigner(str(settings.APP_SECRET_KEY))
cookie_name = "__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session"

tenants = {t.id: t.slug for t in db.query(Tenant).all()}
print("--- users ---")
for u in db.query(User).order_by(User.id).all():
    print(f"USER id={u.id} email={u.email} role={u.role} "
          f"tenant={tenants.get(u.tenant_id)} "
          f"platform={bool(getattr(u, 'is_platform_admin', False))}")

target = None
for u in db.query(User).order_by(User.id).all():
    if tenants.get(u.tenant_id) == "gwld1" and not getattr(u, "is_platform_admin", False):
        target = u
        break

if target is None:
    print("NO_CLIENT_USER")
else:
    d = base64.b64encode(json.dumps(
        {"uid": target.id, "tid": target.tenant_id, "csrf": "x"}).encode())
    print(f"CHOSEN email={target.email} role={target.role}")
    print(cookie_name + "|" + s.sign(d).decode())
db.close()
'''


def main() -> None:
    res = sh(f"echo {base64.b64encode(PROBE.encode()).decode()} "
             f"| base64 -d | docker exec -i {CT} python - 2>&1")
    for line in res.splitlines():
        if line.startswith(("USER ", "CHOSEN", "---", "NO_CLIENT_USER")):
            say("  " + line)

    if "NO_CLIENT_USER" in res:
        say("\nNo non-platform user exists on gwld1, so the client view cannot be")
        say("verified by minting a session. That is itself worth knowing.")
        return

    cookie_line = [l for l in res.splitlines()
                   if "stratus_session" in l and "|" in l]
    if not cookie_line:
        say("could not mint a client session:\n" + res)
        return
    nm, cookie = cookie_line[-1].split("|", 1)

    say()
    say("=" * 74)
    say("What the CLIENT sees at /gwld1/")
    say("=" * 74)
    page = sh(f"curl -s --max-time 30 -b '{nm}={cookie}' '{BASE}/gwld1/'")
    ck(len(page) > 500, "client dashboard renders", f"{len(page)} bytes")

    # The point of the whole exercise.
    ck("Clickatell" not in page, "Clickatell is NOT shown to the client")
    ck("SMS gateway" not in page, "no 'SMS gateway' line for the client")

    # A client must not be offered the platform management console.
    ck("/tenants" not in page, "no link to the platform client list")
    ck("Unassigned Units" not in page, "no 'Unassigned Units' link")

    # But their own panel must still be fully operational.
    for needle, label in (("data-storm-view", "storm activity display"),
                          ("AS3935 UNIT", "detector unit block"),
                          ("Alert delivery", "alert delivery controls"),
                          ("page-loader", "loading overlay")):
        ck(needle in page, f"client panel has the {label}")

    reports = sh(f"curl -s --max-time 30 -b '{nm}={cookie}' '{BASE}/gwld1/reports'")
    ck("Calibration certificate" in reports,
       "client can download the calibration report")
    ck("Clickatell" not in reports, "Clickatell absent from the reports page too")

    # And must not be able to reach the platform console by URL.
    code = sh("curl -s -o /dev/null -w '%{http_code}' --max-time 25 "
              f"-b '{nm}={cookie}' '{BASE}/tenants'")
    say(f"  GET /tenants as a client -> HTTP {code.strip()}")
    ck(code.strip() != "200", "client is refused the platform client list",
       f"HTTP {code.strip()}")

    say()
    say("=" * 74)
    say("Result")
    say("=" * 74)
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")


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
