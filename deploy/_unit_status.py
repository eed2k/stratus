"""Confirm the detector's heartbeat landed in the gwld1 client panel. Read-only."""
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
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import UnitStatus, Tenant, HeartbeatSample, AlertEvent, MessageLog
from app.runtime import get_units
from app.config import settings

db = SessionLocal()
tm = {t.id: t.slug for t in db.query(Tenant).all()}
thresh = int(getattr(settings, "UNIT_ACTIVE_THRESHOLD_MIN", 130)) * 60
print(f"active threshold: {thresh} s")
print()
print(f"{'station_id':<22} {'tenant':<8} {'state':<9} {'age':<10} {'cpu':<7} samples")
print("-" * 74)
for gw in [t for t in db.query(Tenant).all() if t.slug == "gwld1"]:
    for r, active, age in get_units(db, thresh, tenant_id=gw.id):
        n = db.query(HeartbeatSample).filter(
            HeartbeatSample.station_id == r.station_id).count()
        agestr = f"{age/60:.1f} min" if age is not None else "never"
        cpu = f"{r.cpu_temp_c:.1f}C" if r.cpu_temp_c is not None else "-"
        print(f"{r.station_id:<22} {tm.get(r.tenant_id):<8} "
              f"{'ACTIVE' if active else 'INACTIVE':<9} {agestr:<10} {cpu:<7} {n}")
print()
print("latest heartbeat samples for the real unit:")
rows = (db.query(HeartbeatSample)
          .filter(HeartbeatSample.station_id == "GLENCORE WONDERKOP")
          .order_by(HeartbeatSample.ts.desc()).limit(5).all())
if not rows:
    print("  none yet")
for s in rows:
    print(f"  {s.ts}  cpu={s.cpu_temp_c}C  load={s.cpu_load_pct}")
print()
print("alert events:", db.query(AlertEvent).count(),
      " message_log:", db.query(MessageLog).count())
db.close()
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
out = sh(f"echo {b64} | base64 -d | docker exec -i {CT} python - 2>&1", 300)
print(out)
Path("backups").mkdir(exist_ok=True)
Path("backups/_unit_status.txt").write_text(out, encoding="utf-8")
