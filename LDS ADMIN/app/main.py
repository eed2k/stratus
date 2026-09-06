import logging
import uuid
from pathlib import Path

from fastapi import FastAPI
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware

from .config import settings
from .db import Base, engine, SessionLocal
from .models import User, Setting
from .auth import hash_password
from .runtime import ALERTS_ENABLED_KEY
from .security import CSRF_ERROR_DETAIL
from .tenancy import TenantPrefixMiddleware, base_path
from .bootstrap import (add_missing_columns, ensure_platform_tenant,
                        backfill_tenants, drop_stale_unique_constraints,
                        ensure_tenant_defaults, ensure_client_usernames)
from .routes.web import router as web_router
from .routes.api import router as api_router, dlr_router

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="Lightning Alert Admin Panel", docs_url=None, redoc_url=None,
              openapi_url=None)

# Signed, HttpOnly session cookie. Secure flag + SameSite=Lax + a hard
# expiry limit the blast radius of a stolen or replayed cookie. When served
# over HTTPS we use the __Host- cookie prefix, which the browser only accepts
# when Secure is set, Path=/ and no Domain attribute is present. This pins the
# cookie to the exact host and blocks subdomain/insecure overwrites.
#
# WHY LAX AND NOT STRICT
#
#   Strict withholds the cookie on a cross-site top-level navigation, which
#   includes following the "AS3935" link from stratusweather.co.za. Arriving
#   that way, an already signed-in operator looked anonymous, the login page
#   rendered, and rendering mints a session - so the Set-Cookie REPLACED the
#   live session. Any page still open in another tab then held a CSRF token
#   that no longer matched the cookie and its next POST failed with
#   "Invalid or missing CSRF token". That is exactly the report from the field
#   (two 403s on /alerts/toggle in a row).
#
#   Lax fixes it without weakening the defense: the cookie still is NOT sent on
#   a cross-site POST, which is the request CSRF actually abuses, and the
#   explicit per-session token checked by verify_csrf remains the primary
#   control. Only safe top-level GET navigation regains the cookie.
_SESSION_COOKIE = "__Host-stratus_session" if settings.SECURE_COOKIES \
    else "stratus_session"
app.add_middleware(SessionMiddleware,
                   secret_key=settings.APP_SECRET_KEY,
                   session_cookie=_SESSION_COOKIE,
                   same_site="lax",
                   https_only=settings.SECURE_COOKIES,
                   max_age=settings.SESSION_MAX_AGE)


# Defense-in-depth response headers applied to every response.
_CSP = ("default-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        "img-src 'self' data:; "
        "font-src 'self'; connect-src 'self'; "
        "object-src 'none'; base-uri 'self'; "
        "form-action 'self'; frame-ancestors 'none'")
if settings.SECURE_COOKIES:
    _CSP += "; upgrade-insecure-requests"


@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = _CSP
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    resp.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    resp.headers["Cache-Control"] = "no-store"
    if settings.SECURE_COOKIES:
        resp.headers["Strict-Transport-Security"] = \
            "max-age=63072000; includeSubDomains; preload"
    return resp


# --------------------------------------------------------------------------
# Last-resort error page
# --------------------------------------------------------------------------
# Routes handle their own expected failures and re-render the form with a
# message. This exists for the unexpected: without it Starlette returns a bare
# "Internal Server Error" body, which is what an operator saw when
# /tenants/create hit a stale database constraint. The traceback is logged, never
# shown, because it names files, drivers and column values.
_ERROR_PAGE = """<!DOCTYPE html>
<html lang="en-ZA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Something went wrong</title>
<style>
 body{margin:0;min-height:100vh;display:flex;align-items:center;
   justify-content:center;background:#f4f6f9;
   font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
   color:#0a2540}
 .box{max-width:520px;background:#fff;border:1px solid #b9c2cf;
   border-top:3px solid #c0392b;padding:26px 28px;margin:20px}
 h1{margin:0 0 10px;font-size:17px;letter-spacing:.02em;text-transform:uppercase}
 p{margin:0 0 12px;color:#3d4d5c}
 code{background:#f4f6f9;padding:1px 5px;font-size:12px}
 a{color:#0a2540;font-weight:600}
</style></head><body>
<div class="box" role="alert">
  <h1>Something went wrong</h1>
  <p>The action could not be completed and nothing was saved. The error has been
     recorded for us to look at.</p>
  <p>Reference <code>__REF__</code></p>
  <p><a href="__HOME__">Back to the panel</a></p>
</div></body></html>"""


@app.exception_handler(StarletteHTTPException)
async def http_error(request, exc):
    """Give an expired session a way forward instead of a bare JSON body.

    A stale CSRF token is an ordinary consequence of leaving a page open past
    the session lifetime, but the default handler answers it with
    {"detail": "Invalid or missing CSRF token"} - which tells an operator
    nothing and offers no way out. Send them to the sign-in page of whichever
    panel they were in, with an explanation. Every other HTTP error keeps its
    normal behavior, so API 401s and 404s are untouched.
    """
    if exc.status_code == 403 and exc.detail == CSRF_ERROR_DETAIL:
        try:
            base = base_path(request) or ""
        except Exception:                                        # noqa: BLE001
            base = ""
        # Clients sign in at /client, admins at /login. Sending someone to the
        # wrong one of those is its own dead end.
        target = "/client" if request.url.path.rstrip("/").endswith("/client") \
            else "/login"
        return RedirectResponse(f"{base}{target}?expired=1", status_code=303)
    return await http_exception_handler(request, exc)


