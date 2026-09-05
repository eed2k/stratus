"""The forecast subdomain: upload logger data, forecast it, score the forecast.

WHAT THE OPERATOR DOES HERE

  1. Upload a .dat export from a CR300 or CR1000 series logger.
  2. Give the station its coordinates, so a model background can be fetched
     later if they want one.
  3. Ask for a 1, 3 or 5 day forecast.
  4. Watch the verification page fill in as more data arrives, and decide for
     themselves whether the forecast is worth anything.

THERE IS NO SAMPLE DATA

  Deliberately. A station with nothing uploaded shows an empty state that says
  so and points at the upload form. Seeding a demo station would mean the first
  thing anyone saw was a forecast of a place that does not exist, and every
  skill number on the verification page would be fiction.

ACCESS CONTROL

  This service accepts file uploads and stores them, so it is not left open.
  A single operator password is required, taken from FORECAST_PASSWORD, and the
  session is a signed cookie. If FORECAST_PASSWORD is not set the app still
  starts but refuses every request with an explanation, rather than silently
  serving an unauthenticated upload endpoint on a public hostname.

  This is a shared-password gate, which is appropriate for a single-operator
  tool. It is not per-user auth and carries no audit trail; if this ever needs
  to be handed to clients it should move to the panel's user model.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import os
import secrets
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import (charts, dropbox_sync, forecasting, ingest, plain, sector_report,
               verification)
from .db import Database
from .providers import registry

APP_DIR = Path(__file__).resolve().parent
DB_PATH = os.environ.get("FORECAST_DB", "data/forecast.db")
PASSWORD = os.environ.get("FORECAST_PASSWORD", "").strip()
# A random secret means restarting the container invalidates sessions. That is
# the right default: it costs one sign-in and avoids a fixed key baked into an
# image. Set FORECAST_SECRET to keep sessions across restarts.
SECRET = os.environ.get("FORECAST_SECRET", "").strip() or secrets.token_hex(32)
COOKIE = "forecast_session"
SESSION_HOURS = 12
MAX_UPLOAD_BYTES = 64 * 1024 * 1024

# Login brute-force throttle. With a single shared password the sign-in form is
# the whole authentication surface, so unlimited guessing is the one thing it
# must not allow. In-memory and per client address, which is enough for one
# container; behind several workers this state would need to move to the
# database, exactly as the alert console's own throttle notes.
LOGIN_MAX_FAILURES = int(os.environ.get("FORECAST_LOGIN_MAX_FAILURES", "8"))
LOGIN_FAILURE_WINDOW = int(
    os.environ.get("FORECAST_LOGIN_FAILURE_WINDOW", "900"))

# How often the background task wakes up to see whether any station's Dropbox
# interval has elapsed. The per-station interval decides how often a folder is
# actually checked; this is just the tick.
POLL_TICK_SECONDS = int(os.environ.get("DROPBOX_TICK_SECONDS", "60"))
DROPBOX_POLLING = os.environ.get(
    "DROPBOX_POLLING", "true").strip().lower() in ("1", "true", "yes", "on")


@contextlib.asynccontextmanager
async def lifespan(_app: FastAPI):
    """Run the Dropbox poller alongside the web app.

    A background task rather than cron: the interval is per station and
    configurable from the interface, and a task that shares the process can
    report its last result straight back onto the station page.

    Every poll runs in a worker thread. The work is blocking network and SQLite
    calls, and doing that on the event loop would stall the interface for the
    length of a multi-megabyte download.
    """
    task = None
    if DROPBOX_POLLING and PASSWORD:
        task = asyncio.create_task(_poll_loop())
    try:
        yield
    finally:
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


async def _poll_loop() -> None:
    client = dropbox_sync.DropboxClient()
    # A short delay so the container reports healthy before it starts pulling.
    await asyncio.sleep(10)
    while True:
        try:
            if client.configured():
                results = await asyncio.to_thread(
                    dropbox_sync.poll_due, db, client)
                for r in results:
                    if r.downloaded or r.error:
                        print(f"[dropbox] station {r.station_id}: "
                              f"{r.status} {r.error}".rstrip(), flush=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:                                # noqa: BLE001
            # The loop must outlive any single failure, or one bad poll ends
            # continuous ingest until someone restarts the container.
            print(f"[dropbox] poll loop error: {type(exc).__name__}: {exc}",
                  flush=True)
        await asyncio.sleep(POLL_TICK_SECONDS)


app = FastAPI(title="Stratus nano-climate forecast", docs_url=None,
              redoc_url=None, openapi_url=None, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")),
          name="static")
templates = Jinja2Templates(directory=str(APP_DIR / "templates"))
templates.env.globals["label_for"] = charts.label_for
templates.env.globals["unit_for"] = charts.unit_for
templates.env.globals["skill_bar"] = charts.skill_bar
# Exposed as a callable so a template can render the hidden field with
# {{ csrf_token(request) }}. Defined below, next to the session helpers it
# shares a secret with.
templates.env.globals["csrf_token"] = lambda request: _csrf_token(request)

db = Database(DB_PATH)


def _asset_version() -> str:
    """A short fingerprint of the static assets, used to bust browser caches.

    Without this a stylesheet is requested as a bare /static/style.css, and a
    browser that cached it from an earlier deploy keeps using the old copy: the
    new markup arrives, the old rules style it, and the page looks broken or
    simply unchanged. Appending a content hash means a changed file is a changed
    URL, so the browser has no choice but to fetch it.
    """
    digest = hashlib.sha256()
    static = APP_DIR / "static"
    for path in sorted(static.rglob("*")):
        if path.is_file():
            try:
                digest.update(path.read_bytes())
            except OSError:
                continue
    return digest.hexdigest()[:12]


ASSET_VERSION = _asset_version()
templates.env.globals["asset_version"] = ASSET_VERSION


# Defense-in-depth response headers, mirroring the alert console so the two
# FastAPI services present the same posture. The content security policy allows
# inline styles because the loading-gate CSS is inlined in base.html by design,
# and it allows same-origin scripts for /static/app.js; there are no inline
# scripts and no third-party origins. Cache-Control is deliberately NOT set
# here: the cache_headers middleware below owns caching, and it distinguishes a
# fingerprinted static asset (cached hard) from a page (never cached), which a
# blanket no-store here would flatten.
_CSP = ("default-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "img-src 'self' data:; "
        "font-src 'self'; connect-src 'self'; "
        "object-src 'none'; base-uri 'self'; "
        "form-action 'self'; frame-ancestors 'none'; "
        "upgrade-insecure-requests")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = _CSP
    resp.headers["Permissions-Policy"] = (
        "geolocation=(), microphone=(), camera=()")
    resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    resp.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    # Two years, and asserted for subdomains of this host (there are none, so
    # this is safe). `preload` is intentionally omitted: submitting to the
    # preload list is a one-way commitment for the whole domain and belongs in a
    # deliberate, estate-wide decision, not baked in here per service.
    resp.headers["Strict-Transport-Security"] = (
        "max-age=63072000; includeSubDomains")
    return resp


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    """Explicit caching rules, because the defaults are the problem.

    Static assets are addressed with a content hash, so they can be cached hard
    and for a long time. Pages must never be cached: they carry a station's
    current state and a stale one is worse than a slow one. FastAPI's
    StaticFiles sends only ETag and Last-Modified, which leaves the decision to
    the browser's heuristics, and those heuristics are what served an old
    stylesheet after a deploy.
    """
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/"):
        if request.query_params.get("v"):
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable")
        else:
            # Unversioned: allow reuse but force a revalidation every time.
            response.headers["Cache-Control"] = "no-cache"
    else:
        response.headers["Cache-Control"] = "no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


# ---------------------------------------------------------------------------
#  Session handling
# ---------------------------------------------------------------------------

def _sign(payload: str) -> str:
    mac = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256)
    return mac.hexdigest()


def _make_token() -> str:
    expires = int(time.time()) + SESSION_HOURS * 3600
    payload = str(expires)
    return f"{payload}.{_sign(payload)}"


def _valid_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    payload, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(payload)):
        return False
    try:
        return int(payload) > time.time()
    except ValueError:
        return False


def _authed(request: Request) -> bool:
    return _valid_token(request.cookies.get(COOKIE))


def _needs_login(request: Request):
    """Return a response when the caller may not proceed, else None."""
    if not PASSWORD:
        return templates.TemplateResponse(
            request, "misconfigured.html", status_code=503)
    if not _authed(request):
        return RedirectResponse("/login", status_code=303)
    return None


# ---------------------------------------------------------------------------
#  CSRF
# ---------------------------------------------------------------------------

def _csrf_token(request: Request) -> str:
    """A CSRF token bound to the caller's session cookie.

    This service authenticates with its own HMAC-signed cookie rather than
    Starlette's SessionMiddleware, so there is no server-side session store to
    hang a random per-session token on. Instead the token is an HMAC of the
    session cookie under the same server secret. That needs no second cookie and
    no shared state, and a cross-site attacker cannot produce it: the session
    cookie is HttpOnly so its value is not readable from script, and SECRET is
    server-side so the HMAC cannot be recomputed. The token also changes when
    the session does, so it cannot outlive a sign-out.

    Before sign-in there is no session cookie, so there is no token. That is
    fine: every state-changing route sits behind the login gate.
    """
    session = request.cookies.get(COOKIE, "")
    return _sign("csrf." + session)


def verify_csrf(request: Request, csrf_token: str = Form("")):
    """Reject a state-changing POST that does not carry a matching CSRF token.

    A dependency on every write route. The token is accepted either in the
    `csrf_token` form field, which is what the server-rendered forms send and
    what works with scripting off, or in an `X-CSRF-Token` header for a
    programmatic caller. A custom request header cannot be set by a cross-origin
    form post, so either channel is a sound defense.

    The check is skipped for a request that is not signed in. There is no
    session to bind a token to, and the route's own login gate will turn the
    request away, so an unauthenticated POST still lands on the sign-in page
    rather than a bare 403.
    """
    if not _authed(request):
        return
    presented = csrf_token or request.headers.get("X-CSRF-Token", "")
    expected = _csrf_token(request)
    if not presented or not hmac.compare_digest(str(presented), expected):
        raise HTTPException(status_code=403,
                            detail="CSRF token missing or invalid.")


# ---------------------------------------------------------------------------
#  Login throttle
# ---------------------------------------------------------------------------

_login_lock = threading.Lock()
_login_failures: dict[str, list[float]] = {}


def _login_key(request: Request) -> str:
    client = request.client
    return client.host if client else "unknown"


def _login_recent(key: str, now: float) -> list[float]:
    return [t for t in _login_failures.get(key, [])
            if now - t < LOGIN_FAILURE_WINDOW]


def _login_allowed(request: Request) -> bool:
    """False once this client address exceeds the failure budget in the window."""
    now = time.time()
    key = _login_key(request)
    with _login_lock:
        recent = _login_recent(key, now)
        _login_failures[key] = recent
        return len(recent) < LOGIN_MAX_FAILURES


def _record_login_failure(request: Request) -> None:
    now = time.time()
    key = _login_key(request)
    with _login_lock:
        recent = _login_recent(key, now)
        recent.append(now)
        _login_failures[key] = recent


def _reset_login_failures(request: Request) -> None:
    key = _login_key(request)
    with _login_lock:
        _login_failures.pop(key, None)


# ---------------------------------------------------------------------------
#  Health and sign-in
# ---------------------------------------------------------------------------

@app.get("/healthz")
def healthz():
    return JSONResponse({
        "status": "ok",
        "configured": bool(PASSWORD),
        "stations": len(db.list_stations()),
        "dropbox_configured": dropbox_sync.DropboxClient().configured(),
        "dropbox_polling": DROPBOX_POLLING,
        "dropbox_feeds": len(db.list_dropbox_sources(only_enabled=True)),
    })


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request, error: str = ""):
    if not PASSWORD:
        return templates.TemplateResponse(request, "misconfigured.html",
                                          status_code=503)
    if _authed(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(request, "login.html",
                                      {"error": error})


@app.post("/login")
def login(request: Request, password: str = Form("")):
    if not PASSWORD:
        return templates.TemplateResponse(request, "misconfigured.html",
                                          status_code=503)
    # Brute-force throttle: refuse once this client has spent its failure budget
    # in the window, before the password is even looked at.
    if not _login_allowed(request):
        return templates.TemplateResponse(
            request, "login.html",
            {"error": "Too many sign-in attempts. Wait a few minutes and try "
                      "again."}, status_code=429)
    # Constant-time compare so a wrong password cannot be found by timing.
    if not hmac.compare_digest(password, PASSWORD):
        _record_login_failure(request)
        return templates.TemplateResponse(
            request, "login.html",
            {"error": "That password was not accepted."}, status_code=401)
    _reset_login_failures(request)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(COOKIE, _make_token(), httponly=True, samesite="lax",
                        secure=True, max_age=SESSION_HOURS * 3600)
    return response


@app.post("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(COOKIE)
    return response


# ---------------------------------------------------------------------------
#  Stations
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def index(request: Request, message: str = "", error: str = ""):
    gate = _needs_login(request)
    if gate:
        return gate
    rows = []
    for st in db.list_stations():
        lo, hi = db.observation_span(st.id)
        rows.append({
            "station": st,
            "readings": db.observation_count(st.id),
            "first": lo, "last": hi,
            "days": round((hi - lo).total_seconds() / 86400.0, 1)
                    if lo and hi else 0.0,
            "variables": [v for v in db.station_variables(st.id)
                          if v in ingest.ENGINE_VARIABLES],
        })
    return templates.TemplateResponse(request, "index.html", {
        "rows": rows, "message": message, "error": error,
        "dropbox_status": dropbox_sync.DropboxClient().describe(),
        "dropbox_polling": DROPBOX_POLLING,
        "providers": registry.describe_providers(),
    })


@app.post("/stations/new")
def station_new(request: Request, name: str = Form(""),
                slug: str = Form(""),
                folder_path: str = Form(""),
                file_pattern: str = Form("*.dat"),
                interval_minutes: int = Form(15),
                dropbox_enabled: str = Form(""),
                auto_forecast: str = Form("on"),
                _csrf: None = Depends(verify_csrf)):
    """Create a station without a manual upload first.

    Without this the only way to get a station is to hand-upload a .dat, which
    is backwards for anyone whose logger already drips into Dropbox: they would
    have to upload a file by hand before they could switch on the feed that was
    supposed to replace uploading files by hand.
    """
    gate = _needs_login(request)
    if gate:
        return gate

    label = (name or "").strip()
    ident = _slugify(slug or label)
    if not ident or ident == "station":
        return RedirectResponse(
            "/?error=Give+the+station+a+name.", status_code=303)
    if db.get_station_by_slug(ident):
        return RedirectResponse(
            f"/?error=A+station+with+the+id+{ident}+already+exists.",
            status_code=303)

    station_id = db.upsert_station(ident, label or ident, "")

    wants_feed = dropbox_enabled == "on"
    if wants_feed or folder_path.strip():
        minutes = max(1, min(1440, int(interval_minutes or 15)))
        db.upsert_dropbox_source(
            station_id, folder_path=folder_path,
            file_pattern=file_pattern or "*.dat",
            enabled=wants_feed,
            interval_secs=minutes * 60,
            auto_forecast=(auto_forecast == "on"))

    if wants_feed:
        note = ("Station+created.+Checking+Dropbox+now,+"
                "then+every+%d+minutes." % max(1, min(1440,
                                                      int(interval_minutes
                                                          or 15))))
    else:
        note = "Station+created.+Upload+a+file+or+turn+on+the+Dropbox+feed."
    return RedirectResponse(f"/station/{station_id}?message={note}",
                            status_code=303)


@app.post("/upload")
async def upload(request: Request, file: UploadFile,
                 station_slug: str = Form(""),
                 _csrf: None = Depends(verify_csrf)):
    gate = _needs_login(request)
    if gate:
        return gate

    raw = await file.read()
    if not raw:
        return RedirectResponse("/?error=The+file+was+empty.", status_code=303)
    if len(raw) > MAX_UPLOAD_BYTES:
        return RedirectResponse(
            f"/?error=That+file+is+larger+than+"
            f"{MAX_UPLOAD_BYTES // (1024 * 1024)}+MB.", status_code=303)

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        # Campbell files are sometimes latin-1 when a station name carries an
        # accent. Falling back is better than rejecting the upload.
        text = raw.decode("latin-1", errors="replace")

    try:
        observations, report = ingest.parse_dat(text)
    except ingest.IngestError as exc:
        return templates.TemplateResponse(request, "upload_failed.html", {
            "filename": file.filename, "reason": str(exc),
        }, status_code=400)

    slug = (station_slug.strip()
            or _slugify(report.station_name or Path(
                file.filename or "station").stem))
    station_id = db.upsert_station(slug, report.station_name or slug,
                                  report.logger_model)

    digest = hashlib.sha256(raw).hexdigest()
    duplicate = db.upload_already_seen(station_id, digest)
    written = db.insert_observations(station_id, observations)
    db.record_upload(station_id, file.filename or "upload.dat", digest,
                     report.rows_kept, report.rows_skipped,
                     report.first_timestamp, report.last_timestamp,
                     {"mapped": report.mapped,
                      "warnings": report.warnings,
                      "conversions": report.conversions,
                      "unmapped": report.unmapped_columns})

    return templates.TemplateResponse(request, "upload_done.html", {
        "station": db.get_station(station_id),
        "report": report,
        "readings_written": written,
        "duplicate": duplicate,
        "filename": file.filename,
        "total_readings": db.observation_count(station_id),
    })


@app.get("/station/{station_id}", response_class=HTMLResponse)
def station_detail(request: Request, station_id: int, message: str = "",
                   error: str = ""):
    gate = _needs_login(request)
    if gate:
        return gate
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)
    lo, hi = db.observation_span(station_id)
    return templates.TemplateResponse(request, "station.html", {
        "station": st,
        "first": lo, "last": hi,
        "days": round((hi - lo).total_seconds() / 86400.0, 1)
                if lo and hi else 0.0,
        "readings": db.observation_count(station_id),
        "variables": db.station_variables(station_id),
        "engine_variables": [v for v in db.station_variables(station_id)
                             if v in ingest.ENGINE_VARIABLES],
        "uploads": db.list_uploads(station_id),
        "runs": db.list_runs(station_id, limit=15),
        "providers": registry.describe_providers(),
        "all_engine_variables": ingest.ENGINE_VARIABLES,
        "horizons": forecasting.HORIZON_DAYS,
        "dropbox": db.get_dropbox_source(station_id),
        "dropbox_status": dropbox_sync.DropboxClient().describe(),
        "dropbox_files": db.list_dropbox_files(station_id),
        "dropbox_polling": DROPBOX_POLLING,
        "sector_config": db.get_sector_config(station_id) or {},
        "enabled_sectors": db.enabled_sectors(station_id),
        "sector_labels": SECTOR_LABELS,
        "albedo_surfaces": sorted(sector_report.solar.ALBEDO),
        "message": message, "error": error,
    })


@app.post("/station/{station_id}/dropbox")
def station_dropbox(station_id: int, request: Request,
                    folder_path: str = Form(""),
                    file_pattern: str = Form("*.dat"),
                    interval_minutes: int = Form(15),
                    dropbox_enabled: str = Form(""),
                    auto_forecast: str = Form(""),
                    _csrf: None = Depends(verify_csrf)):
    gate = _needs_login(request)
    if gate:
        return gate
    if not db.get_station(station_id):
        return RedirectResponse("/?error=No+such+station.", status_code=303)

    minutes = max(1, min(1440, int(interval_minutes or 15)))
    db.upsert_dropbox_source(
        station_id,
        folder_path=folder_path,
        file_pattern=file_pattern or "*.dat",
        enabled=(dropbox_enabled == "on"),
        interval_secs=minutes * 60,
        auto_forecast=(auto_forecast == "on"))
    note = ("Continuous+feed+on,+checking+every+"
            f"{minutes}+minutes." if dropbox_enabled == "on"
            else "Continuous+feed+off.")
    return RedirectResponse(f"/station/{station_id}?message={note}",
                            status_code=303)


@app.post("/station/{station_id}/dropbox/poll")
async def station_dropbox_poll(station_id: int, request: Request,
                               force: str = Form(""),
                               _csrf: None = Depends(verify_csrf)):
    """Check the folder now, rather than waiting for the interval."""
    gate = _needs_login(request)
    if gate:
        return gate
    if not db.get_station(station_id):
        return RedirectResponse("/?error=No+such+station.", status_code=303)
    result = await asyncio.to_thread(
        dropbox_sync.poll_station, db, station_id, None, force == "on")
    if result.error:
        return RedirectResponse(
            f"/station/{station_id}?error={_q(result.error)}",
            status_code=303)
    detail = result.status
    if result.warnings:
        detail += ". " + "; ".join(result.warnings[:2])
    return RedirectResponse(f"/station/{station_id}?message={_q(detail)}",
                            status_code=303)


@app.post("/station/{station_id}/settings")
def station_settings(station_id: int, request: Request,
                     latitude: str = Form(""), longitude: str = Form(""),
                     elevation_m: str = Form(""),
                     utc_offset_hours: str = Form("2"),
                     _csrf: None = Depends(verify_csrf)):
    gate = _needs_login(request)
    if gate:
        return gate

    def num(raw):
        raw = (raw or "").strip()
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None

    lat, lon = num(latitude), num(longitude)
    if (latitude.strip() and lat is None) or (longitude.strip()
                                              and lon is None):
        return RedirectResponse(
            f"/station/{station_id}?error=Latitude+and+longitude+must+be+"
            f"decimal+degrees.", status_code=303)
    if lat is not None and not -90.0 <= lat <= 90.0:
        return RedirectResponse(
            f"/station/{station_id}?error=Latitude+must+be+between+-90+and+90.",
            status_code=303)
    if lon is not None and not -180.0 <= lon <= 180.0:
        return RedirectResponse(
            f"/station/{station_id}?error=Longitude+must+be+between+-180+and+"
            f"180.", status_code=303)

    db.update_station_position(station_id, lat, lon, num(elevation_m),
                              num(utc_offset_hours) or 2.0)
    return RedirectResponse(f"/station/{station_id}?message=Station+updated.",
                            status_code=303)


@app.post("/station/{station_id}/nwp")
async def station_nwp(station_id: int, request: Request,
                      _csrf: None = Depends(verify_csrf)):
    gate = _needs_login(request)
    if gate:
        return gate
    form = await request.form()
    enabled = form.get("nwp_enabled") == "on"
    providers = [p for p in form.getlist("providers")
                 if p in registry.ALL_PROVIDER_NAMES]
    variables = [v for v in form.getlist("variables")
                 if v in ingest.ENGINE_VARIABLES]
    db.update_station_nwp(station_id, enabled, providers, variables)
    note = ("Model background on." if enabled
            else "Model background off; station history only.")
    return RedirectResponse(
        f"/station/{station_id}?message={note.replace(' ', '+')}",
        status_code=303)


@app.post("/station/{station_id}/delete")
def station_delete(station_id: int, request: Request,
                   confirm_slug: str = Form(""),
                   _csrf: None = Depends(verify_csrf)):
    gate = _needs_login(request)
    if gate:
        return gate
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)
    # Typing the name out is the guard. This deletes every reading and every
    # forecast for the station and cannot be undone from the interface.
    if confirm_slug.strip() != st.slug:
        return RedirectResponse(
            f"/station/{station_id}?error=Type+the+station+id+exactly+to+"
            f"confirm+deletion.", status_code=303)
    db.delete_station(station_id)
    return RedirectResponse("/?message=Station+deleted.", status_code=303)


# ---------------------------------------------------------------------------
#  Forecasting
# ---------------------------------------------------------------------------

@app.post("/station/{station_id}/run")
def station_run(station_id: int, request: Request, days: int = Form(0),
                _csrf: None = Depends(verify_csrf)):
    gate = _needs_login(request)
    if gate:
        return gate
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)
    try:
        if days in forecasting.HORIZON_HOURS:
            forecasting.run_forecast(db, st,
                                     forecasting.HORIZON_HOURS[days])
            note = f"{days}+day+forecast+produced."
        else:
            forecasting.run_all_horizons(db, st)
            note = "1,+3+and+5+day+forecasts+produced."
    except forecasting.NotEnoughData as exc:
        return RedirectResponse(
            f"/station/{station_id}?error={_q(str(exc))}", status_code=303)
    return RedirectResponse(f"/station/{station_id}/forecast?days="
                            f"{days or 1}&message={note}", status_code=303)


@app.post("/station/{station_id}/backfill")
def station_backfill(station_id: int, request: Request, days: int = Form(1),
                     step_hours: int = Form(24),
                     _csrf: None = Depends(verify_csrf)):
    gate = _needs_login(request)
    if gate:
        return gate
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)
    horizon = forecasting.HORIZON_HOURS.get(days, 24)
    try:
        runs = forecasting.backfill_runs(db, st, horizon,
                                        step_hours=max(1, step_hours))
    except forecasting.NotEnoughData as exc:
        return RedirectResponse(
            f"/station/{station_id}?error={_q(str(exc))}", status_code=303)
    return RedirectResponse(
        f"/station/{station_id}/verify?days={days}&message="
        f"{len(runs)}+past+forecasts+issued+and+scored.", status_code=303)


#: Variables the outlook reads. Order matters only for the charts below it.
_OUTLOOK_VARIABLES = ("temperature", "rainfall", "wind_speed", "wind_gust",
                      "humidity", "solar_radiation")

#: Which of those get an hour-by-hour chart, with a plain explanation of what
#: the reader is looking at. Kept to three: the outlook is the answer, and a
#: wall of charts is what this page exists to avoid.
_OUTLOOK_CHARTS = (
    ("temperature", "Temperature through the day",
     "The line is the expected temperature. The shaded band is the range it "
     "could reasonably fall in, so a wide band means less certainty."),
    ("rainfall", "Rainfall",
     "Expected rainfall per hour. Short tall bars are a shower; a long low "
     "run is steady rain."),
    ("wind_speed", "Wind",
     "Sustained wind speed. Check the band as well as the line: wind is "
     "harder to forecast than temperature."),
)


@app.get("/station/{station_id}/dashboard", response_class=HTMLResponse)
def station_dashboard(request: Request, station_id: int,
                      message: str = "", error: str = ""):
    """A plain-language outlook: what the weather is doing, in words and figures.

    The detailed forecast page is organized by variable, which suits someone
    checking the engine. This one is organized by DAY, which is how the question
    is actually asked ("what is tomorrow like?"). It reuses the stored forecast
    points, so it can never disagree with the detail page: same run, same
    numbers, different presentation.
    """
    gate = _needs_login(request)
    if gate:
        return gate
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)

    # Prefer the longest horizon that has actually been run, so the outlook
    # covers as many days as the station can support, and fall back through the
    # shorter ones rather than showing an empty page.
    run = None
    days = 0
    for candidate in sorted(forecasting.HORIZON_DAYS, reverse=True):
        found = db.latest_run(station_id, forecasting.HORIZON_HOURS[candidate])
        if found:
            run, days = found, candidate
            break

    if not run:
        return templates.TemplateResponse(request, "dashboard.html", {
            "station": st, "outlooks": [], "run": None, "days": 0,
            "horizons": forecasting.HORIZON_DAYS,
            "headline": "", "rain_outlook": "", "backing": "",
            "charts_list": [], "message": message, "error": error,
        })

    stored = set(db.station_variables(station_id))
    series_by_variable: dict[str, list[dict]] = {}
    for variable in _OUTLOOK_VARIABLES:
        if variable not in stored:
            continue
        points = db.run_points(run["id"], variable)
        if points:
            series_by_variable[variable] = points

    outlooks = plain.build_outlook(series_by_variable, max_days=days or 5)

    # Charts reuse the same builder the detail page uses, so the two cannot
    # drift apart visually or numerically.
    charts_list = []
    for variable, title, explain in _OUTLOOK_CHARTS:
        points = series_by_variable.get(variable)
        if not points:
            continue
        series = []
        for p in points:
            try:
                valid_at = datetime.strptime(p["valid_at"], "%Y-%m-%d %H:%M:%S")
            except (KeyError, TypeError, ValueError):
                continue
            series.append({
                "valid_at": valid_at, "value": p["value"],
                "p10": p["p10"], "p90": p["p90"],
                "lead_hours": p["lead_hours"],
                "persistence": p["persistence"],
                "climatology": p["climatology"],
            })
        if not series:
            continue
        charts_list.append({
            "title": title, "explain": explain,
            "svg": charts.series_chart(series, variable,
                                       unit=charts.unit_for(variable),
                                       title=""),
        })

    # Name the variables an operator opted into, so the page is explicit about
    # whether a commercial model is involved at all.
    model_backed = []
    if run.get("provider"):
        model_backed = sorted(series_by_variable)

    return templates.TemplateResponse(request, "dashboard.html", {
        "station": st, "outlooks": outlooks, "run": run, "days": days,
        "horizons": forecasting.HORIZON_DAYS,
        "headline": plain.headline(outlooks),
        "rain_outlook": plain.rain_outlook(outlooks),
        "backing": plain.describe_backing(model_backed),
        "charts_list": charts_list,
        "message": message, "error": error,
    })


@app.get("/station/{station_id}/forecast", response_class=HTMLResponse)
def station_forecast(request: Request, station_id: int, days: int = 1,
                     variable: str = "", message: str = "", error: str = ""):
    gate = _needs_login(request)
    if gate:
        return gate
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)
    if days not in forecasting.HORIZON_HOURS:
        days = 1
    horizon = forecasting.HORIZON_HOURS[days]
    run = db.latest_run(station_id, horizon)

    available = [v for v in db.station_variables(station_id)
                 if v in ingest.ENGINE_VARIABLES]
    if not run:
        return templates.TemplateResponse(request, "forecast.html", {
            "station": st, "days": days, "horizons": forecasting.HORIZON_DAYS,
            "run": None, "variable": "", "available": available,
            "chart": "", "rows": [], "message": message,
            "error": error or "",
        })

    chosen = variable if variable in available else (
        "temperature" if "temperature" in available
        else (available[0] if available else ""))

    points = db.run_points(run["id"], chosen) if chosen else []
    series = []
    for p in points:
        series.append({
            "valid_at": datetime.strptime(p["valid_at"], "%Y-%m-%d %H:%M:%S"),
            "value": p["value"], "p10": p["p10"], "p90": p["p90"],
            "lead_hours": p["lead_hours"],
            "persistence": p["persistence"],
            "climatology": p["climatology"],
        })

    observed = []
    if series and chosen:
        observed = db.series(station_id, chosen, series[0]["valid_at"],
                             series[-1]["valid_at"])

    chart = charts.series_chart(
        series, chosen, unit=charts.unit_for(chosen),
        observed=observed,
        title=f"{charts.label_for(chosen)} - {days} day forecast from "
              f"{run['base_time']}") if chosen else ""

    return templates.TemplateResponse(request, "forecast.html", {
        "station": st, "days": days, "horizons": forecasting.HORIZON_DAYS,
        "run": run, "variable": chosen, "available": available,
        "chart": chart, "rows": series,
        "observed_count": len(observed),
        "message": message, "error": error,
    })


@app.get("/station/{station_id}/verify", response_class=HTMLResponse)
def station_verify(request: Request, station_id: int, days: int = 0,
                   variable: str = "", message: str = "", error: str = ""):
    gate = _needs_login(request)
    if gate:
        return gate
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)

    horizon = forecasting.HORIZON_HOURS.get(days) if days else None
    report = verification.verify(db, station_id, horizon_hours=horizon)
    table = verification.summary_table(report)

    available = report.variables or [
        v for v in db.station_variables(station_id)
        if v in ingest.ENGINE_VARIABLES]
    chosen = variable if variable in available else (
        "temperature" if "temperature" in available
        else (available[0] if available else ""))

    chart = charts.error_chart(report.timeline.get(chosen, []), chosen,
                               unit=charts.unit_for(chosen)) if chosen else ""

    return templates.TemplateResponse(request, "verify.html", {
        "station": st, "days": days, "horizons": forecasting.HORIZON_DAYS,
        "report": report, "table": table, "variable": chosen,
        "available": available, "chart": chart,
        "headline": report.headline(chosen) if chosen else None,
        "message": message, "error": error,
    })


# ---------------------------------------------------------------------------
#  Sector products
# ---------------------------------------------------------------------------

#: Sector keys as an operator sees them. Kept here rather than in the template so
#: the wording is in one place for both the tabs and the station page.
SECTOR_LABELS = {
    "solar": "Solar",
    "wind": "Wind",
    "agriculture": "Agriculture",
    "agrivoltaics": "Agrivoltaics",
}


@app.post("/station/{station_id}/sectors")
def station_sectors(station_id: int, request: Request,
                    solar_on: str = Form(""), wind_on: str = Form(""),
                    agriculture_on: str = Form(""),
                    agrivoltaics_on: str = Form(""),
                    tilt_deg: str = Form(""),
                    surface_azimuth_deg: str = Form(""),
                    rated_w: str = Form(""),
                    tracking: str = Form("fixed"),
                    row_pitch_m: str = Form(""),
                    collector_width_m: str = Form(""),
                    albedo_surface: str = Form("grass"),
                    hub_height_m: str = Form(""),
                    measurement_height_m: str = Form(""),
                    crop: str = Form(""),
                    livestock: str = Form(""),
                    _csrf: None = Depends(verify_csrf)):
    """Save which sector products a station shows, and the geometry they need."""
    gate = _needs_login(request)
    if gate:
        return gate
    if not db.get_station(station_id):
        return RedirectResponse("/?error=No+such+station.", status_code=303)

    def num(raw):
        raw = (raw or "").strip()
        if not raw:
            return None
        try:
            return float(raw)
        except ValueError:
            return None

    try:
        db.upsert_sector_config(
            station_id,
            solar=(solar_on == "on"), wind=(wind_on == "on"),
            agriculture=(agriculture_on == "on"),
            agrivoltaics=(agrivoltaics_on == "on"),
            tilt_deg=num(tilt_deg),
            surface_azimuth_deg=num(surface_azimuth_deg),
            rated_w=num(rated_w), tracking=tracking,
            row_pitch_m=num(row_pitch_m),
            collector_width_m=num(collector_width_m),
            albedo_surface=albedo_surface,
            hub_height_m=num(hub_height_m),
            measurement_height_m=num(measurement_height_m),
            crop=crop.strip(), livestock=livestock.strip())
    except ValueError as exc:
        # Out-of-range values are refused rather than clamped, so the page can
        # never disagree with what was stored.
        return RedirectResponse(
            f"/station/{station_id}?error={_q(str(exc))}", status_code=303)

    return RedirectResponse(
        f"/station/{station_id}?message=Sector+settings+saved.",
        status_code=303)


@app.get("/station/{station_id}/sector/{sector}", response_class=HTMLResponse)
def station_sector(request: Request, station_id: int, sector: str,
                   days: int = 1):
    """One sector's page, assembled on demand from the latest run.

    Nothing is cached: every figure is recomputed from the stored forecast points
    so it cannot disagree with the forecast it came from.
    """
    gate = _needs_login(request)
    if gate:
        return gate
    if sector not in SECTOR_LABELS:
        return RedirectResponse(f"/station/{station_id}?error=Unknown+sector.",
                                status_code=303)
    st = db.get_station(station_id)
    if not st:
        return RedirectResponse("/?error=No+such+station.", status_code=303)
    if days not in forecasting.HORIZON_HOURS:
        days = 1

    report = sector_report.build(db, station_id, sector, days)
    if report is None:
        return RedirectResponse(
            f"/station/{station_id}?error=No+{days}+day+forecast+yet.+"
            f"Produce+one+first.", status_code=303)

    enabled = db.enabled_sectors(station_id) or [sector]

    # Charts are built here rather than in the template: the template must stay
    # free of computation so it can be read as a layout.
    poa_chart = dli_chart = tradeoff_chart = wind_rose_svg = ""
    for section in report.sections:
        if not section.available:
            continue
        if section.title == "Plane of array and yield":
            poa_chart = charts.poa_day_chart(
                section.data.get("rows"),
                title=f"Irradiance, {days} day forecast")
        elif section.title == "Direction":
            wind_rose_svg = charts.wind_rose(
                section.data.get("sectors"), title="Where the wind comes from")
        elif section.title == "Crop light under the array":
            dli_chart = charts.dli_comparison(section.data.get("budget"))
        elif section.title == "Energy against crop light":
            tradeoff_chart = charts.tradeoff_curve(
                section.data.get("tradeoff"))

    return templates.TemplateResponse(request, "sector.html", {
        "report": report,
        "sector_label": SECTOR_LABELS[sector],
        "sector_labels": SECTOR_LABELS,
        "enabled_sectors": enabled,
        "horizons": forecasting.HORIZON_DAYS,
        "poa_chart": poa_chart,
        "dli_chart": dli_chart,
        "tradeoff_chart": tradeoff_chart,
        "wind_rose_svg": wind_rose_svg,
    })


# ---------------------------------------------------------------------------
#  Helpers
# ---------------------------------------------------------------------------

def _slugify(raw: str) -> str:
    keep = [c.lower() if c.isalnum() else "-" for c in (raw or "").strip()]
    slug = "".join(keep).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "station"


def _q(text: str) -> str:
    from urllib.parse import quote_plus
    return quote_plus(text)


@app.exception_handler(500)
def server_error(request: Request, exc: Exception):
    """A readable page with a reference, not a bare Internal Server Error.

    The panel learned this the hard way: an unexplained 500 tells the operator
    nothing and gives support nothing to go on.
    """
    reference = secrets.token_hex(4)
    print(f"[forecast] error {reference}: {type(exc).__name__}: {exc}",
          flush=True)
    return templates.TemplateResponse(
        request, "error.html", {"reference": reference}, status_code=500)
