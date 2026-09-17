"""Monthly PDF report generation: technical and client summary.

Data gathering and HTML rendering are kept separate from PDF conversion so the
logic can be unit-tested without the WeasyPrint system libraries present.
WeasyPrint is imported lazily inside build_report_pdf.

All reports use Arial (via the bundled Liberation fonts on the server), South
African English, and avoid em dashes. Charts are embedded as inline vector SVG.
"""
import logging
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

# `charts` is deliberately NOT imported any more. These reports are headings,
# text and tables only. charts.py still exists and is still used by the live
# dashboard for its no-JavaScript CPU fallback.
from .metrics import (sast_month_window, expected_hourly_samples, uptime_pct,
                      energy_bands_legend, distance_band_summary,
                      CPU_WARN_C, CPU_CRIT_C)
from .models import HeartbeatSample, CalibrationEvent, AlertEvent, UnitStatus
from .tenancy import scope
from .timeutil import now_sast

log = logging.getLogger("reports")

REPORT_TYPES = ("technical", "client", "calibration")


def _format_version():
    """Short hash of everything that determines a report's appearance.

    Generated PDFs are cached on disk by station, month and type. Nothing in that
    key describes the *layout*, so after a template change the cache kept serving
    the previous design: a client downloading last month's report would get the
    old one indefinitely, while a newly added type rendered fresh. That is
    exactly the kind of failure nobody notices, because the file downloads fine.

    Including this hash in the cache filename makes any change to the templates
    or the renderers invalidate the cache automatically, with no one having to
    remember to bump a number.

    Computed once at import. Templates only change on deploy, and a deploy
    restarts the process, so there is nothing to re-read at request time.
    """
    import hashlib
    h = hashlib.sha256()
    here = Path(__file__).resolve().parent
    parts = sorted((here / "templates" / "reports").glob("*.html"))
    parts += [here / "charts.py", here / "reports.py"]
    for p in parts:
        try:
            h.update(p.read_bytes())
        except OSError:
            # A missing file must not break report generation; the worst case is
            # a cache key that is stable when it could have changed.
            h.update(b"?")
    return h.hexdigest()[:8]


FORMAT_VERSION = _format_version()

# Human labels for the type slugs. The forms and the download table used to show
# the raw slug, so a client saw "client" as a report name.
REPORT_LABELS = {
    "technical": "Technical system and health",
    "client": "Client summary",
    "calibration": "Calibration certificate",
}

# AS3935 antenna resonance target: the LC oscillator is tuned to 500 kHz within
# 3.5 percent, per the datasheet. Used by the calibration report to state the
# specification a measurement is being judged against.
ANTENNA_TARGET_HZ = 500_000
ANTENNA_TOLERANCE_PCT = 3.5

_TEMPLATES = Path(__file__).resolve().parent / "templates"
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES)),
    autoescape=select_autoescape(["html", "xml"]),
)


# Characters kept by css_safe_text. Everything else becomes a space.
_CSS_TEXT_OK = re.compile(r"[^A-Za-z0-9 \-_.,()/:]+")


