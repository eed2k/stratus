from fastapi import APIRouter, Request, Depends, HTTPException, Form
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from pathlib import Path
from sqlalchemy import func

from ..db import get_db
from ..config import settings
from ..models import User, Recipient, Group, AlertEvent, MessageLog, HeartbeatSample
from ..auth import current_user, require_admin, require_writer, hash_password, verify_password
from ..alert_worker import dispatch_async
from ..messages import build_lightning_sms
from ..runtime import (get_alerts_enabled, set_alerts_enabled, get_units,
                       get_alert_cooldown_min, set_alert_cooldown_min)
from ..timeutil import now_sast
from ..charts import cpu_chart_svg
from ..security import (get_csrf_token, verify_csrf, login_allowed,
                        record_login_failure, reset_login_failures)
from .. import clickatell_sender

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "templates"))

DEMO_MARKERS = ("demo", "test", "sample", "mock")
MIN_PASSWORD_LEN = 10


def _is_viewer(user: User) -> bool:
    return user.role == "viewer"


def _is_demo_user_expr():
    return func.lower(User.email).like("%demo%")


def _is_demo_event_expr():
    return func.lower(AlertEvent.station_id).like("%demo%")


def render(request, name, **ctx):
    user = ctx.pop("user", None)
    ctx.setdefault("csrf_token", get_csrf_token(request))
    return templates.TemplateResponse(name, {"request": request, "user": user, **ctx})


# -------------------- AUTH --------------------
@router.get("/login", response_class=HTMLResponse)
def login_get(request: Request):
    return render(request, "login.html", error=None)


@router.post("/login")
def login_post(request: Request, email: str = Form(...), password: str = Form(...),
               _: None = Depends(verify_csrf), db: Session = Depends(get_db)):
    if not login_allowed(request):
        return render(request, "login.html",
                      error="Too many failed attempts. Try again later.")
    email = (email or "").strip().lower()
    u = db.query(User).filter(User.email == email, User.is_active == True).first()  # noqa: E712
    if not u or not verify_password(password, u.password_hash):
        record_login_failure(request)
        return render(request, "login.html", error="Invalid credentials")
    # Successful login: rotate the session to defeat fixation, then set identity.
    reset_login_failures(request)
    request.session.clear()
    request.session["uid"] = u.id
    return RedirectResponse("/", status_code=303)


@router.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


# -------------------- CHANGE PASSWORD --------------------
@router.get("/account/password", response_class=HTMLResponse)
def change_password_get(request: Request, user: User = Depends(current_user)):
    return render(request, "change_password.html", user=user, error=None, success=None)


@router.post("/account/password")
def change_password_post(request: Request,
                         current_password: str = Form(...),
                         new_password: str = Form(...),
                         confirm_password: str = Form(...),
                         _: None = Depends(verify_csrf),
                         user: User = Depends(current_user),
                         db: Session = Depends(get_db)):
    if not verify_password(current_password, user.password_hash):
        return render(request, "change_password.html", user=user,
                      error="Current password is incorrect.", success=None)
    if new_password != confirm_password:
        return render(request, "change_password.html", user=user,
                      error="New passwords do not match.", success=None)
    if len(new_password) < 10:
        return render(request, "change_password.html", user=user,
                      error="New password must be at least 10 characters.", success=None)
    if verify_password(new_password, user.password_hash):
        return render(request, "change_password.html", user=user,
                      error="New password must differ from the current one.", success=None)
    u = db.query(User).get(user.id)
    u.password_hash = hash_password(new_password)
    db.commit()
    return render(request, "change_password.html", user=user,
                  error=None, success="Password updated.")


# -------------------- DASHBOARD --------------------
@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    events_query = db.query(AlertEvent).order_by(AlertEvent.timestamp.desc())
    if _is_viewer(user):
        events_query = events_query.filter(~_is_demo_event_expr())
    events = events_query.limit(25).all()
    counts = {
        "recipients": db.query(Recipient).filter(Recipient.is_active == True).count(),  # noqa: E712
        "groups":     db.query(Group).filter(Group.is_active == True).count(),          # noqa: E712
        "events_24h": db.query(AlertEvent).count(),
    }
    units = get_units(db, settings.UNIT_ACTIVE_THRESHOLD_MIN * 60)
    # Build a 24h CPU trend chart (inline SVG) for each unit.
    from datetime import timedelta
    cutoff = now_sast() - timedelta(hours=24)
    unit_charts = {}
    for u, _active, _age in units:
        samples = (db.query(HeartbeatSample)
                     .filter(HeartbeatSample.station_id == u.station_id,
                             HeartbeatSample.ts >= cutoff)
                     .order_by(HeartbeatSample.ts.asc())
                     .all())
        unit_charts[u.station_id] = cpu_chart_svg(samples, hours=24)
    return render(request, "dashboard.html", user=user, events=events,
                  counts=counts, alerts_enabled=get_alerts_enabled(db),
                  units=units, unit_charts=unit_charts,
                  alert_cooldown_min=get_alert_cooldown_min(db))


