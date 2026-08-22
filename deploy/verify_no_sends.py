"""Prove that no alert has been sent to any recipient, and list anything armed.

Read-only. This script sends nothing: it makes no POST to any ingest, test or
report endpoint. It only counts rows and reads configuration.

Writes backups/_nothing_sent.txt from Python itself, because the calling shell
on this machine has repeatedly swallowed stdout.
"""
from __future__ import annotations

import base64
import os
import sys
import time
from pathlib import Path

import paramiko
from scp import SCPClient

HOST = os.environ.get("DEPLOY_HOST", "139.84.242.126")
USER = os.environ.get("DEPLOY_USER", "root")
PW = os.environ.get("DEPLOY_PW", "")
if not PW:
    sys.exit("Set DEPLOY_PW")

PANEL_CT = "lightning-alert-panel"
STRATUS_CT = "stratus-app"
PG_CT = "stratus-postgres"

# ---------------------------------------------------------------- panel probe
PANEL_PY = r'''
import sys
sys.path.insert(0, "/app")
from app.db import SessionLocal
from app.models import Tenant, Recipient, AlertEvent, MessageLog
from app.runtime import get_alerts_enabled

db = SessionLocal()

print("=" * 72)
print("1. message_log: every SMS the panel has ever attempted")
print("=" * 72)
total = db.query(MessageLog).count()
print(f"  total rows: {total}")
if total == 0:
    print("  ZERO rows. The panel has never attempted to send a single SMS.")
    print("  Nothing has been queued, sent, skipped or failed.")
else:
    from sqlalchemy import func
    for status, n in (db.query(MessageLog.status, func.count(MessageLog.id))
                        .group_by(MessageLog.status).all()):
        print(f"    status={status!r:<12} {n}")
    print()
    print("  Rows with a status that means it left the building:")
    live = (db.query(MessageLog)
              .filter(MessageLog.status.in_(["sent", "queued", "delivered"]))
              .all())
    if not live:
        print("    none")
    for r in live[:40]:
        print(f"    id={r.id} to={r.to_number} status={r.status} "
              f"provider_id={r.provider_message_id}")

print()
print("=" * 72)
print("2. Alerts toggle per tenant")
print("=" * 72)
print("  When this is False, alert_worker._dispatch marks every message")
print("  'skipped' with error 'Alerts switched off' and calls no gateway.")
for t in db.query(Tenant).order_by(Tenant.id).all():
    print(f"    {t.slug:<10} alerts_enabled={get_alerts_enabled(db, tenant_id=t.id)}")

print()
print("=" * 72)
print("3. Recipient phone numbers that could receive an SMS")
print("=" * 72)
rs = db.query(Recipient).order_by(Recipient.tenant_id, Recipient.id).all()
if not rs:
    print("  no recipients at all")
for r in rs:
    t = db.query(Tenant).filter(Tenant.id == r.tenant_id).first()
    slug = t.slug if t else "?"
    ph = r.phone or ""
    placeholder = ph.startswith("+2700000")
    tag = "non-routable placeholder" if placeholder else "*** REAL-LOOKING ***"
    print(f"    {slug:<10} {r.name!r:<22} {ph:<16} {tag}")

print()
print("=" * 72)
print("4. Demo events claiming messages_sent vs actual message_log rows")
print("=" * 72)
evs = db.query(AlertEvent).order_by(AlertEvent.id).all()
claim = 0
for e in evs:
    ms = getattr(e, "messages_sent", None) or 0
    claim += ms
real = db.query(MessageLog).count()
print(f"  events: {len(evs)}")
print(f"  sum of messages_sent across all events: {claim}")
print(f"  actual message_log rows:                {real}")
if claim and not real:
    print("  The counter is display-only fabricated demo history. No message")
    print("  object exists, so no gateway call was ever made. The event detail")
    print("  page will show the count but list no messages.")
db.close()
'''


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
                out = o.read().decode(errors="replace")
                err = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                return (out or err).rstrip()
            finally:
                c.close()
        except Exception as exc:
            if attempt == 3:
                return f"[connection failed: {type(exc).__name__}: {exc}]"
            time.sleep(8)
    return ""


def push_and_run(local_text: str, remote_name: str, container: str) -> str:
    Path("backups").mkdir(exist_ok=True)
    tmp = Path("backups") / remote_name
    tmp.write_text(local_text, encoding="utf-8")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=300) as scp:
            scp.put(str(tmp), f"/tmp/{remote_name}")
    finally:
        c.close()
    sh(f"docker cp /tmp/{remote_name} {container}:/tmp/{remote_name} "
       f"&& rm -f /tmp/{remote_name}")
    out = sh(f"docker exec {container} python /tmp/{remote_name} 2>&1", timeout=900)
    sh(f"docker exec {container} rm -f /tmp/{remote_name}")
    tmp.unlink(missing_ok=True)
    return out


def psql(sql: str) -> str:
    """Run SQL against the Stratus Neon DB using the postgres container's client.

    The SQL is base64 encoded so no quoting survives the trip through bash.
    """
    b64 = base64.b64encode(sql.encode()).decode()
    url = sh(
        "docker exec " + STRATUS_CT + " printenv DATABASE_URL 2>/dev/null "
        "|| docker inspect " + STRATUS_CT +
        " --format '{{range .Config.Env}}{{println .}}{{end}}' "
        "| grep '^DATABASE_URL=' | head -1 | cut -d= -f2-").strip()
    if not url or not url.startswith("post"):
        return f"[could not read DATABASE_URL, got {url[:40]!r}]"
    enc = base64.b64encode(url.encode()).decode()
    return sh(
        "docker exec " + PG_CT + " sh -lc "
        "'U=$(echo " + enc + " | base64 -d); "
        "echo " + b64 + " | base64 -d | psql \"$U\" -X -A -F \"|\" 2>&1'",
        timeout=300)


SCHED_SQL = """
SELECT id, name, enabled, frequency,
       COALESCE(hour::text,'-') AS hour,
       COALESCE(timezone,'-') AS tz,
       COALESCE(array_length(station_ids,1),0) AS n_stations,
       array_to_string(recipients, ' ') AS to_list,
       COALESCE(next_run_at::text,'-') AS next_run
FROM report_schedules
ORDER BY enabled DESC, id;
"""


def main() -> None:
    lines: list[str] = []

    def say(m=""):
        print(m, flush=True)
        lines.append(m)

    say("#" * 72)
    say("# Did anything get sent to a recipient?")
    say("#" * 72)
    say("  Read-only audit. This script itself sends nothing.")
    say()
    say(f"  VPS clock (UTC): {sh('date -u')}")
    say()
    say(push_and_run(PANEL_PY, "_np.py", PANEL_CT))

    say()
    say("#" * 72)
    say("# Stratus emailed PDF reports (a separate send path from SMS)")
    say("#" * 72)
    say("  An enabled schedule emails a PDF to its recipients with no further")
    say("  confirmation. Listing them so nothing fires unnoticed.")
    say()
    out = psql(SCHED_SQL)
    say(out)
    say()
    say("  DEFAULT_DAILY_REPORT env (blank means the bootstrap is active):")
    say("    " + (sh("docker exec " + STRATUS_CT +
                     " printenv DEFAULT_DAILY_REPORT 2>&1 || true") or "(unset)"))

    Path("backups/_nothing_sent.txt").write_text("\n".join(lines) + "\n",
                                                 encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_nothing_sent.txt").write_text("SCRIPT FAILED\n\n" + tb,
                                                     encoding="utf-8")
        print(tb)
        raise
