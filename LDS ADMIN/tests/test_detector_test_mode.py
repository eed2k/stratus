"""Detector test mode: the commissioning switch that suppresses alerting.

What is being protected here is a safety property, not a feature. While a station
is in test mode the panel records its strikes and sends nobody an SMS, so every
one of these matters:

  - only a platform admin can arm it,
  - it cannot be armed for longer than the ceiling,
  - it ends on its own without anything having to run,
  - a detector cannot arm itself, or label its own events as tests,
  - a test never claims the cooldown slot that a real strike needs,
  - and it is visible on the pages an operator actually looks at.
"""
from datetime import datetime, timedelta

import pytest

from app import runtime
from app.timeutil import now_sast
from tests.util import (login, get_csrf, seed_tenant, seed_user, seed_unit,
                        seed_strike)

# The ingest token from conftest. A detector presents it on every call, including
# the config poll: the poll tells an unauthenticated caller which stations are
# being worked on and when their alerting is suppressed.
TOKEN = {"X-Auth-Token": "test-token"}


def _acme(db):
    """One client with one detector. No platform tenant: the tests that use this
    never go through a route, and the app's own bootstrap owns that row."""
    acme = seed_tenant(db, "acme", "Acme Mine", "Acme Site")
    seed_unit(db, acme.id, "ACME1", site_label="Acme Pit")
    return acme


def _estate(db):
    """A platform admin and a client admin, for the route tests.

    The platform tenant is taken from the bootstrap rather than seeded: the
    `client` fixture runs the app's startup, which has already created it, and
    inserting a second one fails on tenants.slug.
    """
    from app.bootstrap import platform_tenant_id
    from app.db import SessionLocal
    s = SessionLocal()
    pid = platform_tenant_id(s)
    s.close()
    seed_user(db, pid, "root@stratus.test", role="admin", platform_admin=True)
    acme = _acme(db)
    seed_user(db, acme.id, "a@acme.test", role="admin")
    return pid, acme


# ---------------------------------------------------------------------------
# The runtime helpers
# ---------------------------------------------------------------------------

def test_off_by_default(db_session):
    _acme(db_session)
    assert runtime.test_mode_active(db_session, "ACME1") is False
    assert runtime.test_mode_remaining_s(db_session, "ACME1") == 0
    assert runtime.test_mode_stations(db_session) == []


def test_arming_and_ending(db_session):
    acme = _acme(db_session)
    until = runtime.set_test_mode(db_session, "ACME1", 15)
    assert until is not None
    assert runtime.test_mode_active(db_session, "ACME1") is True
    left = runtime.test_mode_remaining_s(db_session, "ACME1")
    assert 14 * 60 <= left <= 15 * 60
    assert runtime.test_mode_stations(db_session, tenant_id=acme.id) \
        == [("ACME1", left)] or runtime.test_mode_stations(
            db_session, tenant_id=acme.id)[0][0] == "ACME1"

    assert runtime.set_test_mode(db_session, "ACME1", 0) is None
    assert runtime.test_mode_active(db_session, "ACME1") is False


def test_the_ceiling_is_enforced_on_write(db_session):
    _acme(db_session)
    until = runtime.set_test_mode(db_session, "ACME1", 10_000)
    left = runtime.test_mode_remaining_s(db_session, "ACME1")
    assert left <= runtime.MAX_TEST_MODE_MIN * 60
    assert until <= now_sast() + timedelta(minutes=runtime.MAX_TEST_MODE_MIN)


def test_the_ceiling_is_enforced_on_read(db_session):
    """A row edited straight in the database must not outrank the ceiling."""
    from app.models import UnitStatus
    _acme(db_session)
    unit = db_session.get(UnitStatus, "ACME1")
    unit.test_mode_until = now_sast() + timedelta(days=7)
    db_session.commit()
    assert runtime.test_mode_remaining_s(db_session, "ACME1") \
        <= runtime.MAX_TEST_MODE_MIN * 60


def test_it_expires_without_anything_having_to_run(db_session):
    """Stored as an expiry on purpose: no sweeper, no cron, nothing to miss."""
    from app.models import UnitStatus
    _acme(db_session)
    unit = db_session.get(UnitStatus, "ACME1")
    unit.test_mode_until = now_sast() - timedelta(seconds=1)
    db_session.commit()
    assert runtime.test_mode_active(db_session, "ACME1") is False
    assert runtime.test_mode_stations(db_session) == []
    # The stale value is deliberately left in place; it simply reads as off.
    assert db_session.get(UnitStatus, "ACME1").test_mode_until is not None