# -------------------- ALERTS MASTER SWITCH --------------------
@router.post("/alerts/toggle")
def alerts_toggle(enabled: str = Form(...), _: None = Depends(verify_csrf),
                  user: User = Depends(require_writer),
                  db: Session = Depends(get_db)):
    set_alerts_enabled(db, enabled == "on")
    return RedirectResponse("/", status_code=303)


@router.post("/alerts/cooldown")
def alerts_cooldown(cooldown_min: int = Form(...),
                    _: None = Depends(verify_csrf),
                    user: User = Depends(require_writer),
                    db: Session = Depends(get_db)):
    set_alert_cooldown_min(db, cooldown_min)
    return RedirectResponse("/", status_code=303)


# -------------------- RECIPIENTS --------------------
@router.get("/recipients", response_class=HTMLResponse)
def recipients_list(request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    if _is_viewer(user):
        # Viewers see empty recipients list
        rows = []
        groups = []
    else:
        rows = db.query(Recipient).order_by(Recipient.name).all()
        groups = db.query(Group).order_by(Group.name).all()
    return render(request, "recipients.html", user=user, rows=rows, groups=groups)


@router.post("/recipients/create")
def recipient_create(request: Request, name: str = Form(...),
                     phone: str = Form(""), language: str = Form("en"),
                     group_id: int = Form(...),
                     _: None = Depends(verify_csrf),
                     user: User = Depends(require_writer),
                     db: Session = Depends(get_db)):
    db.add(Recipient(name=name.strip(), phone=phone.strip(), whatsapp="",
                     channel="sms", language=language, group_id=group_id,
                     is_active=True))
    db.commit()
    return RedirectResponse("/recipients", status_code=303)


@router.post("/recipients/{rid}/delete")
def recipient_delete(rid: int, _: None = Depends(verify_csrf),
                     user: User = Depends(require_writer),
                     db: Session = Depends(get_db)):
    r = db.get(Recipient, rid)
    if r:
        db.delete(r); db.commit()
    return RedirectResponse("/recipients", status_code=303)


@router.post("/recipients/{rid}/toggle")
def recipient_toggle(rid: int, _: None = Depends(verify_csrf),
                     user: User = Depends(require_writer),
                     db: Session = Depends(get_db)):
    r = db.get(Recipient, rid)
    if r:
        r.is_active = not r.is_active; db.commit()
    return RedirectResponse("/recipients", status_code=303)


# -------------------- GROUPS --------------------
@router.get("/groups", response_class=HTMLResponse)
def groups_list(request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    if _is_viewer(user):
        # Viewers see empty groups list
        rows = []
    else:
        rows = db.query(Group).order_by(Group.name).all()
    return render(request, "groups.html", user=user, rows=rows)


@router.post("/groups/create")
def group_create(name: str = Form(...), description: str = Form(""),
                 distance_threshold_km: int = Form(15),
                 _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer), db: Session = Depends(get_db)):
    db.add(Group(name=name.strip(), description=description.strip(),
                 distance_threshold_km=distance_threshold_km, is_active=True))
    db.commit()
    return RedirectResponse("/groups", status_code=303)


@router.post("/groups/{gid}/update")
def group_update(gid: int, distance_threshold_km: int = Form(...),
                 _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer), db: Session = Depends(get_db)):
    g = db.get(Group, gid)
    if g:
        g.distance_threshold_km = max(1, min(40, int(distance_threshold_km)))
        db.commit()
    return RedirectResponse("/groups", status_code=303)


@router.post("/groups/{gid}/toggle")
def group_toggle(gid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 db: Session = Depends(get_db)):
    g = db.get(Group, gid)
    if g:
        g.is_active = not g.is_active; db.commit()
    return RedirectResponse("/groups", status_code=303)


@router.post("/groups/{gid}/delete")
def group_delete(gid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 db: Session = Depends(get_db)):
    g = db.get(Group, gid)
    if g and not g.recipients:
        db.delete(g); db.commit()
    return RedirectResponse("/groups", status_code=303)


