"""Deploy the demo timelapse to lightningdemo.stratusweather.co.za.

WHAT IT CREATES
  /opt/lightning-demo/            its own compose project
    docker-compose.yml            nginx:alpine + Traefik labels
    nginx.conf                    security headers, caching, /healthz
    site/index.html
    site/demo.css
    site/demo.js
    site/style.css                copied from LDS ADMIN/app/static/style.css

ISOLATION
  A separate compose project, joining the existing Traefik network as external.
  No existing compose file, container or label is modified, so neither live site
  is affected. Static content only: no database, no secrets, no route to the
  panel, read-only root filesystem, 64 MB memory cap.

TLS
  Traefik requests a Let's Encrypt certificate over the HTTP-01 challenge on
  first request. DNS for the subdomain already resolves to this host.

NOTHING here sends an SMS or an email, and nothing touches the panel or Stratus.
"""
from __future__ import annotations

import base64
import io
import os
import shutil
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

DIR = "/opt/lightning-demo"
CT = "lightning-demo"
SVC = "demo"
FQDN = "lightningdemo.stratusweather.co.za"
NET = "stratus_stratus-network"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
OUT = Path("backups/_deploy_demo_site.txt")

LOCAL = Path("lightning-demo")
PANEL_CSS = Path("LDS ADMIN/app/static/style.css")

log: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)
    try:
        OUT.write_text("\n".join(log), encoding="utf-8")
    except Exception:
        pass


def section(t: str) -> None:
    say()
    say("=" * 76)
    say(t)
    say("=" * 76)


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


def bash(script: str, timeout=900):
    return sh(f"echo {base64.b64encode(script.encode()).decode()} "
              f"| base64 -d | bash -s", timeout=timeout)


