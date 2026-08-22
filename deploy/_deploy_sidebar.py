"""Deploy the Stratus sidebar change: AS3935 Admin Panel, pinned to the top.

Only client/src/components/AppSidebar.tsx changed, but the client bundle is
built inside the image, so the image has to be rebuilt. Detached with a sentinel
because a Stratus build on this box takes a while and long SSH channels get
dropped.

Only the stratus service is recreated: Postgres and Traefik never restart.
"""
from __future__ import annotations

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

DIR, CF, SVC, CT = "/opt/stratus", "docker-compose.yml", "stratus", "stratus-app"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/stratus-nav.log", "/root/stratus-nav.done"
FILES = ["client/src/components/AppSidebar.tsx"]

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


def main() -> None:
    section("0. Pre-flight")
    for f in FILES:
        p = Path(f)
        if not p.is_file():
            raise SystemExit(f"missing: {p}")
        say(f"  {f}  {p.stat().st_size:,} B")
    cur = sh(f"docker inspect {CT} --format '{{{{.Config.Image}}}}'")
    say(f"  image  {cur}")
    say(f"  disk   {sh('df -h / | tail -1')}")
    say(f"  free   {sh('free -m | sed -n 2p')}")

    section("1. Reclaim space first (builds on this box are tight)")
    say("  " + sh("docker builder prune -af 2>&1 | tail -2"))
    say("  " + sh("docker image prune -f 2>&1 | tail -2"))
    say(f"  disk   {sh('df -h / | tail -1')}")

    section("2. Rollback tag")
    say("  " + sh(f"docker tag {cur} stratus-stratus:rollback-{STAMP} "
                  f"&& echo tagged rollback-{STAMP}"))

    section("3. Upload")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in FILES:
            tf.add(f, arcname=f)
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(buf.getvalue()), f"/tmp/nav-{STAMP}.tar.gz")
    finally:
        c.close()
    say("  " + sh(f"cd {DIR} && tar -xzf /tmp/nav-{STAMP}.tar.gz && "
                  f"rm -f /tmp/nav-{STAMP}.tar.gz && echo extracted"))
    n = sh(f"grep -c 'AS3935 Admin Panel' {DIR}/client/src/components/AppSidebar.tsx")
    say(f"  'AS3935 Admin Panel' occurrences on disk: {n.strip()}")
    old = sh(f"grep -c 'Lightning Dashboard' {DIR}/client/src/components/AppSidebar.tsx "
             "|| true")
    say(f"  'Lightning Dashboard' remaining: {old.strip().splitlines()[0] if old.strip() else '0'}")

    section("4. Build (detached)")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {DIR} && setsid nohup sh -c "
                  f"'docker compose -f {CF} build {SVC} > {LOG} 2>&1; "
                  f"echo $? > {DONE}' >/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code, last = None, -1
    for _ in range(180):                       # up to 60 min
        time.sleep(20)
        d = sh(f"cat {DONE} 2>/dev/null || true")
        try:
            size = int((sh(f"stat -c%s {LOG} 2>/dev/null || echo 0") or "0").strip())
        except ValueError:
            size = last
        if size != last:
            last = size
            t = sh(f"tail -2 {LOG} 2>/dev/null || true")
            mem = sh("free -m | awk '/Mem:/{print $7}'")
            say(f"    [poll] {size:>8} B  mem {mem.strip()} MB  "
                + " | ".join(x.strip() for x in t.splitlines() if x.strip())[-110:])
        if d.strip():
            code = int(d.strip()) if d.strip().isdigit() else -1
            break
    if code is None:
        say("  still building after 60 min; live site untouched. Check " + LOG)
        Path("backups/_sidebar.txt").write_text("\n".join(log), encoding="utf-8")
        return
    say(f"  build exit {code}")
    if code != 0:
        for line in sh(f"tail -30 {LOG}").splitlines():
            say(f"    {line}")
        say("  BUILD FAILED - nothing recreated, site still serving.")
        Path("backups/_sidebar.txt").write_text("\n".join(log), encoding="utf-8")
        return

    section("5. Recreate stratus only")
    say(sh(f"cd {DIR} && docker compose -f {CF} up -d --no-deps {SVC} 2>&1 | tail -6", 900))
    healthy = False
    for i in range(60):
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

    section("6. Verify")
    hit = sh(f"docker exec {CT} sh -c "
             "\"grep -rl 'AS3935 Admin Panel' client/dist/assets 2>/dev/null | head -2 "
             "|| echo none\"")
    ck("none" not in hit and hit.strip() != "",
       "new label is in the built bundle", hit.strip().split("/")[-1])
    gone = sh(f"docker exec {CT} sh -c "
              "\"grep -rl 'Lightning Dashboard' client/dist/assets 2>/dev/null | head -2 "
              "|| echo none\"")
    ck("none" in gone, "old label no longer in the bundle", gone.strip())
    for u, want in (("https://stratusweather.co.za/", "200"),
                    ("https://stratusweather.co.za/api/health", "200")):
        c2 = sh("curl -s -o /dev/null -w %{http_code} --max-time 25 " + u)
        ck(c2.strip() == want, u.replace("https://", ""), c2.strip())
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
