"""Identify the pydyf/WeasyPrint version mismatch behind the report 500."""
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
CT = "lightning-alert-panel"

CODE = r'''
import importlib.metadata as md
for p in ("weasyprint", "pydyf", "tinycss2", "cssselect2", "pillow",
          "fonttools", "tinyhtml5", "html5lib"):
    try:
        print(f"{p:<12} {md.version(p)}")
    except Exception:
        print(f"{p:<12} not installed")

print()
print("WeasyPrint's declared requirement on pydyf:")
try:
    for r in (md.requires("weasyprint") or []):
        if "pydyf" in r:
            print("   ", r)
except Exception as e:
    print("   ", e)

print()
print("Does pydyf.Stream expose transform?")
try:
    import pydyf
    s = pydyf.Stream()
    print("    pydyf.Stream.transform present:", hasattr(s, "transform"))
    print("    Stream MRO:", [c.__name__ for c in type(s).__mro__])
    import inspect
    print("    methods:", sorted(m for m in dir(s) if not m.startswith("_"))[:25])
except Exception as e:
    print("    error:", type(e).__name__, e)

print()
print("Minimal render attempt:")
try:
    from weasyprint import HTML
    b = HTML(string="<p>hello</p>").write_pdf()
    print("    OK, produced", len(b), "bytes")
except Exception as e:
    print("    FAILED:", type(e).__name__, e)
'''


def sh(cmd, timeout=600):
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


b64 = base64.b64encode(CODE.encode()).decode()
txt = sh(f"echo {b64} | base64 -d | docker exec -i {CT} python - 2>&1", 300)
print(txt)
Path("backups").mkdir(exist_ok=True)
Path("backups/_pydyf.txt").write_text(txt, encoding="utf-8")
