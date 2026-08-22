"""Find which pydyf version actually works with weasyprint 62.3.

Run in throwaway containers off the production image, so the live panel is never
touched.

The test script is base64-encoded before it crosses the shell. An earlier
attempt embedded quotes and HTML directly, bash choked, echoed the failed
command back, and the echo contained the very success marker being grepped for -
producing a false PASS. Base64 has no shell metacharacters, and the marker below
cannot appear in an echoed command.
"""
from __future__ import annotations

import base64
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

IMG = "lightning-alert-panel:latest"
CANDIDATES = ["0.10.0", "0.11.0"]
MARKER = "RENDER-SUCCEEDED"

TEST_PY = f'''
import importlib.metadata as md
from weasyprint import HTML
html = "<h1>Report</h1><table><tr><td>a</td><td>b</td></tr></table>"
b = HTML(string=html).write_pdf()
assert b[:4] == b"%PDF", "not a PDF"
print("{MARKER}", len(b), "bytes, pydyf", md.version("pydyf"),
      "weasyprint", md.version("weasyprint"))
'''

out: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    out.append(m)


def sh(cmd, timeout=900):
    for attempt in (1, 2, 3):
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
            if attempt == 3:
                return f"[conn failed: {type(exc).__name__}]"
            time.sleep(8)
    return ""


B64 = base64.b64encode(TEST_PY.encode()).decode()


def try_version(v: str | None) -> tuple[bool, str]:
    """Render a PDF in a fresh container, optionally pinning pydyf first."""
    install = f"pip install -q pydyf=={v} && " if v else ""
    inner = f"echo {B64} | base64 -d > /tmp/t.py && {install}python /tmp/t.py"
    b64_inner = base64.b64encode(inner.encode()).decode()
    # Only base64 crosses the shell boundary, so nothing can be mis-quoted.
    cmd = (f"docker run --rm {IMG} sh -c "
           f"'echo {b64_inner} | base64 -d | sh' 2>&1 | tail -6")
    r = sh(cmd, 900)
    return (MARKER in r and "%PDF" not in r.split(MARKER)[0][-20:]), r


say("#" * 74)
say("# Which pydyf works with weasyprint 62.3?")
say("#" * 74)

say()
say("=" * 74)
say("as shipped (pydyf 0.12.1, unpinned)")
say("=" * 74)
ok, r = try_version(None)
say("  " + r.replace("\n", "\n  "))
say(f"  -> {'WORKS' if ok else 'BROKEN'}")

results: dict[str, bool] = {}
for v in CANDIDATES:
    say()
    say("=" * 74)
    say(f"pydyf=={v}")
    say("=" * 74)
    ok, r = try_version(v)
    say("  " + r.replace("\n", "\n  "))
    say(f"  -> {'WORKS' if ok else 'BROKEN'}")
    results[v] = ok

say()
say("=" * 74)
say("Verdict")
say("=" * 74)
for v, ok in results.items():
    say(f"  pydyf=={v:<10} {'WORKS' if ok else 'broken'}")
good = [v for v, ok in results.items() if ok]
say()
if good:
    say(f"  Pin pydyf=={good[0]} in requirements.txt "
        "(lowest version confirmed working).")
else:
    say("  None worked - weasyprint itself needs upgrading instead.")

Path("backups").mkdir(exist_ok=True)
Path("backups/_pydyf_pin.txt").write_text("\n".join(out), encoding="utf-8")
