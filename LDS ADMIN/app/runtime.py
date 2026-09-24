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

# Test mode never lasts longer than this, whatever is asked for. While a station
# is in test mode no SMS is sent for its events, including a real strike, so the
# window has to be short enough that it cannot be forgotten about across a shift
# change. The detector applies the same ceiling to what the panel tells it, so
# neither side alone can extend it.
MAX_TEST_MODE_MIN = 60


def _key(base: str, tenant_id) -> str:
    return f"t{int(tenant_id)}:{base}" if tenant_id is not None else base


def _read(db: Session, base: str, tenant_id):
    """This tenant's value, or None.

    Deliberately NO fallback to the bare un-prefixed key.

    That fallback used to exist to carry pre-multi-tenant values forward, and it
    silently shared one client's settings with every client that had not yet
    written its own. The consequences were not cosmetic: last_alert_sent_at is
    the cooldown clock, so one client's alert could suppress another client's
    first alert, and alerts_enabled meant switching alerts off in one panel could
    reach into a panel that had never been configured.

    A tenant with no row of its own now gets the documented default from the
    caller instead of inheriting a neighbour's value. The bare keys are migrated
    onto the platform tenant at boot (see bootstrap.migrate_global_settings) and
    are inert after that.
    """
    if tenant_id is not None:
        return db.get(Setting, _key(base, tenant_id))
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


def get_last_alert_sent(db: Session, tenant_id=None, stage_id=None):
    """Datetime of the last dispatched batch, or None.

    `stage_id` scopes the marker to one escalation stage. Without it the cooldown
    is shared across every distance band, so one distant strike claims the slot
    and the near strike that follows is suppressed as a repeat - which is exactly
    backward for a safety system. Each stage therefore keeps its own marker.
    """
    row = _read(db, _stage_key(LAST_ALERT_SENT_KEY, stage_id), tenant_id)
    if not row or not row.value:
        return None
    try:
        return datetime.fromisoformat(row.value)
    except ValueError:
        return None


def mark_alert_sent(db: Session, when: datetime = None, tenant_id=None,
                    stage_id=None) -> None:
    when = when or now_sast()
    _write(db, _stage_key(LAST_ALERT_SENT_KEY, stage_id), tenant_id,
           when.isoformat())


def _stage_key(base: str, stage_id) -> str:
    """Namespace a key to one stage, leaving the un-staged key untouched.

    A tenant that has defined no stages keeps using the original key, so its
    existing cooldown state carries across this change rather than resetting.
    """
    return base if stage_id is None else f"s{int(stage_id)}:{base}"


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


# --------------------------- Detector test mode ---------------------------
# Stored as an expiry on the station's own UnitStatus row rather than in the
# Setting table. Setting.key is VARCHAR(64) and would have to carry the tenant,
# the key name and the station id, which a long station id overflows; and test
# mode is a property of one detector, so it belongs on the detector's row.

def set_test_mode(db: Session, station_id: str, minutes: int):
    """Put one detector into test mode for `minutes`, or 0 to end it now.

    Returns the expiry that was stored, or None when test mode was switched off.
    Raises LookupError for an unknown station, so a caller cannot believe it has
    armed a detector that does not exist.
    """
    station_id = (station_id or "").strip()
    row = db.get(UnitStatus, station_id) if station_id else None
    if row is None:
        raise LookupError(station_id)
    try:
        minutes = int(minutes)
    except (TypeError, ValueError):
        minutes = 0
    minutes = max(0, min(MAX_TEST_MODE_MIN, minutes))
    if minutes == 0:
        row.test_mode_until = None
    else:
        from datetime import timedelta
        row.test_mode_until = now_sast() + timedelta(minutes=minutes)
    db.commit()
    return row.test_mode_until


def test_mode_remaining_s(db: Session, station_id: str) -> int:
    """Seconds of test mode left for this station, 0 when it is not in test mode.

    An expiry in the past reads as 0 and is not cleared. Nothing needs to run for
    test mode to end, which is the point: a missed cleanup job cannot leave a
    detector silently suppressed.
    """
    station_id = (station_id or "").strip()
    row = db.get(UnitStatus, station_id) if station_id else None
    until = getattr(row, "test_mode_until", None) if row is not None else None
    if until is None:
        return 0
    remaining = (until - now_sast()).total_seconds()
    if remaining <= 0:
        return 0
    # Clamp on read as well as on write. A row edited directly in the database,
    # or written before the ceiling was lowered, must not outrank the ceiling.
    return int(min(remaining, MAX_TEST_MODE_MIN * 60))


def test_mode_active(db: Session, station_id: str) -> bool:
    return test_mode_remaining_s(db, station_id) > 0


def test_mode_stations(db: Session, tenant_id=None):
    """[(station_id, seconds_remaining), ...] for stations now in test mode.

    Scoped to one client when tenant_id is given. Used by the banner, so an
    operator opening the dashboard can see that a detector is not alerting.
    """
    q = db.query(UnitStatus).filter(UnitStatus.test_mode_until.isnot(None))
    if tenant_id is not None:
        q = q.filter(UnitStatus.tenant_id == tenant_id)
    out = []
    for row in q.order_by(UnitStatus.station_id).all():
        left = test_mode_remaining_s(db, row.station_id)
        if left > 0:
            out.append((row.station_id, left))
    return out


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
