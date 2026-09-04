from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
)
from sqlalchemy.orm import relationship

from .db import Base
from .timeutil import now_sast


class Tenant(Base):
    """A client with its own lightning panel at /<slug>.

    Every operational row (users, groups, recipients, detector units, events)
    carries a tenant_id, and every query is filtered by it. Rows belonging to
    the Stratus platform team itself use the bootstrap tenant created at
    startup, so there is never an "unowned" record.
    """
    __tablename__ = "tenants"
    id = Column(Integer, primary_key=True)
    # URL path segment, e.g. "glencore" -> /glencore. Lower-case, validated on
    # create so it can never collide with a real route or escape its path.
    slug = Column(String(40), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    # Shown in SMS bodies for this client's alerts.
    site_name = Column(String(120), default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_sast)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    # Short sign-in name for the client login at /client, e.g. "GWLD1". Clients
    # know their unit by that name and should not have to remember an e-mail
    # address to reach their own panel.
    #
    # Deliberately NOT unique=True, and deliberately nullable. add_missing_columns
    # can only ALTER TABLE ADD COLUMN a nullable column, so declaring a
    # constraint here would build one schema on a fresh database and a different
    # one on an upgraded database. Uniqueness is enforced case-insensitively in
    # the routes instead, the same way group names already are.
    username = Column(String(64), nullable=True, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="operator")  # admin | operator | viewer
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_sast)
    # Which client panel this login belongs to.
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    # Platform admins (Stratus Admin) may enter any tenant's panel and manage
    # the tenant list. Client admins are confined to their own tenant.
    is_platform_admin = Column(Boolean, default=False)


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    # Group names are unique per tenant, not globally: two clients may both
    # have a "control room" group.
    name = Column(String(80), nullable=False)
    description = Column(Text, default="")
    distance_threshold_km = Column(Integer, default=15)
    is_active = Column(Boolean, default=True)
    recipients = relationship("Recipient", back_populates="group")


class AlertStage(Base):
    """One escalation step in a client's alert plan, e.g. "20 km - Warning".

    WHY THIS EXISTS ALONGSIDE Group.distance_threshold_km

    A group's threshold answers "does this person get told at all". It cannot
    express escalation: one site wants a quiet heads-up at 30 km, a real warning
    at 20 km, and stop-work at 10 km, with different people on each step. That
    needs a list of bands, not one number per group.

    HOW A STRIKE PICKS A STAGE

    Stages are bands, not filters. For a strike at distance d the stage chosen is
    the one with the SMALLEST distance_km that still covers d - the most specific
    band, which is also the most severe. A strike at 8 km fires the 10 km stage
    and not the 20 or 30 km stages, so nobody receives three messages for one
    flash.

    BACKWARD COMPATIBILITY

    A tenant with no stages defined keeps the old behavior exactly: recipients
    are selected by their group's own threshold. Stages are opt-in, so adding
    this table changes nothing for an existing client until someone defines one.
    """
    __tablename__ = "alert_stages"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    # Shown to recipients, so it should read as a severity: "Watch", "Warning",
    # "Stop work". Kept short because it goes into an SMS.
    name = Column(String(40), nullable=False)
    # Upper edge of the band, in km. A strike at or inside this distance is
    # covered by the stage.
    distance_km = Column(Integer, nullable=False, default=20)
    # Which recipients this stage notifies. NULL means every active group in the
    # tenant, which is the sensible default for a site that wants everyone told
    # at every step and only varies the wording.
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)
    group = relationship("Group")
    is_active = Column(Boolean, default=True)
    # Per-stage repeat suppression, in minutes. NULL falls back to the tenant
    # setting. A near stage usually wants a shorter cooldown than a far one:
    # being reminded every 5 minutes that lightning is 8 km away is useful,
    # whereas the same cadence for 35 km is noise.
    cooldown_min = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now_sast)


class Recipient(Base):
    __tablename__ = "recipients"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    name = Column(String(120), nullable=False)
    phone = Column(String(32), default="")        # E.164, used for SMS
    # Legacy columns kept for DB compatibility; this deployment is SMS-only.
    whatsapp = Column(String(32), default="")
    channel = Column(String(8), default="sms")    # sms only
    language = Column(String(8), default="en")
    is_active = Column(Boolean, default=True)
    group_id = Column(Integer, ForeignKey("groups.id"))
    group = relationship("Group", back_populates="recipients")
    created_at = Column(DateTime, default=now_sast)


