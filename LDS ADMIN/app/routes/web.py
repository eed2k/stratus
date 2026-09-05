import re
import logging

from fastapi import APIRouter, Request, Depends, HTTPException, Form
from fastapi.responses import (RedirectResponse, HTMLResponse, JSONResponse,
                               FileResponse)
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from pathlib import Path
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ..db import get_db
from ..config import settings
from ..models import (User, Recipient, Group, AlertEvent, MessageLog,
                      HeartbeatSample, UnitStatus, Tenant, CalibrationEvent,
                      AlertStage, Setting)
from ..bootstrap import platform_tenant_id
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
from .. import sms_gateway

log = logging.getLogger("web")

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
    # Status-bar indicator. Whether the gateway is usable, never which gateway.
    ctx.setdefault("gateway_ready", bool(settings.sms_api_key))
    return templates.TemplateResponse(name, {"request": request, "user": user, **ctx})


# -------------------- AUTH --------------------
@router.get("/login", response_class=HTMLResponse)
def login_get(request: Request, expired: str = ""):
    # expired=1 is set by the CSRF error handler in main.py, so a session that
    # timed out explains itself here rather than as a raw 403 body.
    error = ("Your session expired, so that action was not carried out. "
             "Please sign in again and retry.") if expired else None
    return render(request, "login.html", error=error)


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
        # Stratus Admin may sign in on any panel; effective tenant follows URL.
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

    return RedirectResponse(_login_destination(db, request, u, url_tid),
                            status_code=303)


def _login_destination(db, request, user, url_tid) -> str:
    """Where a successful sign-in lands.

    Stratus Admin on the unprefixed panel go straight to the client list: their
    job is managing panels, and it is the only page their navigation offers, so
    anywhere else is a detour. A platform admin who signed in at a specific
    client's address stays in that client's panel.

    A client always ends up inside their own panel, whichever login page they
    used.
    """
    if user.is_platform_admin:
        return base_path(request) or "/tenants"
    if url_tid is not None:
        return base_path(request) or "/"
    t = db.get(Tenant, user.tenant_id)
    return f"/{t.slug}/" if t is not None else "/"


# -------------------- CLIENT SIGN-IN --------------------
# A separate front door for clients, at /client.
#
# The main /login page asks for an e-mail address, which is the right thing for
# Stratus Admin but wrong for a site: the people who use a client panel know
# their installation as "GWLD1", not as an e-mail address, and a shared site
# login is usually not attached to one person's mailbox at all.
#
# This route is authentication only. It deliberately does NOT depend on
# current_user, because current_user refuses a client login on any unprefixed
# path by design - that refusal is what stops one client reading another's panel,
# and it must stay. So /client verifies the credentials, then redirects into the
# client's own panel where the normal tenant binding takes over.
@router.get("/client", response_class=HTMLResponse)
def client_login_get(request: Request, expired: str = ""):
    # Only ever served on the platform panel. Inside a client panel the tenant is
    # already known, so the normal login page is the right one.
    if base_path(request):
        return RedirectResponse(redirect_to(request, "/login"), status_code=303)
    # expired=1 is set by the CSRF error handler in main.py.
    error = ("Your session expired, so that action was not carried out. "
             "Please sign in again and retry.") if expired else None
    return render(request, "client_login.html", error=error)