@app.exception_handler(Exception)
async def unhandled_error(request, exc):
    # A short reference so a report can be matched to the logged traceback.
    ref = uuid.uuid4().hex[:8]
    logging.getLogger("unhandled").exception(
        "ref=%s unhandled error on %s %s", ref, request.method, request.url.path)
    # Keep the operator inside whichever panel they were in.
    try:
        home = base_path(request) or "/"
    except Exception:
        home = "/"
    body = _ERROR_PAGE.replace("__REF__", ref).replace("__HOME__", home)
    return HTMLResponse(body, status_code=500)


BASE = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


@app.get("/favicon.ico", include_in_schema=False)
def favicon_ico():
    """Serve the tab icon from the site root as well as from /static.

    Browsers request /favicon.ico whether or not the document links one, and this
    path previously answered with FastAPI's JSON 404, which is why the panel
    showed a blank tab while every other Stratus surface showed the mark. It also
    covers the case where the response carries no markup at all, such as the
    redirect a logged-out visitor receives.

    Deliberately public, and ahead of the tenant prefix middleware's concern: the
    icon is the same for the platform panel and every client sub-panel.
    """
    return FileResponse(BASE / "static" / "favicon.ico",
                        media_type="image/x-icon",
                        headers={"Cache-Control": "public, max-age=86400"})


@app.get("/apple-touch-icon.png", include_in_schema=False)
@app.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
def apple_touch_icon():
    """The icon iOS asks for by convention, answered with the same mark.

    The SVG is served rather than a second raster file, so there is only ever one
    image to keep in step.
    """
    return FileResponse(BASE / "static" / "favicon.svg",
                        media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=86400"})


@app.get("/favicon.ico", include_in_schema=False)
def favicon_ico():
    """Serve the tab icon from the site root as well as from /static.

    Browsers ask for /favicon.ico whether or not the document links one, and a
    client sub-panel is served under a path prefix, so a relative reference is
    not dependable either. Answering here means the mark appears in the tab
    regardless of which of the two routes the browser chooses to take.
    """
    return FileResponse(BASE / "static" / "favicon.ico",
                        media_type="image/x-icon",
                        headers={"Cache-Control": "public, max-age=86400"})


@app.get("/apple-touch-icon.png", include_in_schema=False)
@app.get("/apple-touch-icon-precomposed.png", include_in_schema=False)
def apple_touch_icon():
    """Same reasoning for the icon iOS asks for by convention.

    The SVG is what is served: it is the same mark, and it scales, so there is no
    second raster file to keep in step with the first.
    """
    return FileResponse(BASE / "static" / "favicon.svg",
                        media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=86400"})

# Resolve /<client-slug> into a tenant before routing, so one routing table
# serves the platform panel and every client sub-panel. Added last => runs
# first, ahead of the session and security-header middleware.
app.add_middleware(TenantPrefixMiddleware, session_factory=SessionLocal)

app.include_router(web_router)
app.include_router(api_router)
app.include_router(dlr_router)


def _check_secret():
    weak = {"dev-only-change-me", "change-me-to-a-long-random-string",
            "local-dev-secret-not-for-production-use-only", ""}
    if settings.APP_SECRET_KEY in weak or len(settings.APP_SECRET_KEY) < 32:
        logging.getLogger("startup").warning(
            "APP_SECRET_KEY is weak/default - set a 48+ char random value in "
            ".env before exposing the panel (openssl rand -hex 48).")


def _ensure_user(db, email: str, password: str, role: str, tenant_id: int,
                 platform_admin: bool):
    """Create a login if one with this email does not already exist."""
    email = email.strip().lower()
    if not email:
        return
    if db.query(User).filter(User.email == email).first():
        return
    db.add(User(email=email, password_hash=hash_password(password),
                role=role, is_active=True, tenant_id=tenant_id,
                is_platform_admin=platform_admin))
    db.commit()
    logging.getLogger("startup").info("Seeded %s login: %s", role, email)


@app.on_event("startup")
def bootstrap():
    _check_secret()
    Base.metadata.create_all(bind=engine)
    # Bring an already-populated database up to the current schema, then make
    # sure nothing is left without an owning tenant.
    add_missing_columns()
    # Must run before anything seeds a group: a database built by an older
    # models.py enforces UNIQUE(groups.name) globally, which makes the second
    # tenant's "default" group fail and took /tenants/create down with a 500.
    drop_stale_unique_constraints()
    db = SessionLocal()
    try:
        platform = ensure_platform_tenant(db)
        backfill_tenants(db, platform.id)
        # First boot only: seed the initial admin + operator when there are no
        # logins yet. Once any login exists, a deleted login must STAY deleted,
        # so these are never re-created on a later restart. (If every login is
        # removed the seed runs again, which is the intended way back in rather
        # than a lockout.)
        if db.query(User).count() == 0:
            _ensure_user(db, settings.INITIAL_ADMIN_EMAIL,
                         settings.INITIAL_ADMIN_PASSWORD, "admin",
                         platform.id, True)
            _ensure_user(db, settings.INITIAL_OPERATOR_EMAIL,
                         settings.INITIAL_OPERATOR_PASSWORD, "operator",
                         platform.id, False)
        # Every tenant needs a default group, including the platform one. This
        # also repairs any client panel whose creation failed part-way and left
        # it with no group to attach recipients to.
        ensure_tenant_defaults(db)
        # Let existing clients use the /client sign-in without being issued new
        # credentials: their panel address becomes their sign-in name.
        ensure_client_usernames(db)
        # Global alert on/off switch defaults to ON.
        if not db.get(Setting, ALERTS_ENABLED_KEY):
            db.add(Setting(key=ALERTS_ENABLED_KEY, value="1"))
            db.commit()
    finally:
        db.close()
