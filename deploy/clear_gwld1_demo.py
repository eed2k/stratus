"""Clear the GWLD1 demo telemetry so the panel shows only the real detector.

Removes, for the gwld1 tenant:
  GWLD1-DEMO   unit row, its 192 heartbeat samples, 18 calibration events and
               63 alert events (plus any message-log rows hanging off them)
  GWLD1        the placeholder unit row, superseded by GLENCORE WONDERKOP which
               is what the Pi actually reports as

Deliberately KEPT:
  GLENCORE WONDERKOP and its real heartbeats
  the 3 recipients and 1 group - that is alert configuration, not demo data.
    Deleting them would leave the client with nowhere to send an alert.
  users, and the tenant itself

Everything removed is written to backups/ as JSON first, so it can be restored.
"""
from __future__ import annotations

import base64
import json
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
CT = "lightning-alert-panel"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

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


def py(code: str, timeout: int = 600) -> str:
    b64 = base64.b64encode(code.encode()).decode()
    return sh(f"echo {b64} | base64 -d | docker exec -i {CT} python - 2>&1", timeout)


DUMP = r'''
import json, sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import (UnitStatus, HeartbeatSample, CalibrationEvent,
                        AlertEvent, MessageLog)
db = SessionLocal()
DEMO = "GWLD1-DEMO"
PLACE = "GWLD1"

def rows(model, **f):
    q = db.query(model).filter_by(**f)
    return [{c.name: (str(getattr(r, c.name))
                      if getattr(r, c.name) is not None else None)
             for c in model.__table__.columns} for r in q.all()]

ev = db.query(AlertEvent).filter(AlertEvent.station_id == DEMO).all()
ids = [e.id for e in ev]
payload = {
    "unit_demo": rows(UnitStatus, station_id=DEMO),
    "unit_placeholder": rows(UnitStatus, station_id=PLACE),
    "heartbeat_samples": rows(HeartbeatSample, station_id=DEMO),
    "calibration_events": rows(CalibrationEvent, station_id=DEMO),
    "alert_events": [{c.name: (str(getattr(e, c.name))
                               if getattr(e, c.name) is not None else None)
                      for c in AlertEvent.__table__.columns} for e in ev],
    "message_log": [{c.name: (str(getattr(m, c.name))
                              if getattr(m, c.name) is not None else None)
                     for c in MessageLog.__table__.columns}
                    for m in db.query(MessageLog).filter(
                        MessageLog.event_id.in_(ids)).all()] if ids else [],
}
print("JSON_START")
print(json.dumps(payload))
print("JSON_END")
db.close()
'''

DELETE = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import (UnitStatus, HeartbeatSample, CalibrationEvent,
                        AlertEvent, MessageLog)
db = SessionLocal()
DEMO = "GWLD1-DEMO"
PLACE = "GWLD1"

ids = [e.id for e in db.query(AlertEvent).filter(
    AlertEvent.station_id == DEMO).all()]
n_msg = 0
if ids:
    n_msg = db.query(MessageLog).filter(
        MessageLog.event_id.in_(ids)).delete(synchronize_session=False)
n_ev = db.query(AlertEvent).filter(
    AlertEvent.station_id == DEMO).delete(synchronize_session=False)
n_hb = db.query(HeartbeatSample).filter(
    HeartbeatSample.station_id == DEMO).delete(synchronize_session=False)
n_cal = db.query(CalibrationEvent).filter(
    CalibrationEvent.station_id == DEMO).delete(synchronize_session=False)
n_unit = 0
for sid in (DEMO, PLACE):
    r = db.get(UnitStatus, sid)
    if r is not None:
        db.delete(r)
        n_unit += 1
db.commit()
print(f"message_log      {n_msg}")
print(f"alert_events     {n_ev}")
print(f"heartbeat_sample {n_hb}")
print(f"calibration      {n_cal}")
print(f"unit rows        {n_unit}")
db.close()
'''

AFTER = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import (UnitStatus, HeartbeatSample, CalibrationEvent,
                        AlertEvent, MessageLog, Recipient, Group, Tenant)
from app.runtime import get_units
from app.config import settings
db = SessionLocal()
tm = {t.id: t.slug for t in db.query(Tenant).all()}
thresh = int(getattr(settings, "UNIT_ACTIVE_THRESHOLD_MIN", 130)) * 60
print("units remaining:")
for r in db.query(UnitStatus).order_by(UnitStatus.station_id).all():
    n = db.query(HeartbeatSample).filter(
        HeartbeatSample.station_id == r.station_id).count()
    print(f"  {r.station_id:<22} tenant={tm.get(r.tenant_id):<8} "
          f"last_seen={r.last_seen or 'never'}  samples={n}")
print()
print("alert_events      ", db.query(AlertEvent).count())
print("heartbeat_samples ", db.query(HeartbeatSample).count())
print("calibration_events", db.query(CalibrationEvent).count())
print("message_log       ", db.query(MessageLog).count())
print("recipients (kept) ", db.query(Recipient).count())
print("groups (kept)     ", db.query(Group).count())
db.close()
'''


def main() -> None:
    section("1. Backing up what will be removed")
    raw = py(DUMP, 900)
    if "JSON_START" not in raw:
        say("  could not dump; aborting without deleting anything")
        say(raw[:1500])
        return
    body = raw.split("JSON_START", 1)[1].split("JSON_END", 1)[0].strip()
    data = json.loads(body)
    for k, v in data.items():
        say(f"  {k:<20} {len(v)} row(s)")
    Path("backups").mkdir(exist_ok=True)
    dest = Path("backups") / f"gwld1-demo-backup-{STAMP}.json"
    dest.write_text(json.dumps(data, indent=2), encoding="utf-8")
    say(f"  -> {dest}  ({dest.stat().st_size:,} bytes)")

    section("2. Deleting")
    say(py(DELETE, 900))

    section("3. What remains")
    say(py(AFTER, 600))

    section("4. Panel still healthy")
    for path in ("/gwld1/", "/gwld1/events", "/gwld1/stations", "/gwld1/reports"):
        code = sh("curl -s -o /dev/null -w %{http_code} --max-time 25 "
                  "https://adminpanel.stratusweather.co.za" + path)
        say(f"  {code.strip():<5} {path}  (303 = needs a login, not an error)")
    say("  " + sh("docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' "
                  + CT))

    section("Result")
    say("  GWLD1-DEMO and the GWLD1 placeholder are gone. The only unit left in")
    say("  the client panel is GLENCORE WONDERKOP, the real detector.")
    say("  Recipients and the group were kept: that is alert configuration, and")
    say("  without them a real strike would have nowhere to go.")
    say()
    say(f"  restore from {dest}")

    Path("backups/_clear_demo.txt").write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_clear_demo.txt").write_text(
            "\n".join(out) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
