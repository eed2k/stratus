from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
)
from sqlalchemy.orm import relationship

from .db import Base
from .timeutil import now_sast


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="operator")  # admin | operator | viewer
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_sast)


class Group(Base):
    __tablename__ = "groups"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), unique=True, nullable=False)
    description = Column(Text, default="")
    distance_threshold_km = Column(Integer, default=15)
    is_active = Column(Boolean, default=True)
    recipients = relationship("Recipient", back_populates="group")


class Recipient(Base):
    __tablename__ = "recipients"
    id = Column(Integer, primary_key=True)
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
    last_seen = Column(DateTime, default=now_sast, index=True)
    last_kind = Column(String(16), default="heartbeat")  # heartbeat | strike
    cpu_temp_c = Column(Float, default=0)
    rssi_dbm = Column(Integer, default=0)


class HeartbeatSample(Base):
    """Time-series of heartbeat telemetry for trend charts (24h CPU graph).

    One row per heartbeat. Pruned to a rolling window so the table stays
    small. Powers the dashboard CPU load-vs-temperature chart.
    """
    __tablename__ = "heartbeat_samples"
    id = Column(Integer, primary_key=True)
    station_id = Column(String(64), index=True)
    ts = Column(DateTime, default=now_sast, index=True)
    cpu_temp_c = Column(Float, default=0)
    cpu_load_pct = Column(Float, nullable=True)  # null until the unit reports it
