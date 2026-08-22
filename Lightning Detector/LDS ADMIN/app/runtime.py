"""Runtime operational settings stored in the DB (key/value Setting table).

The alert on/off switch, the repeat-alert cooldown and the last-sent marker are
per tenant: each client controls their own alerting without touching anyone
else's. Keys are namespaced "t<tenant_id>:<key>"; a read falls back to the old
un-namespaced key so a panel upgraded in place keeps its existing settings
until they are next saved.

Detector-unit liveness lives here too, so the web routes and the background
worker share one implementation.
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


def _key(base: str, tenant_id) -> str:
    return f"t{int(tenant_id)}:{base}" if tenant_id is not None else base


def _read(db: Session, base: str, tenant_id):
    """Tenant value if present, else the pre-multi-tenant global value."""
    if tenant_id is not None:
        row = db.get(Setting, _key(base, tenant_id))
        if row is not None:
            return row
    return db.get(Setting, base)


def _write(db: Session, base: str, tenant_id, value: str) -> None:
    key = _key(base, tenant_id)
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def get_alerts_enabled(db: Session, tenant_id=None) -> bool:
    """Return True unless the switch has explicitly been turned off."""
    row = _read(db, ALERTS_ENABLED_KEY, tenant_id)
    return (row.value if row else "1") != "0"


def set_alerts_enabled(db: Session, enabled: bool, tenant_id=None) -> None:
    _write(db, ALERTS_ENABLED_KEY, tenant_id, "1" if enabled else "0")


# --------------------------- Alert cooldown ----------------------------
def get_alert_cooldown_min(db: Session, tenant_id=None) -> int:
    """Minutes to suppress repeat SMS after one is sent (0 = no cooldown)."""
    row = _read(db, ALERT_COOLDOWN_KEY, tenant_id)
    if not row or not row.value:
        return 0
    try:
        return max(0, min(MAX_COOLDOWN_MIN, int(row.value)))
    except (TypeError, ValueError):
        return 0


def set_alert_cooldown_min(db: Session, minutes: int, tenant_id=None) -> None:
    minutes = max(0, min(MAX_COOLDOWN_MIN, int(minutes)))
    _write(db, ALERT_COOLDOWN_KEY, tenant_id, str(minutes))


def get_last_alert_sent(db: Session, tenant_id=None):
    """Return the datetime of the last dispatched SMS batch, or None."""
    row = _read(db, LAST_ALERT_SENT_KEY, tenant_id)
    if not row or not row.value:
        return None
    try:
        return datetime.fromisoformat(row.value)
    except ValueError:
        return None


def mark_alert_sent(db: Session, when: datetime = None, tenant_id=None) -> None:
    when = when or now_sast()
    _write(db, LAST_ALERT_SENT_KEY, tenant_id, when.isoformat())


# --------------------------- Unit liveness -----------------------------
def unit_tenant_id(db: Session, station_id: str):
    """Which client owns this detector, or None if it has not been assigned."""
    station_id = (station_id or "").strip()
    if not station_id:
        return None
    row = db.get(UnitStatus, station_id)
    return row.tenant_id if row else None


def touch_unit(db: Session, station_id: str, kind: str = "heartbeat",
               cpu_temp_c=None, rssi_dbm=None, tenant_id=None) -> None:
    """Record that a detector unit contacted the panel (heartbeat or strike).

    A unit reporting in for the first time is filed under `tenant_id` (the
    platform tenant, when the caller has no better information). It stays
    invisible to every client panel until an admin assigns it, which is the
    safe default: an unassigned detector must never surface in a client's view.
    """
    station_id = (station_id or "UNKNOWN").strip() or "UNKNOWN"
    row = db.get(UnitStatus, station_id)
    if row is None:
        row = UnitStatus(station_id=station_id, tenant_id=tenant_id)
        db.add(row)
    elif row.tenant_id is None and tenant_id is not None:
        row.tenant_id = tenant_id
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


def get_units(db: Session, active_threshold_s: int, tenant_id=None):
    """Return [(UnitStatus, is_active, age_seconds), ...] ordered by station.

    Scoped to one client when tenant_id is given.
    """
    q = db.query(UnitStatus)
    if tenant_id is not None:
        q = q.filter(UnitStatus.tenant_id == tenant_id)
    rows = q.order_by(UnitStatus.station_id).all()
    now = now_sast()
    out = []
    for r in rows:
        age = (now - r.last_seen).total_seconds() if r.last_seen else None
        is_active = age is not None and age <= active_threshold_s
        out.append((r, is_active, age))
    return out
