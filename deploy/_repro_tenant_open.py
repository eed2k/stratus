"""Reproduce what happens when the PLATFORM admin clicks "Open panel".

The earlier audit opened /gwld1/ using the gwld1 admin's own session, which
works. The untested path is a platform admin (uid=1, tenant 1) opening another
tenant's panel, which is exactly what the operator did. This mints a platform
admin session and follows both links from the tenants page, capturing the body
so the actual error is visible rather than guessed at.

Read-only.
"""
from __future__ import annotations

import base64
import os
import re
import sys
import time
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


def sh(cmd: str, timeout: int = 600) -> str:
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
signer = itsdangerous.TimestampSigner(str(settings.APP_SECRET_KEY))
u = db.query(User).filter(User.email == "admin@stratusweather.co.za").first()
data = base64.b64encode(json.dumps(
    {"uid": u.id, "tid": u.tenant_id, "csrf": "x"}).encode())
print("COOKIE=" + signer.sign(data).decode())
print("NAME=" + ("__Host-stratus_session" if settings.SECURE_COOKIES
                 else "stratus_session"))
print("PLATFORM_SLUG=" + str(settings.PLATFORM_TENANT_SLUG))
print("RESERVED=" + ",".join(sorted(getattr(
    __import__("app.tenancy", fromlist=["x"]), "RESERVED_SLUGS", []))))
db.close()
'''


def main() -> None:
    Path("backups").mkdir(exist_ok=True)
    tmp = Path("backups/_mintp.py")
    tmp.write_text(MINT, encoding="utf-8")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=300) as scp:
            scp.put(str(tmp), "/tmp/_mintp.py")
    finally:
        c.close()
    sh(f"docker cp /tmp/_mintp.py {CT}:/tmp/_mintp.py && rm -f /tmp/_mintp.py")
    raw = sh(f"docker exec {CT} python /tmp/_mintp.py 2>&1", timeout=300)
    sh(f"docker exec {CT} rm -f /tmp/_mintp.py")
    tmp.unlink(missing_ok=True)

    facts = {}
    for line in raw.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            facts[k.strip()] = v.strip()

    section("Session")
    for k, v in facts.items():
        say(f"  {k} = {'<' + str(len(v)) + ' chars>' if k == 'COOKIE' else v}")
    cookie = facts.get("COOKIE", "")
    cname = facts.get("NAME", "__Host-stratus_session")
    if not cookie:
        say("  could not mint; raw output:")
        say(raw)
        Path("backups/_repro_tenant.txt").write_text("\n".join(log),
                                                     encoding="utf-8")
        return

    section("As the PLATFORM admin, follow the links on /tenants")
    targets = [
        ("/", "platform dashboard"),
        ("/tenants", "the client list itself"),
        ("/gwld1/", "Open panel -> GWLD1"),
        ("/stratus/", "Open panel -> Stratus Weather (platform)"),
        ("/gwld1/stations", "gwld1 stations"),
        ("/gwld1/events", "gwld1 events"),
        ("/gwld1/settings", "gwld1 settings"),
    ]
    for path, what in targets:
        out = sh("curl -s -o /tmp/body.txt -w '%{http_code}' --max-time 25 "
                 f"-b '{cname}={cookie}' '{BASE}{path}'")
        body = sh("head -c 1200 /tmp/body.txt")
        code = out.strip()
        say()
        say(f"  {code:<5} {path:<20} {what}")
        # Surface the useful part of an error page.
        if code not in ("200", "303", "302", "307"):
            title = re.search(r"<title>(.*?)</title>", body, re.S)
            detail = re.search(r'"detail"\s*:\s*"(.*?)"', body)
            if detail:
                say(f"        detail: {detail.group(1)}")
            elif title:
                say(f"        title : {title.group(1).strip()}")
            for ln in [x for x in body.splitlines() if x.strip()][:6]:
                say(f"        | {ln[:110]}")
        elif code == "200":
            h1 = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
            if h1:
                say(f"        renders h1: {re.sub(r'<[^>]+>', '', h1.group(1)).strip()[:70]}")

    section("Container log for anything raised during those requests")
    say(sh(f"docker logs --since 90s {CT} 2>&1 | tail -40"))

    Path("backups/_repro_tenant.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_repro_tenant.txt").write_text(
            "\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
