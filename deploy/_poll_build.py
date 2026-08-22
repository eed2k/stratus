"""Poll a detached build started by _deploy_sidebar.py, then finish the deploy.

The orchestrating SSH connection was dropped mid-build (10054), which is a known
symptom on this box under build memory pressure. The build itself was launched
with setsid+nohup so it survives that; each poll here is a short independent
connection.
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime
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

DIR, CF, SVC, CT = "/opt/stratus", "docker-compose.yml", "stratus", "stratus-app"
LOG, DONE = "/root/stratus-nav.log", "/root/stratus-nav.done"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

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


def sh(cmd, timeout=900):
    for attempt in (1, 2, 3, 4):
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
            if attempt == 4:
                return f"[conn failed: {type(exc).__name__}]"
            time.sleep(10)
    return ""


def main() -> None:
    section("1. Is the detached build still going?")
    say(f"  sentinel : {sh(f'cat {DONE} 2>/dev/null || echo (running)')}")
    say(f"  log size : {sh(f'stat -c%s {LOG} 2>/dev/null || echo 0')} B")
    say(f"  buildkit : {sh('docker ps --format {{.Names}} | grep -c buildkit || true')}")
    say(f"  source   : "
        + sh("grep -c 'AS3935 Admin Panel' "
             f"{DIR}/client/src/components/AppSidebar.tsx || echo 0"))

    code, last = None, -1
    for _ in range(180):
        d = sh(f"cat {DONE} 2>/dev/null || true")
        if d.strip():
            code = int(d.strip()) if d.strip().isdigit() else -1
            break
        try:
            size = int((sh(f"stat -c%s {LOG} 2>/dev/null || echo 0") or "0").strip())
        except ValueError:
            size = last
        if size != last:
            last = size
            t = sh(f"tail -2 {LOG} 2>/dev/null || true")
            mem = sh("free -m | awk '/Mem:/{print $7}'")
            say(f"    [poll] {size:>8} B  mem {mem.strip()} MB  "
                + " | ".join(x.strip() for x in t.splitlines() if x.strip())[-105:])
        time.sleep(20)

    if code is None:
        say("  still building. Live site untouched; re-run this poller.")
        Path("backups/_sidebar.txt").write_text("\n".join(log), encoding="utf-8")
        return
    say(f"\n  build exit {code}")
    if code != 0:
        for line in sh(f"tail -30 {LOG}").splitlines():
            say(f"    {line}")
        say("  BUILD FAILED - nothing recreated, site still serving.")
        Path("backups/_sidebar.txt").write_text("\n".join(log), encoding="utf-8")
        return

    section("2. Recreate stratus only")
    cur = sh(f"docker inspect {CT} --format '{{{{.Config.Image}}}}'")
    say("  " + sh(f"docker tag {cur} stratus-stratus:rollback-{STAMP} && echo tagged"))
    say(sh(f"cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC} 2>&1 | tail -6", 900))
    healthy = False
    for i in range(72):
        st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                f"{CT} 2>/dev/null")
        if "healthy" in st:
            say(f"  healthy after {i*5}s")
            healthy = True
            break
        if i % 6 == 0:
            say(f"  {i*5:>3}s  {st}")
        time.sleep(5)
    ck(healthy, "stratus healthy")

    section("3. Verify")
    hit = sh(f"docker exec {CT} sh -c "
             "\"grep -rl 'AS3935 Admin Panel' client/dist/assets 2>/dev/null "
             "| head -2 || echo none\"")
    ck("none" not in hit and hit.strip() != "",
       "new label in the built bundle", hit.strip().split("/")[-1])
    gone = sh(f"docker exec {CT} sh -c "
              "\"grep -rl 'Lightning Dashboard' client/dist/assets 2>/dev/null "
              "| head -2 || echo none\"")
    ck("none" in gone, "old label gone from the bundle", gone.strip())
    for u in ("https://stratusweather.co.za/", "https://stratusweather.co.za/api/health"):
        c2 = sh("curl -s -o /dev/null -w %{http_code} --max-time 25 " + u)
        ck(c2.strip() == "200", u.replace("https://", ""), c2.strip())
    n = sh("cd /opt/stratus && U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-) && "
           "docker run --rm -i postgres:17-alpine psql \"$U\" -t -A "
           "-c 'SELECT count(*) FROM stations' 2>&1")
    ck(n.strip() == "9", "still 9 stations", n.strip())

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say(f"\n  rollback  stratus-stratus:rollback-{STAMP}")
    say(f"  disk      {sh('df -h / | tail -1')}")

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_sidebar.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_sidebar.txt").write_text(
            "\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
