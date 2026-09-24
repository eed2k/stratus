"""The calibration record's spreadsheet form.

Two things are being protected here.

First, the CSV has to carry the same figures as the PDF certificate. It is built
from the same gather_report_data() dict for exactly that reason, and a test that
compares the two is what stops a future change to one quietly leaving the other
behind.

Second, it has to be readable as text. The original export in Stratus joined raw
values with commas, so a 25-character heading sat above a 4-character value and
nothing lined up. These tests assert the alignment, not just the content.
"""
from datetime import datetime

import pytest

from app import csvexport, reports
from tests.util import seed_tenant, seed_unit, seed_user, login, get_csrf

EM_DASH = "\u2014"
EN_DASH = "\u2013"
BOM = "\ufeff"


def _seed(db, slug="acme"):
    from app.models import CalibrationEvent, HeartbeatSample
    t = seed_tenant(db, slug, "Acme Mine", "Acme Site")
    seed_unit(db, t.id, "ACME1", site_label="Acme Pit", lat=-25.75, lon=27.25)

    base = datetime(2026, 6, 10, 8, 0, 0)
    for i in range(5):
        db.add(HeartbeatSample(tenant_id=t.id, station_id="ACME1",
                               ts=base.replace(hour=8 + i),
                               cpu_temp_c=40 + i, cpu_load_pct=10 + i))
    # Two antenna checks: one in tolerance with no adjustment, one out of
    # tolerance that moved the tuning capacitor. Both states have to appear.
    db.add(CalibrationEvent(tenant_id=t.id, station_id="ACME1", ts=base,
                            kind="antenna_check", reason="scheduled",
                            freq_hz=496000, in_tolerance=True,
                            tune_cap_before=7, tune_cap_after=7))
    db.add(CalibrationEvent(tenant_id=t.id, station_id="ACME1",
                            ts=base.replace(day=11),
                            kind="antenna_check", reason="scheduled",
                            freq_hz=478000, in_tolerance=False,
                            tune_cap_before=7, tune_cap_after=9))
    db.add(CalibrationEvent(tenant_id=t.id, station_id="ACME1", ts=base,
                            kind="rc_recal", reason="interval", cpu_temp_c=42))
    db.add(CalibrationEvent(tenant_id=t.id, station_id="ACME1",
                            ts=base.replace(day=12),
                            kind="rc_recal", reason="temp_delta",
                            cpu_temp_c=58.4))
    db.commit()
    return t


def _csv(db, tenant, year=2026, month=6):
    data = reports.gather_report_data(db, tenant, "ACME1", year, month)
    return reports.render_calibration_csv(data)


# ---------------------------------------------------------------------------
# The writer
# ---------------------------------------------------------------------------

def test_fields_are_quoted_to_rfc_4180():
    assert csvexport.csv_field("plain") == "plain"
    assert csvexport.csv_field(None) == ""
    assert csvexport.csv_field("a,b") == '"a,b"'
    assert csvexport.csv_field('say "hi"') == '"say ""hi"""'
    assert csvexport.csv_field("two\nlines") == '"two\nlines"'


def test_padding_goes_on_the_right_and_never_on_the_last_column():
    lines = csvexport.align_block([["heading", "n"], ["x", "12345"]])
    # Leading spaces are what make Excel import a numeric column as text, so the
    # pad has to follow the value, not precede it.
    assert lines[0] == "heading,n"
    assert lines[1] == "x      ,12345"
    # Nothing trailing at end of line.
    assert not any(ln.endswith(" ") for ln in lines)


def test_commas_line_up_down_the_block():
    """The defect this module exists to fix: columns that did not line up."""
    lines = csvexport.align_block([
        ["Date and time (SAST)", "Measured (Hz)", "Verdict"],
        ["2026-06-10 08:00", "496000", "in tolerance"],
        ["2026-06-11 08:00", "478000", "out of tolerance"],
    ])
    offsets = [[i for i, ch in enumerate(ln) if ch == ","] for ln in lines]
    assert offsets[0] == offsets[1] == offsets[2]