@router.post("/client")
def client_login_post(request: Request, username: str = Form(...),
                      password: str = Form(...),
                      _: None = Depends(verify_csrf),
                      db: Session = Depends(get_db)):
    if base_path(request):
        return RedirectResponse(redirect_to(request, "/login"), status_code=303)
    if not login_allowed(request):
        return render(request, "client_login.html",
                      error="Too many failed attempts. Try again later.")

    identifier = (username or "").strip()
    if not identifier:
        record_login_failure(request)
        return render(request, "client_login.html", error="Invalid credentials")

    # Accept either the site's sign-in name or an e-mail address, so a client
    # admin who already knows their e-mail is not turned away from the door they
    # were pointed at. Both are matched case-insensitively.
    lowered = identifier.lower()
    u = (db.query(User)
         .filter(func.lower(User.username) == lowered,
                 User.is_active == True)  # noqa: E712
         .first())
    if u is None and "@" in identifier:
        u = (db.query(User)
             .filter(func.lower(User.email) == lowered,
                     User.is_active == True)  # noqa: E712
             .first())

    # One failure message for every rejection below, so this page cannot be used
    # to discover which site names exist.
    if u is None or not verify_password(password, u.password_hash):
        record_login_failure(request)
        return render(request, "client_login.html", error="Invalid credentials")

    # This is the client door. Stratus Admin have their own, and letting a
    # platform admin in here would land them on a client panel with cross-tenant
    # reach from a page that is not meant to grant it.
    if u.is_platform_admin:
        return render(request, "client_login.html",
                      error="Use the staff sign-in page for this account.")

    if u.tenant_id is None:
        record_login_failure(request)
        return render(request, "client_login.html", error="Invalid credentials")
    t = db.get(Tenant, u.tenant_id)
    if t is None or not t.is_active:
        # A disabled panel must not be reachable, and saying so would confirm it
        # exists.
        record_login_failure(request)
        return render(request, "client_login.html", error="Invalid credentials")

    reset_login_failures(request)
    request.session.clear()
    request.session["uid"] = u.id
    request.session["tid"] = u.tenant_id
    return RedirectResponse(f"/{t.slug}/", status_code=303)


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
            "color": band["color"],
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
                   longitude: str = Form(""), altitude_m: str = Form(""),
                   _: None = Depends(verify_csrf),
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

    # Altitude is independent of the coordinate pair: a site can have a surveyed
    # elevation without coordinates, and clearing one must not clear the other.
    alt_s = (altitude_m or "").strip()
    if not alt_s:
        unit.altitude_m = None
    else:
        try:
            alt = float(alt_s)
        except ValueError:
            return _reload(error=(f"Invalid altitude for {station_id}. "
                                  "Enter meters above mean sea level, or leave "
                                  "it blank."))
        # Reject NaN, infinities and physically impossible elevations. The bounds
        # span the Dead Sea shore to well above Everest, which is generous for a
        # lightning detector but catches a transposed coordinate typed into the
        # wrong box.
        if alt != alt or alt in (float("inf"), float("-inf")) \
                or not -500.0 <= alt <= 9000.0:
            return _reload(error=(f"Altitude for {station_id} must be between "
                                  "-500 and 9000 meters."))
        unit.altitude_m = alt

    unit.site_label = (site_label or "").strip() or None
    db.commit()
    return _reload(success=f"Saved metadata for {station_id}.")


# -------------------- REPORTS (list / generate / download) --------------------
_REPORTS_ROOT = Path("data/reports")
_SAFE_PATH = re.compile(r"[^A-Za-z0-9_.-]")


