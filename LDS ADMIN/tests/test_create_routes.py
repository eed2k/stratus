"""Create-route regressions: the stale UNIQUE constraint and the 500 it caused.

Production hit this:

    POST /tenants/create -> sqlite3.IntegrityError:
    UNIQUE constraint failed: groups.name

models.py does not declare Group.name unique - the comment there is explicit
that names are per tenant, because two clients may each have a "control room"
group. The constraint only existed in the live database file, created by an
older models.py. create_all() adds missing tables and add_missing_columns() adds
missing columns, so neither could ever remove it.

Every tenant is seeded with a group named "default", so under a global unique
index the second client panel could not be created at all.

These tests therefore build the OLD schema with raw DDL first, the way
test_migration.py does. Running them against the current models alone would pass
without proving anything.
"""
import sqlalchemy as sa

from tests.util import login, get_csrf, seed_tenant, seed_user

LEGACY_GROUPS_DDL = """
CREATE TABLE groups (
    id INTEGER NOT NULL,
    name VARCHAR(80) NOT NULL,
    description TEXT,
    distance_threshold_km INTEGER,
    is_active BOOLEAN, tenant_id INTEGER,
    PRIMARY KEY (id),
    UNIQUE (name)
)
"""


def _legacy_groups_table():
    """Replace `groups` with the old, globally-unique-name version."""
    from app.db import engine
    with engine.begin() as conn:
        conn.execute(sa.text("DROP TABLE IF EXISTS groups"))
        conn.execute(sa.text(LEGACY_GROUPS_DDL))


def _unique_cols_on(table):
    from app.db import engine
    insp = sa.inspect(engine)
    cols = set()
    for ix in insp.get_indexes(table):
        if ix.get("unique"):
            cols.update(ix.get("column_names") or [])
    for uc in insp.get_unique_constraints(table):
        cols.update(uc.get("column_names") or [])
    return cols


# --------------------------------------------------------------------------
# The migration itself
# --------------------------------------------------------------------------

def test_legacy_schema_really_has_the_constraint():
    """Guard the guard: if this fails the other tests prove nothing."""
    _legacy_groups_table()
    assert "name" in _unique_cols_on("groups")


def test_migration_drops_the_stale_unique_constraint():
    from app.bootstrap import drop_stale_unique_constraints
    _legacy_groups_table()
    drop_stale_unique_constraints()
    assert "name" not in _unique_cols_on("groups")


def test_migration_preserves_existing_groups():
    from app.bootstrap import drop_stale_unique_constraints
    from app.db import engine
    _legacy_groups_table()
    with engine.begin() as conn:
        conn.execute(sa.text(
            "INSERT INTO groups (id, name, description, "
            "distance_threshold_km, is_active, tenant_id) "
            "VALUES (1, 'default', 'keep me', 15, 1, 1)"))
    drop_stale_unique_constraints()
    with engine.begin() as conn:
        rows = conn.execute(sa.text(
            "SELECT id, name, description, distance_threshold_km, tenant_id "
            "FROM groups")).fetchall()
    assert rows == [(1, "default", "keep me", 15, 1)]


