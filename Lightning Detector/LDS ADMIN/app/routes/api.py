from fastapi import APIRouter, Header, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
import hmac
import logging

from ..db import get_db
from ..config import settings
from ..models import AlertEvent, MessageLog, HeartbeatSample, CalibrationEvent
from ..alert_worker import dispatch_async
from ..runtime import (touch_unit, get_units, get_alerts_enabled,
                       unit_tenant_id)
from ..bootstrap import platform_tenant_id

router = APIRouter(prefix="/api/v1")
log = logging.getLogger("dlr")


class LightningPayload(BaseModel):
    station_id: str = Field(..., min_length=1, max_length=64)
    distance_km: float = Field(..., ge=0, le=99)
    energy: int = Field(..., ge=0)
    timestamp: str = Field(..., min_length=1, max_length=40)


class HeartbeatPayload(BaseModel):
    station_id: str = Field(..., min_length=1, max_length=64)
    timestamp: str = Field(default="", max_length=40)
    cpu_temp_c: float | None = None
    # rssi_dbm intentionally accepted-but-ignored: older units may still post it.
    rssi_dbm: int | None = None
    uptime_s: float | None = None
    noise_floor: int | None = None
    strikes_today: int | None = None
    cpu_load_pct: float | None = None


class CalibrationPayload(BaseModel):
    station_id: str = Field(..., min_length=1, max_length=64)
    # "rc_recal" (RC oscillator recalibration) or "antenna_check".
    kind: str = Field(..., min_length=1, max_length=16)
    reason: str | None = Field(default=None, max_length=24)
    timestamp: str = Field(default="", max_length=40)
    cpu_temp_c: float | None = None
    freq_hz: int | None = None
    in_tolerance: bool | None = None
    tune_cap_before: int | None = None
    tune_cap_after: int | None = None


def verify_token(x_auth_token: str = Header(default="")):
    if not settings.ALERT_WEBHOOK_TOKEN:
        return  # token not set on server -> open ingest (dev only)
    if not hmac.compare_digest(str(x_auth_token), str(settings.ALERT_WEBHOOK_TOKEN)):
        raise HTTPException(401, "Invalid X-Auth-Token")


@router.post("/lightning")
def ingest_lightning(payload: LightningPayload, _=Depends(verify_token),
                     db: Session = Depends(get_db)):
    # New detectors are filed under the platform tenant and stay hidden from
    # every client panel until an admin assigns them.
    touch_unit(db, payload.station_id, kind="strike",
               tenant_id=platform_tenant_id(db))
    event_id = dispatch_async(payload.model_dump())
    return {"status": "queued", "event_id": event_id}


@router.post("/heartbeat")
def ingest_heartbeat(payload: HeartbeatPayload, _=Depends(verify_token),
                     db: Session = Depends(get_db)):
    """Hourly liveness ping from the detector unit (no alerting)."""
    touch_unit(db, payload.station_id, kind="heartbeat",
               cpu_temp_c=payload.cpu_temp_c,
               tenant_id=platform_tenant_id(db))
    # Record a time-series sample for the CPU trend chart and monthly reports.
    try:
        from ..timeutil import now_sast
        from ..metrics import prune_cutoff
        station = (payload.station_id or "UNKNOWN").strip() or "UNKNOWN"
        db.add(HeartbeatSample(
            tenant_id=unit_tenant_id(db, station),
            station_id=station,
            cpu_temp_c=float(payload.cpu_temp_c) if payload.cpu_temp_c is not None else 0.0,
            cpu_load_pct=(float(payload.cpu_load_pct)
                          if payload.cpu_load_pct is not None else None),
        ))
        # Retain enough history for monthly reports, then prune older rows so
        # the table stays bounded (hourly rows over the window are small).
        cutoff = prune_cutoff(now_sast(), settings.HEARTBEAT_RETENTION_DAYS)
        db.query(HeartbeatSample).filter(
            HeartbeatSample.station_id == station,
            HeartbeatSample.ts < cutoff).delete(synchronize_session=False)
        db.commit()
    except Exception as e:
        db.rollback()
        log.warning("heartbeat sample store failed: %s", e)
    return {"status": "ok"}


