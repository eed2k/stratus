"""Make the Pi's heartbeat land in the gwld1 panel, and prove the path works.

Two parts:

1. Pre-assign the detector's real identity. UnitStatus.station_id is the primary
   key, and the ingest handler files any UNKNOWN unit under the platform tenant
   so an unassigned detector can never surface in a client's panel. The Pi posts
   station_id "GLENCORE WONDERKOP" but only "GWLD1" was pre-assigned, so its
   heartbeat would land in the platform panel instead of gwld1. Pre-assigning
   the real id to the gwld1 tenant fixes that without changing the Pi's identity
   (which is also used in its local logs and Campbell records).

2. Self-test the live endpoint with the real token under a throwaway station id,
   confirm it was recorded, then remove the throwaway row. Proves the URL, TLS,
   token and handler all work before the Pi is touched.

A heartbeat is pure telemetry: ingest_heartbeat calls touch_unit and stores a
HeartbeatSample. It never calls dispatch_async, so no alert and no SMS. The
script re-checks message_log at the end to demonstrate that.
"""
from __future__ import annotations

import json
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
REAL_ID = "GLENCORE WONDERKOP"
SELFTEST_ID = "GWLD1-SELFTEST"
URL = "https://adminpanel.stratusweather.co.za/gwld1/api/v1/heartbeat"

log: list[str] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 74)
    say(t)
    say("=" * 74)


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


def run_in_ct(code: str, name: str) -> str:
    Path("backups").mkdir(exist_ok=True)
    tmp = Path("backups") / name
    tmp.write_text(code, encoding="utf-8")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=300) as scp:
            scp.put(str(tmp), f"/tmp/{name}")
    finally:
        c.close()
    sh(f"docker cp /tmp/{name} {CT}:/tmp/{name} && rm -f /tmp/{name}")
    out = sh(f"docker exec {CT} python /tmp/{name} 2>&1", timeout=600)
    sh(f"docker exec {CT} rm -f /tmp/{name}")
    tmp.unlink(missing_ok=True)
    return out


LIST_UNITS = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import UnitStatus, Tenant, HeartbeatSample
db = SessionLocal()
tmap = {t.id: t.slug for t in db.query(Tenant).all()}
print(f"{'station_id':<24} {'tenant':<10} {'last_seen':<22} {'cpu':<7} samples")
print("-" * 78)
for r in db.query(UnitStatus).order_by(UnitStatus.station_id).all():
    n = db.query(HeartbeatSample).filter(
        HeartbeatSample.station_id == r.station_id).count()
    print(f"{r.station_id:<24} {tmap.get(r.tenant_id, str(r.tenant_id)):<10} "
          f"{str(r.last_seen or 'never'):<22} "
          f"{(f'{r.cpu_temp_c:.1f}' if r.cpu_temp_c is not None else '-'):<7} {n}")
db.close()
'''

PREASSIGN = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import UnitStatus, Tenant
db = SessionLocal()
gw = db.query(Tenant).filter(Tenant.slug == "gwld1").first()
if not gw:
    print("ERROR: gwld1 tenant not found")
    raise SystemExit(1)
SID = "GLENCORE WONDERKOP"
row = db.get(UnitStatus, SID)
if row is None:
    # last_seen left NULL on purpose: the unit reads as INACTIVE / never seen
    # until the real Pi checks in. No fabricated telemetry.
    db.add(UnitStatus(station_id=SID, tenant_id=gw.id))
    db.commit()
    print(f"pre-assigned {SID!r} -> tenant gwld1 (id {gw.id}), last_seen NULL")
elif row.tenant_id != gw.id:
    old = row.tenant_id
    row.tenant_id = gw.id
    db.commit()
    print(f"re-assigned {SID!r} from tenant {old} -> gwld1 (id {gw.id})")
else:
    print(f"{SID!r} already assigned to gwld1; nothing to change")
db.close()
'''

