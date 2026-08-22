"""Schema top-up and first-run seeding.

The panel has no migration tool, and the live deployment already holds real
alert history, so this module brings an existing database up to the current
schema in place: it adds any missing column with ALTER TABLE and then files
every pre-existing row under the platform tenant. Both steps are idempotent,
so restarting the container repeatedly is harmless.
"""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .config import settings
from .db import engine
from .models import (Tenant, User, Group, Recipient, AlertEvent, UnitStatus,
                     HeartbeatSample)
from .tenancy import normalize_slug

log = logging.getLogger("bootstrap")

# table -> {column: DDL type}. Kept deliberately narrow: nullable columns only,
# which every supported backend can add to a populated table without a rewrite.
_ADDED_COLUMNS = {
    "users": {"tenant_id": "INTEGER", "is_platform_admin": "BOOLEAN"},
    "groups": {"tenant_id": "INTEGER"},
    "recipients": {"tenant_id": "INTEGER"},
    "alert_events": {"tenant_id": "INTEGER"},
    "unit_status": {"tenant_id": "INTEGER",
                    "site_label": "VARCHAR(120)",
                    "latitude": "FLOAT",
                    "longitude": "FLOAT"},
    "heartbeat_samples": {"tenant_id": "INTEGER"},
}


def add_missing_columns() -> None:
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            if table not in existing_tables:
                continue  # create_all() will build it complete
            present = {c["name"] for c in insp.get_columns(table)}
            for col, ddl in columns.items():
                if col in present:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                log.info("schema: added %s.%s", table, col)


def platform_tenant_slug() -> str:
    return normalize_slug(getattr(settings, "PLATFORM_TENANT_SLUG", "stratus")) \
        or "stratus"


def ensure_platform_tenant(db: Session) -> Tenant:
    """The tenant that owns Stratus' own panel and any unassigned detector."""
    slug = platform_tenant_slug()
    t = db.query(Tenant).filter(Tenant.slug == slug).first()
    if t is None:
        t = Tenant(slug=slug, name="Stratus Weather (platform)",
                   site_name=settings.SITE_NAME, is_active=True)
        db.add(t)
        db.commit()
        db.refresh(t)
        log.info("created platform tenant '%s' (id=%s)", slug, t.id)
    return t


def platform_tenant_id(db: Session):
    """Id of the platform tenant, or None if it has not been created yet."""
    t = db.query(Tenant).filter(Tenant.slug == platform_tenant_slug()).first()
    return t.id if t else None


def backfill_tenants(db: Session, tenant_id: int) -> None:
    """Attach every orphaned row to `tenant_id`.

    Runs once in practice: after the first pass nothing has a NULL tenant_id.
    Existing users additionally become platform admins, because before this
    change every admin was implicitly a Stratus admin.
    """
    total = 0
    for model in (Group, Recipient, AlertEvent, UnitStatus, HeartbeatSample, User):
        n = (db.query(model)
               .filter(model.tenant_id.is_(None))
               .update({model.tenant_id: tenant_id}, synchronize_session=False))
        total += n or 0
    # Pre-existing admins keep the reach they already had.
    db.query(User).filter(User.role == "admin",
                          User.is_platform_admin.is_(None))\
      .update({User.is_platform_admin: True}, synchronize_session=False)
    db.query(User).filter(User.is_platform_admin.is_(None))\
      .update({User.is_platform_admin: False}, synchronize_session=False)
    db.commit()
    if total:
        log.info("migrated %d existing row(s) to tenant id=%s", total, tenant_id)