@router.post("/calibration")
def ingest_calibration(payload: CalibrationPayload, _=Depends(verify_token),
                       db: Session = Depends(get_db)):
    """Record an auto-calibration action reported by a detector unit.

    Best-effort: a storage failure is logged and swallowed so the detector's
    post never fails. Events are filed under the unit's owning tenant (the
    platform tenant for an as-yet-unassigned unit) and pruned to a long window
    so the audit history stays bounded.
    """
    try:
        from ..timeutil import now_sast
        from ..metrics import prune_cutoff
        station = (payload.station_id or "UNKNOWN").strip() or "UNKNOWN"
        kind = payload.kind if payload.kind in ("rc_recal", "antenna_check") \
            else "rc_recal"
        db.add(CalibrationEvent(
            tenant_id=unit_tenant_id(db, station),
            station_id=station,
            kind=kind,
            reason=payload.reason,
            cpu_temp_c=payload.cpu_temp_c,
            freq_hz=payload.freq_hz,
            in_tolerance=payload.in_tolerance,
            tune_cap_before=payload.tune_cap_before,
            tune_cap_after=payload.tune_cap_after,
        ))
        cutoff = prune_cutoff(now_sast(), settings.CALIBRATION_RETENTION_DAYS)
        db.query(CalibrationEvent).filter(
            CalibrationEvent.station_id == station,
            CalibrationEvent.ts < cutoff).delete(synchronize_session=False)
        db.commit()
    except Exception as e:
        db.rollback()
        log.warning("calibration event store failed: %s", e)
    return {"status": "ok"}


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/beacon/state")
def beacon_state(station_id: str = "", _=Depends(verify_token),
                 db: Session = Depends(get_db)):
    """State feed for a secondary indicator/beacon unit.

    A beacon controller (e.g. a Pi with a relay HAT driving pilot lights)
    polls this endpoint over outbound HTTPS and drives its lamps:
      - unit_online   -> green light (detector alive) / red light (offline)
      - lightning_active -> flashing amber + buzzer (recent in-range strike)

    Token-authenticated, read-only. Designed to be polled every few seconds.
    """
    from datetime import timedelta
    from ..timeutil import now_sast

    # A beacon that identifies its own detector is answered only about that
    # detector's client. Without station_id the reply spans every unit, which
    # is correct for a single-client deployment but should not be relied on
    # once more than one client is live.
    beacon_tid = unit_tenant_id(db, station_id) if station_id else None

    threshold_s = settings.UNIT_ACTIVE_THRESHOLD_MIN * 60
    units = get_units(db, threshold_s, tenant_id=beacon_tid)
    unit_online = any(active for _u, active, _age in units)
    ages = [age for _u, _a, age in units if age is not None]
    last_seen_age_s = int(min(ages)) if ages else None

    now = now_sast()
    radius = settings.BEACON_LIGHTNING_KM

    # Most-recent in-range strike (bounded to the last 24h for relevance).
    # The beacon uses its age to decide whether to fire its alarm sequence.
    bound = now - timedelta(hours=24)
    strike_q = db.query(AlertEvent).filter(AlertEvent.timestamp >= bound,
                                           AlertEvent.distance_km >= 0,
                                           AlertEvent.distance_km <= radius)
    if beacon_tid is not None:
        strike_q = strike_q.filter(AlertEvent.tenant_id == beacon_tid)
    latest = strike_q.order_by(AlertEvent.timestamp.desc()).first()
    if latest is not None:
        last_strike_age_s = int((now - latest.timestamp).total_seconds())
        last_strike_km = latest.distance_km
    else:
        last_strike_age_s = None
        last_strike_km = None

    # Retained convenience flag: in-range strike within the all-clear window.
    lightning_active = (last_strike_age_s is not None and
                        last_strike_age_s <= settings.BEACON_ALLCLEAR_MIN * 60)

    return {
        "unit_online": unit_online,
        "last_seen_age_s": last_seen_age_s,
        "lightning_active": lightning_active,
        "last_strike_age_s": last_strike_age_s,
        "last_strike_km": last_strike_km,
        "alerts_enabled": get_alerts_enabled(db, tenant_id=beacon_tid),
        "lightning_radius_km": radius,
        "lightning_window_min": settings.BEACON_ALLCLEAR_MIN,
        "server_time": now.isoformat(),
    }