def test_a_section_title_does_not_set_the_column_width():
    """A one-cell row is a heading, not a table row. When it counted towards the
    width, "Oscillator recalibration by trigger" padded every label beneath it
    out to 35 characters and the table read worse than if it had been left
    unaligned."""
    lines = csvexport.align_block([
        ["Oscillator recalibration by trigger"],
        ["Trigger", "Count"],
        ["Routine interval", "1"],
    ])
    assert lines[0] == "Oscillator recalibration by trigger"
    assert lines[1] == "Trigger         ,Count"
    assert lines[2] == "Routine interval,1"


def test_each_block_is_aligned_on_its_own():
    """A two-column summary must not be stretched to a five-column log."""
    doc = csvexport.build_csv_document([
        [["Measure", "Value"], ["Samples", "5"]],
        [["a", "b", "c"], ["1", "2", "3"]],
    ])
    assert doc.startswith(BOM)
    body = doc[len(BOM):].rstrip("\n").split("\n")
    assert body == ["Measure,Value", "Samples,5", "", "a,b,c", "1,2,3"]


def test_notes_are_single_fields_at_the_end():
    doc = csvexport.build_csv_document([[["a", "b"]]], notes=("one, two",))
    assert doc[len(BOM):].rstrip("\n").split("\n")[-1] == '"one, two"'


# ---------------------------------------------------------------------------
# The calibration record
# ---------------------------------------------------------------------------

def test_calibration_csv_carries_the_record(db_session):
    t = _seed(db_session)
    text = _csv(db_session, t)

    # Excel reads the system code page unless told otherwise.
    assert text.startswith(BOM)
    assert text.endswith("\n")

    assert "Calibration record" in text
    assert "Acme Pit" in text
    assert "ACME1" in text
    # Position worded as Stratus words it, the same as the PDF.
    assert "Lat 25.75000 S" in text
    assert "June 2026" in text

    assert "Antenna resonance" in text
    assert "Antenna check log" in text
    assert "Oscillator recalibration log" in text
    assert "Operating temperature" in text

    # Both verdict states and the trigger labels, not the raw slugs.
    assert "in tolerance" in text
    assert "out of tolerance" in text
    assert "Routine interval" in text
    assert "Enclosure temperature drift" in text
    assert "temp_delta" not in text

    assert EM_DASH not in text and EN_DASH not in text


def test_numbers_are_plain_so_a_spreadsheet_reads_them_as_numbers(db_session):
    """The certificate writes 500,000 because it is being read. Here that comma
    would force the field to be quoted and the column to import as text."""
    t = _seed(db_session)
    text = _csv(db_session, t)

    assert "500000" in text
    assert "496000" in text
    assert "500,000" not in text
    assert "496,000" not in text
    # Deviation is signed, so a reader sees the direction of the error.
    assert "-4000" in text      # 496000 against the 500000 specification
    assert "-22000" in text     # 478000
    # Permitted deviation stays ASCII; the reports avoid non-ASCII symbols.
    assert "+/-17500" in text


def test_figures_match_the_pdf_certificate(db_session):
    """Same dict feeds both, so the counts cannot disagree."""
    t = _seed(db_session)
    data = reports.gather_report_data(db_session, t, "ACME1", 2026, 6)
    cal = data["calibration"]
    text = reports.render_calibration_csv(data)

    rows = dict()
    for line in text.split("\n"):
        parts = [p.strip() for p in line.split(",")]
        if len(parts) == 2:
            rows[parts[0]] = parts[1]

    assert rows["Total events"] == str(cal["total"]) == "4"
    assert rows["Oscillator recalibrations"] == str(cal["rc_recal_count"])
    assert rows["Antenna checks"] == str(len(cal["antenna_checks"]))
    assert rows["In tolerance"] == str(cal["antenna_pass"]) == "1"
    assert rows["Out of tolerance"] == str(cal["antenna_fail"]) == "1"
    assert rows["Verdict not reported"] == str(cal["antenna_unknown"])
    assert rows["Specification (Hz)"] == str(cal["target_hz"])
    assert rows["Tuning adjustments"] == str(cal["tune_changes"]) == "1"
    assert rows["Samples"] == str(data["cpu"]["count"])