def _report_path(tenant_slug, station_id, year, month, rtype):
    """Filesystem cache path for a report, built only from validated inputs.

    The filename carries reports.FORMAT_VERSION, a hash of the report templates
    and renderers. Without it the cache key said nothing about layout, so a
    template change left every already-generated PDF serving the old design
    forever. Including it means a deploy that changes the look of a report
    invalidates its cached copies automatically.
    """
    slug = _SAFE_PATH.sub("_", tenant_slug or "tenant")
    station = _SAFE_PATH.sub("_", station_id or "station")
    ver = _SAFE_PATH.sub("_", reports_mod.FORMAT_VERSION)
    fname = f"{year:04d}-{month:02d}-{rtype}-{ver}.pdf"
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
    # Calibration months count too. Without this a month whose only activity was
    # calibration was not offered, which would have made the calibration report
    # unreachable for exactly the periods it is about.
    for (ts,) in scope(db.query(CalibrationEvent.ts), CalibrationEvent, tid).all():
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
                  report_labels=reports_mod.REPORT_LABELS,
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
    def _reload(error=None):
        rows = [] if _is_viewer(user) else \
            scope(db.query(Recipient), Recipient, tid).order_by(Recipient.name).all()
        groups = scope(db.query(Group), Group, tid).order_by(Group.name).all()
        return render(request, "recipients.html", user=user, rows=rows,
                      groups=groups, error=error)

    # The group must belong to this tenant; otherwise a crafted form could
    # attach a recipient to another client's group.
    if scoped_get(db, Group, group_id, tid) is None:
        raise HTTPException(400, "Unknown group")
    name = (name or "").strip()
    if not name:
        return _reload(error="Enter a name for the recipient.")
    db.add(Recipient(tenant_id=tid, name=name, phone=phone.strip(),
                     whatsapp="", channel="sms", language=language,
                     group_id=group_id, is_active=True))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        log.exception("recipient_create failed for tenant=%s name=%r", tid, name)
        return _reload(error=f"Could not save '{name}'. It conflicts with an "
                             "existing recipient.")
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
    def _reload(error=None):
        rows = [] if _is_viewer(user) else \
            scope(db.query(Group), Group, tid).order_by(Group.name).all()
        return render(request, "groups.html", user=user, rows=rows, error=error)

    name = (name or "").strip()
    if not name:
        return _reload(error="Enter a name for the group.")
    # Names are unique per tenant, not globally: two clients may each have a
    # "control room". Checked here rather than left to the database, because the
    # models deliberately declare no constraint for it.
    existing = (scope(db.query(Group), Group, tid)
                .filter(func.lower(Group.name) == name.lower()).first())
    if existing is not None:
        return _reload(error=f"A group called '{name}' already exists.")
    try:
        threshold = max(1, min(40, int(distance_threshold_km)))
    except (TypeError, ValueError):
        return _reload(error="Alert distance must be a whole number of kilometers.")

    db.add(Group(tenant_id=tid, name=name, description=description.strip(),
                 distance_threshold_km=threshold, is_active=True))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        log.exception("group_create failed for tenant=%s name=%r", tid, name)
        return _reload(error=f"Could not save the group '{name}'. "
                             "It conflicts with existing data.")
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


# -------------------- ALERT STAGES --------------------
# A client's escalation plan: which distance bands raise an alert, what each is
# called, and who it goes to. Managed by the client's own admin or operator.
_STAGE_MAX_KM = 40
_STAGE_PRESET = [("Advisory", 30), ("Warning", 20), ("Stop work", 10)]


def _stages_ctx(db, user, tid, error=None, success=None):
    """Context for the stages page. Stages read nearest-first, like the plan."""
    rows = [] if _is_viewer(user) else \
        (scope(db.query(AlertStage), AlertStage, tid)
         .order_by(AlertStage.distance_km.asc()).all())
    groups = scope(db.query(Group), Group, tid).order_by(Group.name).all()
    return {"user": user, "rows": rows, "groups": groups,
            "max_km": _STAGE_MAX_KM, "error": error, "success": success,
            "cooldown_default": get_alert_cooldown_min(db, tenant_id=tid)}


