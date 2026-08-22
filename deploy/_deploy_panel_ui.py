"""Deploy the report fix and the dashboard chart/layout changes.

  requirements.txt      pin pydyf==0.11.0 - unpinned 0.12.1 broke every PDF
  app/charts.py         CPU chart 480x160 -> 960x300, denser grid, time labels
  app/static/style.css  unit block declared once, chart flexes to full width

requirements.txt changed, so the pip layer rebuilds. That is slower than an
app-only build on this box.
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

DIR = "/opt/lightning-panel"
CF = "docker-compose.traefik.yml"
SVC, CT = "panel", "lightning-alert-panel"
BASE = "https://adminpanel.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/panel-ui.log", "/root/panel-ui.done"
FILES = ["requirements.txt", "app/charts.py", "app/static/style.css"]
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
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<44} {detail}")


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
u = db.query(User).filter(User.email == "admin@stratusweather.co.za").first()
d = base64.b64encode(json.dumps({"uid": u.id, "tid": u.tenant_id, "csrf": "x"}).encode())
print(("__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session")
      + "|" + s.sign(d).decode())
db.close()
'''


def main() -> None:
    section("0. Pre-flight")
    for f in FILES:
        p = ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing: {p}")
        say(f"  {f:<26} {p.stat().st_size:>8,} B")
    cur = sh(f"docker inspect {CT} --format '{{{{.Config.Image}}}}'")
    say(f"  image  {cur}")
    say(f"  disk   {sh('df -h / | tail -1')}")

    section("1. Rollback tag")
    say("  " + sh(f"docker tag {cur} lightning-alert-panel:rollback-{STAMP} "
                  f"&& echo tagged rollback-{STAMP}"))

    section("2. Upload")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in FILES:
            tf.add(ROOT / f, arcname=f)
    data = buf.getvalue()
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(data), f"/tmp/ui-{STAMP}.tar.gz")
    finally:
        c.close()
    say("  " + sh(f"cd {DIR} && tar -xzf /tmp/ui-{STAMP}.tar.gz && "
                  f"rm -f /tmp/ui-{STAMP}.tar.gz && echo extracted"))
    say("  " + sh(f"grep -n 'pydyf' {DIR}/requirements.txt | tail -2"))
    say("  " + sh(f"grep -c 'W, H = 960, 300' {DIR}/app/charts.py") + " chart geometry")
    say("  " + sh(f"grep -c 'flex: 1 1 520px' {DIR}/app/static/style.css")
        + " css flex rule")

    section("3. Build (detached; pip layer rebuilds)")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose -f {CF} build {SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' >/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code, last = None, -1
    for _ in range(150):
        time.sleep(20)
        d = sh(f"cat {DONE} 2>/dev/null || true")
        try:
            size = int((sh(f"stat -c%s {LOG} 2>/dev/null || echo 0") or "0").strip())
        except ValueError:
            size = last
        if size != last:
            last = size
            t = sh(f"tail -2 {LOG} 2>/dev/null || true")
            say(f"    [poll] {size:>8} B  "
                + " | ".join(x.strip() for x in t.splitlines() if x.strip())[-120:])
        if d.strip():
            code = int(d.strip()) if d.strip().isdigit() else -1
            break
    if code is None:
        say("  still building; live panel untouched.")
        return
    say(f"  build exit {code}")
    if code != 0:
        for line in sh(f"tail -30 {LOG}").splitlines():
            say(f"    {line}")
        say("  BUILD FAILED - nothing recreated.")
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

    section("5. Verify the PDF fix")
    v = sh(f"docker exec {CT} python -c "
           "\"import importlib.metadata as m; print(m.version('pydyf'))\"")
    ck(v.strip() == "0.11.0", "pydyf pinned in the image", v.strip())
    r = sh(f"docker exec {CT} python -c "
           "\"from weasyprint import HTML; b=HTML(string='<p>x</p>').write_pdf(); "
           "print('PDFBYTES', len(b), b[:4])\" 2>&1 | tail -2")
    ck("PDFBYTES" in r, "weasyprint renders a PDF", r.strip()[:70])

    res = sh(f"echo {base64.b64encode(MINT.encode()).decode()} "
             f"| base64 -d | docker exec -i {CT} python - 2>&1")
    line = [l for l in res.splitlines() if "|" in l]
    if line:
        nm, cookie = line[-1].split("|", 1)
        page = sh("curl -s --max-time 25 " f"-b '{nm}={cookie}' '{BASE}/gwld1/reports'")
        tok = re.search(r'name="csrf_token"\s+value="([^"]*)"', page)
        tok = tok.group(1) if tok else "x"
        code_ = sh("curl -s -o /tmp/r.txt -w '%{http_code}' --max-time 180 "
                   f"-b '{nm}={cookie}' -X POST '{BASE}/gwld1/reports/generate' "
                   f"--data-urlencode 'csrf_token={tok}' "
                   "--data-urlencode 'station_id=GLENCORE WONDERKOP' "
                   "--data-urlencode 'month=2026-08' "
                   "--data-urlencode 'report_type=technical'")
        ck(code_.strip() in ("303", "302", "200"),
           "POST /gwld1/reports/generate", code_.strip())
        dl = sh("curl -s -o /tmp/r.pdf -w '%{http_code}' --max-time 180 "
                f"-b '{nm}={cookie}' "
                f"'{BASE}/gwld1/reports/download?station=GLENCORE%20WONDERKOP"
                "&month=2026-08&type=technical'")
        head = sh("head -c 4 /tmp/r.pdf")
        size = sh("stat -c%s /tmp/r.pdf 2>/dev/null || echo 0")
        ck(dl.strip() == "200" and "%PDF" in head,
           "downloaded a real PDF", f"HTTP {dl.strip()}, {size.strip()} bytes, {head}")
        for p in ("/gwld1/", "/gwld1/stations", "/tenants", "/"):
            c2 = sh("curl -s -o /dev/null -w %{http_code} --max-time 25 "
                    f"-b '{nm}={cookie}' '{BASE}{p}'")
            ck(c2.strip() == "200", f"GET {p}", c2.strip())
    css = sh("curl -s --max-time 25 " f"'{BASE}/static/style.css' | grep -c 'flex: 1 1 520px'")
    ck(css.strip() not in ("0", ""), "new CSS is being served", css.strip())

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say(f"\n  rollback  lightning-alert-panel:rollback-{STAMP}")
    say(f"  disk      {sh('df -h / | tail -1')}")

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_panel_ui.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_panel_ui.txt").write_text(
            "\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
