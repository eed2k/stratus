import re
from fastapi import APIRouter, Request, Depends, HTTPException, Form
from fastapi.responses import (RedirectResponse, HTMLResponse, JSONResponse,
                               FileResponse)
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from pathlib import Path
from sqlalchemy import func

from ..db import get_db
from ..config import settings
from ..models import (User, Recipient, Group, AlertEvent, MessageLog,
                      HeartbeatSample, UnitStatus, Tenant)
from ..metrics import (energy_band, distance_band_summary, valid_coords,
                      CPU_WARN_C, CPU_CRIT_C)
from .. import reports as reports_mod
from ..auth import (current_user, current_tenant, require_admin, require_writer,
                    require_platform_admin, tenant_id, hash_password,
                    verify_password)
from ..alert_worker import dispatch_async
from ..messages import build_lightning_sms
from ..runtime import (get_alerts_enabled, set_alerts_enabled, get_units,
                       get_alert_cooldown_min, set_alert_cooldown_min)
from ..timeutil import now_sast
from ..charts import cpu_chart_svg
from ..security import (get_csrf_token, verify_csrf, login_allowed,
                        record_login_failure, reset_login_failures)
from ..tenancy import (url_tenant, base_path, redirect_to, scope, scoped_get,
                       validate_slug, normalize_slug)
from .. import clickatell_sender

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "templates"))

DEMO_MARKERS = ("demo", "test", "sample", "mock")
MIN_PASSWORD_LEN = 10


def _is_viewer(user: User) -> bool:
    return user.role == "viewer"


def _is_demo_event_expr():
    return func.lower(AlertEvent.station_id).like("%demo%")


# Range selector for the CPU chart: label -> hours.
_CPU_RANGE_HOURS = {"24h": 24, "7d": 24 * 7, "30d": 24 * 30}

# Distance rings for the storm-activity display (km) and the outer radius.
_STORM_RINGS_KM = [10, 20, 30, 40]
_STORM_RADIUS_KM = 40


def station_display(unit, request):
    """Resolve a station's display label: site_label, then tenant site_name,
    then the station_id. Used by JSON endpoints and (later) reports."""
    if unit is not None and getattr(unit, "site_label", None):
        return unit.site_label
    urlt = url_tenant(request)
    return (urlt or {}).get("site_name") or settings.SITE_NAME


def _resolve_unit(db, tid, station):
    """The requested station within this tenant, or the tenant's first unit."""
    station = (station or "").strip()
    if station:
        return scoped_get(db, UnitStatus, station, tid)
    return (scope(db.query(UnitStatus), UnitStatus, tid)
            .order_by(UnitStatus.station_id).first())


def render(request, name, **ctx):
    """Render a template with the context every page needs.

    `base` is the current panel's URL prefix ("" on the platform panel,
    "/<slug>" inside a client panel); templates prefix all internal links with
    it so navigation stays inside the panel you are in. `site_name` and the
    signed-in tenant come from the resolved tenant, never a hard-coded name.
    """
    user = ctx.pop("user", None)
    ctx.setdefault("csrf_token", get_csrf_token(request))
    ctx.setdefault("base", base_path(request))
    urlt = url_tenant(request)
    ctx.setdefault("site_name", (urlt or {}).get("site_name") or settings.SITE_NAME)
    ctx.setdefault("tenant_name", (urlt or {}).get("name"))
    ctx.setdefault("is_platform_admin",
                   bool(user is not None and getattr(user, "is_platform_admin", False)))
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

    # Decide which panel this login is allowed into.
    urlt = url_tenant(request)
    url_tid = urlt["id"] if urlt else None
    if u.is_platform_admin:
        # Platform staff may sign in on any panel; effective tenant follows URL.
        tid = url_tid if url_tid is not None else u.tenant_id
    else:
        # A client login only works on its own panel. Signing in at the wrong
        # slug is refused without revealing whether that slug exists.
        if url_tid is not None and url_tid != u.tenant_id:
            record_login_failure(request)
            return render(request, "login.html", error="Invalid credentials")
        tid = u.tenant_id
    if tid is None:
        record_login_failure(request)
        return render(request, "login.html", error="Invalid credentials")

    # Successful login: rotate the session to defeat fixation, then set identity.
    reset_login_failures(request)
    request.session.clear()
    request.session["uid"] = u.id
    request.session["tid"] = tid

    # Land inside the tenant that was authenticated. A client who signed in on
    # the root panel is sent to their own slug rather than the platform panel.
    dest = base_path(request) or "/"
    if url_tid is None and not u.is_platform_admin:
        t = db.get(Tenant, tid)
        if t is not None:
            dest = f"/{t.slug}/"
    return RedirectResponse(dest, status_code=303)


