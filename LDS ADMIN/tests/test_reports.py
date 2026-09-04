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
    # Position is now worded exactly as Stratus words it: hemisphere letters
    # rather than a signed pair, so a client reading both products for one site
    # sees the same thing. Was "-25.75000, 27.25000".
    assert "Lat 25.75000 S" in html
    assert "Lon 27.25000 E" in html
    assert "Technical System and Health Report" in html
    assert "Arial" in html
    assert EM_DASH not in html


def test_render_client_report(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    html = reports.render_report_html("client", data)
    assert "Monthly Lightning Report" in html
    assert "Acme Pit" in html
    # Renamed from "Energy legend": the dashboard, the charts and the report
    # all say "intensity" now, and one system should use one word for one thing.
    assert "Intensity bands" in html
    assert "relative, dimensionless" in html
    assert EM_DASH not in html


def test_empty_month_is_valid_report(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2020, 1)
    assert data["has_data"] is False
    for rtype in reports.REPORT_TYPES:
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


# ---------------------------------------------------------------------------
# Calibration report
# ---------------------------------------------------------------------------

def test_calibration_data_is_gathered(db_session):
    """The raw calibration rows used to be discarded, leaving only counts, so an
    individual recalibration could not be audited."""
    t = _seed_month(db_session)
    cal = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)["calibration"]

    assert cal["total"] == 2
    assert cal["rc_recal_count"] == 1
    assert len(cal["antenna_checks"]) == 1
    assert len(cal["rc_recals"]) == 1
    assert len(cal["events"]) == 2

    # in_tolerance is nullable, so "unknown" must be its own bucket: a check that
    # reported no verdict is not a failed check.
    assert cal["antenna_pass"] == 1
    assert cal["antenna_fail"] == 0
    assert cal["antenna_unknown"] == 0
    assert cal["antenna_pass"] + cal["antenna_fail"] + cal["antenna_unknown"] \
        == len(cal["antenna_checks"])

    assert cal["freq_min"] == 496000
    assert cal["freq_max"] == 496000
    assert cal["freq_avg"] == 496000
    # tune_cap_before == tune_cap_after in the fixture, so nothing was adjusted.
    assert cal["tune_changes"] == 0
    assert cal["rc_reasons"] == [("interval", 1)]

    # The specification the measurement is judged against, from the datasheet.
    assert cal["target_hz"] == 500000
    assert cal["tolerance_pct"] == 3.5
    assert cal["tolerance_hz"] == 17500


