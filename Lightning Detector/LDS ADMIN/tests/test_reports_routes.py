"""Report access routes: listing, generation, download, roles, isolation
(Task 10). The PDF builder is mocked so these run without WeasyPrint.
"""
import pytest

from tests.util import (login, get_csrf, seed_tenant, seed_user, seed_unit,
                        seed_heartbeat)

FAKE_PDF = b"%PDF-1.4\n%fake report bytes\n"


@pytest.fixture(autouse=True)
def _mock_pdf(monkeypatch):
    import app.reports as reports_mod
    monkeypatch.setattr(reports_mod, "build_report",
                        lambda *a, **k: FAKE_PDF)
    yield


def _setup(db):
    from app.timeutil import now_sast
    a = seed_tenant(db, "acme", "Acme Mine", "Acme Site")
    b = seed_tenant(db, "beta", "Beta Mine", "Beta Site")
    seed_user(db, a.id, "a@acme.test", role="operator")
    seed_user(db, a.id, "v@acme.test", role="viewer")
    seed_user(db, b.id, "b@beta.test", role="admin")
    seed_unit(db, a.id, "ACME1", site_label="Acme Pit")
    seed_unit(db, b.id, "BETA1")
    seed_heartbeat(db, a.id, "ACME1", now_sast(), temp=40.0, load=10.0)
    return a, b


def test_reports_page_lists_download_links(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    r = client.get("/acme/reports")
    assert r.status_code == 200
    assert "/acme/reports/download?station=ACME1" in r.text
    assert "Generate a report" in r.text  # operator can generate


def test_viewer_sees_no_generate_form(client, db_session):
    _setup(db_session)
    login(client, "/acme", "v@acme.test")
    r = client.get("/acme/reports")
    assert r.status_code == 200
    assert "Generate a report" not in r.text
    # But viewer can still download.
    assert "/acme/reports/download?station=ACME1" in r.text


def test_generate_then_download(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    csrf = get_csrf(client, "/acme/reports")
    r = client.post("/acme/reports/generate",
                    data={"csrf_token": csrf, "station_id": "ACME1",
                          "month": "2026-06", "report_type": "technical"},
                    follow_redirects=False)
    assert r.status_code == 303
    loc = r.headers["location"]
    assert "/acme/reports/download?station=ACME1" in loc

    r = client.get(loc)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_download_regenerates_when_missing(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    r = client.get("/acme/reports/download?station=ACME1&month=2026-07&type=client")
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


def test_viewer_cannot_generate(client, db_session):
    _setup(db_session)
    login(client, "/acme", "v@acme.test")
    # The viewer reports page has no form; take a valid CSRF token from the
    # account page so this exercises the role gate, not the CSRF gate.
    csrf = get_csrf(client, "/acme/account/password")
    r = client.post("/acme/reports/generate",
                    data={"csrf_token": csrf, "station_id": "ACME1",
                          "month": "2026-06", "report_type": "technical"},
                    follow_redirects=False)
    assert r.status_code == 403


def test_cross_tenant_station_download_blocked(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    # BETA1 is not owned by acme -> not found.
    r = client.get("/acme/reports/download?station=BETA1&month=2026-06&type=technical",
                   follow_redirects=False)
    assert r.status_code == 404


def test_other_tenant_reports_page_bounces(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    r = client.get("/beta/reports", follow_redirects=False)
    assert r.status_code in (302, 303)
    assert "/beta/login" in r.headers.get("location", "")


def test_bad_report_type_rejected(client, db_session):
    _setup(db_session)
    login(client, "/acme", "a@acme.test")
    r = client.get("/acme/reports/download?station=ACME1&month=2026-06&type=bogus",
                   follow_redirects=False)
    assert r.status_code == 404