def test_check_log_columns_line_up(db_session):
    t = _seed(db_session)
    body = _csv(db_session, t)[len(BOM):].split("\n")
    start = body.index("Antenna check log") + 1
    block = body[start:start + 3]          # header plus the two checks
    offsets = [[i for i, ch in enumerate(ln) if ch == ","] for ln in block]
    assert offsets[0] == offsets[1] == offsets[2], block


def test_the_caveat_survives_into_the_spreadsheet(db_session):
    """A CSV stripped of the framing would be quoted as a conformity result,
    which is exactly what this record is not."""
    t = _seed(db_session)
    text = _csv(db_session, t)
    assert "not a certificate of conformity" in text
    assert "not independent of the equipment under test" in text
    assert "METRON (PTY) LTD | Inteltronics" in text


def test_empty_month_says_so_without_reading_as_skipped_calibration(db_session):
    t = _seed(db_session)
    text = _csv(db_session, t, year=2020, month=1)
    assert "No calibration activity was reported for January 2020." in text
    assert "offline or newly commissioned" in text
    # No tables to speak of, so the section headings must not appear.
    assert "Antenna check log" not in text
    assert "Operating temperature" not in text


def test_csv_form_is_declared_for_calibration_only():
    assert reports.CSV_TYPES == ("calibration",)
    for rtype in reports.CSV_TYPES:
        assert rtype in reports.REPORT_TYPES
    with pytest.raises(ValueError):
        reports.build_report_csv(None, None, "ACME1", 2026, 6, "technical")


# ---------------------------------------------------------------------------
# The route
# ---------------------------------------------------------------------------

def _login_operator(client, db):
    t = _seed(db)
    seed_user(db, t.id, "a@acme.test", role="operator")
    login(client, "/acme", "a@acme.test")
    return t


def test_download_serves_csv(client, db_session):
    _login_operator(client, db_session)
    r = client.get("/acme/reports/download"
                   "?station=ACME1&month=2026-06&type=calibration&fmt=csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert 'filename="ACME1-2026-06-calibration.csv"' \
        in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbf")     # UTF-8 BOM
    assert "Antenna check log" in r.text


def test_pdf_is_still_the_default(client, db_session):
    _login_operator(client, db_session)
    import app.reports as reports_mod
    orig = reports_mod.build_report
    reports_mod.build_report = lambda *a, **k: b"%PDF-1.4\nfake\n"
    try:
        r = client.get("/acme/reports/download"
                       "?station=ACME1&month=2026-06&type=calibration")
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/pdf"
    finally:
        reports_mod.build_report = orig


def test_csv_is_refused_for_types_that_have_no_csv_form(client, db_session):
    """A link asking for CSV must not quietly answer with a PDF."""
    _login_operator(client, db_session)
    for rtype in ("technical", "client"):
        r = client.get(f"/acme/reports/download?station=ACME1&month=2026-06"
                       f"&type={rtype}&fmt=csv", follow_redirects=False)
        assert r.status_code == 404, rtype


def test_unknown_format_is_refused(client, db_session):
    _login_operator(client, db_session)
    r = client.get("/acme/reports/download"
                   "?station=ACME1&month=2026-06&type=calibration&fmt=xlsx",
                   follow_redirects=False)
    assert r.status_code == 404


def test_csv_respects_tenant_isolation(client, db_session):
    _login_operator(client, db_session)
    other = seed_tenant(db_session, "beta", "Beta Mine", "Beta Site")
    seed_unit(db_session, other.id, "BETA1")
    r = client.get("/acme/reports/download"
                   "?station=BETA1&month=2026-06&type=calibration&fmt=csv",
                   follow_redirects=False)
    assert r.status_code == 404


def test_reports_page_offers_the_csv_link(client, db_session):
    _login_operator(client, db_session)
    r = client.get("/acme/reports")
    assert r.status_code == 200
    assert "month=2026-06&type=calibration&fmt=csv" in r.text
    # And only for the types that have one.
    assert "type=technical&fmt=csv" not in r.text
    assert "type=client&fmt=csv" not in r.text
