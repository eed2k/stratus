"""Report builder: data gathering, HTML rendering, empty months (Task 9.4).

PDF generation is exercised only when WeasyPrint (and its native libraries) are
installed; otherwise that check is skipped.
"""
from datetime import datetime

import pytest

from app import reports

EM_DASH = "\u2014"


def _seed_month(db):
    from app.models import Tenant, HeartbeatSample, CalibrationEvent, AlertEvent
    from tests.util import seed_tenant, seed_unit
    t = seed_tenant(db, "acme", "Acme Mine", "Acme Site")
    seed_unit(db, t.id, "ACME1", site_label="Acme Pit", lat=-25.75, lon=27.25)

    base = datetime(2026, 6, 10, 8, 0, 0)
    for i in range(5):
        db.add(HeartbeatSample(tenant_id=t.id, station_id="ACME1",
                               ts=base.replace(hour=8 + i),
                               cpu_temp_c=40 + i, cpu_load_pct=10 + i))
    db.add(CalibrationEvent(tenant_id=t.id, station_id="ACME1", ts=base,
                            kind="rc_recal", reason="interval", cpu_temp_c=42))
    db.add(CalibrationEvent(tenant_id=t.id, station_id="ACME1", ts=base,
                            kind="antenna_check", reason="scheduled",
                            freq_hz=496000, in_tolerance=True,
                            tune_cap_before=7, tune_cap_after=7))
    db.add(AlertEvent(tenant_id=t.id, station_id="ACME1", timestamp=base,
                      distance_km=8, energy=600000))
    db.add(AlertEvent(tenant_id=t.id, station_id="ACME1", timestamp=base,
                      distance_km=3, energy=1600000))
    db.commit()
    return t


def test_gather_and_render_technical(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    assert data["has_data"] is True
    assert data["strikes"]["total"] == 2
    assert data["calibration"]["rc_recal_count"] == 1

    html = reports.render_report_html("technical", data)
    assert "Acme Pit" in html                 # site label
    assert "-25.75000, 27.25000" in html      # coordinates
    assert "Technical System and Health Report" in html
    assert "Arial" in html
    assert EM_DASH not in html


def test_render_client_report(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    html = reports.render_report_html("client", data)
    assert "Monthly Lightning Report" in html
    assert "Acme Pit" in html
    assert "Energy legend" in html
    assert "relative, dimensionless" in html
    assert EM_DASH not in html


def test_empty_month_is_valid_report(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2020, 1)
    assert data["has_data"] is False
    for rtype in ("technical", "client"):
        html = reports.render_report_html(rtype, data)
        assert "No " in html
        assert EM_DASH not in html


def test_unknown_report_type_raises(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    with pytest.raises(ValueError):
        reports.render_report_html("bogus", data)


def test_parse_month():
    assert reports.parse_month("2026-06") == (2026, 6)
    with pytest.raises(ValueError):
        reports.parse_month("2026-13")
    with pytest.raises(ValueError):
        reports.parse_month("nope")


def test_pdf_bytes_when_weasyprint_available(db_session):
    """Real PDF bytes, when WeasyPrint's native libraries are present.

    importorskip alone is not enough: the weasyprint package imports fine from
    a bare pip install, but it only loads Pango/GObject through cffi at call
    time. On a developer machine without those system libraries that surfaces
    as an OSError deep in cffi rather than an ImportError, which would fail the
    suite instead of skipping it. The Dockerfile installs the libraries, so
    this check does run and does assert real %PDF bytes inside the container.
    """
    # Importing weasyprint is itself what triggers the cffi dlopen of
    # gobject/pango, so the guard has to wrap the import, not just the render.
    try:
        from weasyprint import HTML  # noqa: F401  (probe the native stack)
    except ImportError as exc:  # pragma: no cover - depends on the host
        pytest.skip(f"WeasyPrint not installed: {exc}")
    except OSError as exc:  # pragma: no cover - depends on the host
        pytest.skip(f"WeasyPrint native libraries unavailable: {exc}")

    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    html = reports.render_report_html("technical", data)
    try:
        pdf = reports.build_report_pdf(html)
    except OSError as exc:  # pragma: no cover - depends on the host
        pytest.skip(f"WeasyPrint native libraries unavailable: {exc}")
    assert pdf[:5] == b"%PDF-"
