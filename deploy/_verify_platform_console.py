"""Confirm the platform admin console is still a management console only.

The root panel (no tenant prefix), reached by admin@stratusweather.co.za, must be
for configuring and monitoring CLIENT panels. It must not be a detector console:
a detector always belongs to exactly one client and is operated from that
client's own panel.

Several deploys have landed since that split was made, so this re-checks it
rather than assuming. Read-only: no writes, no restarts, no sends.
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
OUT = Path("backups/_verify_platform_console.txt")

log: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)
    OUT.write_text("\n".join(log), encoding="utf-8")


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


def ck(ok: bool, label: str, detail: str = "") -> None:
    checks.append((bool(ok), label))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<50} {detail}")


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
    return sh(f"echo {base64.b64encode(script.encode()).decode()} "
              f"| base64 -d | bash -s", timeout=timeout)


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
print("ROLE", u.role, "TENANT", u.tenant_id)
print(("__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session")
      + "|" + s.sign(d).decode())
db.close()
'''


def main() -> None:
    res = sh(f"echo {base64.b64encode(MINT.encode()).decode()} "
             f"| base64 -d | docker exec -i {CT} python - 2>&1")
    role = [l for l in res.splitlines() if l.startswith("ROLE")]
    cookie_line = [l for l in res.splitlines() if "stratus_session" in l and "|" in l]
    if not cookie_line:
        say("could not mint a session:\n" + res)
        return
    nm, cookie = cookie_line[-1].split("|", 1)
    say("platform admin: " + (role[0] if role else "?"))

    curl = f"curl -s --max-time 30 -b '{nm}={cookie}'"

    section("1. Root sends the platform admin to the client list")
    hdr = bash(f"{curl} -D - -o /dev/null '{BASE}/' | grep -Ei '^(HTTP/|location:)'")
    say("  " + hdr.replace("\n", "\n  "))
    ck("303" in hdr and "/tenants" in hdr,
       "GET / redirects to /tenants, not a dashboard")

    section("2. The platform navigation offers management, not a detector")
    page = sh(f"{curl} '{BASE}/tenants'")
    navs = re.findall(r'<nav>(.*?)</nav>', page, re.S)
    links = re.findall(r'href="([^"]*)"[^>]*>([^<]*)</a>', navs[0]) if navs else []
    for href, text in links:
        say(f"    {text.strip():<22} {href}")

    labels = [t.strip().lower() for _h, t in links]
    hrefs = [h for h, _t in links]

    ck("clients" in labels, "Clients (manage client panels) present")
    # These are detector-operator functions and belong in a client panel only.
    for bad in ("dashboard", "recipients", "groups", "events", "reports",
                "test alert"):
        ck(bad not in labels, f"no '{bad}' link on the platform console")
    ck(not any(re.match(r"^/(events|reports|recipients|groups|test)", h)
               for h in hrefs),
       "no detector-operator route linked from the platform nav")

    section("3. The client list is a monitoring view")
    for needle, label in (("/gwld1", "links through to each client panel"),
                          ("Open panel", "offers 'Open panel' per client")):
        ck(needle in page, label)
    # Counts per client are what makes it a monitoring view rather than a list.
    ck(re.search(r"<th[^>]*>\s*Users", page) is not None, "shows per-client users")
    ck(re.search(r"<th[^>]*>\s*Recipients", page) is not None,
       "shows per-client recipients")
    ck(re.search(r"<th[^>]*>\s*Events", page) is not None,
       "shows per-client events")
    ck(re.search(r"<th[^>]*>\s*Status", page) is not None,
       "shows per-client status")

    section("4. Clickatell stays platform infrastructure")
    client_page = sh(f"{curl} '{BASE}/gwld1/'")
    ck("Clickatell" in page or "Clickatell" in sh(f"{curl} '{BASE}/settings'"),
       "gateway visible to the platform admin")
    ck("Clickatell" not in client_page,
       "gateway NOT shown in the client panel")

    section("5. Detector telemetry is absent from the platform console")
    # The platform tenant owns no detector, so none of the detector furniture
    # should appear on its console.
    for needle, label in (("data-storm-view", "storm activity display"),
                          ("data-cpu-chart", "CPU chart"),
                          ("AS3935 UNIT", "detector unit block"),
                          ("Alert delivery", "alert delivery controls")):
        ck(needle not in page, f"no {label} on the platform console")

    section("6. Unassigned Units is kept on purpose")
    # A detector reporting in for the first time is filed under the platform
    # tenant and is invisible to every client until an admin assigns it. This
    # page is the only place that assignment can be made, so it is configuration
    # rather than detector operation.
    ck("stations" in " ".join(hrefs).lower(),
       "Unassigned Units reachable (only place to assign a new detector)")
    st = sh(f"{curl} -o /dev/null -w '%{{http_code}}' '{BASE}/stations'")
    ck(st.strip() == "200", "GET /stations on the platform console", st.strip())

    section("7. Client panel keeps the full operational navigation")
    cnavs = re.findall(r'<nav>(.*?)</nav>', client_page, re.S)
    clinks = re.findall(r'>([^<]+)</a>', cnavs[0]) if cnavs else []
    clabels = [c.strip().lower() for c in clinks if c.strip()]
    say("    " + ", ".join(clabels))
    for need in ("dashboard", "recipients", "events", "reports"):
        ck(need in clabels, f"client panel still has '{need}'")
    ck("data-storm-view" in client_page, "client panel has the storm display")
    ck("clients" not in clabels, "client panel does not link to the client list")

    section("Result")
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
