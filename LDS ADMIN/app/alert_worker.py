"""Background fan-out worker.

Runs each alert dispatch in a thread so the Pi webhook returns fast.
For higher throughput, swap with Celery/RQ later; the interface stays the same.
"""
import logging
import threading
from typing import Dict, Any

from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Recipient, Group, AlertEvent, MessageLog, AlertStage
from .timeutil import now_sast
from .runtime import (get_alerts_enabled, get_alert_cooldown_min,
                      get_last_alert_sent, mark_alert_sent, unit_tenant_id,
                      MAX_COOLDOWN_MIN)
from .messages import build_lightning_sms
from . import sms_gateway

log = logging.getLogger("alerts")


def _build_body(payload: Dict[str, Any], stage=None) -> str:
    return build_lightning_sms(
        payload, stage_name=stage.name if stage is not None else None)


def select_stage(db: Session, tenant_id: int, distance_km: float):
    """The escalation stage covering `distance_km`, or None.

    Stages are bands. The one chosen is the ACTIVE stage with the smallest
    distance_km that still covers the strike, i.e. the most specific band, which
    is also the most severe. With stages at 10, 20 and 30 km a strike at 8 km
    fires the 10 km stage alone - not all three - so one flash produces one
    message per recipient rather than three.

    Returns None when the client has defined no stages, which is the signal to
    fall back to per-group thresholds. That keeps every existing panel behaving
    exactly as before until someone opts in.
    """
    try:
        distance = float(distance_km)
    except (TypeError, ValueError):
        return None
    return (db.query(AlertStage)
            .filter(AlertStage.tenant_id == tenant_id,
                    AlertStage.is_active == True,          # noqa: E712
                    AlertStage.distance_km >= distance)
            .order_by(AlertStage.distance_km.asc())
            .first())


def select_targets(db: Session, tenant_id: int, distance_km: float, stage):
    """Recipients to notify for this strike.

    Two paths on purpose:

      With a stage, the stage owns the distance decision and the group's own
      threshold is not consulted. Mixing the two would mean a stage could fire
      while the recipients it names are filtered out by their group threshold,
      which reads as the alert plan being ignored.

      Without a stage, the original behavior: each group's threshold decides.

    A recipient always needs a phone number, and both the recipient and the group
    must be active in either path.
    """
    q = (db.query(Recipient)
         .join(Group, Recipient.group_id == Group.id)
         .filter(Recipient.tenant_id == tenant_id,
                 Group.tenant_id == tenant_id,
                 Recipient.is_active == True,              # noqa: E712
                 Group.is_active == True,                  # noqa: E712
                 Recipient.phone != ""))
    if stage is not None:
        if stage.group_id is not None:
            # A stage naming a group notifies only that group.
            q = q.filter(Group.id == stage.group_id)
        return q.all()
    return q.filter(Group.distance_threshold_km >= distance_km).all()


def _dispatch(event_id: int, payload: Dict[str, Any]):
    db: Session = SessionLocal()
    try:
        event = db.get(AlertEvent, event_id)
        if not event:
            return

        # The event's own tenant decides who may be messaged. An event with no
        # tenant belongs to a detector nobody has claimed yet, so there is no
        # one to notify and no recipient list may be consulted.
        tid = event.tenant_id
        if tid is None:
            log.warning("event %d has no tenant (unassigned detector %s) - "
                        "no recipients notified", event.id, event.station_id)
            db.commit()
            return

        # Which escalation stage covers this strike, if the client uses stages.
        stage = select_stage(db, tid, payload["distance_km"])
        targets = select_targets(db, tid, payload["distance_km"], stage)
        event.recipients_targeted = len(targets)
        body = _build_body(payload, stage)

        alerts_on = get_alerts_enabled(db, tenant_id=tid)

        # Cooldown: after one batch goes out, suppress further batches for the
        # configured number of minutes. The slot is "claimed" up front so a rapid
        # burst of events only sends once.
        #
        # Scoped to the stage that fired. Sharing one slot across every distance
        # band meant a 35 km strike silenced the 8 km strike behind it, which is
        # the wrong way round: the closer the lightning, the more the next
        # message matters. A stage may also set its own shorter interval.
        stage_id = stage.id if stage is not None else None
        cooldown_min = get_alert_cooldown_min(db, tenant_id=tid)
        if stage is not None and stage.cooldown_min is not None:
            cooldown_min = max(0, min(MAX_COOLDOWN_MIN, int(stage.cooldown_min)))
        cooldown_active = False
        if alerts_on and cooldown_min > 0:
            last_sent = get_last_alert_sent(db, tenant_id=tid, stage_id=stage_id)
            if last_sent is not None:
                elapsed = (now_sast() - last_sent).total_seconds()
                if elapsed < cooldown_min * 60:
                    cooldown_active = True
            if not cooldown_active:
                # Claim the slot before sending.
                mark_alert_sent(db, tenant_id=tid, stage_id=stage_id)

        for r in targets:
            if not r.phone:
                continue
            row = MessageLog(event_id=event.id, recipient_id=r.id,
                             channel="sms", to_number=r.phone, body=body,
                             status="queued")
            db.add(row); db.flush()
            if not alerts_on:
                # Master switch is off: record the event + intended recipients
                # for audit, but suppress actual SMS delivery.
                row.status = "skipped"
                row.error = "Alerts switched off"
                continue
            if cooldown_active:
                # Within the cooldown window: record for audit, suppress send.
                row.status = "skipped"
                row.error = f"Cooldown active ({cooldown_min} min)"
                continue
            try:
                status, sid = sms_gateway.send_sms(r.phone, body)
                row.status = status
                row.provider_message_id = sid
                event.messages_sent += 1
            except Exception as e:  # noqa: BLE001 - surface provider errors in the log
                row.status = "failed"
                row.error = str(e)[:1000]
                event.messages_failed += 1
                log.warning("SMS send failed (-> %s): %s", r.phone, e)
        stage_label = (f"stage '{stage.name}' (<={stage.distance_km} km)"
                       if stage is not None else "group thresholds")
        if not alerts_on:
            log.info("Alerts switched off - %d message(s) suppressed for event "
                     "%d [%s]", len(targets), event.id, stage_label)
        elif cooldown_active:
            log.info("Cooldown active (%d min) - %d message(s) suppressed for "
                     "event %d [%s]", cooldown_min, len(targets), event.id,
                     stage_label)
        else:
            log.info("Event %d at %.1f km matched %s - %d recipient(s)",
                     event.id, float(payload.get("distance_km") or 0),
                     stage_label, len(targets))
        db.commit()
    finally:
        db.close()


def dispatch_async(payload: Dict[str, Any], tenant_id=None) -> int:
    """Persist the event row immediately, then fan out in a thread.

    `tenant_id` is normally left to the detector -> tenant mapping; pass it
    explicitly for operator-triggered test alerts, which belong to the panel
    the operator is signed in to.

    Returns the new event ID.
    """
    db = SessionLocal()
    try:
        if tenant_id is None:
            tenant_id = unit_tenant_id(db, payload.get("station_id"))
        event = AlertEvent(
            tenant_id=tenant_id,
            station_id=payload["station_id"],
            distance_km=payload["distance_km"],
            energy=payload["energy"],
            timestamp=now_sast(),
        )
        db.add(event); db.commit(); db.refresh(event)
        event_id = event.id
    finally:
        db.close()
    threading.Thread(target=_dispatch, args=(event_id, payload), daemon=True).start()
    return event_id
