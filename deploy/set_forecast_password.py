"""Change the forecast site's operator password.

Rewrites FORECAST_PASSWORD in /opt/stratus-forecast/.env and restarts the
container. FORECAST_SECRET is left alone deliberately, so existing sessions are
not invalidated by the change itself; pass --sign-out-everyone to rotate that
too, which forces every open browser to sign in again.

Usage
    python deploy/set_forecast_password.py "the new password"
    python deploy/set_forecast_password.py "the new password" --sign-out-everyone
    python deploy/set_forecast_password.py --generate

Needs DEPLOY_PW in the environment, like the other deploy scripts.
"""
from __future__ import annotations

import base64
import os
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

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

DIR = "/opt/stratus-forecast"
CT = "stratus-forecast"
SVC = "forecast"
BASE = "https://forecast.stratusweather.co.za"
CTX = ssl.create_default_context()

args = [a for a in sys.argv[1:]]
rotate_secret = "--sign-out-everyone" in args
args = [a for a in args if not a.startswith("--")]

if "--generate" in sys.argv[1:]:
    new_password = secrets.token_urlsafe(18)
    generated = True
elif args:
    new_password = args[0]
    generated = False
else:
    sys.exit(__doc__)

if len(new_password) < 12:
    sys.exit("Use at least 12 characters. This is the only thing standing in "
             "front of an upload endpoint on a public hostname.")


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd, timeout=600):
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
            time.sleep(6)
    return ""


def bash(script: str, timeout=600):
    return sh(f"echo {base64.b64encode(script.encode()).decode()} "
              f"| base64 -d | bash -s", timeout=timeout)


def post(path, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"User-Agent": "stratus-forecast-passwd"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


# The password is passed to the server base64 encoded so it does not appear in
# a process list or a shell history on the way through.
pw_b64 = base64.b64encode(new_password.encode()).decode()
secret_line = ""
if rotate_secret:
    secret_line = (f'printf "FORECAST_SECRET=%s\\n" '
                   f'"{secrets.token_hex(32)}" >> "$TMP"')

print("Rewriting .env", flush=True)
print(bash(f"""
set -e
cd {DIR}
umask 077
TMP=$(mktemp)
# Keep every setting except the two being replaced.
grep -v '^FORECAST_PASSWORD=' .env 2>/dev/null \
  | {"grep -v '^FORECAST_SECRET=' " if rotate_secret else "cat"} > "$TMP" || true
printf "FORECAST_PASSWORD=%s\\n" "$(echo {pw_b64} | base64 -d)" >> "$TMP"
{secret_line}
mv "$TMP" .env
chmod 600 .env
echo "  .env now has $(wc -l < .env) settings, mode $(stat -c %a .env)"
echo "  keys: $(cut -d= -f1 .env | tr '\\n' ' ')"
"""))

print("Restarting the container", flush=True)
print(sh(f"cd {DIR} && docker compose up -d --force-recreate {SVC} "
         f"2>&1 | tail -4"))

healthy = False
for _ in range(30):
    time.sleep(6)
    if sh(f"docker inspect -f '{{{{.State.Health.Status}}}}' {CT} "
          f"2>/dev/null").strip() == "healthy":
        healthy = True
        break
print(f"  healthy: {healthy}")

print("Checking the new password is live", flush=True)
ok_new = post("/login", {"password": new_password})
ok_old = post("/login", {"password": "9BbJjiaJO0BlIkBvthnxbI-0"})
print(f"  new password  HTTP {ok_new}  (200 means accepted)")
print(f"  old password  HTTP {ok_old}  (401 means correctly rejected)")

good = healthy and ok_new == 200 and ok_old == 401
print()
if generated:
    print("  " + "-" * 62)
    print(f"  NEW OPERATOR PASSWORD: {new_password}")
    print("  " + "-" * 62)
if rotate_secret:
    print("  Session secret rotated: every open browser must sign in again.")
print("  DONE" if good else "  CHECK THE OUTPUT ABOVE: something did not pass")
sys.exit(0 if good else 1)
