"""Deploy the platform-console split, bigger charts and icon-free legends.

  app/templates/base.html  two navigations: management console vs client panel
  app/routes/web.py        platform admin on "/" lands on /tenants
  app/charts.py            legend markers removed
  app/static/style.css     unit-grid stacks in a column so charts can grow

requirements.txt is unchanged, so the pip layer is cached and this build is
quick compared with the last one.
"""
from __future__ import annotations

import base64
import io
import os
import re
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
BASE = "https://adminpanel.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/panel-console.log", "/root/panel-console.done"
FILES = ["app/templates/base.html", "app/routes/web.py",
         "app/charts.py", "app/static/style.css"]
ROOT = Path("LDS ADMIN")

log: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


def ck(ok: bool, label: str, detail: str = "") -> None:
    checks.append((ok, label))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<48} {detail}")


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd, timeout=900):
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


MINT = r'''
import base64, json, sys
sys.path.insert(0, "/app")
import itsdangerous
from app.config import settings
from app.db import SessionLocal
from app.models import User
db = SessionLocal()
s = itsdangerous.TimestampSigner(str(settings.APP_SECRET_KEY))
for email in ("admin@stratusweather.co.za", "admin@gwld1.stratusweather.co.za"):
    u = db.query(User).filter(User.email == email).first()
    if u:
        d = base64.b64encode(json.dumps(
            {"uid": u.id, "tid": u.tenant_id, "csrf": "x"}).encode())
        print(email + "|" + s.sign(d).decode())
print("NAME|" + ("__Host-stratus_session" if settings.SECURE_COOKIES
                 else "stratus_session"))
db.close()
'''


