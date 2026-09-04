import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .config import settings
from .db import Base, engine, SessionLocal
from .models import User, Group, Setting
from .auth import hash_password
from .runtime import ALERTS_ENABLED_KEY
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


BASE = Path(__file__).resolve().parent
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")

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


def _ensure_user(db, email: str, password: str, role: str):
    """Create a login if one with this email does not already exist."""
    email = email.strip().lower()
    if not email:
        return
    if db.query(User).filter(User.email == email).first():
        return
    db.add(User(email=email, password_hash=hash_password(password),
                role=role, is_active=True))
    db.commit()
    logging.getLogger("startup").info("Seeded %s login: %s", role, email)


@app.on_event("startup")
def bootstrap():
    _check_secret()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Admin login (full access) and operator login (site user).
        _ensure_user(db, settings.INITIAL_ADMIN_EMAIL,
                     settings.INITIAL_ADMIN_PASSWORD, "admin")
        _ensure_user(db, settings.INITIAL_OPERATOR_EMAIL,
                     settings.INITIAL_OPERATOR_PASSWORD, "operator")
        if not db.query(Group).first():
            db.add(Group(name="default", description="Default recipient group",
                         distance_threshold_km=15, is_active=True))
            db.commit()
        # Global alert on/off switch defaults to ON.
        if not db.get(Setting, ALERTS_ENABLED_KEY):
            db.add(Setting(key=ALERTS_ENABLED_KEY, value="1"))
            db.commit()
    finally:
        db.close()