@router.get("/events/{eid}")
def event_status(eid: int, _=Depends(verify_token), db: Session = Depends(get_db)):
    e = db.get(AlertEvent, eid)
    if not e:
        raise HTTPException(404, "Not found")
    return {
        "id": e.id, "station_id": e.station_id,
        "distance_km": e.distance_km, "energy": e.energy,
        "timestamp": e.timestamp.isoformat() + "+02:00",
        "targeted": e.recipients_targeted,
        "sent": e.messages_sent, "failed": e.messages_failed,
    }


# -------------------- Clickatell delivery-receipt callback --------------------
# Configured in Clickatell One API setup as:
#   POST https://gwld1-admin.dynv6.net/api/clickatell/dlr
# with custom auth header (we accept the token as either ?token=... or via the
# X-Auth-Token header) so it works across Clickatell's setup variants.
dlr_router = APIRouter(prefix="/api/clickatell")


def _verify_dlr(token_qs: str, x_auth_token: str, authorization: str) -> None:
    expected = settings.CLICKATELL_DLR_TOKEN
    if not expected:
        return  # not configured -> accept (useful for first connectivity test)
    # Accept: ?token=..., X-Auth-Token header, or HTTP Basic where the password
    # equals the token (Clickatell's "Username + Password" callback auth uses
    # Basic; we ignore the username and only check the password).
    if (hmac.compare_digest(str(token_qs), str(expected))
            or hmac.compare_digest(str(x_auth_token), str(expected))):
        return
    if authorization.lower().startswith("basic "):
        import base64
        try:
            decoded = base64.b64decode(authorization.split(None, 1)[1]).decode("utf-8", "ignore")
            _, _, password = decoded.partition(":")
            if hmac.compare_digest(str(password), str(expected)):
                return
        except Exception:
            pass
    raise HTTPException(401, "Invalid DLR token")


_STATUS_MAP = {
    # Clickatell numeric statuses
    "1": "queued",      # message unknown
    "2": "queued",      # message queued
    "3": "delivered",   # delivered to gateway
    "4": "delivered",   # received by recipient
    "5": "failed",      # error with message
    "6": "failed",      # user canceled
    "7": "failed",      # error delivering
    "8": "sent",        # OK / accepted
    "9": "failed",      # routing error
    "10": "failed",     # message expired
    "11": "queued",     # message scheduled
    "12": "failed",     # out of credit
    "13": "failed",     # blocked by gateway
    "14": "failed",     # blocked by destination
}


@dlr_router.post("/dlr")
async def clickatell_dlr(request: Request,
                         token: str = "",
                         x_auth_token: str = Header(default=""),
                         authorization: str = Header(default=""),
                         db: Session = Depends(get_db)):
    _verify_dlr(token, x_auth_token, authorization)
    try:
        data = await request.json()
    except Exception:
        data = {}

    # Clickatell sends one or many delivery receipts; normalize to a list.
    items = data if isinstance(data, list) else (data.get("messages") or [data])
    updated = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        msg_id = str(it.get("apiMessageId") or it.get("messageId") or "").strip()
        raw_status = str(it.get("messageStatus") or it.get("status") or "").strip()
        err = str(it.get("statusDescription") or it.get("error") or "")[:1000]
        if not msg_id:
            continue
        new_status = _STATUS_MAP.get(raw_status, raw_status.lower() or "queued")
        rows = (db.query(MessageLog)
                  .filter(MessageLog.provider_message_id == msg_id)
                  .all())
        for row in rows:
            row.status = new_status
            if err:
                row.error = err
            updated += 1
    if updated:
        db.commit()
    log.info("clickatell DLR processed: %d row(s) updated", updated)
    return {"status": "ok", "updated": updated}