class AlertEvent(Base):
    __tablename__ = "alert_events"
    id = Column(Integer, primary_key=True)
    # Resolved at ingest from the detector's station_id -> UnitStatus.tenant_id
    # mapping, so historical events stay with the client that owns the unit.
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    station_id = Column(String(64), index=True)
    distance_km = Column(Float)
    energy = Column(Integer)
    timestamp = Column(DateTime, default=now_sast, index=True)
    recipients_targeted = Column(Integer, default=0)
    messages_sent = Column(Integer, default=0)
    messages_failed = Column(Integer, default=0)


class MessageLog(Base):
    __tablename__ = "message_log"
    id = Column(Integer, primary_key=True)
    event_id = Column(Integer, ForeignKey("alert_events.id"))
    recipient_id = Column(Integer, ForeignKey("recipients.id"))
    channel = Column(String(8))                   # sms | wa
    to_number = Column(String(32))
    body = Column(Text)
    status = Column(String(32))                   # queued | sent | delivered | failed
    provider_message_id = Column("twilio_sid", String(64), default="")
    error = Column(Text, default="")
    created_at = Column(DateTime, default=now_sast)


class Setting(Base):
    """Simple key/value table for runtime tweaks editable in UI."""
    __tablename__ = "settings"
    key = Column(String(64), primary_key=True)
    value = Column(Text, default="")


class UnitStatus(Base):
    """Last-known liveness of each detector unit (the Pi/AS3935).

    Updated whenever the Pi contacts the panel: hourly heartbeats and on
    every lightning strike. The dashboard derives ACTIVE/INACTIVE from how
    recently last_seen was updated.
    """
    __tablename__ = "unit_status"
    station_id = Column(String(64), primary_key=True)
    # Owning client. This is the authoritative detector -> tenant mapping that
    # every other per-station query derives from.
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    last_seen = Column(DateTime, default=now_sast, index=True)
    last_kind = Column(String(16), default="heartbeat")  # heartbeat | strike
    cpu_temp_c = Column(Float, default=0)
    rssi_dbm = Column(Integer, default=0)
    # Per-station metadata shown on reports and displays. Nullable: a station
    # may exist before an admin sets these. site_label overrides the tenant
    # site_name for this specific detector; coordinates locate the install.
    site_label = Column(String(120), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    # Meters above mean sea level. Added so the site line on an LDS report can
    # carry the same three figures as a Stratus report, which already prints
    # latitude, longitude and altitude for every weather station.
    altitude_m = Column(Float, nullable=True)


class HeartbeatSample(Base):
    """Time-series of heartbeat telemetry for trend charts (24h CPU graph).

    One row per heartbeat. Pruned to a rolling window so the table stays
    small. Powers the dashboard CPU load-vs-temperature chart.
    """
    __tablename__ = "heartbeat_samples"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    station_id = Column(String(64), index=True)
    ts = Column(DateTime, default=now_sast, index=True)
    cpu_temp_c = Column(Float, default=0)
    cpu_load_pct = Column(Float, nullable=True)  # null until the unit reports it


class CalibrationEvent(Base):
    """A calibration action reported by a detector unit.

    The AS3935 auto-calibrates: it recalibrates its RC oscillators when the
    enclosure temperature drifts, and runs a daily antenna resonance check.
    The detector posts each occurrence here so the monthly technical report can
    show real, auditable calibration activity rather than an assumed schedule.
    """
    __tablename__ = "calibration_events"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id"), index=True)
    station_id = Column(String(64), index=True)
    ts = Column(DateTime, default=now_sast, index=True)
    # "rc_recal" (oscillator recalibration) | "antenna_check" (resonance check)
    kind = Column(String(16), default="rc_recal")
    # For rc_recal: "temp_delta" | "interval". For antenna_check: "scheduled".
    reason = Column(String(24), nullable=True)
    cpu_temp_c = Column(Float, nullable=True)
    # antenna_check only: measured LCO frequency and whether it was in the
    # 3.5 percent tolerance of 500 kHz, plus any tune_cap adjustment made.
    freq_hz = Column(Integer, nullable=True)
    in_tolerance = Column(Boolean, nullable=True)
    tune_cap_before = Column(Integer, nullable=True)
    tune_cap_after = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now_sast)
