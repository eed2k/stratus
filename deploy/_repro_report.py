"""Reproduce the 500 on report generation and capture the real traceback.

Safe: reports_generate builds a PDF, writes it under the tenant's report
directory and redirects to the download. It never emails anyone.
"""
from __future__ import annotations

import base64
import os
import re
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


def say(m: str = "") -> None:
    print(m, flush=True)
    out.append(m)


def section(t: str) -> None:
    say()
    say("=" * 76)
    say(t)
    say("=" * 76)


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

# Does WeasyPrint even import inside the running container?
WP = r'''
import sys
sys.path.insert(0, "/app")
try:
    import weasyprint
    print("weasyprint", weasyprint.__version__, "imports OK")
except Exception as exc:
    print("weasyprint IMPORT FAILED:", type(exc).__name__, exc)
try:
    from app import reports as r
    print("REPORT_TYPES:", getattr(r, "REPORT_TYPES", "n/a"))
    print("has build_report:", hasattr(r, "build_report"))
except Exception as exc:
    print("app.reports import failed:", type(exc).__name__, exc)
'''


def main() -> None:
    section("1. Does WeasyPrint import in the live container?")
    b64 = base64.b64encode(WP.encode()).decode()
    say(sh(f"echo {b64} | base64 -d | docker exec -i {CT} python - 2>&1", 300))

    section("2. Mint a session")
    b64 = base64.b64encode(MINT.encode()).decode()
    res = sh(f"echo {b64} | base64 -d | docker exec -i {CT} python - 2>&1", 300)
    line = [l for l in res.splitlines() if "|" in l]
    if not line:
        say(res)
        return
    nm, cookie = line[-1].split("|", 1)
    say(f"  cookie name {nm}, {len(cookie)} chars")

    section("3. What does the Reports page offer?")
    page = sh("curl -s --max-time 25 " f"-b '{nm}={cookie}' '{BASE}/gwld1/reports'")
    stations = re.findall(r'<option value="([^"]+)"[^>]*>\s*([^<]*)</option>', page)
    say(f"  option tags found: {len(stations)}")
    for v, t in stations[:20]:
        say(f"    value={v!r}  text={t.strip()!r}")
    csrf = re.search(r'name="csrf_token"\s+value="([^"]*)"', page)
    say(f"  csrf token in page: {csrf.group(1) if csrf else '<none>'}")

    # Pick a station and month from the form itself.
    sel_station = None
    sel_month = None
    sel_type = None
    for v, _t in stations:
        if re.match(r"^\d{4}-\d{2}$", v) and sel_month is None:
            sel_month = v
        elif v in ("technical", "summary", "compliance") and sel_type is None:
            sel_type = v
        elif sel_station is None and not re.match(r"^\d{4}-\d{2}$", v):
            sel_station = v
    sel_type = sel_type or "technical"
    say()
    say(f"  will request station={sel_station!r} month={sel_month!r} type={sel_type!r}")

    if not sel_station or not sel_month:
        say("  could not determine valid form values; dumping the form markup:")
        m = re.search(r"<form[^>]*reports/generate.*?</form>", page, re.S)
        say(m.group(0)[:2000] if m else page[:1500])
        Path("backups/_repro_report.txt").write_text("\n".join(out), encoding="utf-8")
        return

    section("4. POST /gwld1/reports/generate")
    tok = csrf.group(1) if csrf else "x"
    code = sh("curl -s -o /tmp/rep.txt -w '%{http_code}' --max-time 120 "
              f"-b '{nm}={cookie}' -X POST '{BASE}/gwld1/reports/generate' "
              f"--data-urlencode 'csrf_token={tok}' "
              f"--data-urlencode 'station_id={sel_station}' "
              f"--data-urlencode 'month={sel_month}' "
              f"--data-urlencode 'report_type={sel_type}'")
    say(f"  HTTP {code.strip()}")
    say("  body (first 500 chars):")
    say("  " + sh("head -c 500 /tmp/rep.txt").replace("\n", "\n  "))

    section("5. Traceback from the container")
    logs = sh(f"docker logs --since 180s {CT} 2>&1")
    if "Traceback" in logs:
        idx = logs.rfind("Traceback")
        say(logs[idx:idx + 4000])
    else:
        say("  no traceback in the last 3 minutes")
        say(logs[-1500:])

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_repro_report.txt").write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_repro_report.txt").write_text(
            "\n".join(out) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
