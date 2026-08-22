"""Shared test fixtures.

Adds the panel package to the import path and configures an isolated,
file-based SQLite database so the app under test and the test code share the
same data. Pure-function tests (test_metrics.py) do not use these fixtures.
"""
import os
import sys
import tempfile
from pathlib import Path

# Make `import app...` work when pytest is run from the LDS ADMIN folder.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# A shared file-based SQLite DB (in-memory would not be visible across the
# separate connections the app and the tests each open). Set before app import
# so config/db pick it up.
_DB = Path(tempfile.gettempdir()) / "lds_admin_test.db"
try:
    _DB.unlink()
except FileNotFoundError:
    pass

os.environ["DATABASE_URL"] = f"sqlite:///{_DB.as_posix()}"
os.environ["SECURE_COOKIES"] = "false"
os.environ["APP_SECRET_KEY"] = "test-secret-key-that-is-long-enough-000000000000"
os.environ["ALERT_WEBHOOK_TOKEN"] = "test-token"
os.environ.setdefault("CLICKATELL_DLR_TOKEN", "")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_db():
    """Drop and recreate all tables before each test for isolation.

    Skipped silently for tests that never import the app (pure helpers).
    """
    try:
        from app.db import engine, Base
        from app import models  # noqa: F401  (registers tables on Base)
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
    except Exception:
        pass
    yield


@pytest.fixture()
def client():
    """A TestClient whose lifespan runs the app's startup bootstrap."""
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db_session():
    """A SQLAlchemy session on the same database the app uses."""
    from app.db import SessionLocal
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def seed_tenant(db, slug="acme", name="Acme Mine", site_name="Acme Site"):
    """Create and return an active tenant."""
    from app.models import Tenant
    t = Tenant(slug=slug, name=name, site_name=site_name, is_active=True)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def seed_user(db, tenant_id, email, role="operator", platform_admin=False,
              password="pw"):
    """Create and return a user in a tenant."""
    from app.models import User
    from app.auth import hash_password
    u = User(email=email.lower(), password_hash=hash_password(password),
             role=role, is_active=True, tenant_id=tenant_id,
             is_platform_admin=platform_admin)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u