def test_render_calibration_report(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    html = reports.render_report_html("calibration", data)

    assert "Detector Calibration Report" in html
    assert "Acme Pit" in html
    assert "Antenna resonance" in html
    assert "Oscillator recalibration" in html
    assert "496,000" in html                 # the measured frequency
    assert "500,000" in html                 # the specification
    assert "in tolerance" in html
    assert "Routine interval" in html        # reason rendered, not the raw slug
    assert EM_DASH not in html

    # The honest framing has to survive: this is evidence of self-calibration,
    # not an accredited certificate, and the reader must not infer traceability.
    assert "not a certificate of conformity" in html
    assert "not independent of the equipment under test" in html


def test_calibration_report_handles_a_month_with_no_activity(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2020, 1)
    html = reports.render_report_html("calibration", data)
    assert "No calibration activity was reported" in html
    # An empty month must not read as "calibration was skipped".
    assert "offline or newly commissioned" in html
    assert EM_DASH not in html


def test_calibration_is_offered_as_a_report_type():
    assert "calibration" in reports.REPORT_TYPES
    # Every type needs a human label, or the form offers a raw slug.
    for rtype in reports.REPORT_TYPES:
        assert rtype in reports.REPORT_LABELS
        assert reports.REPORT_LABELS[rtype] != rtype


# ---------------------------------------------------------------------------
# PDF presentation: page breaks, one font, semantic markup, text equivalents
# ---------------------------------------------------------------------------

def _all_reports(db_session):
    t = _seed_month(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    return {r: reports.render_report_html(r, data) for r in reports.REPORT_TYPES}


def test_every_report_controls_page_breaks(db_session):
    """Tables were splitting across A4 boundaries and headings were being
    stranded at the foot of a page, because no break rules existed at all."""
    for rtype, html in _all_reports(db_session).items():
        # A heading must not be the last thing on a page.
        assert "page-break-after: avoid" in html, rtype
        # Summary tables and charts are kept whole.
        assert "table.data { break-inside: avoid; page-break-inside: avoid; }" in html, rtype
        assert "figure { break-inside: avoid" in html, rtype
        # A log may span pages, but its header row repeats and no single row is
        # ever cut in half.
        assert "thead { display: table-header-group; }" in html, rtype
        assert "tr, th, td { break-inside: avoid" in html, rtype
        # No stranded single lines.
        assert "orphans: 3" in html and "widows: 3" in html, rtype


def test_every_report_uses_one_font_stack(db_session):
    """Three different stacks were in play: the report body, charts.py, and the
    legacy inline chart font.

    Quoting legitimately differs between the two contexts: a CSS rule can use
    double quotes, but an SVG font-family attribute is itself double-quoted and
    must use single quotes inside. So the comparison is made on the family list
    with quoting and spacing normalized away.
    """
    import re
    want = "arial, liberation sans, helvetica, sans-serif"
    pattern = re.compile(r'font-family\s*[:=]\s*(?:"([^"]*)"|([^;}]+))')

    for rtype, html in _all_reports(db_session).items():
        families = set()
        for m in pattern.finditer(html):
            raw = m.group(1) if m.group(1) is not None else m.group(2)
            norm = re.sub(r"\s+", " ", raw.replace('"', "").replace("'", "")).strip()
            # `inherit` is deliberate on headings: it takes the body stack.
            if norm.lower() != "inherit":
                families.add(norm.lower())
        assert families, rtype
        assert families == {want}, f"{rtype} mixes font stacks: {families}"


def test_every_report_numbers_its_pages(db_session):
    for rtype, html in _all_reports(db_session).items():
        assert "counter(page)" in html, rtype
        assert "counter(pages)" in html, rtype


def test_tables_are_semantic_not_layout(db_session):
    """Key/value pairs were marked up as tables, which made assistive technology
    announce them as grids with meaningless row and column relationships."""
    for rtype, html in _all_reports(db_session).items():
        assert "<thead>" in html and "<tbody>" in html, rtype
        assert 'scope="col"' in html, rtype
        # Metadata is a description list now.
        assert '<dl class="meta">' in html, rtype


def test_charts_carry_a_text_equivalent(db_session):
    """Every chart is an SVG. A reader using a screen reader, or looking at a
    monochrome printout, needs the finding in words as well."""
    for rtype, html in _all_reports(db_session).items():
        assert "<figure>" in html, rtype
        assert "<figcaption>" in html, rtype
        # The SVG itself is still labeled for assistive technology.
        assert 'role="img"' in html, rtype
        assert "aria-label=" in html, rtype


def test_css_safe_text_cannot_break_out_of_a_css_string():
    """The running footer embeds an operator-supplied site label in
    `content: "..."`. A quote there would close the string early and break the
    pagination of the whole report."""
    hostile = 'Acme "Pit" \\ <script>alert(1)</script>; } @page { size: A3 }'
    out = reports.css_safe_text(hostile)
    for ch in ('"', "'", "\\", "<", ">", "{", "}", ";", "@", "&"):
        assert ch not in out, f"{ch!r} survived sanitizing: {out!r}"
    assert "Acme" in out and "Pit" in out          # the readable part survives
    assert reports.css_safe_text(None) == ""
    assert reports.css_safe_text("   ") == ""
    assert len(reports.css_safe_text("x" * 500)) <= 90
    # Newlines would also terminate a CSS string literal.
    assert "\n" not in reports.css_safe_text("line one\nline two")


def test_footer_text_is_present_and_sanitized(db_session):
    from app.models import UnitStatus
    t = _seed_month(db_session)
    unit = db_session.get(UnitStatus, "ACME1")
    unit.site_label = 'Bad "Site" }'
    db_session.commit()

    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    assert '"' not in data["footer_text"] and "}" not in data["footer_text"]

    for rtype in reports.REPORT_TYPES:
        html = reports.render_report_html(rtype, data)
        # The sanitized value reached the footer, and no stray quote or brace
        # leaked into the @page rule.
        assert 'content: "Bad Site' in html, rtype
        assert "&quot;" not in html, rtype


def test_format_version_is_stable_and_short():
    v = reports.FORMAT_VERSION
    assert isinstance(v, str) and len(v) == 8
    assert v.isalnum()
    # Recomputing over unchanged files must give the same answer, or every
    # request would miss the cache.
    assert reports._format_version() == v


def test_cache_path_changes_when_the_layout_changes(monkeypatch):
    """A template change must invalidate cached PDFs.

    Regression: the cache key was station/month/type only, so after the report
    templates were rewritten the panel kept serving the previous design to
    anyone downloading an already-generated month.
    """
    from app.routes import web

    a = web._report_path("acme", "ACME1", 2026, 8, "technical")
    assert reports.FORMAT_VERSION in a.name

    monkeypatch.setattr(reports, "FORMAT_VERSION", "deadbeef")
    b = web._report_path("acme", "ACME1", 2026, 8, "technical")
    assert a != b, "cache path must change when the report format changes"
    assert "deadbeef" in b.name
    # Still confined to one directory per tenant and station.
    assert a.parent == b.parent


# ---------------------------------------------------------------------------
# Site line: wording shared with Stratus
# ---------------------------------------------------------------------------

def test_site_line_matches_the_stratus_wording():
    """Must be byte-identical to Stratus's formatSiteLine output.

    Reference (server/services/reportSchedulerService.ts):
        Lat 25.71682 S  |  Lon 27.39935 E  |  Altitude 1209 m AMSL

    Hemisphere letters rather than a signed number, two spaces either side of the
    pipe, altitude rounded to whole meters, ASCII only. If this drifts, a client
    holding a weather report and a lightning report for one site reads the
    position two different ways.
    """
    line = reports.format_site_line(-25.71682, 27.39935, 1209)
    assert line == "Lat 25.71682 S  |  Lon 27.39935 E  |  Altitude 1209 m AMSL"

    # Northern and eastern hemispheres.
    assert reports.format_site_line(51.5, -0.12, 11) == \
        "Lat 51.50000 N  |  Lon 0.12000 W  |  Altitude 11 m AMSL"

    # No degree sign: the PDF font is WinAnsi-encoded.
    assert "\u00b0" not in line
    assert line.isascii()


def test_site_line_omits_what_is_not_recorded():
    """Stratus omits the line rather than printing a placeholder, because in a
    formal report "not set" reads like a failed measurement."""
    assert reports.format_site_line(None, None, None) is None
    # Altitude alone is still worth stating.
    assert reports.format_site_line(None, None, 1200) == "Altitude 1200 m AMSL"
    # A half-set coordinate pair is not a position, so it is dropped.
    assert reports.format_site_line(-25.7, None, None) is None
    assert reports.format_site_line(None, 27.4, None) is None
    # Coordinates without an altitude are fine.
    assert reports.format_site_line(-25.7, 27.4, None) == \
        "Lat 25.70000 S  |  Lon 27.40000 E"


def test_site_line_survives_bad_input():
    nan = float("nan")
    assert reports.format_site_line(nan, 27.4, None) is None
    assert reports.format_site_line(-25.7, 27.4, nan) == \
        "Lat 25.70000 S  |  Lon 27.40000 E"
    assert reports.format_site_line("not a number", 27.4, None) is None
    assert reports.format_site_line(-25.7, 27.4, "high") == \
        "Lat 25.70000 S  |  Lon 27.40000 E"
    # Zero is a real altitude, not a missing one.
    assert reports.format_site_line(None, None, 0) == "Altitude 0 m AMSL"


def test_altitude_reaches_the_report(db_session):
    from app.models import UnitStatus
    t = _seed_month(db_session)
    unit = db_session.get(UnitStatus, "ACME1")
    unit.altitude_m = 1209
    db_session.commit()

    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    assert data["meta"]["altitude_m"] == 1209
    assert data["meta"]["site_line"] == \
        "Lat 25.75000 S  |  Lon 27.25000 E  |  Altitude 1209 m AMSL"

    for rtype in reports.REPORT_TYPES:
        html = reports.render_report_html(rtype, data)
        assert "Altitude 1209 m AMSL" in html, rtype


def test_position_row_is_dropped_when_nothing_is_recorded(db_session):
    from app.models import UnitStatus
    t = _seed_month(db_session)
    unit = db_session.get(UnitStatus, "ACME1")
    unit.latitude = None
    unit.longitude = None
    unit.altitude_m = None
    db_session.commit()

    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    assert data["meta"]["site_line"] is None
    for rtype in reports.REPORT_TYPES:
        html = reports.render_report_html(rtype, data)
        # No placeholder, and no empty "Position" label left behind.
        assert "not set" not in html, rtype
        assert "<dt>Position</dt>" not in html, rtype
