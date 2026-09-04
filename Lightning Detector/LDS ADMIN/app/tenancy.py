"""Multi-tenant support: one lightning panel per client, at /<slug>.

Layout
------
  /                     platform panel (Stratus Admin)      tenant = bootstrap
  /tenants              client-panel management (platform admins only)
  /<slug>/...           that client's own panel, e.g. /glencore/recipients

How a request is bound to a tenant
----------------------------------
`TenantPrefixMiddleware` looks at the first path segment. If it matches an
active tenant slug it strips the segment from the path, records the tenant on
`request.state`, and sets `root_path` so the routing table below is reused
verbatim for every client. Nothing else in the app needs to know about slugs.

Isolation model
---------------
The session cookie stores both `uid` and `tid`. `current_user` (auth.py)
rejects the request unless the session's tenant matches the tenant resolved
from the URL, so a client cookie cannot be replayed against another client's
path. Every DB read then goes through `scope()` / `scoped_get()` here, which
filter on `tenant_id`; nothing queries a scoped table without them.

Platform admins are the single exception: they may enter any tenant's panel,
and their effective tenant is whatever the URL says.
"""
import re
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from .models import Tenant

# Path segments that are real routes on the platform panel and therefore can
# never be used as a client slug.
RESERVED_SLUGS = {
    "static", "login", "logout", "account", "recipients", "groups", "events",
    "test", "settings", "users", "tenants", "api", "alerts", "docs", "redoc",
    "openapi.json", "health", "healthz", "favicon.ico", "robots.txt", "dlr",
    "admin", "assets",
}

# Lower-case letters, digits and single inner hyphens. Keeps the slug safe in a
# URL path and stops traversal ("..") or separator ("/") tricks outright.
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$")


def normalize_slug(raw: str) -> str:
    """Fold user input into a candidate slug (does not validate)."""
    s = (raw or "").strip().lower()
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s[:40]


def validate_slug(raw: str) -> str:
    """Return a safe slug or raise a 400 explaining why it was refused."""
    s = normalize_slug(raw)
    if not s:
        return _bad("Enter a panel address (letters and numbers).")
    if not SLUG_RE.match(s):
        return _bad("Use 2-40 characters: lower-case letters, numbers, hyphens.")
    if s in RESERVED_SLUGS:
        return _bad(f"'{s}' is reserved by the panel. Choose another address.")
    return s


def _bad(msg: str):
    raise HTTPException(status_code=400, detail=msg)


class TenantPrefixMiddleware:
    """Strip a leading /<slug> and bind the request to that tenant.

    Pure ASGI (not BaseHTTPMiddleware) so it can rewrite `path` and `root_path`
    before routing happens. Unknown or inactive slugs are left untouched, which
    means they fall through to the normal 404 rather than leaking which client
    names exist.
    """

    def __init__(self, app, session_factory):
        self.app = app
        self.session_factory = session_factory

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "/")
        first = path.lstrip("/").split("/", 1)[0]
        tenant = None
        if first and first not in RESERVED_SLUGS and SLUG_RE.match(first):
            db = self.session_factory()
            try:
                tenant = (db.query(Tenant)
                            .filter(Tenant.slug == first,
                                    Tenant.is_active == True)  # noqa: E712
                            .first())
                if tenant is not None:
                    # Detach a plain snapshot: the session closes below, and the
                    # request must not hold a live ORM identity across it.
                    tenant = {"id": tenant.id, "slug": tenant.slug,
                              "name": tenant.name,
                              "site_name": tenant.site_name or tenant.name}
            finally:
                db.close()

        state = scope.setdefault("state", {})
        if tenant:
            prefix = "/" + tenant["slug"]
            remainder = path[len(prefix):] or "/"
            if not remainder.startswith("/"):
                # e.g. /glencorefoo must not be treated as tenant "glencore"
                state["url_tenant"] = None
                state["base"] = ""
                await self.app(scope, receive, send)
                return
            scope["path"] = remainder
            scope["raw_path"] = remainder.encode()
            scope["root_path"] = prefix
            state["url_tenant"] = tenant
            state["base"] = prefix
        else:
            state["url_tenant"] = None
            state["base"] = ""

        await self.app(scope, receive, send)


# ------------------------------ helpers -------------------------------
def url_tenant(request: Request) -> Optional[dict]:
    """The tenant addressed by the URL, or None on the platform panel."""
    return getattr(request.state, "url_tenant", None)


def base_path(request: Request) -> str:
    """URL prefix for links/redirects: "" on the platform panel, else /<slug>."""
    return getattr(request.state, "base", "") or ""


def redirect_to(request: Request, path: str) -> str:
    """Absolute path that stays inside the current panel."""
    return f"{base_path(request)}{path}" or "/"


def scope(query, model, tenant_id: int):
    """Constrain a query to one tenant. Used on every scoped-table read."""
    return query.filter(model.tenant_id == tenant_id)


def scoped_get(db: Session, model, pk, tenant_id: int):
    """Primary-key fetch that refuses to cross a tenant boundary.

    Returns None when the row belongs to another client, so callers treat it
    exactly like "not found" and never reveal that the id exists.
    """
    row = db.get(model, pk)
    if row is None:
        return None
    if getattr(row, "tenant_id", None) != tenant_id:
        return None
    return row


def get_tenant_or_404(db: Session, tenant_id: int) -> Tenant:
    t = db.get(Tenant, tenant_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Client panel not found")
    return t