@router.get("/logout")
def logout(request: Request):
    base = base_path(request)
    request.session.clear()
    return RedirectResponse(f"{base}/login", status_code=303)


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
    if len(new_password) < MIN_PASSWORD_LEN:
        return render(request, "change_password.html", user=user,
                      error=f"New password must be at least {MIN_PASSWORD_LEN} characters.",
                      success=None)
    if verify_password(new_password, user.password_hash):
        return render(request, "change_password.html", user=user,
                      error="New password must differ from the current one.", success=None)
    u = db.get(User, user.id)
    u.password_hash = hash_password(new_password)
    db.commit()
    return render(request, "change_password.html", user=user,
                  error=None, success="Password updated.")


# -------------------- DASHBOARD --------------------
@router.get("/", response_class=HTMLResponse)
def dashboard(request: Request, user: User = Depends(current_user),
              tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    # A platform admin on the unprefixed panel gets the management console, not a
    # detector dashboard: a detector belongs to exactly one client and is
    # operated from that client's own panel. Their navigation has no Dashboard
    # entry, so landing here after login would otherwise be a dead end.
    # Client logins are unaffected, and so is a platform admin who has entered a
    # client's panel at /<slug>/.
    if user.is_platform_admin and not base_path(request):
        return RedirectResponse("/tenants", status_code=303)

    events_query = scope(db.query(AlertEvent), AlertEvent, tid)\
        .order_by(AlertEvent.timestamp.desc())
    if _is_viewer(user):
        events_query = events_query.filter(~_is_demo_event_expr())
    events = events_query.limit(25).all()
    counts = {
        "recipients": scope(db.query(Recipient), Recipient, tid)
                        .filter(Recipient.is_active == True).count(),  # noqa: E712
        "groups":     scope(db.query(Group), Group, tid)
                        .filter(Group.is_active == True).count(),      # noqa: E712
        "events_24h": scope(db.query(AlertEvent), AlertEvent, tid).count(),
    }
    units = get_units(db, settings.UNIT_ACTIVE_THRESHOLD_MIN * 60, tenant_id=tid)
    # Build a 24h CPU trend chart (inline SVG) for each unit.
    from datetime import timedelta
    cutoff = now_sast() - timedelta(hours=24)
    unit_charts = {}
    for u, _active, _age in units:
        samples = (scope(db.query(HeartbeatSample), HeartbeatSample, tid)
                     .filter(HeartbeatSample.station_id == u.station_id,
                             HeartbeatSample.ts >= cutoff)
                     .order_by(HeartbeatSample.ts.asc())
                     .all())
        unit_charts[u.station_id] = cpu_chart_svg(samples, hours=24)
    return render(request, "dashboard.html", user=user, events=events,
                  counts=counts, alerts_enabled=get_alerts_enabled(db, tenant_id=tid),
                  units=units, unit_charts=unit_charts,
                  alert_cooldown_min=get_alert_cooldown_min(db, tenant_id=tid))


# -------------------- DASHBOARD DATA (JSON, tenant-scoped) --------------------
@router.get("/data/cpu")
def data_cpu(request: Request, station: str = "", range: str = "24h",
             user: User = Depends(current_user),
             tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    """CPU temperature/load time-series for the interactive chart.

    Tenant-scoped: only telemetry for a unit owned by the current panel is
    returned. The response always carries the WARN/CRIT reference lines so the
    chart can draw them even before data arrives.
    """
    from datetime import timedelta
    unit = _resolve_unit(db, tid, station)
    payload = {"station": unit.station_id if unit else None,
               "site": station_display(unit, request),
               "warn": CPU_WARN_C, "crit": CPU_CRIT_C, "points": []}
    if unit is None:
        return JSONResponse(payload)
    hours = _CPU_RANGE_HOURS.get(range, 24)
    cutoff = now_sast() - timedelta(hours=hours)
    rows = (scope(db.query(HeartbeatSample), HeartbeatSample, tid)
              .filter(HeartbeatSample.station_id == unit.station_id,
                      HeartbeatSample.ts >= cutoff)
              .order_by(HeartbeatSample.ts.asc()).all())
    payload["points"] = [
        {"t": s.ts.isoformat(), "temp": s.cpu_temp_c, "load": s.cpu_load_pct}
        for s in rows
    ]
    return JSONResponse(payload)


@router.get("/data/strikes")
def data_strikes(request: Request, station: str = "", window: int = 1440,
                 user: User = Depends(current_user),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    """Recent in-range strikes for the storm-activity display.

    Grouped by distance only (the sensor does not measure bearing), into the
    five proximity bands defined in metrics.DISTANCE_BANDS. The aggregation is
    done here rather than in the browser so the dashboard and the PDF report
    are computed by the same function and cannot disagree.

    `strikes` is still returned for the plain-table fallback and for tooltips.
    """
    from datetime import timedelta
    try:
        window = max(1, min(int(window), 60 * 24 * 7))  # cap at 7 days
    except (TypeError, ValueError):
        window = 1440
    cutoff = now_sast() - timedelta(minutes=window)
    q = scope(db.query(AlertEvent), AlertEvent, tid)\
        .filter(AlertEvent.timestamp >= cutoff)
    station = (station or "").strip()
    if station:
        q = q.filter(AlertEvent.station_id == station)
    if _is_viewer(user):
        q = q.filter(~_is_demo_event_expr())
    rows = q.order_by(AlertEvent.timestamp.desc()).limit(300).all()
    strikes = []
    for e in rows:
        band = energy_band(e.energy)
        strikes.append({
            "t": e.timestamp.isoformat(),
            "distance_km": e.distance_km,
            "energy": e.energy,
            "band": band["name"],
            "colour": band["colour"],
        })
    summary = distance_band_summary(strikes)
    return JSONResponse({"radius_km": _STORM_RADIUS_KM, "rings": _STORM_RINGS_KM,
                         "bearing_measured": False, "window_min": window,
                         "bands": summary["bands"], "total": summary["total"],
                         "unplaced": summary["unplaced"],
                         "strikes": strikes})


# -------------------- STATION METADATA (admin / operator) --------------------
@router.get("/stations", response_class=HTMLResponse)
def stations_list(request: Request, user: User = Depends(require_writer),
                  tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    units = (scope(db.query(UnitStatus), UnitStatus, tid)
             .order_by(UnitStatus.station_id).all())
    return render(request, "stations.html", user=user, units=units,
                  error=None, success=None)


@router.post("/stations/{station_id}/update")
def station_update(request: Request, station_id: str,
                   site_label: str = Form(""), latitude: str = Form(""),
                   longitude: str = Form(""), _: None = Depends(verify_csrf),
                   user: User = Depends(require_writer),
                   tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    unit = scoped_get(db, UnitStatus, station_id, tid)
    if unit is None:
        raise HTTPException(status_code=404, detail="Unknown station")

    def _reload(error=None, success=None):
        units = (scope(db.query(UnitStatus), UnitStatus, tid)
                 .order_by(UnitStatus.station_id).all())
        return render(request, "stations.html", user=user, units=units,
                      error=error, success=success)

    lat_s = (latitude or "").strip()
    lon_s = (longitude or "").strip()
    if not lat_s and not lon_s:
        # Both blank clears the coordinates.
        unit.latitude = None
        unit.longitude = None
    elif not (lat_s and lon_s) or not valid_coords(lat_s, lon_s):
        return _reload(error=(f"Invalid coordinates for {station_id}. "
                              "Enter both latitude (-90 to 90) and longitude "
                              "(-180 to 180)."))
    else:
        unit.latitude = float(lat_s)
        unit.longitude = float(lon_s)

    unit.site_label = (site_label or "").strip() or None
    db.commit()
    return _reload(success=f"Saved metadata for {station_id}.")


# -------------------- REPORTS (list / generate / download) --------------------
_REPORTS_ROOT = Path("data/reports")
_SAFE_PATH = re.compile(r"[^A-Za-z0-9_.-]")


def _report_path(tenant_slug, station_id, year, month, rtype):
    """Filesystem cache path for a report, built only from validated inputs."""
    slug = _SAFE_PATH.sub("_", tenant_slug or "tenant")
    station = _SAFE_PATH.sub("_", station_id or "station")
    fname = f"{year:04d}-{month:02d}-{rtype}.pdf"
    return _REPORTS_ROOT / slug / station / fname


def _available_months(db, tid):
    """Distinct year-months (desc) that have telemetry or events, plus now."""
    from datetime import datetime
    ym = set()
    for (ts,) in scope(db.query(HeartbeatSample.ts), HeartbeatSample, tid).all():
        if ts:
            ym.add((ts.year, ts.month))
    for (ts,) in scope(db.query(AlertEvent.timestamp), AlertEvent, tid).all():
        if ts:
            ym.add((ts.year, ts.month))
    now = now_sast()
    ym.add((now.year, now.month))
    out = sorted(ym, reverse=True)
    return [{"year": y, "month": m, "value": f"{y:04d}-{m:02d}",
             "label": datetime(y, m, 1).strftime("%B %Y")} for (y, m) in out]


@router.get("/reports", response_class=HTMLResponse)
def reports_list(request: Request, user: User = Depends(current_user),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    units = (scope(db.query(UnitStatus), UnitStatus, tid)
             .order_by(UnitStatus.station_id).all())
    if _is_viewer(user):
        units = [u for u in units if "demo" not in (u.station_id or "").lower()]
    return render(request, "reports.html", user=user, units=units,
                  months=_available_months(db, tid),
                  report_types=reports_mod.REPORT_TYPES,
                  can_generate=user.role in ("admin", "operator"),
                  error=None, success=None)


@router.post("/reports/generate")
def reports_generate(request: Request, station_id: str = Form(...),
                     month: str = Form(...), report_type: str = Form(...),
                     _: None = Depends(verify_csrf),
                     user: User = Depends(require_writer),
                     tid: int = Depends(tenant_id),
                     tenant: Tenant = Depends(current_tenant),
                     db: Session = Depends(get_db)):
    if report_type not in reports_mod.REPORT_TYPES:
        raise HTTPException(status_code=400, detail="Unknown report type")
    if scoped_get(db, UnitStatus, station_id, tid) is None:
        raise HTTPException(status_code=404, detail="Unknown station")
    try:
        year, mo = reports_mod.parse_month(month)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid month")
    pdf = reports_mod.build_report(db, tenant, station_id, year, mo, report_type)
    path = _report_path(tenant.slug, station_id, year, mo, report_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pdf)
    return RedirectResponse(
        redirect_to(request, f"/reports/download?station={station_id}"
                             f"&month={year:04d}-{mo:02d}&type={report_type}"),
        status_code=303)


@router.get("/reports/download")
def reports_download(request: Request, station: str, month: str,
                     type: str = "technical",
                     user: User = Depends(current_user),
                     tid: int = Depends(tenant_id),
                     tenant: Tenant = Depends(current_tenant),
                     db: Session = Depends(get_db)):
    if type not in reports_mod.REPORT_TYPES:
        raise HTTPException(status_code=404, detail="Not found")
    if _is_viewer(user) and "demo" in (station or "").lower():
        raise HTTPException(status_code=404, detail="Not found")
    if scoped_get(db, UnitStatus, station, tid) is None:
        raise HTTPException(status_code=404, detail="Unknown station")
    try:
        year, mo = reports_mod.parse_month(month)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")
    path = _report_path(tenant.slug, station, year, mo, type)
    if not path.exists():
        pdf = reports_mod.build_report(db, tenant, station, year, mo, type)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(pdf)
    return FileResponse(str(path), media_type="application/pdf",
                        filename=f"{station}-{year:04d}-{mo:02d}-{type}.pdf")


# -------------------- ALERTS MASTER SWITCH --------------------
@router.post("/alerts/toggle")
def alerts_toggle(request: Request, enabled: str = Form(...),
                  _: None = Depends(verify_csrf),
                  user: User = Depends(require_writer),
                  tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    set_alerts_enabled(db, enabled == "on", tenant_id=tid)
    return RedirectResponse(redirect_to(request, "/"), status_code=303)


@router.post("/alerts/cooldown")
def alerts_cooldown(request: Request, cooldown_min: int = Form(...),
                    _: None = Depends(verify_csrf),
                    user: User = Depends(require_writer),
                    tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    set_alert_cooldown_min(db, cooldown_min, tenant_id=tid)
    return RedirectResponse(redirect_to(request, "/"), status_code=303)


# -------------------- RECIPIENTS --------------------
@router.get("/recipients", response_class=HTMLResponse)
def recipients_list(request: Request, user: User = Depends(current_user),
                    tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    if _is_viewer(user):
        rows, groups = [], []
    else:
        rows = scope(db.query(Recipient), Recipient, tid)\
            .order_by(Recipient.name).all()
        groups = scope(db.query(Group), Group, tid).order_by(Group.name).all()
    return render(request, "recipients.html", user=user, rows=rows, groups=groups)


@router.post("/recipients/create")
def recipient_create(request: Request, name: str = Form(...),
                     phone: str = Form(""), language: str = Form("en"),
                     group_id: int = Form(...),
                     _: None = Depends(verify_csrf),
                     user: User = Depends(require_writer),
                     tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    # The group must belong to this tenant; otherwise a crafted form could
    # attach a recipient to another client's group.
    if scoped_get(db, Group, group_id, tid) is None:
        raise HTTPException(400, "Unknown group")
    db.add(Recipient(tenant_id=tid, name=name.strip(), phone=phone.strip(),
                     whatsapp="", channel="sms", language=language,
                     group_id=group_id, is_active=True))
    db.commit()
    return RedirectResponse(redirect_to(request, "/recipients"), status_code=303)


@router.post("/recipients/{rid}/delete")
def recipient_delete(request: Request, rid: int, _: None = Depends(verify_csrf),
                     user: User = Depends(require_writer),
                     tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    r = scoped_get(db, Recipient, rid, tid)
    if r:
        db.delete(r); db.commit()
    return RedirectResponse(redirect_to(request, "/recipients"), status_code=303)


@router.post("/recipients/{rid}/toggle")
def recipient_toggle(request: Request, rid: int, _: None = Depends(verify_csrf),
                     user: User = Depends(require_writer),
                     tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    r = scoped_get(db, Recipient, rid, tid)
    if r:
        r.is_active = not r.is_active; db.commit()
    return RedirectResponse(redirect_to(request, "/recipients"), status_code=303)


# -------------------- GROUPS --------------------
@router.get("/groups", response_class=HTMLResponse)
def groups_list(request: Request, user: User = Depends(current_user),
                tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    rows = [] if _is_viewer(user) else \
        scope(db.query(Group), Group, tid).order_by(Group.name).all()
    return render(request, "groups.html", user=user, rows=rows)


@router.post("/groups/create")
def group_create(request: Request, name: str = Form(...), description: str = Form(""),
                 distance_threshold_km: int = Form(15),
                 _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    db.add(Group(tenant_id=tid, name=name.strip(), description=description.strip(),
                 distance_threshold_km=distance_threshold_km, is_active=True))
    db.commit()
    return RedirectResponse(redirect_to(request, "/groups"), status_code=303)


@router.post("/groups/{gid}/update")
def group_update(request: Request, gid: int, distance_threshold_km: int = Form(...),
                 _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    g = scoped_get(db, Group, gid, tid)
    if g:
        g.distance_threshold_km = max(1, min(40, int(distance_threshold_km)))
        db.commit()
    return RedirectResponse(redirect_to(request, "/groups"), status_code=303)


@router.post("/groups/{gid}/toggle")
def group_toggle(request: Request, gid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    g = scoped_get(db, Group, gid, tid)
    if g:
        g.is_active = not g.is_active; db.commit()
    return RedirectResponse(redirect_to(request, "/groups"), status_code=303)


@router.post("/groups/{gid}/delete")
def group_delete(request: Request, gid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    g = scoped_get(db, Group, gid, tid)
    if g and not g.recipients:
        db.delete(g); db.commit()
    return RedirectResponse(redirect_to(request, "/groups"), status_code=303)


# -------------------- EVENTS --------------------
@router.get("/events", response_class=HTMLResponse)
def events_list(request: Request, user: User = Depends(current_user),
                tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    q = scope(db.query(AlertEvent), AlertEvent, tid)\
        .order_by(AlertEvent.timestamp.desc())
    if _is_viewer(user):
        q = q.filter(~_is_demo_event_expr())
    events = q.limit(200).all()
    return render(request, "events.html", user=user, events=events)


@router.get("/events/{eid}", response_class=HTMLResponse)
def event_detail(request: Request, eid: int, user: User = Depends(current_user),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    event = scoped_get(db, AlertEvent, eid, tid)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if _is_viewer(user) and (event.station_id or "").lower().find("demo") != -1:
        raise HTTPException(status_code=404, detail="Event not found")
    msgs = db.query(MessageLog).filter(MessageLog.event_id == eid)\
              .order_by(MessageLog.id).all()
    return render(request, "event_detail.html", user=user, event=event, msgs=msgs)


# -------------------- DELETE EVENTS (admin only) --------------------
@router.post("/events/{eid}/delete")
def event_delete(request: Request, eid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_admin),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    event = scoped_get(db, AlertEvent, eid, tid)
    if event:
        db.query(MessageLog).filter(MessageLog.event_id == eid)\
          .delete(synchronize_session=False)
        db.delete(event)
        db.commit()
    return RedirectResponse(redirect_to(request, "/events"), status_code=303)


@router.post("/events/delete-all")
def events_delete_all(request: Request, _: None = Depends(verify_csrf),
                      user: User = Depends(require_admin),
                      tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    # Only this tenant's events (and their message logs) are cleared.
    ids = [e.id for e in scope(db.query(AlertEvent.id), AlertEvent, tid).all()]
    if ids:
        db.query(MessageLog).filter(MessageLog.event_id.in_(ids))\
          .delete(synchronize_session=False)
        scope(db.query(AlertEvent), AlertEvent, tid)\
          .delete(synchronize_session=False)
        db.commit()
    return RedirectResponse(redirect_to(request, "/events"), status_code=303)


# -------------------- TEST ALERT (admin / operator) --------------------
@router.get("/test", response_class=HTMLResponse)
def test_alert_get(request: Request, user: User = Depends(require_writer),
                   tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    recipients = (scope(db.query(Recipient), Recipient, tid)
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
                    tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
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
            recipients = (scope(db.query(Recipient), Recipient, tid)
                            .filter(Recipient.is_active == True)  # noqa: E712
                            .order_by(Recipient.name).all())
            return render(request, "test_alert.html", user=user,
                          recipients=recipients,
                          error="Enter a destination number for a single test.",
                          success=None)
        body = build_lightning_sms(payload)
        event = AlertEvent(tenant_id=tid,
                           station_id=station, distance_km=payload["distance_km"],
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
        return RedirectResponse(redirect_to(request, f"/events/{event.id}"),
                                status_code=303)

    # Default: fan out to all eligible recipients via the real production path.
    # The tenant is taken from the signed-in operator rather than the test
    # station_id, which usually has no detector record to map from.
    event_id = dispatch_async(payload, tenant_id=tid)
    return RedirectResponse(redirect_to(request, f"/events/{event_id}"),
                            status_code=303)


# -------------------- SETTINGS (admin only) --------------------
@router.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request, user: User = Depends(require_admin),
                  tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    gateway = {
        "clickatell_api_key": bool(settings.CLICKATELL_API_KEY),
        "clickatell_dlr_token": bool(settings.CLICKATELL_DLR_TOKEN),
        "webhook_token": bool(settings.ALERT_WEBHOOK_TOKEN),
    }
    return render(request, "settings.html", user=user, gateway=gateway,
                  alerts_enabled=get_alerts_enabled(db, tenant_id=tid))


# -------------------- USERS (admin only) --------------------
@router.get("/users", response_class=HTMLResponse)
def users_list(request: Request, user: User = Depends(require_admin),
               tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    # A client admin sees only their own panel's logins. Platform staff inside a
    # tenant see that tenant's logins.
    rows = scope(db.query(User), User, tid).order_by(User.email).all()
    return render(request, "users.html", user=user, rows=rows)


@router.post("/users/create")
def users_create(request: Request, email: str = Form(...), password: str = Form(...),
                 role: str = Form("operator"), _: None = Depends(verify_csrf),
                 user: User = Depends(require_admin),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    if role not in ("admin", "operator", "viewer"):
        raise HTTPException(400, "Invalid role")
    email = email.strip().lower()
    if "@" not in email or len(email) < 5:
        raise HTTPException(400, "A valid e-mail address is required")
    if len(password) < MIN_PASSWORD_LEN:
        raise HTTPException(400,
                            f"Password must be at least {MIN_PASSWORD_LEN} characters")
    # E-mail is globally unique (login is by e-mail alone), so this check is not
    # scoped to the tenant.
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "A user with that e-mail already exists")
    # New logins belong to the current tenant and are never platform admins:
    # only the seeded Stratus admin holds cross-tenant reach.
    db.add(User(email=email, password_hash=hash_password(password),
                role=role, is_active=True, tenant_id=tid, is_platform_admin=False))
    db.commit()
    return RedirectResponse(redirect_to(request, "/users"), status_code=303)


@router.post("/users/{uid}/delete")
def users_delete(request: Request, uid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_admin),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    if uid == user.id:
        raise HTTPException(400, "Cannot delete yourself")
    u = scoped_get(db, User, uid, tid)
    if u:
        # Never allow removal of the last remaining admin in a panel: that would
        # lock everyone out of Users / Settings for that client.
        if u.role == "admin":
            admin_count = scope(db.query(User), User, tid).filter(
                User.role == "admin", User.is_active == True).count()  # noqa: E712
            if admin_count <= 1:
                raise HTTPException(400, "Cannot delete the last admin account")
        db.delete(u); db.commit()
    return RedirectResponse(redirect_to(request, "/users"), status_code=303)


# ==================== CLIENT PANELS (platform admins only) ====================
# Stratus staff create and open per-client panels here. A client never sees
# these routes: require_platform_admin 404s for anyone else, and the middleware
# only exposes them on the platform panel (no slug prefix).
@router.get("/tenants", response_class=HTMLResponse)
def tenants_list(request: Request, user: User = Depends(require_platform_admin),
                 db: Session = Depends(get_db)):
    # The platform tenant is not a client, so it does not belong in the client
    # list. Its panel is the unprefixed one you are already signed in to, which
    # made the "Open panel" link here point at /<platform-slug>/ and read as if
    # Stratus were one of its own customers.
    tenants = (db.query(Tenant)
                 .filter(Tenant.slug != settings.PLATFORM_TENANT_SLUG)
                 .order_by(Tenant.name).all())
    rows = []
    for t in tenants:
        rows.append({
            "t": t,
            "users": db.query(User).filter(User.tenant_id == t.id).count(),
            "recipients": db.query(Recipient).filter(Recipient.tenant_id == t.id).count(),
            "units": db.query(func.count()).select_from(AlertEvent)
                       .filter(AlertEvent.tenant_id == t.id).scalar() or 0,
            "url": f"/{t.slug}/",
        })
    return render(request, "tenants.html", user=user, rows=rows,
                  platform_slug=settings.PLATFORM_TENANT_SLUG, error=None)


@router.post("/tenants/create")
def tenant_create(request: Request, name: str = Form(...), slug: str = Form(...),
                  admin_email: str = Form(...), admin_password: str = Form(...),
                  site_name: str = Form(""), _: None = Depends(verify_csrf),
                  user: User = Depends(require_platform_admin),
                  db: Session = Depends(get_db)):
    def back(err):
        # Same exclusion as tenants_list, so a validation error does not make
        # the platform tenant reappear in the client list.
        tenants = (db.query(Tenant)
                     .filter(Tenant.slug != settings.PLATFORM_TENANT_SLUG)
                     .order_by(Tenant.name).all())
        rows = [{"t": t, "users": 0, "recipients": 0, "units": 0,
                 "url": f"/{t.slug}/"} for t in tenants]
        return render(request, "tenants.html", user=user, rows=rows,
                      platform_slug=settings.PLATFORM_TENANT_SLUG, error=err)

    slug = validate_slug(slug)   # raises 400 with a readable message if bad
    if db.query(Tenant).filter(Tenant.slug == slug).first():
        return back(f"A panel with the address '{slug}' already exists.")
    admin_email = admin_email.strip().lower()
    if "@" not in admin_email or len(admin_email) < 5:
        return back("Enter a valid client admin e-mail.")
    if db.query(User).filter(User.email == admin_email).first():
        return back("That admin e-mail is already in use.")
    if len(admin_password) < MIN_PASSWORD_LEN:
        return back(f"Admin password must be at least {MIN_PASSWORD_LEN} characters.")

    t = Tenant(slug=slug, name=name.strip() or slug,
               site_name=(site_name.strip() or name.strip() or slug),
               is_active=True)
    db.add(t); db.commit(); db.refresh(t)
    # Seed the client's own admin and a default recipient group.
    db.add(User(email=admin_email, password_hash=hash_password(admin_password),
                role="admin", is_active=True, tenant_id=t.id,
                is_platform_admin=False))
    db.add(Group(tenant_id=t.id, name="default",
                 description="Default recipient group",
                 distance_threshold_km=15, is_active=True))
    db.commit()
    return RedirectResponse(redirect_to(request, "/tenants"), status_code=303)


@router.post("/tenants/{tenant_pk}/toggle")
def tenant_toggle(request: Request, tenant_pk: int, _: None = Depends(verify_csrf),
                  user: User = Depends(require_platform_admin),
                  db: Session = Depends(get_db)):
    t = db.get(Tenant, tenant_pk)
    # The platform tenant is the home panel and can never be switched off.
    if t and t.slug != settings.PLATFORM_TENANT_SLUG:
        t.is_active = not t.is_active
        db.commit()
    return RedirectResponse(redirect_to(request, "/tenants"), status_code=303)
