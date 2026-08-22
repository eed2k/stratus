"""Deploy the two panel fixes: the /gwld1/ 500 and the platform-in-client-list.

  app/templates/dashboard.html  guard a null last_seen (fixes the 500)
  app/routes/web.py             exclude the platform tenant from the client list

The template alone could be hot-copied, but web.py is Python and needs the
process restarted, and copying into the container without rebuilding would leave
the image stale so the next `compose up` silently reverts it. So: upload, build,
recreate.

Build runs detached with a sentinel file because holding one SSH channel open
through a build on this box has previously ended with the remote host closing it.
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

DIR = "/opt/lightning-panel"
CF = "docker-compose.traefik.yml"
SVC = "panel"
CT = "lightning-alert-panel"
BASE = "https://adminpanel.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG = "/root/panel-fix.log"
DONE = "/root/panel-fix.done"

FILES = ["app/templates/dashboard.html", "app/routes/web.py"]
LOCAL_ROOT = Path("LDS ADMIN")

log: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


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
print("COOKIE=" + s.sign(d).decode())
print("NAME=" + ("__Host-stratus_session" if settings.SECURE_COOKIES else "stratus_session"))
db.close()
'''


def mint() -> tuple[str, str]:
    b64 = base64.b64encode(MINT.encode()).decode()
    out = sh(f"echo {b64} | base64 -d | docker exec -i {CT} python - 2>&1", 300)
    ck = nm = ""
    for line in out.splitlines():
        if line.startswith("COOKIE="):
            ck = line.split("=", 1)[1].strip()
        elif line.startswith("NAME="):
            nm = line.split("=", 1)[1].strip()
    return ck, nm


def main() -> None:
    section("0. Pre-flight")
    for f in FILES:
        p = LOCAL_ROOT / f
        if not p.is_file():
            raise SystemExit(f"missing locally: {p}")
        say(f"  {f:<34} {p.stat().st_size:>7,} B")
    cur = sh(f"docker inspect {CT} --format '{{{{.Config.Image}}}}'")
    say(f"  current image  {cur}")
    say(f"  disk           {sh('df -h / | tail -1')}")

    section("1. Rollback tag")
    say("  " + sh(f"docker tag {cur} lightning-alert-panel:rollback-{STAMP} && "
                  f"echo tagged lightning-alert-panel:rollback-{STAMP}"))

    section("2. Upload the changed files")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in FILES:
            tf.add(LOCAL_ROOT / f, arcname=f)
    data = buf.getvalue()
    say(f"  {len(FILES)} files, {len(data):,} bytes compressed")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(data), f"/tmp/panelfix-{STAMP}.tar.gz")
    finally:
        c.close()
    say("  " + sh(f"cd {DIR} && tar -xzf /tmp/panelfix-{STAMP}.tar.gz && "
                  f"rm -f /tmp/panelfix-{STAMP}.tar.gz && echo extracted"))

    say()
    say("  confirming on disk:")
    n1 = sh(f"grep -c 'if u.last_seen' {DIR}/app/templates/dashboard.html || echo 0")
    n2 = sh(f"grep -c 'PLATFORM_TENANT_SLUG' {DIR}/app/routes/web.py || echo 0")
    say(f"    dashboard.html null guard      {n1}")
    say(f"    web.py platform exclusion      {n2}")

    section("3. Build (detached)")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose -f {CF} build {SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' > /dev/null 2>&1 < /dev/null & echo LAUNCHED"))
    code, last = None, -1
    for _ in range(120):                       # up to 40 minutes
        time.sleep(20)
        d = sh(f"cat {DONE} 2>/dev/null || true")
        try:
            size = int((sh(f"stat -c%s {LOG} 2>/dev/null || echo 0") or "0").strip())
        except ValueError:
            size = last
        if size != last:
            last = size
            tail = sh(f"tail -2 {LOG} 2>/dev/null || true")
            snip = " | ".join(x.strip() for x in tail.splitlines() if x.strip())[-130:]
            say(f"    [poll] {size:>8} B  {snip}")
        if d.strip():
            try:
                code = int(d.strip())
            except ValueError:
                code = -1
            break
    if code is None:
        say("  still building; live container untouched. Check " + LOG)
        return
    say(f"  build exit {code}")
    if code != 0:
        say("  BUILD FAILED - nothing recreated, panel still serving.")
        for line in sh(f"tail -25 {LOG}").splitlines():
            say(f"    {line}")
        return

    section("4. Recreate the panel only")
    say(sh(f"cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC} 2>&1 | tail -8", 900))
    healthy = False
    for i in range(48):
        st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                f"{CT} 2>/dev/null")
        if "healthy" in st:
            say(f"  healthy after {i * 5}s")
            healthy = True
            break
        if i % 4 == 0:
            say(f"  {i * 5:>3}s  {st}")
        time.sleep(5)
    if not healthy:
        say("  did not report healthy within 240s")

    section("5. Verify the two fixes as the platform admin")
    ok = healthy
    ck, nm = mint()
    if not ck:
        say("  could not mint a session to verify with")
        ok = False
    else:
        for path, want, what in (
            ("/gwld1/", "200", "the 500 is gone"),
            ("/gwld1/stations", "200", "stations still fine"),
            ("/tenants", "200", "client list renders"),
            ("/", "200", "platform dashboard"),
        ):
            code_ = sh("curl -s -o /tmp/b.txt -w '%{http_code}' --max-time 25 "
                       f"-b '{nm}={ck}' '{BASE}{path}'")
            good = code_.strip() == want
            ok &= good
            say(f"  {'PASS' if good else 'FAIL':<5} {code_.strip():<4} {path:<18} {what}")

        say()
        body = sh("curl -s --max-time 25 " f"-b '{nm}={ck}' '{BASE}/tenants'")
        has_gwld1 = "gwld1" in body
        has_platform = "Stratus Weather (platform)" in body or ">/stratus<" in body
        say(f"  {'PASS' if has_gwld1 else 'FAIL':<5} GWLD1 still listed as a client")
        say(f"  {'PASS' if not has_platform else 'FAIL':<5} "
            "Stratus Weather no longer listed as a client")
        ok &= has_gwld1 and not has_platform

        say()
        dash = sh("curl -s --max-time 25 " f"-b '{nm}={ck}' '{BASE}/gwld1/'")
        shows_never = "never" in dash
        say(f"  {'PASS' if shows_never else 'FAIL':<5} "
            "never-seen units render as 'never'")
        ok &= shows_never
        for sid in ("GLENCORE WONDERKOP", "GWLD1-DEMO"):
            say(f"        unit '{sid}' on the page: {sid in dash}")

    say()
    say("  no traceback since the recreate:")
    tb = sh(f"docker logs --since 120s {CT} 2>&1 | grep -c 'Traceback' || echo 0")
    say(f"    tracebacks: {tb.strip()}")
    ok &= tb.strip() == "0"

    section("Result")
    if ok:
        say("  Both fixed and live. /gwld1/ opens, and the client list shows")
        say("  only real clients.")
    else:
        say("  Completed with failures. Rollback:")
        say(f"    docker tag lightning-alert-panel:rollback-{STAMP} {cur}")
        say(f"    cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC}")
    say(f"\n  rollback image  lightning-alert-panel:rollback-{STAMP}")
    say(f"  disk            {sh('df -h / | tail -1')}")

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_panel_fix.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_panel_fix.txt").write_text(
            "\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