# -------------------- EVENTS --------------------
@router.get("/events", response_class=HTMLResponse)
def events_list(request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    q = db.query(AlertEvent).order_by(AlertEvent.timestamp.desc())
    if _is_viewer(user):
        q = q.filter(~_is_demo_event_expr())
    events = q.limit(200).all()
    return render(request, "events.html", user=user, events=events)


@router.get("/events/{eid}", response_class=HTMLResponse)
def event_detail(eid: int, request: Request, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    event = db.get(AlertEvent, eid)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if _is_viewer(user) and (event.station_id or "").lower().find("demo") != -1:
        raise HTTPException(status_code=404, detail="Event not found")
    msgs = db.query(MessageLog).filter(MessageLog.event_id == eid)\
              .order_by(MessageLog.id).all()
    return render(request, "event_detail.html", user=user, event=event, msgs=msgs)


# -------------------- DELETE EVENTS (admin only) --------------------
@router.post("/events/{eid}/delete")
def event_delete(eid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_admin),
                 db: Session = Depends(get_db)):
    event = db.get(AlertEvent, eid)
    if event:
        # Remove child message-log rows first (works even without DB-level
        # cascade, e.g. SQLite with foreign keys off).
        db.query(MessageLog).filter(MessageLog.event_id == eid)\
          .delete(synchronize_session=False)
        db.delete(event)
        db.commit()
    return RedirectResponse("/events", status_code=303)


@router.post("/events/delete-all")
def events_delete_all(_: None = Depends(verify_csrf),
                      user: User = Depends(require_admin),
                      db: Session = Depends(get_db)):
    db.query(MessageLog).delete(synchronize_session=False)
    db.query(AlertEvent).delete(synchronize_session=False)
    db.commit()
    return RedirectResponse("/events", status_code=303)


# -------------------- TEST ALERT (admin / operator) --------------------
@router.get("/test", response_class=HTMLResponse)
def test_alert_get(request: Request, user: User = Depends(require_writer),
                   db: Session = Depends(get_db)):
    recipients = (db.query(Recipient)
                    .filter(Recipient.is_active == True)  # noqa: E712
                    .order_by(Recipient.name).all())
    return render(request, "test_alert.html", user=user,
                  recipients=recipients, error=None, success=None)


@router.post("/test")
def test_alert_post(request: Request,
                    mode: str = Form("recipients"),
                    station_id: str = Form("TEST"),
                    distance_km: float = Form(1.0),
                    energy: int = Form(50000),
                    number: str = Form(""),
                    _: None = Depends(verify_csrf),
                    user: User = Depends(require_writer),
                    db: Session = Depends(get_db)):
    station = (station_id or "TEST").strip() or "TEST"
    payload = {
        "station_id": station,
        "distance_km": float(distance_km),
        "energy": int(energy),
        "timestamp": now_sast().strftime("%Y-%m-%dT%H:%M:%S+02:00"),
    }

    if mode == "single":
        to = number.strip()
        if not to:
            recipients = (db.query(Recipient)
                            .filter(Recipient.is_active == True)  # noqa: E712
                            .order_by(Recipient.name).all())
            return render(request, "test_alert.html", user=user,
                          recipients=recipients,
                          error="Enter a destination number for a single test.",
                          success=None)
        body = build_lightning_sms(payload)
        event = AlertEvent(station_id=station, distance_km=payload["distance_km"],
                           energy=payload["energy"], timestamp=now_sast(),
                           recipients_targeted=1)
        db.add(event); db.commit(); db.refresh(event)
        row = MessageLog(event_id=event.id, recipient_id=None, channel="sms",
                         to_number=to, body=body, status="queued")
        db.add(row); db.flush()
        try:
            status, sid = clickatell_sender.send_sms(to, body)
            row.status = status
            row.provider_message_id = sid
            event.messages_sent = 1
        except Exception as e:  # noqa: BLE001 - surface provider errors in the log
            row.status = "failed"
            row.error = str(e)[:1000]
            event.messages_failed = 1
        db.commit()
        return RedirectResponse(f"/events/{event.id}", status_code=303)

    # Default: fan out to all eligible recipients via the real production path
    event_id = dispatch_async(payload)
    return RedirectResponse(f"/events/{event_id}", status_code=303)


# -------------------- SETTINGS (admin only) --------------------
@router.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request, user: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    gateway = {
        "clickatell_api_key": bool(settings.CLICKATELL_API_KEY),
        "clickatell_dlr_token": bool(settings.CLICKATELL_DLR_TOKEN),
        "webhook_token": bool(settings.ALERT_WEBHOOK_TOKEN),
    }
    return render(request, "settings.html", user=user, gateway=gateway,
                  alerts_enabled=get_alerts_enabled(db))


# -------------------- USERS (admin only) --------------------
@router.get("/users", response_class=HTMLResponse)
def users_list(request: Request, user: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    rows = db.query(User).order_by(User.email).all()
    return render(request, "users.html", user=user, rows=rows)


@router.post("/users/create")
def users_create(email: str = Form(...), password: str = Form(...),
                 role: str = Form("operator"), _: None = Depends(verify_csrf),
                 user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if role not in ("admin", "operator", "viewer"):
        raise HTTPException(400, "Invalid role")
    email = email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(400, "A valid e-mail address is required")
    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(400,
                            f"Password must be at least {MIN_PASSWORD_LEN} characters")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "A user with that e-mail already exists")
    db.add(User(email=email, password_hash=hash_password(password),
                role=role, is_active=True))
    db.commit()
    return RedirectResponse("/users", status_code=303)


@router.post("/users/{uid}/delete")
def users_delete(uid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_admin),
                 db: Session = Depends(get_db)):
    if uid == user.id:
        raise HTTPException(400, "Cannot delete yourself")
    u = db.get(User, uid)
    if u:
        # Never allow removal of the last remaining admin: that would lock
        # everyone out of Users / Settings / gateway configuration.
        if u.role == "admin":
            admin_count = db.query(User).filter(
                User.role == "admin", User.is_active == True).count()  # noqa: E712
            if admin_count <= 1:
                raise HTTPException(400, "Cannot delete the last admin account")
        db.delete(u); db.commit()
    return RedirectResponse("/users", status_code=303)



