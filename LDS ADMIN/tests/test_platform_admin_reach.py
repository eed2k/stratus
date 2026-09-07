"""Stratus Admin reaches every panel; a client login reaches only its own.

Asserted rather than assumed because the two halves pull in opposite directions
and both were touched this session. The users page was opened to operators with a
role filter, and the detector assignment page was added under
require_platform_admin, so the boundary between "may cross tenants" and "pinned to
one" is exactly what a mistake here would blur.
"""
from tests.util import get_csrf, login, seed_tenant, seed_user


def _estate(db):
    """A platform admin plus two clients, each with its own admin and operator."""
    from app.bootstrap import platform_tenant_id
    from app.db import SessionLocal
    s = SessionLocal()
    pid = platform_tenant_id(s)
    s.close()

    seed_user(db, pid, "stratus@metron.test", role="admin", platform_admin=True)
    a = seed_tenant(db, "quaggasklip", "Quaggasklip")
    b = seed_tenant(db, "gwld1", "Glencore Wonderkop")
    seed_user(db, a.id, "admin@quaggasklip.test", role="admin")
    seed_user(db, a.id, "operator@quaggasklip.test", role="operator")
    seed_user(db, b.id, "admin@gwld1.test", role="admin")
    seed_user(db, b.id, "operator@gwld1.test", role="operator")
    return pid, a, b


# ---------------------------------------------------------------------------
#  Stratus Admin may go anywhere
# ---------------------------------------------------------------------------

def test_platform_admin_reaches_the_platform_console(client, db_session):
    _estate(db_session)
    login(client, "", "stratus@metron.test")
    assert client.get("/tenants").status_code == 200
    assert client.get("/units").status_code == 200


def test_platform_admin_reaches_every_client_panel(client, db_session):
    _estate(db_session)
    login(client, "", "stratus@metron.test")
    for slug in ("quaggasklip", "gwld1"):
        r = client.get(f"/{slug}/recipients", follow_redirects=False)
        assert r.status_code == 200, f"platform admin blocked from /{slug}/"


def test_platform_admin_sees_a_clients_own_logins_including_its_admins(
        client, db_session):
    """The role filter added for operators must not narrow a Stratus Admin.

    They hold role 'admin', so they see the whole list of the panel they stepped
    into - and only that panel's, because scope() still applies.
    """
    _estate(db_session)
    login(client, "", "stratus@metron.test")
    body = client.get("/quaggasklip/users").text
    assert "admin@quaggasklip.test" in body
    assert "operator@quaggasklip.test" in body
    # Still one tenant at a time.
    assert "admin@gwld1.test" not in body


# ---------------------------------------------------------------------------
#  A client login may not
# ---------------------------------------------------------------------------

def test_a_client_admin_cannot_enter_another_clients_panel(client, db_session):
    _estate(db_session)
    login(client, "/quaggasklip", "admin@quaggasklip.test")
    r = client.get("/gwld1/recipients", follow_redirects=False)
    assert r.status_code == 303
    assert "/login" in r.headers.get("location", "")


def test_a_client_admin_cannot_reach_the_platform_console(client, db_session):
    _estate(db_session)
    login(client, "/quaggasklip", "admin@quaggasklip.test")
    for path in ("/tenants", "/units"):
        r = client.get(path, follow_redirects=False)
        assert r.status_code in (303, 404), f"{path} reachable by a client admin"


def test_a_client_operator_cannot_reach_the_platform_console(client, db_session):
    _estate(db_session)
    login(client, "/quaggasklip", "operator@quaggasklip.test")
    for path in ("/tenants", "/units"):
        r = client.get(path, follow_redirects=False)
        assert r.status_code in (303, 404)


def test_a_client_operator_sees_no_administrators_in_its_own_panel(client,
                                                                  db_session):
    _estate(db_session)
    login(client, "/quaggasklip", "operator@quaggasklip.test")
    body = client.get("/quaggasklip/users").text
    assert "operator@quaggasklip.test" in body
    assert "admin@quaggasklip.test" not in body
