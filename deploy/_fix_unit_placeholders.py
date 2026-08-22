"""Make the two pre-assigned detector rows read honestly as 'never seen'.

UnitStatus.last_seen has default=now_sast and cpu_temp_c has default=0, so
inserting a placeholder row stamps it with the current time and 0.0 C. The
panel then shows the unit as ACTIVE with a 0 C CPU before the Pi has ever
connected, which is misleading in a client-facing panel.

The stations template renders '-' when last_seen is falsy, and get_units treats
a null last_seen as age=None -> is_active False, so clearing these columns is
both safe and accurate.
"""
from __future__ import annotations

import os
import sys
import time
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

CT = "lightning-alert-panel"

CODE = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import UnitStatus, Tenant, HeartbeatSample

db = SessionLocal()
tmap = {t.id: t.slug for t in db.query(Tenant).all()}

# Only rows that have never actually reported. GWLD1-DEMO has real seeded
# telemetry and is left completely alone.
for sid in ("GLENCORE WONDERKOP", "GWLD1"):
    row = db.get(UnitStatus, sid)
    if row is None:
        print(f"  {sid!r}: no such row")
        continue
    samples = db.query(HeartbeatSample).filter(
        HeartbeatSample.station_id == sid).count()
    if samples:
        print(f"  {sid!r}: has {samples} heartbeat sample(s) - real data, left alone")
        continue
    row.last_seen = None
    row.cpu_temp_c = None
    row.rssi_dbm = None
    row.last_kind = None
    db.commit()
    print(f"  {sid!r}: cleared to never-seen (tenant {tmap.get(row.tenant_id)})")

print()
print("Units now:")
print(f"  {'station_id':<24} {'tenant':<10} {'last_seen':<22} {'cpu':<7} samples")
print("  " + "-" * 74)
for r in db.query(UnitStatus).order_by(UnitStatus.station_id).all():
    n = db.query(HeartbeatSample).filter(
        HeartbeatSample.station_id == r.station_id).count()
    print(f"  {r.station_id:<24} {tmap.get(r.tenant_id, str(r.tenant_id)):<10} "
          f"{str(r.last_seen or '-'):<22} "
          f"{(f'{r.cpu_temp_c:.1f}' if r.cpu_temp_c is not None else '-'):<7} {n}")
db.close()
'''


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd: str, timeout: int = 600) -> str:
    for attempt in (1, 2, 3):
        try:
            c = fresh()
            try:
                _i, o, e = c.exec_command(cmd, timeout=timeout)
                out = o.read().decode(errors="replace")
                err = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                return (out or err).rstrip()
            finally:
                c.close()
        except Exception as exc:
            if attempt == 3:
                return f"[connection failed: {type(exc).__name__}]"
            time.sleep(8)
    return ""


def main() -> None:
    out: list[str] = []

    def say(m=""):
        print(m, flush=True)
        out.append(m)

    Path("backups").mkdir(exist_ok=True)
    tmp = Path("backups/_fixunits.py")
    tmp.write_text(CODE, encoding="utf-8")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=300) as scp:
            scp.put(str(tmp), "/tmp/_fixunits.py")
    finally:
        c.close()
    sh(f"docker cp /tmp/_fixunits.py {CT}:/tmp/_fixunits.py && rm -f /tmp/_fixunits.py")
    say(sh(f"docker exec {CT} python /tmp/_fixunits.py 2>&1", timeout=600))
    sh(f"docker exec {CT} rm -f /tmp/_fixunits.py")
    tmp.unlink(missing_ok=True)

    say()
    say("Stations page still renders:")
    say("  " + sh("curl -s -o /dev/null -w '%{http_code}' --max-time 25 "
                  "https://adminpanel.stratusweather.co.za/gwld1/stations"))
    say("  (303 expected without a session; a 500 would mean the null broke it)")

    Path("backups/_fix_units.txt").write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_fix_units.txt").write_text("SCRIPT FAILED\n\n" + tb,
                                                  encoding="utf-8")
        print(tb)
        raise
