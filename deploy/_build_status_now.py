"""One-shot status of the detached Stratus build. No waiting, no changes."""
from __future__ import annotations

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

LOG, DONE = "/root/stratus-nav.log", "/root/stratus-nav.done"
CT = "stratus-app"

out: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    out.append(m)


def sh(cmd, timeout=180):
    for attempt in (1, 2, 3):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect(HOST, username=USER, password=PW, timeout=45,
                      look_for_keys=False, allow_agent=False,
                      banner_timeout=45, auth_timeout=45)
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
            time.sleep(6)
    return ""


say("=" * 72)
say("Detached Stratus build status")
say("=" * 72)
sent = sh(f"cat {DONE} 2>/dev/null || echo RUNNING")
say(f"  sentinel        : {sent.strip()}")
say(f"  build log size  : {sh(f'stat -c%s {LOG} 2>/dev/null || echo 0').strip()} B")
say(f"  buildkit active : {sh('docker ps --format {{.Image}} | grep -ci buildkit || true').strip().splitlines()[0] if sh('docker ps --format {{.Image}} | grep -ci buildkit || true').strip() else '0'}")
say()
say("  last 6 log lines:")
for line in sh(f"tail -6 {LOG} 2>/dev/null || echo '(no log)'").splitlines():
    say(f"    {line}")

say()
say("=" * 72)
say("Live site right now (unchanged until the recreate happens)")
say("=" * 72)
say(f"  container   : {sh('docker inspect -f ' + chr(39) + '{{.State.Status}}/{{.State.Health.Status}}' + chr(39) + ' ' + CT)}")
say(f"  image       : {sh('docker inspect ' + CT + ' --format ' + chr(39) + '{{.Image}}' + chr(39))[:26]}")
say(f"  uptime      : {sh('docker inspect -f ' + chr(39) + '{{.State.StartedAt}}' + chr(39) + ' ' + CT)}")
for u in ("https://stratusweather.co.za/", "https://stratusweather.co.za/api/health"):
    say(f"  {u:<44} {sh('curl -s -o /dev/null -w %{http_code} --max-time 20 ' + u).strip()}")

say()
say("  nav label in the CURRENTLY RUNNING bundle:")
new = sh(f"docker exec {CT} sh -c \"grep -rl 'AS3935 Admin Panel' "
         "client/dist/assets 2>/dev/null | head -1 || echo none\"")
old = sh(f"docker exec {CT} sh -c \"grep -rl 'Lightning Dashboard' "
         "client/dist/assets 2>/dev/null | head -1 || echo none\"")
say(f"    'AS3935 Admin Panel' : {new.strip()}")
say(f"    'Lightning Dashboard': {old.strip()}")

say()
say(f"  disk : {sh('df -h / | tail -1')}")
say(f"  mem  : {sh('free -h | sed -n 2p')}")

Path("backups").mkdir(exist_ok=True)
Path("backups/_build_status_now.txt").write_text("\n".join(out), encoding="utf-8")
