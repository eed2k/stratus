import logging
import uuid
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .config import settings
from .db import Base, engine, SessionLocal
from .models import User, Setting
from .auth import hash_password
from .runtime import ALERTS_ENABLED_KEY
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
_SESSION_COOKIE = "__Host-stratus_session" if settings.SECURE_COOKIES \
    else "stratus_session"
app.add_middleware(SessionMiddleware,
                   secret_key=settings.APP_SECRET_KEY,
                   session_cookie=_SESSION_COOKIE,
                   same_site="strict",
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
        # Admin login (full access) and operator login (site user).
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
