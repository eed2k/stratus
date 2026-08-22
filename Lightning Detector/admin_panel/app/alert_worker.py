"""Background fan-out worker.

Runs each alert dispatch in a thread so the Pi webhook returns fast.
For higher throughput, swap with Celery/RQ later; the interface stays the same.
"""
import logging
import threading
from typing import Dict, Any

from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Recipient, Group, AlertEvent, MessageLog
from .timeutil import now_sast
from .runtime import (get_alerts_enabled, get_alert_cooldown_min,
                      get_last_alert_sent, mark_alert_sent)
from .messages import build_lightning_sms
from . import clickatell_sender

log = logging.getLogger("alerts")


def _build_body(payload: Dict[str, Any]) -> str:
    return build_lightning_sms(payload)


def _dispatch(event_id: int, payload: Dict[str, Any]):
    db: Session = SessionLocal()
    try:
        event = db.get(AlertEvent, event_id)
        if not event:
            return

        # Eligible recipients: active, in an active group, group threshold honoured.
        # SMS-only deployment: a recipient must have a phone number.
        targets = (
            db.query(Recipient)
              .join(Group)
              .filter(Recipient.is_active == True,                 # noqa: E712
                      Group.is_active == True,                     # noqa: E712
                      Recipient.phone != "",
                      Group.distance_threshold_km >= payload["distance_km"])
              .all()
        )
        event.recipients_targeted = len(targets)
        body = _build_body(payload)

        alerts_on = get_alerts_enabled(db)

        # Cooldown: after one SMS batch goes out, suppress further batches for
        # the configured number of minutes. The slot is "claimed" up front so a
        # rapid burst of events only sends once.
        cooldown_min = get_alert_cooldown_min(db)
        cooldown_active = False
        if alerts_on and cooldown_min > 0:
            last_sent = get_last_alert_sent(db)
            if last_sent is not None:
                elapsed = (now_sast() - last_sent).total_seconds()
                if elapsed < cooldown_min * 60:
                    cooldown_active = True
            if not cooldown_active:
                mark_alert_sent(db)  # claim the slot before sending

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
                status, sid = clickatell_sender.send_sms(r.phone, body)
                row.status = status
                row.provider_message_id = sid
                event.messages_sent += 1
            except Exception as e:  # noqa: BLE001 - surface provider errors in the log
                row.status = "failed"
                row.error = str(e)[:1000]
                event.messages_failed += 1
                log.warning("SMS send failed (-> %s): %s", r.phone, e)
        if not alerts_on:
            log.info("Alerts switched off - %d SMS suppressed for event %d",
                     len(targets), event.id)
        elif cooldown_active:
            log.info("Cooldown active (%d min) - %d SMS suppressed for event %d",
                     cooldown_min, len(targets), event.id)
        db.commit()
    finally:
        db.close()


def dispatch_async(payload: Dict[str, Any]) -> int:
    """Persist the event row immediately, then fan out in a thread.

    Returns the new event ID.
    """
    db = SessionLocal()
    try:
        event = AlertEvent(
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
