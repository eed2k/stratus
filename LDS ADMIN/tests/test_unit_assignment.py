"""Handing a detector to a client, and taking its history with it.

A detector files itself under the platform tenant on its first heartbeat. Before
this route existed there was no way to move it, so a unit stayed invisible to
every client panel and, because alert_worker consults no recipient list for an
event with no owning client, no alert was ever sent for it.
"""
from tests.util import get_csrf, login, seed_tenant, seed_user


def _platform_admin(db):
    """A Stratus Admin on the platform panel, plus a client to assign to."""
    from app.bootstrap import platform_tenant_id
    from app.db import SessionLocal
    s = SessionLocal()
    pid = platform_tenant_id(s)
    s.close()
    seed_user(db, pid, "stratus@metron.test", role="admin", platform_admin=True)
    client_t = seed_tenant(db, "quaggasklip", "Quaggasklip")
    return pid, client_t


def _seen_unit(db, station_id, tenant_id):
    from app.models import UnitStatus
    u = UnitStatus(station_id=station_id, tenant_id=tenant_id)
    db.add(u)
    db.commit()
    return u


def test_an_unassigned_detector_is_listed(client, db_session):
    pid, _c = _platform_admin(db_session)
    _seen_unit(db_session, "QUAGGASKLIP", pid)
    login(client, "", "stratus@metron.test")
    body = client.get("/units").text
    assert "QUAGGASKLIP" in body
    assert "unassigned" in body


def test_assigning_moves_the_detector_to_the_client(client, db_session):
    pid, c = _platform_admin(db_session)
    _seen_unit(db_session, "QUAGGASKLIP", pid)
    login(client, "", "stratus@metron.test")
    token = get_csrf(client, "/units")
    r = client.post("/units/QUAGGASKLIP/assign",
                    data={"tenant_id_form": str(c.id), "csrf_token": token})
    assert r.status_code == 200

    from app.models import UnitStatus
    db_session.expire_all()
    u = db_session.get(UnitStatus, "QUAGGASKLIP")
    assert u.tenant_id == c.id


def test_the_history_moves_with_the_detector(client, db_session):
    """A client handed a live detector with no past would not trust the panel."""
    from datetime import datetime
    from app.models import AlertEvent, HeartbeatSample, UnitStatus

    pid, c = _platform_admin(db_session)
    _seen_unit(db_session, "QUAGGASKLIP", pid)
    db_session.add(AlertEvent(tenant_id=pid, station_id="QUAGGASKLIP",
                              timestamp=datetime(2026, 9, 1, 12, 0),
                              distance_km=8.0, energy=500000))
    db_session.add(HeartbeatSample(tenant_id=pid, station_id="QUAGGASKLIP",
                                   ts=datetime(2026, 9, 1, 12, 0),
                                   cpu_temp_c=42.0))
    db_session.commit()

    login(client, "", "stratus@metron.test")
    token = get_csrf(client, "/units")
    client.post("/units/QUAGGASKLIP/assign",
                data={"tenant_id_form": str(c.id), "csrf_token": token})

    db_session.expire_all()
    assert db_session.query(AlertEvent).filter(
        AlertEvent.station_id == "QUAGGASKLIP",
        AlertEvent.tenant_id == c.id).count() == 1
    assert db_session.query(HeartbeatSample).filter(
        HeartbeatSample.station_id == "QUAGGASKLIP",
        HeartbeatSample.tenant_id == c.id).count() == 1
    assert db_session.get(UnitStatus, "QUAGGASKLIP").tenant_id == c.id


def test_the_assigned_detector_appears_on_the_client_panel(client, db_session):
    """The point of the whole exercise."""
    pid, c = _platform_admin(db_session)
    _seen_unit(db_session, "QUAGGASKLIP", pid)
    seed_user(db_session, c.id, "boss@quaggasklip.test", role="admin")

    login(client, "", "stratus@metron.test")
    token = get_csrf(client, "/units")
    client.post("/units/QUAGGASKLIP/assign",
                data={"tenant_id_form": str(c.id), "csrf_token": token})
    client.get("/logout")

    login(client, "/quaggasklip", "boss@quaggasklip.test")
    assert "QUAGGASKLIP" in client.get("/quaggasklip/stations").text


def test_a_client_admin_cannot_reach_the_assignment_page(client, db_session):
    """Assigning hardware between clients is a platform action."""
    _pid, c = _platform_admin(db_session)
    seed_user(db_session, c.id, "boss@quaggasklip.test", role="admin")
    login(client, "/quaggasklip", "boss@quaggasklip.test")
    r = client.get("/quaggasklip/units", follow_redirects=False)
    assert r.status_code in (303, 404)


def test_assigning_to_nothing_is_refused(client, db_session):
    pid, _c = _platform_admin(db_session)
    _seen_unit(db_session, "QUAGGASKLIP", pid)
    login(client, "", "stratus@metron.test")
    token = get_csrf(client, "/units")
    r = client.post("/units/QUAGGASKLIP/assign",
                    data={"tenant_id_form": "", "csrf_token": token})
    assert r.status_code == 200
    assert "Choose a client" in r.text

    from app.models import UnitStatus
    db_session.expire_all()
    assert db_session.get(UnitStatus, "QUAGGASKLIP").tenant_id == pid


def test_an_unknown_detector_is_a_404(client, db_session):
    pid, c = _platform_admin(db_session)
    # A real unit is seeded so the page renders a form to take the CSRF token
    # from; the assignment below still names a station that does not exist.
    _seen_unit(db_session, "QUAGGASKLIP", pid)
    login(client, "", "stratus@metron.test")
    token = get_csrf(client, "/units")
    r = client.post("/units/NOT-A-UNIT/assign",
                    data={"tenant_id_form": str(c.id), "csrf_token": token})
    assert r.status_code == 404
