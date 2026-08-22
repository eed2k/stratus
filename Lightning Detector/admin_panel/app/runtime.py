"""Runtime operational settings stored in the DB (key/value Setting table).

Currently the global alert on/off switch plus detector-unit liveness. Kept
separate so both the web routes and the background worker can share the
same logic.
"""
from datetime import datetime

from sqlalchemy.orm import Session

from .models import Setting, UnitStatus
from .timeutil import now_sast

ALERTS_ENABLED_KEY = "alerts_enabled"
ALERT_COOLDOWN_KEY = "alert_cooldown_min"
LAST_ALERT_SENT_KEY = "last_alert_sent_at"

# Hard ceiling so a typo can't silence alerts for days.
MAX_COOLDOWN_MIN = 1440


def get_alerts_enabled(db: Session) -> bool:
    """Return True unless the switch has explicitly been turned off."""
    row = db.get(Setting, ALERTS_ENABLED_KEY)
    return (row.value if row else "1") != "0"


def set_alerts_enabled(db: Session, enabled: bool) -> None:
    row = db.get(Setting, ALERTS_ENABLED_KEY)
    if row is None:
        db.add(Setting(key=ALERTS_ENABLED_KEY, value="1" if enabled else "0"))
    else:
        row.value = "1" if enabled else "0"
    db.commit()


# --------------------------- Alert cooldown ----------------------------
def get_alert_cooldown_min(db: Session) -> int:
    """Minutes to suppress repeat SMS after one is sent (0 = no cooldown)."""
    row = db.get(Setting, ALERT_COOLDOWN_KEY)
    if not row or not row.value:
        return 0
    try:
        return max(0, min(MAX_COOLDOWN_MIN, int(row.value)))
    except (TypeError, ValueError):
        return 0


def set_alert_cooldown_min(db: Session, minutes: int) -> None:
    minutes = max(0, min(MAX_COOLDOWN_MIN, int(minutes)))
    row = db.get(Setting, ALERT_COOLDOWN_KEY)
    if row is None:
        db.add(Setting(key=ALERT_COOLDOWN_KEY, value=str(minutes)))
    else:
        row.value = str(minutes)
    db.commit()


def get_last_alert_sent(db: Session):
    """Return the datetime of the last dispatched SMS batch, or None."""
    row = db.get(Setting, LAST_ALERT_SENT_KEY)
    if not row or not row.value:
        return None
    try:
        return datetime.fromisoformat(row.value)
    except ValueError:
        return None


def mark_alert_sent(db: Session, when: datetime = None) -> None:
    when = when or now_sast()
    row = db.get(Setting, LAST_ALERT_SENT_KEY)
    if row is None:
        db.add(Setting(key=LAST_ALERT_SENT_KEY, value=when.isoformat()))
    else:
        row.value = when.isoformat()
    db.commit()


# --------------------------- Unit liveness -----------------------------
def touch_unit(db: Session, station_id: str, kind: str = "heartbeat",
               cpu_temp_c=None, rssi_dbm=None) -> None:
    """Record that a detector unit contacted the panel (heartbeat or strike)."""
    station_id = (station_id or "UNKNOWN").strip() or "UNKNOWN"
    row = db.get(UnitStatus, station_id)
    if row is None:
        row = UnitStatus(station_id=station_id)
        db.add(row)
    row.last_seen = now_sast()
    row.last_kind = kind
    if cpu_temp_c is not None:
        try:
            row.cpu_temp_c = float(cpu_temp_c)
        except (TypeError, ValueError):
            pass
    if rssi_dbm is not None:
        try:
            row.rssi_dbm = int(rssi_dbm)
        except (TypeError, ValueError):
            pass
    db.commit()


def get_units(db: Session, active_threshold_s: int):
    """Return [(UnitStatus, is_active, age_seconds), ...] ordered by station."""
    rows = db.query(UnitStatus).order_by(UnitStatus.station_id).all()
    now = now_sast()
    out = []
    for r in rows:
        age = (now - r.last_seen).total_seconds() if r.last_seen else None
        is_active = age is not None and age <= active_threshold_s
        out.append((r, is_active, age))
    return out