@router.get("/stages", response_class=HTMLResponse)
def stages_list(request: Request, user: User = Depends(current_user),
                tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    return render(request, "stages.html", **_stages_ctx(db, user, tid))


@router.post("/stages/create")
def stage_create(request: Request, name: str = Form(...),
                 distance_km: int = Form(...), group_id: str = Form(""),
                 cooldown_min: str = Form(""),
                 _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    def _reload(error=None):
        return render(request, "stages.html",
                      **_stages_ctx(db, user, tid, error=error))

    name = (name or "").strip()
    if not name:
        return _reload(error="Give the stage a name, for example 'Warning'.")
    try:
        distance = int(distance_km)
    except (TypeError, ValueError):
        return _reload(error="Distance must be a whole number of kilometers.")
    if not 1 <= distance <= _STAGE_MAX_KM:
        return _reload(error=f"Distance must be between 1 and {_STAGE_MAX_KM} km. "
                             "The detector cannot place a strike beyond that.")

    # Two stages at the same distance can never both fire: selection takes the
    # smallest covering band, so the second would be permanently dead.
    clash = (scope(db.query(AlertStage), AlertStage, tid)
             .filter(AlertStage.distance_km == distance).first())
    if clash is not None:
        return _reload(error=(f"There is already a stage at {distance} km "
                              f"('{clash.name}'). Each stage needs its own "
                              "distance, or one of them could never fire."))

    gid = None
    if (group_id or "").strip():
        try:
            gid = int(group_id)
        except (TypeError, ValueError):
            return _reload(error="Choose a valid group.")
        # Must belong to this tenant, or a crafted form could point a stage at
        # another client's recipients.
        if scoped_get(db, Group, gid, tid) is None:
            return _reload(error="Choose a valid group.")

    cool = None
    if (cooldown_min or "").strip():
        try:
            cool = max(0, min(1440, int(cooldown_min)))
        except (TypeError, ValueError):
            return _reload(error="Repeat interval must be a whole number of "
                                 "minutes, or blank to use the panel default.")

    db.add(AlertStage(tenant_id=tid, name=name[:40], distance_km=distance,
                      group_id=gid, cooldown_min=cool, is_active=True))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        log.exception("stage_create failed for tenant=%s name=%r", tid, name)
        return _reload(error=f"Could not save the stage '{name}'.")
    return RedirectResponse(redirect_to(request, "/stages"), status_code=303)


@router.post("/stages/preset")
def stages_preset(request: Request, _: None = Depends(verify_csrf),
                  user: User = Depends(require_writer),
                  tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    """Create the common three-step plan in one action.

    30 km advisory, 20 km warning, 10 km stop work: the arrangement most sites
    end up with. Only fills gaps, so it never disturbs a distance already in use.
    """
    existing = {s.distance_km for s in
                scope(db.query(AlertStage), AlertStage, tid).all()}
    added = 0
    for label, km in _STAGE_PRESET:
        if km in existing:
            continue
        db.add(AlertStage(tenant_id=tid, name=label, distance_km=km,
                          group_id=None, is_active=True))
        added += 1
    if added:
        db.commit()
    msg = (f"Added {added} stage(s)." if added
           else "Those distances already have stages.")
    return render(request, "stages.html", **_stages_ctx(db, user, tid, success=msg))


@router.post("/stages/{sid}/update")
def stage_update(request: Request, sid: int, name: str = Form(...),
                 distance_km: int = Form(...), group_id: str = Form(""),
                 cooldown_min: str = Form(""),
                 _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    def _reload(error=None):
        return render(request, "stages.html",
                      **_stages_ctx(db, user, tid, error=error))

    s = scoped_get(db, AlertStage, sid, tid)
    if s is None:
        raise HTTPException(404, "Stage not found")
    name = (name or "").strip()
    if not name:
        return _reload(error="Give the stage a name.")
    try:
        distance = int(distance_km)
    except (TypeError, ValueError):
        return _reload(error="Distance must be a whole number of kilometers.")
    if not 1 <= distance <= _STAGE_MAX_KM:
        return _reload(error=f"Distance must be between 1 and {_STAGE_MAX_KM} km.")
    clash = (scope(db.query(AlertStage), AlertStage, tid)
             .filter(AlertStage.distance_km == distance,
                     AlertStage.id != s.id).first())
    if clash is not None:
        return _reload(error=(f"There is already a stage at {distance} km "
                              f"('{clash.name}')."))

    gid = None
    if (group_id or "").strip():
        try:
            gid = int(group_id)
        except (TypeError, ValueError):
            return _reload(error="Choose a valid group.")
        if scoped_get(db, Group, gid, tid) is None:
            return _reload(error="Choose a valid group.")

    cool = None
    if (cooldown_min or "").strip():
        try:
            cool = max(0, min(1440, int(cooldown_min)))
        except (TypeError, ValueError):
            return _reload(error="Repeat interval must be whole minutes.")

    s.name = name[:40]
    s.distance_km = distance
    s.group_id = gid
    s.cooldown_min = cool
    db.commit()
    return RedirectResponse(redirect_to(request, "/stages"), status_code=303)


@router.post("/stages/{sid}/toggle")
def stage_toggle(request: Request, sid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    s = scoped_get(db, AlertStage, sid, tid)
    if s:
        s.is_active = not s.is_active
        db.commit()
    return RedirectResponse(redirect_to(request, "/stages"), status_code=303)


@router.post("/stages/{sid}/delete")
def stage_delete(request: Request, sid: int, _: None = Depends(verify_csrf),
                 user: User = Depends(require_writer),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    s = scoped_get(db, AlertStage, sid, tid)
    if s:
        db.delete(s)
        db.commit()
    return RedirectResponse(redirect_to(request, "/stages"), status_code=303)


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
            status, sid = sms_gateway.send_sms(to, body)
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
        "api_key": bool(settings.sms_api_key),
        "dlr_token": bool(settings.sms_dlr_token),
        "webhook_token": bool(settings.ALERT_WEBHOOK_TOKEN),
    }
    return render(request, "settings.html", user=user, gateway=gateway,
                  alerts_enabled=get_alerts_enabled(db, tenant_id=tid))


# -------------------- USERS (admin only) --------------------
@router.get("/users", response_class=HTMLResponse)
def users_list(request: Request, user: User = Depends(require_admin),
               tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    # A client admin sees only their own panel's logins. Stratus Admin inside a
    # tenant see that tenant's logins.
    rows = scope(db.query(User), User, tid).order_by(User.email).all()
    return render(request, "users.html", user=user, rows=rows)


@router.post("/users/create")
def users_create(request: Request, email: str = Form(...), password: str = Form(...),
                 role: str = Form("operator"), _: None = Depends(verify_csrf),
                 user: User = Depends(require_admin),
                 tid: int = Depends(tenant_id), db: Session = Depends(get_db)):
    # Errors come back on the form itself. Raising HTTPException here replaced
    # the page with a bare error, losing what the admin had typed.
    def _reload(error=None):
        rows = scope(db.query(User), User, tid).order_by(User.email).all()
        return render(request, "users.html", user=user, rows=rows, error=error)

    if role not in ("admin", "operator", "viewer"):
        return _reload(error="Choose a valid role.")
    email = (email or "").strip().lower()
    if "@" not in email or len(email) < 5:
        return _reload(error="A valid e-mail address is required.")
    if len(password) < MIN_PASSWORD_LEN:
        return _reload(
            error=f"Password must be at least {MIN_PASSWORD_LEN} characters.")
    # E-mail is globally unique (login is by e-mail alone), so this check is not
    # scoped to the tenant.
    if db.query(User).filter(User.email == email).first():
        return _reload(error="A user with that e-mail already exists.")
    # New logins belong to the current tenant and are never platform admins:
    # only the seeded Stratus admin holds cross-tenant reach.
    db.add(User(email=email, password_hash=hash_password(password),
                role=role, is_active=True, tenant_id=tid, is_platform_admin=False))
    try:
        db.commit()
    except IntegrityError:
        # Two admins submitting the same address at once both pass the check
        # above; the database is the only real arbiter.
        db.rollback()
        return _reload(error="A user with that e-mail already exists.")
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
# Stratus Admin create and open per-client panels here. A client never sees
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

    # One transaction for the whole panel: tenant, its admin login and its
    # default group. This used to commit the tenant first and the admin and group
    # second, so when the second commit failed the client panel existed with no
    # way to sign into it and no group to attach recipients to. A panel is only
    # useful complete, so it is created all at once or not at all.
    t = Tenant(slug=slug, name=name.strip() or slug,
               site_name=(site_name.strip() or name.strip() or slug),
               is_active=True)
    db.add(t)
    db.flush()          # assigns t.id without ending the transaction
    db.add(User(email=admin_email, password_hash=hash_password(admin_password),
                role="admin", is_active=True, tenant_id=t.id,
                is_platform_admin=False))
    db.add(Group(tenant_id=t.id, name="default",
                 description="Default recipient group",
                 distance_threshold_km=15, is_active=True))
    try:
        db.commit()
    except IntegrityError:
        # A constraint the pre-checks above do not cover, such as a legacy
        # UNIQUE index left on groups.name by an older schema. Roll back so the
        # session is usable for re-rendering the page.
        db.rollback()
        log.exception("tenant_create failed for slug=%s", slug)
        return back("Could not create that panel: it conflicts with existing "
                    "data. Nothing was saved. Please check the name and "
                    "address, then try again.")
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


def _tenant_contents(db, tenant_pk: int) -> dict:
    """Count everything that belongs to a client panel.

    Used both to show an admin what a deletion would destroy and to prove
    afterwards that it was destroyed.
    """
    return {
        "users": db.query(User).filter(User.tenant_id == tenant_pk).count(),
        "groups": db.query(Group).filter(Group.tenant_id == tenant_pk).count(),
        "stages": db.query(AlertStage)
                    .filter(AlertStage.tenant_id == tenant_pk).count(),
        "recipients": db.query(Recipient)
                        .filter(Recipient.tenant_id == tenant_pk).count(),
        "events": db.query(AlertEvent)
                    .filter(AlertEvent.tenant_id == tenant_pk).count(),
        "units": db.query(UnitStatus)
                   .filter(UnitStatus.tenant_id == tenant_pk).count(),
        "heartbeats": db.query(HeartbeatSample)
                        .filter(HeartbeatSample.tenant_id == tenant_pk).count(),
        "calibrations": db.query(CalibrationEvent)
                          .filter(CalibrationEvent.tenant_id == tenant_pk).count(),
    }


@router.get("/tenants/{tenant_pk}/edit", response_class=HTMLResponse)
def tenant_edit_get(request: Request, tenant_pk: int,
                    user: User = Depends(require_platform_admin),
                    db: Session = Depends(get_db)):
    t = db.get(Tenant, tenant_pk)
    if t is None:
        raise HTTPException(404, "Client panel not found")
    if t.slug == settings.PLATFORM_TENANT_SLUG:
        # The platform panel is Stratus' own and is not a client record.
        raise HTTPException(404, "Client panel not found")
    admins = (db.query(User)
              .filter(User.tenant_id == t.id, User.role == "admin")
              .order_by(User.email).all())
    return render(request, "tenant_edit.html", user=user, t=t, admins=admins,
                  contents=_tenant_contents(db, t.id), error=None, success=None)


@router.post("/tenants/{tenant_pk}/update")
def tenant_update(request: Request, tenant_pk: int,
                  name: str = Form(...), site_name: str = Form(""),
                  client_username: str = Form(""),
                  _: None = Depends(verify_csrf),
                  user: User = Depends(require_platform_admin),
                  db: Session = Depends(get_db)):
    """Rename a client panel and set its client sign-in name.

    The panel address (slug) is deliberately NOT editable. It is baked into the
    detector's configured webhook URL - ".../gwld1/api/v1/lightning" - and into
    whatever the client has bookmarked. Changing it here would silently stop a
    live detector from reporting, with nothing on this page to suggest why. A
    panel that genuinely needs a new address should be created afresh.
    """
    t = db.get(Tenant, tenant_pk)
    if t is None or t.slug == settings.PLATFORM_TENANT_SLUG:
        raise HTTPException(404, "Client panel not found")

    def _reload(error=None, success=None):
        admins = (db.query(User)
                  .filter(User.tenant_id == t.id, User.role == "admin")
                  .order_by(User.email).all())
        return render(request, "tenant_edit.html", user=user, t=t, admins=admins,
                      contents=_tenant_contents(db, t.id),
                      error=error, success=success)

    new_name = (name or "").strip()
    if not new_name:
        return _reload(error="Enter a client name.")

    wanted = (client_username or "").strip()
    if wanted:
        # Same rule as the login: names are compared case-insensitively, so two
        # logins differing only in case would be indistinguishable at sign-in.
        clash = (db.query(User)
                 .filter(func.lower(User.username) == wanted.lower())
                 .first())
        admins = (db.query(User)
                  .filter(User.tenant_id == t.id, User.role == "admin")
                  .order_by(User.email).all())
        if clash is not None and clash.tenant_id != t.id:
            return _reload(error=f"The sign-in name '{wanted}' is already in use.")
        if len(admins) != 1:
            return _reload(
                error=("This panel has "
                       + ("no admin login" if not admins
                          else f"{len(admins)} admin logins")
                       + ", so there is no single account to attach a sign-in "
                         "name to. Set it on the panel's own Users page."))
        admins[0].username = wanted

    t.name = new_name
    t.site_name = (site_name or "").strip() or new_name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        log.exception("tenant_update failed for slug=%s", t.slug)
        return _reload(error="Could not save those changes.")
    return _reload(success="Saved.")


@router.post("/tenants/{tenant_pk}/delete")
def tenant_delete(request: Request, tenant_pk: int,
                  confirm_slug: str = Form(""),
                  _: None = Depends(verify_csrf),
                  user: User = Depends(require_platform_admin),
                  db: Session = Depends(get_db)):
    """Delete a client panel and everything filed under it.

    THIS IS IRREVERSIBLE AND IT IS MEANT TO BE HARD TO DO BY ACCIDENT.

    The admin must type the panel address to confirm, because a misplaced click
    on a row would otherwise destroy a client's entire alert history. The
    platform panel can never be deleted.

    Detectors are the one thing NOT deleted. A unit is physical hardware that is
    still out there transmitting: its UnitStatus row is reassigned to the
    platform tenant, exactly where an unclaimed detector lives, so it reappears
    on the Unassigned Units page for reassignment instead of being orphaned and
    then silently re-created on its next heartbeat with no owner.

    Deletion order follows the foreign keys inward: message logs before events,
    recipients before groups, and stages before the groups they point at.
    """
    t = db.get(Tenant, tenant_pk)
    if t is None:
        raise HTTPException(404, "Client panel not found")
    if t.slug == settings.PLATFORM_TENANT_SLUG:
        raise HTTPException(400, "The platform panel cannot be deleted.")

    def _reload(error):
        admins = (db.query(User)
                  .filter(User.tenant_id == t.id, User.role == "admin")
                  .order_by(User.email).all())
        return render(request, "tenant_edit.html", user=user, t=t, admins=admins,
                      contents=_tenant_contents(db, t.id), error=error,
                      success=None)

    if (confirm_slug or "").strip().lower() != t.slug.lower():
        return _reload(error=(f"To delete this panel, type its address "
                              f"'{t.slug}' exactly. Nothing was deleted."))

    slug = t.slug
    before = _tenant_contents(db, t.id)
    platform_id = platform_tenant_id(db)

    try:
        # Message logs reference events, so they go first. Collected by event id
        # because MessageLog carries no tenant_id of its own.
        event_ids = [e.id for e in db.query(AlertEvent.id)
                     .filter(AlertEvent.tenant_id == t.id).all()]
        if event_ids:
            db.query(MessageLog).filter(MessageLog.event_id.in_(event_ids))\
              .delete(synchronize_session=False)
        db.query(AlertEvent).filter(AlertEvent.tenant_id == t.id)\
          .delete(synchronize_session=False)
        db.query(HeartbeatSample).filter(HeartbeatSample.tenant_id == t.id)\
          .delete(synchronize_session=False)
        db.query(CalibrationEvent).filter(CalibrationEvent.tenant_id == t.id)\
          .delete(synchronize_session=False)
        # Stages reference groups; recipients reference groups. Both before them.
        db.query(AlertStage).filter(AlertStage.tenant_id == t.id)\
          .delete(synchronize_session=False)
        db.query(Recipient).filter(Recipient.tenant_id == t.id)\
          .delete(synchronize_session=False)
        db.query(Group).filter(Group.tenant_id == t.id)\
          .delete(synchronize_session=False)
        db.query(User).filter(User.tenant_id == t.id)\
          .delete(synchronize_session=False)
        # Hand the hardware back rather than deleting it.
        released = (db.query(UnitStatus).filter(UnitStatus.tenant_id == t.id)
                    .update({UnitStatus.tenant_id: platform_id},
                            synchronize_session=False))
        # Per-tenant runtime settings are keyed "t<id>:name" and have no foreign
        # key, so they would otherwise be left behind for a future tenant that
        # happens to reuse the id.
        db.query(Setting).filter(Setting.key.like(f"t{t.id}:%"))\
          .delete(synchronize_session=False)
        db.delete(t)
        db.commit()
    except Exception:
        db.rollback()
        log.exception("tenant_delete failed for slug=%s", slug)
        return _reload(error="Could not delete that panel. Nothing was deleted.")

    log.warning("client panel '%s' deleted by %s - removed %s, released %d "
                "detector(s) to the platform panel",
                slug, user.email, before, released)
    return RedirectResponse(redirect_to(request, "/tenants"), status_code=303)
