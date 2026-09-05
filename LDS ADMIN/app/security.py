"""Security helpers: CSRF tokens and login brute-force throttling.

Kept deliberately simple and dependency-free (in-memory). For a single
container this is sufficient; behind multiple workers move the throttle
state to the database or a shared cache.
"""
import secrets
import time
import threading

from fastapi import Request, Form, HTTPException

from .config import settings

CSRF_SESSION_KEY = "csrf"

# The message raised when a POST arrives without a usable token. Named so the
# error handler in main.py can recognize it and show the operator a way forward
# instead of a bare JSON body, without the two copies of the string drifting.
CSRF_ERROR_DETAIL = "Invalid or missing CSRF token"


# ----------------------------- CSRF ------------------------------------
def get_csrf_token(request: Request) -> str:
    """Return the per-session CSRF token, creating one if needed."""
    token = request.session.get(CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        request.session[CSRF_SESSION_KEY] = token
    return token


def verify_csrf(request: Request, csrf_token: str = Form("")):
    """Dependency for state-changing POSTs: reject mismatched/absent tokens."""
    expected = request.session.get(CSRF_SESSION_KEY, "")
    if not expected or not secrets.compare_digest(str(csrf_token), str(expected)):
        raise HTTPException(status_code=403, detail=CSRF_ERROR_DETAIL)


# ----------------------- Login throttling ------------------------------
_lock = threading.Lock()
_failures: dict[str, list[float]] = {}


def _client_key(request: Request) -> str:
    client = request.client
    return client.host if client else "unknown"


def _recent(key: str, now: float) -> list[float]:
    window = settings.LOGIN_FAILURE_WINDOW
    return [t for t in _failures.get(key, []) if now - t < window]


def login_allowed(request: Request) -> bool:
    """False once the client IP exceeds the failure budget in the window."""
    now = time.time()
    key = _client_key(request)
    with _lock:
        recent = _recent(key, now)
        _failures[key] = recent
        return len(recent) < settings.LOGIN_MAX_FAILURES


def record_login_failure(request: Request) -> None:
    now = time.time()
    key = _client_key(request)
    with _lock:
        recent = _recent(key, now)
        recent.append(now)
        _failures[key] = recent


def reset_login_failures(request: Request) -> None:
    key = _client_key(request)
    with _lock:
        _failures.pop(key, None)