def test_unknown_station_cannot_be_armed(db_session):
    _acme(db_session)
    with pytest.raises(LookupError):
        runtime.set_test_mode(db_session, "NOPE", 10)
    assert runtime.test_mode_remaining_s(db_session, "NOPE") == 0
    assert runtime.test_mode_remaining_s(db_session, "") == 0


def test_stations_are_scoped_to_their_client(db_session):
    acme = _acme(db_session)
    other = seed_tenant(db_session, "beta", "Beta Mine")
    seed_unit(db_session, other.id, "BETA1")
    runtime.set_test_mode(db_session, "BETA1", 10)

    assert [s for s, _ in runtime.test_mode_stations(db_session,
                                                    tenant_id=acme.id)] == []
    assert [s for s, _ in runtime.test_mode_stations(db_session,
                                                    tenant_id=other.id)] \
        == ["BETA1"]


# ---------------------------------------------------------------------------
# The schema
# ---------------------------------------------------------------------------

def test_new_columns_are_added_to_an_existing_database(tmp_path, monkeypatch):
    """Both columns have to arrive by ALTER TABLE on a populated database, and
    the DDL has to be a type every supported backend accepts."""
    from sqlalchemy import create_engine, inspect, text
    import app.bootstrap as bootstrap

    url = f"sqlite:///{tmp_path.as_posix()}/legacy.db"
    eng = create_engine(url)
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE unit_status ("
                          "station_id VARCHAR(64) PRIMARY KEY, "
                          "tenant_id INTEGER)"))
        conn.execute(text("CREATE TABLE alert_events ("
                          "id INTEGER PRIMARY KEY, station_id VARCHAR(64))"))
        conn.execute(text("INSERT INTO unit_status (station_id, tenant_id) "
                          "VALUES ('GWLD1', 1)"))
        conn.execute(text("INSERT INTO alert_events (id, station_id) "
                          "VALUES (1, 'GWLD1')"))
    monkeypatch.setattr(bootstrap, "engine", eng)

    bootstrap.add_missing_columns()
    units = {c["name"] for c in inspect(eng).get_columns("unit_status")}
    events = {c["name"] for c in inspect(eng).get_columns("alert_events")}
    assert "test_mode_until" in units
    assert "is_test" in events

    # Existing rows survive and read as "not testing" / "not a test".
    with eng.begin() as conn:
        assert conn.execute(text("SELECT test_mode_until FROM unit_status")
                            ).scalar() is None
        assert conn.execute(text("SELECT is_test FROM alert_events")
                            ).scalar() is None

    bootstrap.add_missing_columns()      # idempotent


def test_the_timestamp_ddl_is_portable():
    """DATETIME is not a Postgres type, and the live database may be Postgres.
    That DDL would raise inside the startup hook and take the panel down on
    deploy, which is a failure nobody sees until the container will not come
    up."""
    import app.bootstrap as bootstrap
    ddl = bootstrap._ADDED_COLUMNS["unit_status"]["test_mode_until"]
    assert ddl == "TIMESTAMP"


# ---------------------------------------------------------------------------
# The route
# ---------------------------------------------------------------------------

def test_platform_admin_can_arm_and_end_it(client, db_session):
    _estate(db_session)
    login(client, "", "root@stratus.test")
    csrf = get_csrf(client, "/units")

    r = client.post("/units/ACME1/test-mode",
                    data={"csrf_token": csrf, "minutes": "15"})
    assert r.status_code == 200
    assert "test mode for 15 minutes" in r.text
    assert runtime.test_mode_active(db_session, "ACME1") is True

    r = client.post("/units/ACME1/test-mode",
                    data={"csrf_token": csrf, "minutes": "0"})
    assert r.status_code == 200
    assert "alerting normally again" in r.text
    assert runtime.test_mode_active(db_session, "ACME1") is False