CLEANUP = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import UnitStatus, HeartbeatSample
db = SessionLocal()
SID = "GWLD1-SELFTEST"
n = db.query(HeartbeatSample).filter(HeartbeatSample.station_id == SID).delete(
    synchronize_session=False)
row = db.get(UnitStatus, SID)
if row:
    db.delete(row)
db.commit()
print(f"removed self-test unit {SID!r} and {n} sample row(s)")
print("remaining units:",
      ", ".join(r.station_id for r in db.query(UnitStatus)
                .order_by(UnitStatus.station_id).all()))
db.close()
'''


def main() -> None:
    section("1. Units in the panel right now")
    say(run_in_ct(LIST_UNITS, "_units.py"))

    section("2. Pre-assigning the detector's real station_id to gwld1")
    say("  The Pi identifies itself as 'GLENCORE WONDERKOP' in its logs and")
    say("  Campbell records. Rather than change that identity, the panel is")
    say("  told which client it belongs to.")
    say()
    say("  " + run_in_ct(PREASSIGN, "_preassign.py"))

    section("3. Self-testing the live endpoint with the real token")
    token = sh("grep -E '^ALERT_WEBHOOK_TOKEN=' /opt/lightning-panel/.env "
               "| cut -d= -f2-").strip()
    say(f"  token read from the panel .env: {len(token)} chars"
        f" ({'set' if token else 'MISSING'})")
    if not token:
        say("  cannot self-test without the token")
        return

    body = json.dumps({
        "station_id": SELFTEST_ID,
        "timestamp": "2026-08-21T22:00:00+02:00",
        "cpu_temp_c": 44.5,
        "uptime_s": 123.0,
        "noise_floor": 5,
        "strikes_today": 0,
        "cpu_load_pct": 7.5,
    })
    b64 = __import__("base64").b64encode(body.encode()).decode()

    say()
    say("  a) correct token -> expect 200 {\"status\":\"ok\"}")
    out = sh("B=$(echo " + b64 + " | base64 -d); "
             "curl -s -w '\\nHTTP %{http_code}\\n' --max-time 25 "
             f"-X POST '{URL}' "
             "-H 'Content-Type: application/json' "
             f"-H 'X-Auth-Token: {token}' "
             "--data \"$B\"")
    for line in out.splitlines():
        say(f"     {line}")
    ok_good = "HTTP 200" in out

    say()
    say("  b) wrong token -> expect 401, proving auth is enforced")
    out2 = sh("B=$(echo " + b64 + " | base64 -d); "
              "curl -s -w '\\nHTTP %{http_code}\\n' --max-time 25 "
              f"-X POST '{URL}' "
              "-H 'Content-Type: application/json' "
              "-H 'X-Auth-Token: deliberately-wrong' "
              "--data \"$B\"")
    for line in out2.splitlines():
        say(f"     {line}")
    ok_401 = "HTTP 401" in out2

    section("4. Did it get recorded?")
    say(run_in_ct(LIST_UNITS, "_units2.py"))

    section("5. Removing the self-test row")
    say("  " + run_in_ct(CLEANUP, "_cleanup.py"))

    section("6. No alert was raised by the heartbeat")
    ml = sh(f"docker exec {CT} python -c "
            "\"import sys; sys.path.insert(0,'/app'); "
            "from app.db import SessionLocal; from app.models import MessageLog; "
            "d=SessionLocal(); print(d.query(MessageLog).count()); d.close()\"")
    say(f"  message_log rows: {ml}  (0 = nothing sent, as expected)")

    section("Result")
    say(f"  heartbeat accepted with the real token : {ok_good}")
    say(f"  rejected with a wrong token (401)      : {ok_401}")
    if ok_good and ok_401:
        say()
        say("  The endpoint, TLS, token and handler all work. Once the Pi runs,")
        say("  its heartbeat will appear under Stations in the gwld1 panel.")

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_heartbeat_check.txt").write_text("\n".join(log),
                                                    encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_heartbeat_check.txt").write_text(
            "\n".join(log) + "\n\nSCRIPT FAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
