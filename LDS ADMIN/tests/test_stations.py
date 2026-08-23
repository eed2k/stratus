"""Station metadata management (Task 7): validation, persistence, isolation."""
from tests.util import (login, get_csrf, seed_tenant, seed_user, seed_unit)


def _setup(db):
    a = seed_tenant(db, "acme", "Acme", "Acme Site")
    b = seed_tenant(db, "beta", "Beta", "Beta Site")
    seed_user(db, a.id, "a@acme.test", role="operator")
    seed_user(db, b.id, "b@beta.test", role="admin")
    seed_user(db, a.id, "v@acme.test", role="viewer")
    seed_unit(db, a.id, "ACME1")
    seed_unit(db, b.id, "BETA1")
    return a, b


def _post_update(client, base, station, csrf, **fields):
    data = {"csrf_token": csrf, "site_label": "", "latitude": "", "longitude": ""}
    data.update(fields)
    return client.post(f"{base}/stations/{station}/update", data=data,
                       follow_redirects=False)


def test_writer_saves_valid_coords(client, db_session):
    from app.models import UnitStatus
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/stations")

    r = _post_update(client, "/acme", "ACME1", csrf,
                     site_label="Acme Pit", latitude="-25.75", longitude="27.25")
    assert r.status_code == 200

    db_session.expire_all()
    u = db_session.get(UnitStatus, "ACME1")
    assert u.site_label == "Acme Pit"
    assert abs(u.latitude + 25.75) < 1e-6
    assert abs(u.longitude - 27.25) < 1e-6


def test_invalid_coords_rejected(client, db_session):
    from app.models import UnitStatus
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/stations")

    r = _post_update(client, "/acme", "ACME1", csrf,
                     latitude="100", longitude="200")
    assert r.status_code == 200
    assert "Invalid coordinates" in r.text

    db_session.expire_all()
    u = db_session.get(UnitStatus, "ACME1")
    assert u.latitude is None and u.longitude is None


def test_blank_coords_clear(client, db_session):
    from app.models import UnitStatus
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/stations")
    _post_update(client, "/acme", "ACME1", csrf, latitude="-25.0", longitude="27.0")

    db_session.expire_all()
    assert db_session.get(UnitStatus, "ACME1").latitude == -25.0

    # Now clear them.
    csrf = get_csrf(client, "/acme/stations")
    _post_update(client, "/acme", "ACME1", csrf, site_label="Kept")
    db_session.expire_all()
    u = db_session.get(UnitStatus, "ACME1")
    assert u.latitude is None and u.longitude is None
    assert u.site_label == "Kept"


def test_cross_tenant_station_not_updatable(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/stations")
    # BETA1 is not owned by acme -> treated as not found.
    r = _post_update(client, "/acme", "BETA1", csrf, site_label="hack")
    assert r.status_code == 404


def test_other_tenant_page_bounces_to_login(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    r = client.get("/beta/stations", follow_redirects=False)
    assert r.status_code in (302, 303)
    assert "/beta/login" in r.headers.get("location", "")


def test_viewer_cannot_access_stations(client, db_session):
    _setup(db_session)
    login(client, "/acme", "v@acme.test")
    r = client.get("/acme/stations", follow_redirects=False)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Altitude
# ---------------------------------------------------------------------------

def test_altitude_saves_and_clears(client, db_session):
    from app.models import UnitStatus
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/stations")

    r = _post_update(client, "/acme", "ACME1", csrf,
                     latitude="-25.75", longitude="27.25", altitude_m="1209")
    assert r.status_code == 200
    db_session.expire_all()
    assert db_session.get(UnitStatus, "ACME1").altitude_m == 1209

    # Blank clears it without disturbing the coordinates.
    csrf = get_csrf(client, "/acme/stations")
    _post_update(client, "/acme", "ACME1", csrf,
                 latitude="-25.75", longitude="27.25", altitude_m="")
    db_session.expire_all()
    u = db_session.get(UnitStatus, "ACME1")
    assert u.altitude_m is None
    assert u.latitude == -25.75 and u.longitude == 27.25


def test_altitude_is_independent_of_coordinates(client, db_session):
    from app.models import UnitStatus
    """A surveyed elevation can exist without coordinates, and clearing the
    coordinates must not silently discard it."""
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/stations")

    _post_update(client, "/acme", "ACME1", csrf, altitude_m="1500")
    db_session.expire_all()
    u = db_session.get(UnitStatus, "ACME1")
    assert u.altitude_m == 1500
    assert u.latitude is None and u.longitude is None


def test_altitude_rejects_nonsense(client, db_session):
    from app.models import UnitStatus
    _setup(db_session)
    login(client, "/acme", "a@acme.test")

    for bad in ("abc", "99999", "-2000", "nan", "inf"):
        csrf = get_csrf(client, "/acme/stations")
        r = _post_update(client, "/acme", "ACME1", csrf, altitude_m=bad)
        assert r.status_code == 200
        assert "ltitude" in r.text, f"{bad!r} was accepted silently"
        db_session.expire_all()
        assert db_session.get(UnitStatus, "ACME1").altitude_m is None, bad


def test_altitude_accepts_sea_level_and_below(client, db_session):
    from app.models import UnitStatus
    """Zero is a real elevation, and a few sites genuinely sit below sea level."""
    _setup(db_session)
    login(client, "/acme", "a@acme.test")

    csrf = get_csrf(client, "/acme/stations")
    _post_update(client, "/acme", "ACME1", csrf, altitude_m="0")
    db_session.expire_all()
    assert db_session.get(UnitStatus, "ACME1").altitude_m == 0

    csrf = get_csrf(client, "/acme/stations")
    _post_update(client, "/acme", "ACME1", csrf, altitude_m="-300")
    db_session.expire_all()
    assert db_session.get(UnitStatus, "ACME1").altitude_m == -300