def css_safe_text(value, limit=90):
    """Reduce a string to characters safe inside a CSS string literal.

    The running footer puts the site name into `content: "..."` in an `@page`
    rule. That is a CSS string inside an HTML `<style>` element, where neither of
    the usual defenses applies: Jinja's HTML autoescaping would turn a quote into
    `&quot;`, which a CSS parser does not decode and would print literally, while
    an unescaped quote closes the string early and breaks the rule, and with it
    the pagination of the whole report.

    Site labels are operator-supplied, so rather than escape for two grammars at
    once this keeps a conservative whitelist: letters, digits, spaces and light
    punctuation. A footer needs nothing more.
    """
    text = _CSS_TEXT_OK.sub(" ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def parse_month(year_month):
    """Parse 'YYYY-MM' into (year, month). Raises ValueError on bad input."""
    parts = str(year_month).split("-")
    if len(parts) != 2:
        raise ValueError("month must be formatted YYYY-MM")
    year, month = int(parts[0]), int(parts[1])
    if not 1 <= month <= 12:
        raise ValueError("month must be 1..12")
    return year, month


def format_site_line(latitude, longitude, altitude_m):
    """Site geometry as one plain-text line, or None when nothing is recorded.

    Deliberately identical in wording to Stratus's
    server/services/reportSchedulerService.ts::formatSiteLine, so a client
    holding a Stratus weather report and an LDS lightning report for the same
    site reads the position the same way in both. The two products previously
    disagreed: Stratus wrote hemisphere letters and included altitude, while this
    panel wrote a signed comma-separated pair and had no altitude at all.

    Decimal degrees with an explicit hemisphere letter rather than a signed
    number, because a signed latitude on a printed report is easy to misread.
    Altitude is meters above mean sea level.

    ASCII only, no degree sign: the PDF renderer's font is WinAnsi-encoded, the
    same reason the reports write "deg C".

    Returns None when neither coordinates nor an altitude are on record, so the
    caller omits the line instead of printing "not set". Stratus does the same,
    and a placeholder in a formal report reads like a missing measurement rather
    than a field nobody filled in.
    """
    parts = []
    try:
        lat = float(latitude) if latitude is not None else None
        lon = float(longitude) if longitude is not None else None
    except (TypeError, ValueError):
        lat = lon = None
    # NaN fails every comparison, so exclude it explicitly rather than letting it
    # format as "nan".
    if (lat is not None and lon is not None
            and lat == lat and lon == lon):
        parts.append(f"Lat {abs(lat):.5f} {'N' if lat >= 0 else 'S'}")
        parts.append(f"Lon {abs(lon):.5f} {'E' if lon >= 0 else 'W'}")

    try:
        alt = float(altitude_m) if altitude_m is not None else None
    except (TypeError, ValueError):
        alt = None
    if alt is not None and alt == alt:
        parts.append(f"Altitude {round(alt)} m AMSL")

    return "  |  ".join(parts) if parts else None


def station_meta(db, tenant, station_id):
    """Resolve display metadata for a station within a tenant."""
    unit = db.get(UnitStatus, station_id)
    label, lat, lon, alt = None, None, None, None
    if unit is not None and unit.tenant_id == tenant.id:
        label = unit.site_label
        lat, lon = unit.latitude, unit.longitude
        alt = getattr(unit, "altitude_m", None)
    site = label or (tenant.site_name or "") or station_id
    return {
        "station_id": station_id,
        "site": site,
        "latitude": lat,
        "longitude": lon,
        "altitude_m": alt,
        "has_coords": lat is not None and lon is not None,
        # Shared wording with Stratus. None when nothing is on record.
        "site_line": format_site_line(lat, lon, alt),
        # Retained for anything still reading it, but reports now use site_line.
        "coords_text": (f"{lat:.5f}, {lon:.5f}"
                        if lat is not None and lon is not None
                        else "not set"),
    }


def gather_report_data(db, tenant, station_id, year, month):
    """Collect all figures and charts for one station-month, tenant-scoped."""
    start, nxt = sast_month_window(year, month)

    hbs = (scope(db.query(HeartbeatSample), HeartbeatSample, tenant.id)
           .filter(HeartbeatSample.station_id == station_id,
                   HeartbeatSample.ts >= start, HeartbeatSample.ts < nxt)
           .order_by(HeartbeatSample.ts.asc()).all())
    temps = [h.cpu_temp_c for h in hbs if h.cpu_temp_c is not None]
    warn_count = sum(1 for t in temps if t >= CPU_WARN_C)
    crit_count = sum(1 for t in temps if t >= CPU_CRIT_C)
    hours_seen = {h.ts.replace(minute=0, second=0, microsecond=0) for h in hbs}
    expected = expected_hourly_samples(year, month, now_sast())
    uptime = uptime_pct(len(hours_seen), expected)

    cals = (scope(db.query(CalibrationEvent), CalibrationEvent, tenant.id)
            .filter(CalibrationEvent.station_id == station_id,
                    CalibrationEvent.ts >= start, CalibrationEvent.ts < nxt)
            .order_by(CalibrationEvent.ts.asc()).all())
    rc_recals = [c for c in cals if c.kind == "rc_recal"]
    rc_recal_count = len(rc_recals)
    antenna_checks = [c for c in cals if c.kind == "antenna_check"]

    # Antenna resonance outcome. in_tolerance is nullable, so "unknown" is a
    # third state and must not be silently folded into "failed": a check that
    # never reported a verdict is not the same as one that failed.
    ant_pass = sum(1 for c in antenna_checks if c.in_tolerance is True)
    ant_fail = sum(1 for c in antenna_checks if c.in_tolerance is False)
    ant_unknown = sum(1 for c in antenna_checks if c.in_tolerance is None)
    freqs = [c.freq_hz for c in antenna_checks if c.freq_hz is not None]

    # Why the oscillator recalibrated. The detector reports "temp_delta" when
    # enclosure temperature drifted past its threshold and "interval" for the
    # routine timer, which is the difference between a thermally stressed
    # installation and a quiet one.
    rc_reasons = {}
    for c in rc_recals:
        key = c.reason or "unspecified"
        rc_reasons[key] = rc_reasons.get(key, 0) + 1
    tune_changes = sum(
        1 for c in antenna_checks
        if c.tune_cap_before is not None and c.tune_cap_after is not None
        and c.tune_cap_before != c.tune_cap_after)

    evs = (scope(db.query(AlertEvent), AlertEvent, tenant.id)
           .filter(AlertEvent.station_id == station_id,
                   AlertEvent.timestamp >= start, AlertEvent.timestamp < nxt)
           .order_by(AlertEvent.timestamp.asc()).all())
    distances = [e.distance_km for e in evs if e.distance_km is not None]
    energies = [e.energy for e in evs if e.energy is not None]
    closest = min(distances) if distances else None

    month_label = start.strftime("%B %Y")
    meta = station_meta(db, tenant, station_id)
    return {
        "tenant": tenant,
        "meta": meta,
        # Pre-sanitized for the running footer, which embeds it in a CSS string.
        "footer_text": css_safe_text(f"{meta['site']} - {month_label}"),
        "period": {"year": year, "month": month, "label": month_label,
                   "start": start, "end": nxt},
        "generated_at": now_sast(),
        "has_data": bool(hbs or cals or evs),
        "cpu": {
            "count": len(temps),
            "min": min(temps) if temps else None,
            "max": max(temps) if temps else None,
            "avg": (sum(temps) / len(temps)) if temps else None,
            "warn_count": warn_count, "crit_count": crit_count,
            "warn": CPU_WARN_C, "crit": CPU_CRIT_C,
        },
        "uptime_pct": uptime,
        "calibration": {
            "rc_recal_count": rc_recal_count,
            "antenna_checks": antenna_checks,
            "total": len(cals),
            # Added for the dedicated calibration report. The full event list
            # was previously discarded, so only the counts survived and an
            # individual recalibration could not be audited.
            "events": cals,
            "rc_recals": rc_recals,
            "rc_reasons": sorted(rc_reasons.items()),
            "antenna_pass": ant_pass,
            "antenna_fail": ant_fail,
            "antenna_unknown": ant_unknown,
            "freq_min": min(freqs) if freqs else None,
            "freq_max": max(freqs) if freqs else None,
            "freq_avg": (sum(freqs) / len(freqs)) if freqs else None,
            "tune_changes": tune_changes,
            # AS3935 antenna target and permitted deviation, from the
            # datasheet: the LC oscillator is tuned to 500 kHz +/- 3.5 percent.
            "target_hz": ANTENNA_TARGET_HZ,
            "tolerance_pct": ANTENNA_TOLERANCE_PCT,
            "tolerance_hz": round(ANTENNA_TARGET_HZ * ANTENNA_TOLERANCE_PCT / 100.0),
        },
        "strikes": {"total": len(evs), "closest": closest},
        "energy_legend": energy_bands_legend(),
        # No "charts" key. These reports carry headings, text and tables only, so
        # the five SVGs that used to be rendered here (CPU trend, distance
        # histogram, energy bands, uptime gauge and storm bands) are gone.
        #
        # Nothing is lost: every figure already had a caption stating the same
        # finding in words, because an SVG is unreadable to a screen reader and to
        # anyone holding a monochrome print. Those captions are now the prose, and
        # the underlying numbers were always in the tables beside them.
        #
        # charts.py itself stays: the live dashboard uses cpu_chart_svg for its
        # no-JavaScript fallback, and metrics.distance_band_summary is still the
        # single source both the panel and this report count bands with.
        "distance_bands": distance_band_summary(
            [{"distance_km": e.distance_km, "energy": e.energy} for e in evs]),
    }


def render_report_html(report_type, data):
    """Render the report HTML for the given type. Testable without WeasyPrint."""
    if report_type not in REPORT_TYPES:
        raise ValueError(f"unknown report type: {report_type}")
    template = _env.get_template(f"reports/{report_type}.html")
    return template.render(**data)


def build_report_pdf(html):
    """Convert report HTML to PDF bytes. WeasyPrint is imported lazily so the
    rest of the module works without its native libraries installed."""
    from weasyprint import HTML  # noqa: WPS433 (lazy import by design)
    return HTML(string=html).write_pdf()


def build_report(db, tenant, station_id, year, month, report_type):
    """Full pipeline: gather -> render HTML -> PDF bytes."""
    data = gather_report_data(db, tenant, station_id, year, month)
    html = render_report_html(report_type, data)
    return build_report_pdf(html)
