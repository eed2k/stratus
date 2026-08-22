"""Remove the GWLD1-SELFTEST unit created while validating the heartbeat path."""
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
from app.models import UnitStatus, HeartbeatSample, Tenant
db = SessionLocal()
SID = "GWLD1-SELFTEST"
n = db.query(HeartbeatSample).filter(
    HeartbeatSample.station_id == SID).delete(synchronize_session=False)
row = db.get(UnitStatus, SID)
if row:
    db.delete(row)
db.commit()
print(f"removed {SID!r} and {n} sample row(s)")
print()
tmap = {t.id: t.slug for t in db.query(Tenant).all()}
print(f"  {'station_id':<24} {'tenant':<10} {'last_seen':<28} {'cpu':<6} samples")
print("  " + "-" * 78)
for r in db.query(UnitStatus).order_by(UnitStatus.station_id).all():
    c = db.query(HeartbeatSample).filter(
        HeartbeatSample.station_id == r.station_id).count()
    print(f"  {r.station_id:<24} {tmap.get(r.tenant_id, str(r.tenant_id)):<10} "
          f"{str(r.last_seen or '-'):<28} "
          f"{(f'{r.cpu_temp_c:.1f}' if r.cpu_temp_c is not None else '-'):<6} {c}")
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
    tmp = Path("backups/_cl.py")
    tmp.write_text(CODE, encoding="utf-8")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=300) as scp:
            scp.put(str(tmp), "/tmp/_cl.py")
    finally:
        c.close()
    sh(f"docker cp /tmp/_cl.py {CT}:/tmp/_cl.py && rm -f /tmp/_cl.py")
    say(sh(f"docker exec {CT} python /tmp/_cl.py 2>&1", timeout=600))
    sh(f"docker exec {CT} rm -f /tmp/_cl.py")
    tmp.unlink(missing_ok=True)

    say()
    say("message_log rows: " + sh(
        f"docker exec {CT} python -c "
        "\"import sys; sys.path.insert(0,'/app'); "
        "from app.db import SessionLocal; from app.models import MessageLog; "
        "d=SessionLocal(); print(d.query(MessageLog).count()); d.close()\""))

    Path("backups/_cleanup_selftest.txt").write_text("\n".join(out),
                                                     encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_cleanup_selftest.txt").write_text(
            "SCRIPT FAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
