"""Shared helpers for integration tests: seeding and login."""
import re


def _csrf(html):
    m = (re.search(r'name="csrf_token"[^>]*value="([^"]+)"', html)
         or re.search(r'value="([^"]+)"[^>]*name="csrf_token"', html))
    assert m, "csrf token not found on page"
    return m.group(1)


def get_csrf(client, path):
    """Fetch a page and extract its CSRF token (also primes the session)."""
    r = client.get(path)
    return _csrf(r.text)


def login(client, base, email, password="pw"):
    """Perform the real login flow. `base` is "" or "/<slug>"."""
    token = get_csrf(client, f"{base}/login")
    return client.post(
        f"{base}/login",
        data={"email": email, "password": password, "csrf_token": token},
        follow_redirects=False,
    )


def seed_tenant(db, slug, name=None, site_name=None):
    from app.models import Tenant
    t = Tenant(slug=slug, name=name or slug,
               site_name=site_name or name or slug, is_active=True)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def seed_user(db, tenant_id, email, role="admin", platform_admin=False,
              password="pw"):
    from app.models import User
    from app.auth import hash_password
    u = User(email=email.lower(), password_hash=hash_password(password),
             role=role, is_active=True, tenant_id=tenant_id,
             is_platform_admin=platform_admin)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def seed_unit(db, tenant_id, station_id, site_label=None, lat=None, lon=None):
    from app.models import UnitStatus
    u = UnitStatus(station_id=station_id, tenant_id=tenant_id,
                   site_label=site_label, latitude=lat, longitude=lon)
    db.add(u)
    db.commit()
    return u


def seed_heartbeat(db, tenant_id, station_id, ts, temp=40.0, load=10.0):
    from app.models import HeartbeatSample
    db.add(HeartbeatSample(tenant_id=tenant_id, station_id=station_id, ts=ts,
                           cpu_temp_c=temp, cpu_load_pct=load))
    db.commit()


def seed_strike(db, tenant_id, station_id, ts, distance_km=8.0, energy=600000):
    from app.models import AlertEvent
    db.add(AlertEvent(tenant_id=tenant_id, station_id=station_id, timestamp=ts,
                      distance_km=distance_km, energy=energy))
    db.commit()