def main() -> None:
    section("0. Pre-flight")
    if not PANEL_CSS.is_file():
        raise SystemExit(f"missing {PANEL_CSS}")
    # The demo's look comes from the console's stylesheet. Copying it here keeps
    # one source of truth rather than a hand-maintained duplicate.
    shutil.copyfile(PANEL_CSS, LOCAL / "site" / "style.css")
    say(f"  copied {PANEL_CSS.name} -> site/style.css "
        f"({PANEL_CSS.stat().st_size:,} B)")

    files = ["docker-compose.yml", "nginx.conf",
             "site/index.html", "site/demo.css", "site/demo.js", "site/style.css"]
    for f in files:
        p = LOCAL / f
        if not p.is_file():
            raise SystemExit(f"missing {p}")
        say(f"  {f:<24} {p.stat().st_size:>8,} B")

    pre = bash(f"""
echo "--- DNS as this host sees it ---"
getent hosts {FQDN} || echo "  (no A record visible from the server)"
echo "--- traefik network must already exist ---"
docker network ls --format '{{{{.Name}}}}' | grep -x '{NET}' || echo "  MISSING {NET}"
echo "--- nothing else must own that hostname ---"
# Our own container is expected to hold the route on a re-deploy. Only a
# *different* container having taken the hostname is a problem.
for c in $(docker ps --format '{{{{.Names}}}}' | grep -v '^{CT}$'); do
  docker inspect $c --format '{{{{json .Config.Labels}}}}' \
    | grep -q '{FQDN}' && echo "  ALREADY ROUTED BY: $c"
done
echo "--- live sites before the change ---"
for u in https://stratusweather.co.za/ https://adminpanel.stratusweather.co.za/login; do
  printf "  %-50s HTTP %s\\n" "$u" "$(curl -s -o /dev/null -w '%{{http_code}}' --max-time 20 $u)"
done
echo "--- disk ---"
df -h / | tail -1
""")
    say(pre)
    ck(NET in pre and "MISSING" not in pre, "Traefik network present")
    ck("ALREADY ROUTED BY" not in pre,
       "hostname not claimed by another container")
    ck(pre.count("HTTP 200") >= 2, "both live sites healthy before the change")

    section("1. Upload")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in files:
            tf.add(LOCAL / f, arcname=f)
    payload = buf.getvalue()
    say(f"  tarball {len(payload):,} B")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(payload), f"/tmp/demo-{STAMP}.tar.gz")
    finally:
        c.close()

    say(bash(f"""
mkdir -p {DIR}/site
cd {DIR}
tar -xzf /tmp/demo-{STAMP}.tar.gz && echo "extract ok"
rm -f /tmp/demo-{STAMP}.tar.gz
echo "--- contents ---"
find {DIR} -type f | sort | sed 's|^|  |'
echo "--- compose validity ---"
docker compose -f docker-compose.yml config >/dev/null 2>&1 \
  && echo "COMPOSE_VALID" || docker compose -f docker-compose.yml config
"""))

    section("2. Start the container")
    say(sh(f"cd {DIR} && docker compose up -d 2>&1 | tail -8", 600))
    up = False
    for i in range(36):
        st = sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                f"{CT} 2>/dev/null")
        if "healthy" in st or "running/" in st:
            say(f"  {st.strip()} after {i*5}s")
            up = True
            if "healthy" in st:
                break
        time.sleep(5)
    ck(up, "demo container running")

    section("3. Traefik picked up the route, and TLS was issued")
    # The first HTTPS request triggers the HTTP-01 challenge, so this may take a
    # few attempts while the certificate is obtained.
    code = ""
    for attempt in range(12):
        code = sh("curl -s -o /dev/null -w '%{http_code}' --max-time 25 "
                  f"https://{FQDN}/").strip()
        if code == "200":
            break
        say(f"    attempt {attempt + 1}: HTTP {code} (waiting for the certificate)")
        time.sleep(15)
    ck(code == "200", f"https://{FQDN}/ serves", f"HTTP {code}")

    detail = bash(f"""
echo "--- certificate ---"
echo | openssl s_client -connect {FQDN}:443 -servername {FQDN} 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates 2>/dev/null \
  || echo "  could not read the certificate"
echo "--- http must redirect to https ---"
curl -s -o /dev/null -w '  http -> %{{http_code}} %{{redirect_url}}\\n' --max-time 20 http://{FQDN}/
echo "--- assets ---"
for p in / /demo.js /demo.css /style.css /robots.txt /healthz; do
  printf "  %-14s HTTP %s\\n" "$p" "$(curl -s -o /dev/null -w '%{{http_code}}' --max-time 20 https://{FQDN}$p)"
done
echo "--- security headers ---"
curl -s -D - -o /dev/null --max-time 20 https://{FQDN}/ \
  | grep -Ei 'content-security-policy|x-frame-options|x-robots-tag|x-content-type' \
  | sed 's|^|  |'
""")
    say(detail)
    ck("Let's Encrypt" in detail or "R1" in detail or "E1" in detail
       or "issuer" in detail.lower(), "certificate present")
    ck("content-security-policy" in detail.lower(), "CSP header served")
    ck("x-robots-tag" in detail.lower(), "noindex header served")

    section("4. The page is complete and self-contained")
    page = sh(f"curl -s --max-time 25 https://{FQDN}/")
    for needle, label in (
            ("Lightning Alert Console", "console chrome present"),
            ("Demonstration.", "demo disclaimer present"),
            ("storm-bands", "storm band host present"),
            ("does not measure bearing", "bearing caveat present"),
            ("not joules", "energy caveat present"),
            ('id="simclock"', "simulated clock present"),
            ("demo.js", "timelapse script referenced")):
        ck(needle in page, label)

    js = sh(f"curl -s --max-time 25 https://{FQDN}/demo.js")
    ck("CB_BODY" in js, "cloud path present in the served script")
    ck("fetch(" not in js, "no fetch in the served script")
    ck("adminpanel" not in js and "api/v1" not in js,
       "no reference to the live panel")

    section("5. The live sites are untouched")
    after = bash(f"""
for u in https://stratusweather.co.za/ https://adminpanel.stratusweather.co.za/login; do
  printf "  %-50s HTTP %s\\n" "$u" "$(curl -s -o /dev/null -w '%{{http_code}}' --max-time 20 $u)"
done
echo "--- containers ---"
docker ps --format '  {{{{.Names}}}}  {{{{.Status}}}}' | grep -Ei 'stratus|lightning'
echo "--- demo memory use ---"
docker stats --no-stream --format '  {{{{.Name}}}}  {{{{.MemUsage}}}}  {{{{.CPUPerc}}}}' {CT}
echo "--- disk ---"
df -h / | tail -1
""")
    say(after)
    ck(after.count("HTTP 200") >= 2, "both live sites still healthy")

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks)-len(bad)} of {len(checks)} checks passed")
    for _, l in bad:
        say(f"    FAIL  {l}")
    say(f"\n  URL       https://{FQDN}/")
    say(f"  Location  {DIR}")
    say(f"  Remove    cd {DIR} && docker compose down")


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
