"""Show the END of the report-generation traceback: the frames in app code and
the exception itself, with the uvicorn/starlette plumbing filtered out."""
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
CT = "lightning-alert-panel"


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


logs = sh(f"docker logs --since 900s {CT} 2>&1")
lines = logs.splitlines()

out = []
out.append("=" * 76)
out.append("Frames inside /app (the code that actually matters)")
out.append("=" * 76)
for i, ln in enumerate(lines):
    if "/app/app/" in ln and "File " in ln:
        out.append("  " + ln.strip())
        # the source line that follows a File: line
        if i + 1 < len(lines) and not lines[i + 1].strip().startswith("File "):
            out.append("      " + lines[i + 1].strip())

out.append("")
out.append("=" * 76)
out.append("The exception (last 30 non-plumbing lines)")
out.append("=" * 76)
skip = ("site-packages", "uvicorn", "starlette", "fastapi", "contextlib",
        "INFO:", "^^^^")
tail = [l for l in lines if l.strip() and not any(s in l for s in skip)]
for l in tail[-30:]:
    out.append("  " + l.rstrip())

out.append("")
out.append("=" * 76)
out.append("Any Error/Exception lines verbatim")
out.append("=" * 76)
for l in lines:
    s = l.strip()
    if (s.endswith("Error") or "Error:" in s or "Exception:" in s
            or s.startswith(("ValueError", "TypeError", "AttributeError",
                             "KeyError", "OSError", "RuntimeError"))):
        if "site-packages" not in l:
            out.append("  " + s)

txt = "\n".join(out)
print(txt)
Path("backups").mkdir(exist_ok=True)
Path("backups/_report_error_tail.txt").write_text(txt, encoding="utf-8")