def test_a_client_admin_cannot_arm_it(client, db_session):
    """It switches alerting off for a detector. That is not a client's control,
    and require_platform_admin answers 404 rather than 403 so the route's
    existence is not advertised."""
    _estate(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/account/password")
    r = client.post("/acme/units/ACME1/test-mode",
                    data={"csrf_token": csrf, "minutes": "15"},
                    follow_redirects=False)
    assert r.status_code == 404
    assert runtime.test_mode_active(db_session, "ACME1") is False


def test_an_anonymous_post_cannot_arm_it(client, db_session):
    _estate(db_session)
    r = client.post("/units/ACME1/test-mode", data={"minutes": "15"},
                    follow_redirects=False)
    assert r.status_code in (303, 403, 404)
    assert runtime.test_mode_active(db_session, "ACME1") is False


def test_a_request_over_the_ceiling_is_refused_outright(client, db_session):
    """Refused, not silently clamped. Somebody asking for four hours has a
    different plan in mind and needs to be told, not quietly given one."""
    _estate(db_session)
    login(client, "", "root@stratus.test")
    csrf = get_csrf(client, "/units")
    r = client.post("/units/ACME1/test-mode",
                    data={"csrf_token": csrf, "minutes": "240"})
    assert r.status_code == 200
    assert f"0 to {runtime.MAX_TEST_MODE_MIN} minutes" in r.text
    assert runtime.test_mode_active(db_session, "ACME1") is False


def test_rubbish_input_is_refused(client, db_session):
    _estate(db_session)
    login(client, "", "root@stratus.test")
    csrf = get_csrf(client, "/units")
    for bad in ("", "abc", "-5", "1.5"):
        r = client.post("/units/ACME1/test-mode",
                        data={"csrf_token": csrf, "minutes": bad})
        assert r.status_code == 200, bad
        assert runtime.test_mode_active(db_session, "ACME1") is False, bad


def test_unknown_detector_is_a_404(client, db_session):
    _estate(db_session)
    login(client, "", "root@stratus.test")
    csrf = get_csrf(client, "/units")
    r = client.post("/units/NOPE/test-mode",
                    data={"csrf_token": csrf, "minutes": "15"},
                    follow_redirects=False)
    assert r.status_code == 404


def test_the_units_page_warns_while_it_is_on(client, db_session):
    _estate(db_session)
    runtime.set_test_mode(db_session, "ACME1", 15)
    login(client, "", "root@stratus.test")
    r = client.get("/units")
    assert r.status_code == 200
    assert "Test mode is on" in r.text
    assert "End test" in r.text


def test_the_client_dashboard_warns_while_it_is_on(client, db_session):
    """The banner belongs where somebody is watching during a storm, not only on
    the console where it was switched on."""
    _estate(db_session)
    login(client, "/acme", "a@acme.test")
    assert "Test mode is on" not in client.get("/acme/").text

    runtime.set_test_mode(db_session, "ACME1", 15)
    body = client.get("/acme/").text
    assert "Test mode is on" in body
    assert "no SMS is being sent" in body


def test_another_clients_test_mode_does_not_reach_this_dashboard(client,
                                                                 db_session):
    _estate(db_session)
    other = seed_tenant(db_session, "beta", "Beta Mine")
    seed_unit(db_session, other.id, "BETA1")
    runtime.set_test_mode(db_session, "BETA1", 15)
    login(client, "/acme", "a@acme.test")
    assert "Test mode is on" not in client.get("/acme/").text


# ---------------------------------------------------------------------------
# The detector-facing API
# ---------------------------------------------------------------------------

def test_detector_config_reports_the_window(client, db_session):
    _estate(db_session)
    r = client.get("/api/v1/detector/config?station_id=ACME1",
                   headers=TOKEN)
    assert r.status_code == 200
    body = r.json()
    assert body["station_id"] == "ACME1"
    assert body["test_mode"] is False
    assert body["test_mode_s"] == 0
    assert body["max_test_mode_s"] == runtime.MAX_TEST_MODE_MIN * 60

    runtime.set_test_mode(db_session, "ACME1", 10)
    body = client.get("/api/v1/detector/config?station_id=ACME1",
                      headers=TOKEN).json()
    assert body["test_mode"] is True
    assert 9 * 60 <= body["test_mode_s"] <= 10 * 60


def test_detector_config_returns_remaining_time_not_an_expiry(client,
                                                             db_session):
    """A remaining time needs no agreement about clocks or time zones, and a
    detector with a wrong clock still stops testing on schedule."""
    _estate(db_session)
    runtime.set_test_mode(db_session, "ACME1", 10)
    body = client.get("/api/v1/detector/config?station_id=ACME1",
                      headers=TOKEN).json()
    assert isinstance(body["test_mode_s"], int)
    assert "test_mode_until" not in body
    assert "expires_at" not in body


def test_detector_config_needs_the_ingest_token(client, db_session):
    """The poll says which stations are being worked on and when their alerting
    is suppressed. That is not a public reading."""
    _estate(db_session)
    assert client.get("/api/v1/detector/config?station_id=ACME1"
                      ).status_code == 401
    assert client.get("/api/v1/detector/config?station_id=ACME1",
                      headers={"X-Auth-Token": "wrong"}).status_code == 401


def test_detector_config_answers_off_for_an_unknown_station(client, db_session):
    """Acted on by an unattended process, so the unanswerable question has to
    read as off rather than as an error."""
    _estate(db_session)
    for qs in ("?station_id=NOPE", ""):
        body = client.get(f"/api/v1/detector/config{qs}",
                          headers=TOKEN).json()
        assert body["test_mode"] is False
        assert body["test_mode_s"] == 0


# ---------------------------------------------------------------------------
# Ingest and dispatch
# ---------------------------------------------------------------------------

def _ingest(client, station="ACME1", km=5, energy=120000):
    return client.post("/api/v1/lightning", headers=TOKEN, json={
        "station_id": station, "distance_km": km, "energy": energy,
        "timestamp": "2026-07-01T12:00:00+0200"})


def test_an_event_is_tagged_only_while_test_mode_is_on(client, db_session):
    from app.models import AlertEvent
    _estate(db_session)

    assert _ingest(client).json()["test_mode"] is False
    runtime.set_test_mode(db_session, "ACME1", 10)
    assert _ingest(client).json()["test_mode"] is True
    runtime.set_test_mode(db_session, "ACME1", 0)
    assert _ingest(client).json()["test_mode"] is False

    flags = [bool(e.is_test) for e in
             db_session.query(AlertEvent).order_by(AlertEvent.id).all()]
    assert flags == [False, True, False]


def test_a_detector_cannot_declare_its_own_event_a_test(client, db_session):
    """The panel decides. A detector that could label its own events could mark a
    real strike as a test, and a test sends nobody an SMS."""
    from app.models import AlertEvent
    _estate(db_session)
    r = client.post("/api/v1/lightning", headers=TOKEN, json={
        "station_id": "ACME1", "distance_km": 2, "energy": 500000,
        "timestamp": "2026-07-01T12:00:00+0200",
        "is_test": True, "test_mode": True})
    assert r.status_code == 200
    assert r.json()["test_mode"] is False
    event = db_session.query(AlertEvent).order_by(AlertEvent.id.desc()).first()
    assert bool(event.is_test) is False


def test_test_messages_are_recorded_as_skipped_and_never_sent(db_session,
                                                              monkeypatch):
    from app.models import AlertEvent, MessageLog, Recipient, Group
    from app import alert_worker, sms_gateway
    acme = _acme(db_session)

    group = Group(tenant_id=acme.id, name="control", distance_threshold_km=40,
                  is_active=True)
    db_session.add(group); db_session.commit()
    db_session.add(Recipient(tenant_id=acme.id, name="Shift", phone="+27820000000",
                             channel="sms", language="en", group_id=group.id,
                             is_active=True))
    db_session.commit()

    sent = []
    monkeypatch.setattr(sms_gateway, "send_sms",
                        lambda to, body: sent.append(to) or ("sent", "x"))

    event = AlertEvent(tenant_id=acme.id, station_id="ACME1", distance_km=5,
                       energy=120000, timestamp=now_sast(), is_test=True)
    db_session.add(event); db_session.commit()
    eid = event.id
    alert_worker._dispatch(eid, {"station_id": "ACME1", "distance_km": 5,
                                 "energy": 120000})

    assert sent == [], "an SMS went out for a test event"
    rows = db_session.query(MessageLog).filter(MessageLog.event_id == eid).all()
    assert [r.status for r in rows] == ["skipped"]
    assert rows[0].error == "Test mode"
    # The recipients it WOULD have gone to are still on record.
    db_session.refresh(event)
    assert event.recipients_targeted == 1
    assert event.messages_sent == 0


def test_a_test_does_not_burn_the_cooldown_slot(db_session, monkeypatch):
    """A bench test must not silence the next real strike in that band."""
    from app.models import AlertEvent
    from app import alert_worker
    acme = _acme(db_session)
    runtime.set_alert_cooldown_min(db_session, 30, tenant_id=acme.id)

    event = AlertEvent(tenant_id=acme.id, station_id="ACME1", distance_km=5,
                       energy=120000, timestamp=now_sast(), is_test=True)
    db_session.add(event); db_session.commit()
    alert_worker._dispatch(event.id, {"station_id": "ACME1", "distance_km": 5,
                                      "energy": 120000})

    assert runtime.get_last_alert_sent(db_session, tenant_id=acme.id) is None


def test_the_tag_is_shown_on_the_events_pages(client, db_session):
    from app.models import AlertEvent
    _, acme = _estate(db_session)
    event = AlertEvent(tenant_id=acme.id, station_id="ACME1", distance_km=5,
                       energy=120000, timestamp=now_sast(), is_test=True)
    db_session.add(event); db_session.commit()
    eid = event.id

    login(client, "/acme", "a@acme.test")
    assert "[test]" in client.get("/acme/events").text
    assert "[test]" in client.get("/acme/").text
    detail = client.get(f"/acme/events/{eid}").text
    assert "Recorded during a commissioning test" in detail
