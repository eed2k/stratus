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
                     HeartbeatSample, Setting)
from .tenancy import normalize_slug

log = logging.getLogger("bootstrap")

# table -> {column: DDL type}. Kept deliberately narrow: nullable columns only,
# which every supported backend can add to a populated table without a rewrite.
_ADDED_COLUMNS = {
    "users": {"tenant_id": "INTEGER", "is_platform_admin": "BOOLEAN",
              "username": "VARCHAR(64)"},
    "groups": {"tenant_id": "INTEGER"},
    "recipients": {"tenant_id": "INTEGER"},
    "alert_events": {"tenant_id": "INTEGER"},
    "unit_status": {"tenant_id": "INTEGER",
                    "site_label": "VARCHAR(120)",
                    "latitude": "FLOAT",
                    "longitude": "FLOAT",
                    "altitude_m": "FLOAT"},
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


# ---------------------------------------------------------------------------
# Stale UNIQUE constraints left by older schemas
# ---------------------------------------------------------------------------
# Columns that must NOT be globally unique, but were in an earlier version of
# models.py. create_all() only creates missing tables and add_missing_columns()
# only adds columns, so neither can remove a constraint: a database created
# under the old models keeps enforcing it forever.
#
# This mattered in production. groups.name carried a table-level UNIQUE, while
# every tenant is seeded with a group named "default", so creating the second
# client panel raised
#     sqlite3.IntegrityError: UNIQUE constraint failed: groups.name
# and the request 500'd. The model is explicit that the intended scope is per
# tenant, not global: two clients may both have a "control room" group.
_STALE_UNIQUE = {
    "groups": {"name"},
    "recipients": {"name", "phone"},
}

# Model classes by table, so a rebuilt table is created from current metadata
# rather than hand-written DDL that could drift from models.py.
_MODEL_BY_TABLE = {
    "groups": Group,
    "recipients": Recipient,
}


def _single_column_unique_indexes(insp, table):
    """Unique indexes on `table` that cover exactly one column.

    Returns [(index_name_or_None, column)]. A name of None means the constraint
    is an implicit table-level UNIQUE (SQLite's sqlite_autoindex_*), which has
    no droppable index object and forces a table rebuild.
    """
    found = []
    for ix in insp.get_indexes(table):
        cols = list(ix.get("column_names") or [])
        if ix.get("unique") and len(cols) == 1:
            found.append((ix.get("name"), cols[0]))
    # Implicit UNIQUE(...) clauses are reported as unique constraints, not
    # indexes, by the SQLite dialect.
    try:
        for uc in insp.get_unique_constraints(table):
            cols = list(uc.get("column_names") or [])
            if len(cols) == 1:
                name = uc.get("name")
                if not any(c == cols[0] for _n, c in found):
                    found.append((name, cols[0]))
    except NotImplementedError:
        pass
    return found


def _rebuild_without_unique(conn, table):
    """Recreate `table` from current ORM metadata, dropping stale constraints.

    SQLite cannot ALTER away a table-level UNIQUE, so the table is rebuilt:
    drop its named indexes, rename it aside, create the current definition, copy
    the columns the two versions share, then drop the old copy.
    """
    model = _MODEL_BY_TABLE[table]
    insp = inspect(conn)
    old_cols = {c["name"] for c in insp.get_columns(table)}
    new_cols = [c.name for c in model.__table__.columns]
    common = [c for c in new_cols if c in old_cols]
    before = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()

    # Named indexes travel with the table across a rename and would then collide
    # with the ones create() is about to make, so remove them first.
    for ix in insp.get_indexes(table):
        if ix.get("name"):
            conn.execute(text(f'DROP INDEX IF EXISTS "{ix["name"]}"'))

    old = f"{table}__stale"
    conn.execute(text(f'DROP TABLE IF EXISTS "{old}"'))
    # legacy_alter_table keeps SQLite from rewriting other tables' foreign keys
    # to point at the renamed-aside copy. recipients.group_id must still
    # reference groups, not groups__stale, once this is done.
    conn.execute(text("PRAGMA legacy_alter_table=ON"))
    try:
        conn.execute(text(f'ALTER TABLE "{table}" RENAME TO "{old}"'))
    finally:
        conn.execute(text("PRAGMA legacy_alter_table=OFF"))

    model.__table__.create(bind=conn)
    cols = ", ".join(f'"{c}"' for c in common)
    conn.execute(text(f'INSERT INTO "{table}" ({cols}) SELECT {cols} FROM "{old}"'))
    after = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
    if after != before:
        # Leave the copy in place for inspection rather than lose rows.
        raise RuntimeError(
            f"rebuild of {table} copied {after} of {before} rows; "
            f'original retained as "{old}"')
    conn.execute(text(f'DROP TABLE "{old}"'))
    log.warning("schema: rebuilt %s without its stale UNIQUE constraint "
                "(%d row(s) preserved)", table, after)


def drop_stale_unique_constraints() -> None:
    """Remove UNIQUE constraints that the current models do not declare."""
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    for table, bad_cols in _STALE_UNIQUE.items():
        if table not in tables:
            continue
        model = _MODEL_BY_TABLE.get(table)
        if model is None:
            continue
        # Never remove something the models still ask for.
        declared = {c.name for c in model.__table__.columns if c.unique}
        offenders = [(name, col)
                     for name, col in _single_column_unique_indexes(insp, table)
                     if col in bad_cols and col not in declared]
        if not offenders:
            continue
        needs_rebuild = False
        with engine.begin() as conn:
            for name, col in offenders:
                # An implicit constraint has no real index to drop. SQLite names
                # these sqlite_autoindex_*, and they cannot be dropped directly.
                if name and not name.startswith("sqlite_autoindex"):
                    conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
                    log.warning("schema: dropped stale unique index %s on %s.%s",
                                name, table, col)
                else:
                    needs_rebuild = True
        if needs_rebuild:
            with engine.begin() as conn:
                _rebuild_without_unique(conn, table)


def ensure_tenant_defaults(db: Session) -> None:
    """Give every tenant the default recipient group it should have been seeded
    with.

    Repairs panels left half-built by the failure above: tenant_create committed
    the tenant, then failed inserting its admin user and default group, so the
    panel existed with no group to attach recipients to and therefore no way to
    alert anyone. Idempotent.
    """
    repaired = []
    for t in db.query(Tenant).all():
        if db.query(Group).filter(Group.tenant_id == t.id).first():
            continue
        db.add(Group(tenant_id=t.id, name="default",
                     description="Default recipient group",
                     distance_threshold_km=15, is_active=True))
        repaired.append(t.slug)
    if repaired:
        db.commit()
        log.warning("seeded a missing default group for tenant(s): %s",
                    ", ".join(repaired))


def ensure_client_usernames(db: Session) -> None:
    """Give each client panel's admin a sign-in name matching its address.

    Clients sign in at /client with a short name rather than an e-mail address,
    because they know their site as "GWLD1" and not as
    admin@gwld1.stratusweather.co.za. This derives that name from the panel's own
    slug, so an existing client can use the new login without anyone having to
    hand out fresh credentials.

    Deliberately conservative. A username is only assigned when:
      - the tenant is not the platform tenant (Stratus Admin sign in at /login),
      - the tenant has exactly ONE admin user, so there is no doubt which login
        the site's name should refer to,
      - that user has no username yet, and
      - the name is not already taken by another login.

    Anything ambiguous is left alone and logged rather than guessed at, because
    silently attaching a site's name to the wrong login would hand one client's
    panel to another. Idempotent.
    """
    platform_slug = platform_tenant_slug()
    assigned, skipped = [], []

    # One pass to collect the names already in use, compared case-insensitively
    # because that is how the login looks them up.
    taken = set()
    for u in db.query(User).all():
        if u.username:
            taken.add(u.username.strip().lower())

    for t in db.query(Tenant).all():
        if t.slug == platform_slug:
            continue
        candidate = (t.slug or "").strip().upper()
        if not candidate:
            continue
        if candidate.lower() in taken:
            continue          # already assigned, or claimed by another login
        # The panel's sign-in name goes to its OPERATOR login. Client panels no
        # longer hold admin logins at all: administration of the console is
        # Stratus' own, and a client's own login is an operator. A legacy admin
        # login is still accepted here so an existing panel does not lose its
        # sign-in name before those accounts are cleaned up.
        candidates_q = (db.query(User)
                        .filter(User.tenant_id == t.id,
                                User.role.in_(("operator", "admin")))
                        .all())
        admins = [u for u in candidates_q if u.role == "operator"] \
            or [u for u in candidates_q if u.role == "admin"]
        if len(admins) != 1:
            # Zero logins is a broken panel; more than one is ambiguous. Either
            # way an operator should choose, not this function.
            if admins:
                skipped.append(f"{t.slug} ({len(admins)} candidate logins)")
            continue
        admin = admins[0]
        if admin.username:
            continue
        admin.username = candidate
        taken.add(candidate.lower())
        assigned.append(f"{candidate} -> {admin.email}")

    if assigned:
        db.commit()
        log.info("client sign-in names assigned: %s", ", ".join(assigned))
    if skipped:
        log.warning("client sign-in name not assigned automatically for: %s "
                    "(set it on the Users page)", ", ".join(skipped))


def platform_tenant_slug() -> str:
    return normalize_slug(getattr(settings, "PLATFORM_TENANT_SLUG", "stratus")) \
        or "stratus"


def ensure_platform_tenant(db: Session) -> Tenant:
    """The tenant that owns Stratus' own panel and any unassigned detector."""
    slug = platform_tenant_slug()
    t = db.query(Tenant).filter(Tenant.slug == slug).first()
    if t is None:
        # site_name is the platform's own neutral name, never a client's. It used
        # to be seeded from the deployment-wide SITE_NAME, which meant the
        # platform tenant was literally named after the first client onboarded.
        t = Tenant(slug=slug, name="Stratus Weather (platform)",
                   site_name=settings.PLATFORM_NAME, is_active=True)
        db.add(t)
        db.commit()
        db.refresh(t)
        log.info("created platform tenant '%s' (id=%s)", slug, t.id)
    else:
        # Repair a platform tenant that was seeded from the old deployment-wide
        # SITE_NAME and so carries a client's name. Only touched when it still
        # matches that setting, so a name an admin has since chosen is left alone.
        stale = (settings.SITE_NAME or "").strip()
        current = (t.site_name or "").strip()
        if stale and current.casefold() == stale.casefold():
            t.site_name = settings.PLATFORM_NAME
            db.commit()
            log.warning("platform tenant site_name was %r (the deployment-wide "
                        "SITE_NAME, a client's name); reset to %r",
                        current, settings.PLATFORM_NAME)
    return t


def migrate_global_settings(db: Session, platform_id) -> None:
    """Move pre-multi-tenant Setting rows onto the platform tenant.

    Settings are stored as "t<tenant_id>:<key>", with bare "<key>" rows left over
    from before the console was multi-tenant. Reads used to fall back to the bare
    row when a tenant had none of its own, which quietly shared one client's
    configuration with every client that had not been configured yet. For
    last_alert_sent_at that meant one client's alert could start another client's
    cooldown and suppress its first message.

    That fallback is gone. This hands the leftover values to the platform tenant,
    which is who they belonged to, and removes the bare rows so nothing can read
    them again. Idempotent: after the first pass there are no bare rows.
    """
    if platform_id is None:
        return
    bare = [row for row in db.query(Setting).all() if ":" not in (row.key or "")]
    if not bare:
        return
    moved, dropped = [], []
    for row in bare:
        scoped_key = f"t{int(platform_id)}:{row.key}"
        if db.get(Setting, scoped_key) is None:
            db.add(Setting(key=scoped_key, value=row.value))
            moved.append(row.key)
        else:
            dropped.append(row.key)
        db.delete(row)
    db.commit()
    log.info("migrated global settings onto platform tenant %s: moved=%s "
             "already-present=%s", platform_id, moved or "-", dropped or "-")


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