def test_migration_leaves_recipients_foreign_key_pointing_at_groups():
    """The rebuild renames `groups` aside; SQLite must not rewrite the FK."""
    from app.bootstrap import drop_stale_unique_constraints
    from app.db import engine
    _legacy_groups_table()
    drop_stale_unique_constraints()
    insp = sa.inspect(engine)
    targets = {fk["referred_table"]
               for fk in insp.get_foreign_keys("recipients")}
    assert "groups__stale" not in targets
    with engine.begin() as conn:
        names = {r[0] for r in conn.execute(sa.text(
            "SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
    assert "groups__stale" not in names


def test_migration_is_idempotent():
    from app.bootstrap import drop_stale_unique_constraints
    _legacy_groups_table()
    drop_stale_unique_constraints()
    drop_stale_unique_constraints()          # must not raise
    assert "name" not in _unique_cols_on("groups")


def test_migration_keeps_constraints_the_models_do_declare():
    """Tenant.slug and User.email are genuinely unique and must survive."""
    from app.bootstrap import drop_stale_unique_constraints
    drop_stale_unique_constraints()
    assert "slug" in _unique_cols_on("tenants")
    assert "email" in _unique_cols_on("users")


# --------------------------------------------------------------------------
# Repairing panels the old bug left half-built
# --------------------------------------------------------------------------

def test_ensure_tenant_defaults_seeds_a_missing_group(db_session):
    """The live database had a tenant with users but no group."""
    from app.bootstrap import ensure_tenant_defaults
    from app.models import Group
    t = seed_tenant(db_session, slug="halfbuilt", name="Half Built")
    assert db_session.query(Group).filter(Group.tenant_id == t.id).count() == 0
    ensure_tenant_defaults(db_session)
    groups = db_session.query(Group).filter(Group.tenant_id == t.id).all()
    assert [g.name for g in groups] == ["default"]


def test_ensure_tenant_defaults_does_not_duplicate(db_session):
    from app.bootstrap import ensure_tenant_defaults
    from app.models import Group
    t = seed_tenant(db_session, slug="once", name="Once")
    ensure_tenant_defaults(db_session)
    ensure_tenant_defaults(db_session)
    assert db_session.query(Group).filter(Group.tenant_id == t.id).count() == 1


def test_two_tenants_may_both_have_a_default_group(db_session):
    """The behavior the stale constraint made impossible."""
    from app.bootstrap import ensure_tenant_defaults
    from app.models import Group
    a = seed_tenant(db_session, slug="alpha", name="Alpha")
    b = seed_tenant(db_session, slug="beta", name="Beta")
    ensure_tenant_defaults(db_session)
    names = {(g.tenant_id, g.name) for g in db_session.query(Group).all()}
    assert (a.id, "default") in names
    assert (b.id, "default") in names


# --------------------------------------------------------------------------
# The routes, end to end, on a legacy database
# --------------------------------------------------------------------------
# These build the TestClient by hand instead of taking the `client` fixture,
# because the legacy table has to exist BEFORE the app starts up: the point is
# that startup migrates it.

def _platform_admin(db):
    """A platform admin login on the tenant bootstrap created."""
    from app.config import settings
    from app.models import Tenant
    t = (db.query(Tenant)
         .filter(Tenant.slug == settings.PLATFORM_TENANT_SLUG).first())
    assert t is not None, "startup should have created the platform tenant"
    return seed_user(db, t.id, "platform.admin@test.local", role="admin",
                     platform_admin=True)


def test_tenant_create_succeeds_on_a_legacy_database(db_session):
    """The exact production failure: creating a client panel 500'd."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import Tenant, Group, User

    _legacy_groups_table()
    with TestClient(app) as c:              # startup migrates the schema
        _platform_admin(db_session)
        login(c, "", "platform.admin@test.local")
        token = get_csrf(c, "/tenants")
        r = c.post("/tenants/create",
                   data={"name": "Gwld One", "slug": "gwldone",
                         "admin_email": "admin@gwldone.test",
                         "admin_password": "averylongpassword",
                         "site_name": "GWLD One Site",
                         "csrf_token": token},
                   follow_redirects=False)

    assert r.status_code == 303, r.text[:400]
    t = db_session.query(Tenant).filter(Tenant.slug == "gwldone").first()
    assert t is not None
    # Complete, not half-built: the panel has its admin and its default group.
    assert db_session.query(User).filter(User.tenant_id == t.id).count() == 1
    groups = db_session.query(Group).filter(Group.tenant_id == t.id).all()
    assert [g.name for g in groups] == ["default"]


def test_second_tenant_can_also_be_created(db_session):
    """Two panels each need a group called "default"; the old schema forbade it."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import Group, Tenant

    _legacy_groups_table()
    with TestClient(app) as c:
        _platform_admin(db_session)
        login(c, "", "platform.admin@test.local")
        for slug in ("clienta", "clientb"):
            token = get_csrf(c, "/tenants")
            r = c.post("/tenants/create",
                       data={"name": slug.title(), "slug": slug,
                             "admin_email": f"admin@{slug}.test",
                             "admin_password": "averylongpassword",
                             "site_name": "", "csrf_token": token},
                       follow_redirects=False)
            assert r.status_code == 303, f"{slug}: {r.text[:400]}"

    defaults = (db_session.query(Group).filter(Group.name == "default").all())
    tenant_ids = {g.tenant_id for g in defaults}
    for slug in ("clienta", "clientb"):
        t = db_session.query(Tenant).filter(Tenant.slug == slug).first()
        assert t is not None and t.id in tenant_ids


def test_duplicate_slug_is_a_message_not_a_500(client, db_session):
    from app.models import Tenant
    _platform_admin(db_session)
    login(client, "", "platform.admin@test.local")
    seed_tenant(db_session, "taken", "Taken")
    token = get_csrf(client, "/tenants")
    r = client.post("/tenants/create",
                    data={"name": "Another", "slug": "taken",
                          "admin_email": "new@taken.test",
                          "admin_password": "averylongpassword",
                          "site_name": "", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "already exists" in r.text
    # Nothing partial was written.
    assert db_session.query(Tenant).filter(Tenant.slug == "taken").count() == 1


def test_failed_tenant_create_leaves_no_orphan_tenant(client, db_session):
    """A rejected create must not leave a panel nobody can sign in to."""
    from app.models import Tenant, User
    _platform_admin(db_session)
    login(client, "", "platform.admin@test.local")
    # Re-using an existing admin e-mail is refused after the tenant name is read.
    seed_user(db_session, _platform_tenant_id(db_session), "clash@test.local")
    token = get_csrf(client, "/tenants")
    r = client.post("/tenants/create",
                    data={"name": "Orphan Co", "slug": "orphanco",
                          "admin_email": "clash@test.local",
                          "admin_password": "averylongpassword",
                          "site_name": "", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "already in use" in r.text
    assert db_session.query(Tenant).filter(Tenant.slug == "orphanco").count() == 0


def _platform_tenant_id(db):
    from app.config import settings
    from app.models import Tenant
    t = (db.query(Tenant)
         .filter(Tenant.slug == settings.PLATFORM_TENANT_SLUG).first())
    return t.id


# --------------------------------------------------------------------------
# Groups
# --------------------------------------------------------------------------

def test_group_create_rejects_a_duplicate_name_with_a_message(client, db_session):
    from app.models import Group
    t = seed_tenant(db_session, "acme", "Acme")
    seed_user(db_session, t.id, "op@acme.test", role="operator")
    login(client, "/acme", "op@acme.test")

    token = get_csrf(client, "/acme/groups")
    r = client.post("/acme/groups/create",
                    data={"name": "Control Room", "description": "",
                          "distance_threshold_km": "15", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303

    token = get_csrf(client, "/acme/groups")
    r = client.post("/acme/groups/create",
                    data={"name": "control room", "description": "",
                          "distance_threshold_km": "15", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200, r.text[:300]
    assert "already exists" in r.text
    assert (db_session.query(Group)
            .filter(Group.tenant_id == t.id).count() == 1)


def test_two_tenants_may_use_the_same_group_name(client, db_session):
    """Per-tenant uniqueness, which is what models.py intends."""
    from app.models import Group
    a = seed_tenant(db_session, "alpha", "Alpha")
    b = seed_tenant(db_session, "beta", "Beta")
    seed_user(db_session, a.id, "a@alpha.test", role="operator")
    seed_user(db_session, b.id, "b@beta.test", role="operator")

    login(client, "/alpha", "a@alpha.test")
    token = get_csrf(client, "/alpha/groups")
    r = client.post("/alpha/groups/create",
                    data={"name": "Control Room", "description": "",
                          "distance_threshold_km": "15", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303

    login(client, "/beta", "b@beta.test")
    token = get_csrf(client, "/beta/groups")
    r = client.post("/beta/groups/create",
                    data={"name": "Control Room", "description": "",
                          "distance_threshold_km": "15", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303, r.text[:300]

    names = {(g.tenant_id, g.name) for g in db_session.query(Group).all()}
    assert (a.id, "Control Room") in names
    assert (b.id, "Control Room") in names


def test_group_create_rejects_a_blank_name(client, db_session):
    t = seed_tenant(db_session, "acme", "Acme")
    seed_user(db_session, t.id, "op@acme.test", role="operator")
    login(client, "/acme", "op@acme.test")
    token = get_csrf(client, "/acme/groups")
    r = client.post("/acme/groups/create",
                    data={"name": "   ", "description": "",
                          "distance_threshold_km": "15", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "Enter a name" in r.text


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------

def test_duplicate_user_email_renders_on_the_form(client, db_session):
    """Used to raise HTTPException, replacing the page with a bare error."""
    t = seed_tenant(db_session, "acme", "Acme")
    seed_user(db_session, t.id, "boss@acme.test", role="admin")
    login(client, "/acme", "boss@acme.test")
    token = get_csrf(client, "/acme/users")
    r = client.post("/acme/users/create",
                    data={"email": "boss@acme.test", "password": "averylongpassword",
                          "role": "operator", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "already exists" in r.text
    # Still a real page, not a bare error string.
    assert "<h1>Users</h1>" in r.text


def test_short_password_renders_on_the_form(client, db_session):
    t = seed_tenant(db_session, "acme", "Acme")
    seed_user(db_session, t.id, "boss@acme.test", role="admin")
    login(client, "/acme", "boss@acme.test")
    token = get_csrf(client, "/acme/users")
    r = client.post("/acme/users/create",
                    data={"email": "new@acme.test", "password": "short",
                          "role": "operator", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "at least" in r.text
