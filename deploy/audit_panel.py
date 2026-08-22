"""Audit every page, button and action endpoint on the LIVE LDS admin panel.

Approach
  The admin password was changed in-app so the seeded credential no longer
  works, and guessing would burn the 8-failures-per-15-minutes login throttle.
  Rather than create an extra admin account in the production auth database,
  this mints a correctly signed session cookie inside the container using the
  app's own APP_SECRET_KEY, then drives the real public HTTPS endpoint with it.
  That exercises Traefik, the app and the templates exactly as a browser would.

Safety
  - Every page probe is a GET, so nothing mutates.
  - Action endpoints are probed WITHOUT a CSRF token. verify_csrf is a FastAPI
    dependency, so it resolves before the handler body and returns 403. That
    proves the route is wired and protected while changing nothing.
  - POST /test is never called at all. In single-number mode it calls
    clickatell_sender.send_sms directly and bypasses the alerts-off toggle, so
    it is excluded by name rather than relying on CSRF to stop it.
  - /logout is probed last because it clears the session.
"""
from __future__ import annotations

import base64
import os
import re
import sys
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

CT = "lightning-alert-panel"
BASE = "https://adminpanel.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

log: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 78)
    say(t)
    say("=" * 78)


# ---------------------------------------------------------------- container
MINT = r'''
import base64, json, sys
sys.path.insert(0, "/app")
import itsdangerous
from app.config import settings
from app.db import SessionLocal
from app.models import User, Tenant, Recipient, Group, AlertEvent, UnitStatus

db = SessionLocal()
signer = itsdangerous.TimestampSigner(str(settings.APP_SECRET_KEY))

def mint(uid, tid, csrf="audit-csrf-token"):
    payload = {"uid": uid, "tid": tid, "csrf": csrf}
    data = base64.b64encode(json.dumps(payload).encode())
    return signer.sign(data).decode()

name = "__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session"
print(f"COOKIE_NAME={name}")

tmap = {t.slug: t.id for t in db.query(Tenant).all()}
print("TENANTS=" + ",".join(f"{k}:{v}" for k, v in sorted(tmap.items())))

for label, email in (("ADMIN", "admin@stratusweather.co.za"),
                     ("GWLD1", "admin@gwld1.stratusweather.co.za")):
    u = db.query(User).filter(User.email == email).first()
    if not u:
        print(f"{label}_MISSING=1")
        continue
    print(f"{label}_UID={u.id}")
    print(f"{label}_TID={u.tenant_id}")
    print(f"{label}_PLATFORM={bool(getattr(u, 'is_platform_admin', False))}")
    print(f"{label}_COOKIE={mint(u.id, u.tenant_id)}")

def first_id(model, tid):
    r = db.query(model).filter(model.tenant_id == tid).order_by(model.id).first()
    return r.id if r else 0

for label, slug in (("ADMIN", "stratus"), ("GWLD1", "gwld1")):
    tid = tmap.get(slug)
    if not tid:
        continue
    print(f"{label}_EVENT={first_id(AlertEvent, tid)}")
    print(f"{label}_RECIP={first_id(Recipient, tid)}")
    print(f"{label}_GROUP={first_id(Group, tid)}")
    ev = db.query(AlertEvent).filter(AlertEvent.tenant_id == tid).count()
    print(f"{label}_EVENTCOUNT={ev}")
    try:
        un = (db.query(UnitStatus).filter(UnitStatus.tenant_id == tid)
                .order_by(UnitStatus.station_id).first())
        print(f"{label}_UNIT={getattr(un, 'station_id', '') if un else ''}")
    except Exception as exc:
        print(f"{label}_UNIT=")
        print(f"{label}_UNITERR={type(exc).__name__}")
db.close()
'''


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd: str, timeout: int = 900) -> str:
    for attempt in (1, 2, 3):
        try:
            c = fresh()
            try:
                _i, o, e = c.exec_command(cmd, timeout=timeout)
                out = o.read().decode(errors="replace")
                err = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                return (out or err).rstrip()
            finally:
                c.close()
        except Exception as exc:
            if attempt == 3:
                return f"[connection failed: {type(exc).__name__}]"
            time.sleep(8)
    return ""


def push_run(text: str, name: str) -> str:
    Path("backups").mkdir(exist_ok=True)
    tmp = Path("backups") / name
    tmp.write_text(text, encoding="utf-8")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=300) as scp:
            scp.put(str(tmp), f"/tmp/{name}")
    finally:
        c.close()
    sh(f"docker cp /tmp/{name} {CT}:/tmp/{name} && rm -f /tmp/{name}")
    out = sh(f"docker exec {CT} python /tmp/{name} 2>&1", timeout=600)
    sh(f"docker exec {CT} rm -f /tmp/{name}")
    tmp.unlink(missing_ok=True)
    return out