def main() -> None:
    section("0. Pre-flight")
    for f in FILES:
        p = ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing: {p}")
        say(f"  {f:<30} {p.stat().st_size:>8,} B")
    cur = sh(f"docker inspect {CT} --format '{{{{.Config.Image}}}}'")
    say(f"  disk  {sh('df -h / | tail -1')}")

    section("1. Rollback tag")
    say("  " + sh(f"docker tag {cur} lightning-alert-panel:rollback-{STAMP} "
                  f"&& echo tagged rollback-{STAMP}"))

    section("2. Upload")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in FILES:
            tf.add(ROOT / f, arcname=f)
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(buf.getvalue()), f"/tmp/con-{STAMP}.tar.gz")
    finally:
        c.close()
    say("  " + sh(f"cd {DIR} && tar -xzf /tmp/con-{STAMP}.tar.gz && "
                  f"rm -f /tmp/con-{STAMP}.tar.gz && echo extracted"))
    for needle, f in (("platform_console", "app/templates/base.html"),
                      ("Unassigned Units", "app/templates/base.html"),
                      ("flex-direction: column", "app/static/style.css"),
                      ("W, H = 960, 300", "app/charts.py")):
        say(f"  {sh(f'grep -c {needle!r} {DIR}/{f}').strip():>3}  {needle}")
    say(f"  {sh(f'grep -c 9632 {DIR}/app/charts.py || true').strip().splitlines()[0]:>3}"
        "  legend glyphs remaining (want 0)")

    section("3. Build (detached)")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose -f {CF} build {SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' >/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code, last = None, -1
    for _ in range(120):
        time.sleep(15)
        d = sh(f"cat {DONE} 2>/dev/null || true")
        try:
            size = int((sh(f"stat -c%s {LOG} 2>/dev/null || echo 0") or "0").strip())
        except ValueError:
            size = last
        if size != last:
            last = size
            t = sh(f"tail -2 {LOG} 2>/dev/null || true")
            say(f"    [poll] {size:>7} B  "
                + " | ".join(x.strip() for x in t.splitlines() if x.strip())[-110:])
        if d.strip():
            code = int(d.strip()) if d.strip().isdigit() else -1
            break
    if code is None:
        say("  still building; panel untouched.")
        Path("backups/_console.txt").write_text("\n".join(log), encoding="utf-8")
        return
    say(f"  build exit {code}")
    if code != 0:
        for line in sh(f"tail -25 {LOG}").splitlines():
            say(f"    {line}")
        Path("backups/_console.txt").write_text("\n".join(log), encoding="utf-8")
        return

    section("4. Recreate")
    say(sh(f"cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC} 2>&1 | tail -6", 900))
    healthy = False
    for i in range(48):
        st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                f"{CT} 2>/dev/null")
        if "healthy" in st:
            say(f"  healthy after {i*5}s")
            healthy = True
            break
        time.sleep(5)
    ck(healthy, "panel healthy")

    section("5. Verify")
    res = sh(f"echo {base64.b64encode(MINT.encode()).decode()} "
             f"| base64 -d | docker exec -i {CT} python - 2>&1")
    cookies = {}
    nm = "__Host-stratus_session"
    for line in res.splitlines():
        if "|" in line:
            k, v = line.split("|", 1)
            if k == "NAME":
                nm = v.strip()
            else:
                cookies[k.strip()] = v.strip()
    plat = cookies.get("admin@stratusweather.co.za", "")
    if not plat:
        ck(False, "could not mint a platform session")
        Path("backups/_console.txt").write_text("\n".join(log), encoding="utf-8")
        return

    def get(path, cookie):
        return sh("curl -s --max-time 30 "
                  + (f"-b '{nm}={cookie}' " if cookie else "")
                  + f"'{BASE}{path}'")

    def code_of(path, cookie):
        return sh("curl -s -o /dev/null -w %{http_code} --max-time 30 "
                  + (f"-b '{nm}={cookie}' " if cookie else "")
                  + f"'{BASE}{path}'").strip()

    say("  platform console:")
    c1 = code_of("/", plat)
    ck(c1 in ("303", "302", "307"), "GET / redirects the platform admin", c1)
    loc = sh("curl -s -o /dev/null -D - --max-time 30 "
             f"-b '{nm}={plat}' '{BASE}/' | grep -i '^location:' || true")
    say(f"        {loc.strip()}")
    ck("/tenants" in loc, "redirect target is /tenants")

    t = get("/tenants", plat)
    ck("Create a client panel" in t or "tenants/create" in t,
       "client creation form present")
    ck("gwld1" in t, "active client listed with access")
    nav = t.split("</nav>")[0] if "</nav>" in t else t
    for label, want in (("Clients", True), ("Unassigned Units", True),
                        ("Recipients", False), ("Test Alert", False),
                        ("Events", False), ("Groups", False)):
        present = f">{label}<" in nav
        ck(present == want,
           f"platform nav {'has' if want else 'omits'} {label}",
           "present" if present else "absent")

    say()
    say("  client panel keeps the full navigation:")
    g = get("/gwld1/", plat)
    gnav = g.split("</nav>")[0] if "</nav>" in g else g
    for label in ("Dashboard", "Recipients", "Groups", "Events", "Reports",
                  "Test Alert"):
        ck(f">{label}<" in gnav, f"client nav has {label}")

    say()
    say("  charts and legend:")
    ck("&#9632;" not in g and "\u25a0" not in g, "no square glyphs in the page")
    ck("Temp &deg;C" in g or "Temp \u00b0C" in g, "legend text still present")
    ck("960 300" in g or 'viewBox="0 0 960 300"' in g,
       "chart uses the larger viewBox")
    css = sh("curl -s --max-time 25 " f"'{BASE}/static/style.css'")
    ck("flex-direction: column" in css, "unit-grid stacks in a column")
    ck("flex: 1 1 520px" in css, "chart flexes to fill width")

    say()
    say("  nothing else regressed:")
    for p, want in (("/gwld1/stations", "200"), ("/gwld1/events", "200"),
                    ("/gwld1/reports", "200"), ("/settings", "200"),
                    ("/users", "200"), ("/api/v1/health", "200")):
        ck(code_of(p, plat) == want, f"GET {p}", code_of(p, plat))
    ml = sh(f"docker exec {CT} python -c "
            "\"import sys; sys.path.insert(0,'/app'); "
            "from app.db import SessionLocal; from app.models import MessageLog; "
            "d=SessionLocal(); print(d.query(MessageLog).count()); d.close()\"")
    ck(ml.strip() == "0", "message_log still empty", ml.strip())
    tb = sh(f"docker logs --since 120s {CT} 2>&1")
    n = tb.count("Traceback (most recent call last)")
    ck(n == 0, "no tracebacks since recreate", str(n))

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say(f"\n  rollback  lightning-alert-panel:rollback-{STAMP}")
    say(f"  disk      {sh('df -h / | tail -1')}")

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_console.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_console.txt").write_text(
            "\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
