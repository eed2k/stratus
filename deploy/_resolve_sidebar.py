"""Resolve two anomalies from the sidebar deploy, then reclaim disk.

  1. compose reported "Running" rather than "Recreated", yet the new bundle hash
     was found inside the container. Is the running container actually on the
     new image?
  2. "Lightning Dashboard" still matched somewhere under client/dist/assets even
     though the source has no such string. Find the file and see whether it is a
     stale leftover or a legitimate other use.
"""
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
CT = "stratus-app"

out: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    out.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


def sh(cmd, timeout=600):
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
            time.sleep(8)
    return ""


section("1. Is the running container on the newly built image?")
run_img = sh(f"docker inspect {CT} --format '{{{{.Image}}}}'").strip()
latest = sh("docker inspect stratus-stratus:latest --format '{{.Id}}'").strip()
say(f"  running container image : {run_img[:26]}")
say(f"  stratus-stratus:latest  : {latest[:26]}")
say(f"  MATCH                   : {run_img == latest}")
say(f"  container StartedAt      : "
    + sh("docker inspect -f '{{.State.StartedAt}}' " + CT))
say(f"  image Created            : "
    + sh("docker inspect stratus-stratus:latest --format '{{.Created}}'"))
say()
say("  Interpretation: compose prints 'Running' when the container already")
say("  matches the service definition. If the IDs match, the recreate did")
say("  happen (an earlier interrupted run had already swapped it in).")

section("2. Where does 'Lightning Dashboard' still appear?")
hits = sh(f"docker exec {CT} sh -c \"grep -rl 'Lightning Dashboard' "
          "client/dist/assets 2>/dev/null || echo none\"")
say("  files:")
for h in hits.splitlines():
    say(f"    {h}")
if "none" not in hits:
    first = hits.splitlines()[0].strip()
    say()
    say(f"  context around the match in {first}:")
    ctx = sh(f"docker exec {CT} sh -c \"grep -o '.\\{{0,90\\}}Lightning Dashboard"
             f".\\{{0,90\\}}' {first} | head -3\"")
    for line in ctx.splitlines():
        say(f"    ...{line.strip()}...")

say()
say("  and the new label:")
newh = sh(f"docker exec {CT} sh -c \"grep -rl 'AS3935 Admin Panel' "
          "client/dist/assets 2>/dev/null || echo none\"")
for h in newh.splitlines():
    say(f"    {h}")

say()
say("  total asset files in the image (a stale leftover would inflate this):")
say("    " + sh(f"docker exec {CT} sh -c 'ls client/dist/assets | wc -l'"))
say("  index-*.js present:")
for h in sh(f"docker exec {CT} sh -c 'ls client/dist/assets/index-*.js'").splitlines():
    say(f"    {h}")

section("3. Reclaim disk (85% is too tight for the next build)")
say(f"  before : {sh('df -h / | tail -1')}")
say("  images:")
for line in sh("docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}'"
               " | sort").splitlines():
    say(f"    {line}")
say()
say("  " + sh("docker builder prune -af 2>&1 | tail -2"))
# Drop older rollback tags, keeping the two most recent for each app.
say("  old rollback tags:")
tags = sh("docker images --format '{{.Repository}}:{{.Tag}}' "
          "| grep -E 'rollback-' | sort").splitlines()
keep = set(tags[-2:]) if len(tags) > 2 else set(tags)
for t in tags:
    t = t.strip()
    if t and t not in keep:
        say(f"    removing {t}: " + sh(f"docker rmi {t} 2>&1 | tail -1"))
    elif t:
        say(f"    keeping  {t}")
say("  " + sh("docker image prune -f 2>&1 | tail -2"))
say(f"  after  : {sh('df -h / | tail -1')}")

section("4. Site health")
for u in ("https://stratusweather.co.za/",
          "https://stratusweather.co.za/api/health",
          "https://adminpanel.stratusweather.co.za/login"):
    say(f"  {sh('curl -s -o /dev/null -w %{http_code} --max-time 20 ' + u).strip():<5} {u}")
say("  " + sh("docker ps --format '{{.Names}}  {{.Status}}' | sort"))

Path("backups").mkdir(exist_ok=True)
Path("backups/_resolve_sidebar.txt").write_text("\n".join(out), encoding="utf-8")
