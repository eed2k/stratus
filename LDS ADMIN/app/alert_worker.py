"""Background fan-out worker.

Runs each alert dispatch in a thread so the Pi webhook returns fast.
For higher throughput, swap with Celery/RQ later; the interface stays the same.
"""
import logging
import threading
from typing import Dict, Any, Optional

from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import (Recipient, Group, AlertEvent, MessageLog, AlertStage,
                     Tenant, UnitStatus)
from .timeutil import now_sast
from .runtime import (get_alerts_enabled, get_alert_cooldown_min,
                      get_last_alert_sent, mark_alert_sent, unit_tenant_id,
                      MAX_COOLDOWN_MIN)
from .messages import build_lightning_sms
from . import sms_gateway

log = logging.getLogger("alerts")


def resolve_site_name(db: Session, tenant_id, station_id) -> str:
    """The name to print on the Location line of an SMS, for THIS alert.

    Resolution order, matching how reports.py and station_display() already
    label a station, most specific first:

      1. the detector's own site_label, when an admin has set one. A client can
         run more than one unit, and "Location:" should name the installation
         that saw the strike, not the account.
      2. the owning client's site_name, which is what the platform console asks
         for when a site is created and keeps in step when it is renamed.
      3. that client's name, so a site created without an explicit site_name
         still reads correctly rather than falling through.
      4. the detector's own station_id, which is at least reported by the unit
         that saw the strike and so can never name the wrong client.

    There is deliberately no deployment-wide fallback: a single environment
    variable cannot be correct for more than one client.

    This exists because the previous code read a deployment-wide setting instead.
    Quaggasklip's messages went out saying GLENCORE WONDERKOP, because that was
    the client the panel was first configured for. Nothing about adding a client
    could have fixed it, since the name was never read from the client record.
    """
    if station_id:
        unit = db.get(UnitStatus, str(station_id))
        if unit is not None and (unit.site_label or "").strip():
            return unit.site_label.strip()

    if tenant_id is not None:
        tenant = db.get(Tenant, tenant_id)
        if tenant is not None:
            for candidate in ((tenant.site_name or ""), (tenant.name or "")):
                if candidate.strip():
                    return candidate.strip()

    return str(station_id or "SITE").strip()


def _build_body(payload: Dict[str, Any], stage=None,
                site_name: Optional[str] = None) -> str:
    return build_lightning_sms(
        payload, site_name=site_name,
        stage_name=stage.name if stage is not None else None)


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
        # Name the site from the event's own tenant and detector, not from the
        # deployment-wide SITE_NAME.
        body = _build_body(
            payload, stage,
            site_name=resolve_site_name(db, tid, event.station_id))

        alerts_on = get_alerts_enabled(db, tenant_id=tid)

        # Test mode. Read from the event row, which was stamped at ingest, not
        # re-evaluated here: the window may well have expired between the strike
        # arriving and this thread running, and what matters is the state when
        # the event was received.
        is_test = bool(event.is_test)

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
        # A test event must not claim the cooldown slot. If it did, a bench test
        # would silence the next real strike in that band for the whole cooldown
        # period, which turns a harmless test into a missed warning.
        if alerts_on and not is_test and cooldown_min > 0:
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
            if is_test:
                # The station was in test mode when this arrived. Same treatment
                # as the master switch: the event and the recipients it would
                # have gone to are on record, nothing is sent.
                #
                # Checked first so the recorded reason names test mode rather
                # than whichever other gate also happened to be shut. Whoever
                # reads this row needs to know a person put the detector into
                # test mode, which is the reason they can act on.
                row.status = "skipped"
                row.error = "Test mode"
                continue
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
                # Masked: the full number is personal information and a rotated,
                # backed-up log read by platform staff is the wrong place to keep
                # a copy of a client's contact list. The recipient id identifies
                # the row exactly for anyone entitled to look it up.
                log.warning("SMS send failed (recipient=%s -> %s): %s",
                            r.id, sms_gateway.mask_number(r.phone), e)
        stage_label = (f"stage '{stage.name}' (<={stage.distance_km} km)"
                       if stage is not None else "group thresholds")
        if is_test:
            log.info("Test mode on %s - event %d recorded, %d message(s) "
                     "suppressed [%s]", event.station_id, event.id,
                     len(targets), stage_label)
        elif not alerts_on:
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


def dispatch_async(payload: Dict[str, Any], tenant_id=None,
                   is_test: bool = False) -> int:
    """Persist the event row immediately, then fan out in a thread.

    `tenant_id` is normally left to the detector -> tenant mapping; pass it
    explicitly for operator-triggered test alerts, which belong to the panel
    the operator is signed in to.

    `is_test` records that the station was in test mode when this event arrived,
    which stores the event and suppresses every message for it. The caller
    decides, from the station's own test-mode window; it is never read from the
    detector's payload.

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
            is_test=bool(is_test),
        )
        db.add(event); db.commit(); db.refresh(event)
        event_id = event.id
    finally:
        db.close()
    threading.Thread(target=_dispatch, args=(event_id, payload), daemon=True).start()
    return event_id