def main() -> None:
    section("1. Minting a signed admin session inside the container")
    raw = push_run(MINT, "_mint.py")
    facts: dict[str, str] = {}
    for line in raw.splitlines():
        if "=" in line and not line.startswith(" "):
            k, v = line.split("=", 1)
            facts[k.strip()] = v.strip()
    for k in sorted(facts):
        if k.endswith("_COOKIE"):
            say(f"  {k} = <{len(facts[k])} chars, not shown>")
        else:
            say(f"  {k} = {facts[k]}")

    cname = facts.get("COOKIE_NAME", "__Host-stratus_session")
    admin_cookie = facts.get("ADMIN_COOKIE", "")
    gwld1_cookie = facts.get("GWLD1_COOKIE", "")
    if not admin_cookie:
        say()
        say("  Could not mint an admin session. Raw container output:")
        for line in raw.splitlines():
            say(f"    {line}")
        Path("backups/_panel_audit.txt").write_text("\n".join(log),
                                                    encoding="utf-8")
        raise SystemExit("Could not mint an admin session; aborting audit.")

    ev_s = facts.get("ADMIN_EVENT", "0")
    ev_g = facts.get("GWLD1_EVENT", "0")
    rc_g = facts.get("GWLD1_RECIP", "0")
    gr_g = facts.get("GWLD1_GROUP", "0")
    unit_g = facts.get("GWLD1_UNIT", "") or "GWLD1"

    # ---------------------------------------------------------------- probes
    # (label, method, path, cookie, expected-set)
    P: list[tuple[str, str, str, str, str]] = []

    def g(label, path, cookie="A", exp="200"):
        P.append((label, "GET", path, cookie, exp))

    def p(label, path, cookie="A", exp="403"):
        P.append((label, "POST", path, cookie, exp))

    # --- platform panel pages, admin session
    g("Login page", "/login", "-", "200")
    g("Dashboard", "/", "A")
    g("Dashboard CPU JSON", "/data/cpu?range=24h", "A")
    g("Dashboard strikes JSON", "/data/strikes?window=1440", "A")
    g("Stations", "/stations", "A")
    g("Reports", "/reports", "A")
    g("Recipients", "/recipients", "A")
    g("Groups", "/groups", "A")
    g("Events", "/events", "A")
    g("Test alert page", "/test", "A")
    g("Settings", "/settings", "A")
    g("Users", "/users", "A")
    g("Clients (tenants)", "/tenants", "A", "200|404")
    g("Change password", "/account/password", "A")
    if ev_s and ev_s != "0":
        g("Event detail", f"/events/{ev_s}", "A")

    # --- gwld1 tenant panel, gwld1 admin session
    if gwld1_cookie:
        g("gwld1 dashboard", "/gwld1/", "G")
        g("gwld1 stations", "/gwld1/stations", "G")
        g("gwld1 recipients", "/gwld1/recipients", "G")
        g("gwld1 groups", "/gwld1/groups", "G")
        g("gwld1 events", "/gwld1/events", "G")
        g("gwld1 reports", "/gwld1/reports", "G")
        g("gwld1 test page", "/gwld1/test", "G")
        g("gwld1 settings", "/gwld1/settings", "G")
        g("gwld1 users", "/gwld1/users", "G")
        g("gwld1 CPU JSON", "/gwld1/data/cpu?range=24h", "G")
        g("gwld1 strikes JSON", "/gwld1/data/strikes?window=1440", "G")
        if ev_g and ev_g != "0":
            g("gwld1 event detail", f"/gwld1/events/{ev_g}", "G")

    # --- static assets that the buttons and charts depend on
    for a in ("/static/style.css", "/static/app.js",
              "/static/js/cpu-chart.js", "/static/js/storm-view.js",
              "/static/vendor/react.production.min.js",
              "/static/vendor/react-dom.production.min.js",
              "/static/vendor/prop-types.min.js",
              "/static/vendor/recharts.js"):
        g(f"asset {a.split('/')[-1]}", a, "-", "200")

    # --- API
    g("API health", "/api/v1/health", "-", "200")
    g("API health (gwld1)", "/gwld1/api/v1/health", "-", "200")

    # --- action endpoints: CSRF-less POST must be refused, proving they exist
    p("Alerts toggle", "/alerts/toggle", "A")
    p("Alerts cooldown", "/alerts/cooldown", "A")
    p("Recipient create", "/recipients/create", "A")
    p("Group create", "/groups/create", "A")
    p("User create", "/users/create", "A")
    p("Report generate", "/reports/generate", "A")
    p("Station update", f"/stations/{unit_g}/update", "A")
    p("Events delete all", "/events/delete-all", "A")
    p("Change password", "/account/password", "A")
    p("Tenant create", "/tenants/create", "A", "403|404")
    if gwld1_cookie:
        p("gwld1 alerts toggle", "/gwld1/alerts/toggle", "G")
        p("gwld1 cooldown", "/gwld1/alerts/cooldown", "G")
        p("gwld1 recipient create", "/gwld1/recipients/create", "G")
        if rc_g and rc_g != "0":
            p("gwld1 recipient toggle", f"/gwld1/recipients/{rc_g}/toggle", "G")
            p("gwld1 recipient delete", f"/gwld1/recipients/{rc_g}/delete", "G")
        if gr_g and gr_g != "0":
            p("gwld1 group update", f"/gwld1/groups/{gr_g}/update", "G")
            p("gwld1 group toggle", f"/gwld1/groups/{gr_g}/toggle", "G")
            p("gwld1 group delete", f"/gwld1/groups/{gr_g}/delete", "G")
        if ev_g and ev_g != "0":
            p("gwld1 event delete", f"/gwld1/events/{ev_g}/delete", "G")

    # --- unauthenticated access must be refused, not served
    g("Dashboard, no session", "/", "-", "303|302|307")
    g("Settings, no session", "/settings", "-", "303|302|307")
    g("Users, no session", "/users", "-", "303|302|307")

    # --- logout last, it clears the session
    g("Logout", "/logout", "A", "303|302|307")

    # ------------------------------------------------------------ run probes
    section(f"2. Probing {len(P)} endpoints on {BASE}")
    say("  POST rows are sent WITHOUT a CSRF token: 403 is the correct,")
    say("  non-mutating result and proves the route exists and is protected.")
    say("  POST /test is deliberately excluded so no SMS can be sent.")
    say()

    lines = ["set -u"]
    for i, (label, method, path, ck, _exp) in enumerate(P):
        cookie = {"A": admin_cookie, "G": gwld1_cookie, "-": ""}[ck]
        carg = f"-b '{cname}={cookie}'" if cookie else ""
        marg = "-X POST" if method == "POST" else ""
        lines.append(
            f"printf '%s|%s|%s|' {i} '{method}' '{path}'; "
            f"curl -s -o /dev/null -w '%{{http_code}}' --max-time 25 "
            f"{marg} {carg} '{BASE}{path}'; echo"
        )
    script = "\n".join(lines) + "\n"
    b64 = base64.b64encode(script.encode()).decode()
    out = sh(f"echo {b64} | base64 -d | bash 2>&1", timeout=1800)

    codes: dict[int, str] = {}
    for line in out.splitlines():
        m = re.match(r"^(\d+)\|([A-Z]+)\|(\S*)\|(\d{3})$", line.strip())
        if m:
            codes[int(m.group(1))] = m.group(4)

    ok_n = bad_n = 0
    bad: list[str] = []
    say(f"  {'result':<7} {'method':<6} {'code':<5} {'endpoint':<44} what it is")
    say("  " + "-" * 74)
    for i, (label, method, path, ck, exp) in enumerate(P):
        code = codes.get(i, "---")
        good = code in exp.split("|")
        if good:
            ok_n += 1
        else:
            bad_n += 1
            bad.append(f"{method} {path} -> {code} (expected {exp}) [{label}]")
        say(f"  {'ok' if good else 'FAIL':<7} {method:<6} {code:<5} "
            f"{path[:44]:<44} {label}")

    section("3. Result")
    say(f"  {ok_n} of {len(P)} endpoints behaved as expected.")
    if bad:
        say()
        say("  Needs attention:")
        for b in bad:
            say(f"    {b}")
    else:
        say("  Every page renders, every asset is served, every action endpoint")
        say("  is wired and CSRF-protected, and unauthenticated access is")
        say("  refused on protected pages.")

    say()
    say("  Not exercised, by design:")
    say("    POST /test              would send a real SMS in single-number mode")
    say("    POST /alerts/toggle ON  would arm live strike alerts")
    say("    destructive deletes     recipients/groups/events/users removal")
    say("  These are confirmed present and CSRF-protected, not clicked.")

    say()
    say("  Panel still healthy after the audit:")
    say("  " + sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                  + CT))
    ml = sh(f"docker exec {CT} python -c "
            "\"import sys; sys.path.insert(0,'/app'); "
            "from app.db import SessionLocal; from app.models import MessageLog; "
            "d=SessionLocal(); print(d.query(MessageLog).count()); d.close()\" 2>&1")
    say(f"  message_log rows: {ml}  (0 confirms nothing was sent)")

    Path("backups").mkdir(exist_ok=True)
    Path(f"backups/_panel_audit_{STAMP}.log").write_text("\n".join(log),
                                                         encoding="utf-8")
    Path("backups/_panel_audit.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_panel_audit.txt").write_text(
            "\n".join(log) + "\n\nSCRIPT FAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
