from passlib.context import CryptContext
from fastapi import Request, HTTPException, status, Depends
from sqlalchemy.orm import Session

from .db import get_db
from .models import User, Tenant
from .tenancy import url_tenant, base_path

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(p: str) -> str:
    return pwd_context.hash(p)


def verify_password(p: str, h: str) -> bool:
    return pwd_context.verify(p, h)


def _to_login(request: Request):
    """Bounce to the login page of the panel that was addressed."""
    return HTTPException(status_code=status.HTTP_303_SEE_OTHER,
                         headers={"Location": f"{base_path(request)}/login"})


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Authenticate, then bind the request to exactly one tenant.

    Three things must agree before a request is served:
      1. the session cookie identifies an active user,
      2. that user's tenant matches the tenant in the URL, and
      3. the session was issued for that same tenant.

    Platform admins are exempt from (2)/(3): they may enter any client's panel.
    The resolved tenant is written to request.state.tenant_id, which is the only
    value the route handlers are allowed to filter on.
    """
    uid = request.session.get("uid")
    if not uid:
        raise _to_login(request)
    user = db.query(User).filter(User.id == uid, User.is_active == True).first()  # noqa: E712
    if not user:
        request.session.clear()
        raise _to_login(request)

    urlt = url_tenant(request)
    url_tid = urlt["id"] if urlt else None
    session_tid = request.session.get("tid")

    if user.is_platform_admin:
        # Effective tenant follows the URL; on the platform panel it is the
        # admin's own (bootstrap) tenant.
        effective = url_tid if url_tid is not None else user.tenant_id
    else:
        # A client login is pinned to its tenant. Any mismatch between the
        # cookie, the user record and the URL is treated as not-logged-in for
        # this panel rather than an error that confirms the panel exists.
        if user.tenant_id is None:
            request.session.clear()
            raise _to_login(request)
        if session_tid is not None and session_tid != user.tenant_id:
            request.session.clear()
            raise _to_login(request)
        if url_tid is None or url_tid != user.tenant_id:
            raise _to_login(request)
        effective = user.tenant_id

    if effective is None:
        request.session.clear()
        raise _to_login(request)

    request.state.tenant_id = effective
    return user


def tenant_id(request: Request, user: User = Depends(current_user)) -> int:
    """The one tenant this request may touch. Depend on this in routes."""
    tid = getattr(request.state, "tenant_id", None)
    if tid is None:
        raise _to_login(request)
    return tid


def current_tenant(request: Request, user: User = Depends(current_user),
                   db: Session = Depends(get_db)) -> Tenant:
    tid = getattr(request.state, "tenant_id", None)
    t = db.get(Tenant, tid) if tid is not None else None
    if t is None:
        raise _to_login(request)
    return t


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def require_writer(user: User = Depends(current_user)) -> User:
    """Allow admin and operator. Block viewer from any write action."""
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Read-only account")
    return user


def require_platform_admin(user: User = Depends(current_user)) -> User:
    """Stratus Admin only: manage the list of client panels."""
    if not user.is_platform_admin:
        raise HTTPException(status_code=404, detail="Not found")
    return user
