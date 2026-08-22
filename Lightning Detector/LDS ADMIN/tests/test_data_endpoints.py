"""Tenant isolation and auth for the dashboard JSON endpoints (Task 6.3).

Property 1: a user only ever sees their own tenant's data.
"""
from datetime import timedelta

from tests.util import (login, seed_tenant, seed_user, seed_unit,
                        seed_heartbeat, seed_strike)


def _two_tenants(db):
    from app.timeutil import now_sast
    now = now_sast()
    a = seed_tenant(db, "acme", "Acme Mine", "Acme Site")
    b = seed_tenant(db, "beta", "Beta Mine", "Beta Site")
    seed_user(db, a.id, "a@acme.test", role="admin")
    seed_user(db, b.id, "b@beta.test", role="admin")
    seed_unit(db, a.id, "ACME1", site_label="Acme Pit")
    seed_unit(db, b.id, "BETA1", site_label="Beta Pit")
    seed_heartbeat(db, a.id, "ACME1", now - timedelta(hours=1), temp=41.0, load=12.0)
    seed_heartbeat(db, b.id, "BETA1", now - timedelta(hours=1), temp=55.0, load=80.0)
    seed_strike(db, a.id, "ACME1", now - timedelta(minutes=30), distance_km=8, energy=600000)
    seed_strike(db, b.id, "BETA1", now - timedelta(minutes=30), distance_km=3, energy=1600000)
    return a, b


def test_cpu_data_is_tenant_scoped(client, db_session):
    _two_tenants(db_session)
    login(client, "/acme", "a@acme.test")

    r = client.get("/acme/data/cpu?station=ACME1&range=24h")
    assert r.status_code == 200
    data = r.json()
    assert data["station"] == "ACME1"
    assert data["site"] == "Acme Pit"
    assert data["warn"] == 70.0 and data["crit"] == 78.0
    assert len(data["points"]) == 1
    assert data["points"][0]["temp"] == 41.0

    # Acme's login may not read Beta's panel: cross-tenant URL bounces to login.
    r = client.get("/beta/data/cpu?station=BETA1", follow_redirects=False)
    assert r.status_code in (302, 303)
    assert "/beta/login" in r.headers.get("location", "")


def test_strikes_data_is_tenant_scoped(client, db_session):
    _two_tenants(db_session)
    login(client, "/acme", "a@acme.test")

    r = client.get("/acme/data/strikes?window=1440")
    assert r.status_code == 200
    data = r.json()
    assert data["bearing_measured"] is False
    # Only Acme's strike is visible, with its energy band classified.
    assert len(data["strikes"]) == 1
    s = data["strikes"][0]
    assert s["distance_km"] == 8
    assert s["band"] == "Moderate"  # 600000 -> Moderate band


def test_data_requires_login(client, db_session):
    _two_tenants(db_session)
    r = client.get("/acme/data/cpu?station=ACME1", follow_redirects=False)
    assert r.status_code in (302, 303)
    assert "/acme/login" in r.headers.get("location", "")
