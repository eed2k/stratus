"""Monthly PDF report generation: technical and client summary.

Data gathering and HTML rendering are kept separate from PDF conversion so the
logic can be unit-tested without the WeasyPrint system libraries present.
WeasyPrint is imported lazily inside build_report_pdf.

All reports use Arial (via the bundled Liberation fonts on the server), South
African English, and avoid em dashes. Charts are embedded as inline vector SVG.
"""
import logging
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import charts
from .metrics import (sast_month_window, expected_hourly_samples, uptime_pct,
                      energy_bands_legend, CPU_WARN_C, CPU_CRIT_C)
from .models import HeartbeatSample, CalibrationEvent, AlertEvent, UnitStatus
from .tenancy import scope
from .timeutil import now_sast

log = logging.getLogger("reports")

REPORT_TYPES = ("technical", "client")

_TEMPLATES = Path(__file__).resolve().parent / "templates"
_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES)),
    autoescape=select_autoescape(["html", "xml"]),
)


def parse_month(year_month):
    """Parse 'YYYY-MM' into (year, month). Raises ValueError on bad input."""
    parts = str(year_month).split("-")
    if len(parts) != 2:
        raise ValueError("month must be formatted YYYY-MM")
    year, month = int(parts[0]), int(parts[1])
    if not 1 <= month <= 12:
        raise ValueError("month must be 1..12")
    return year, month


def station_meta(db, tenant, station_id):
    """Resolve display metadata for a station within a tenant."""
    unit = db.get(UnitStatus, station_id)
    label, lat, lon = None, None, None
    if unit is not None and unit.tenant_id == tenant.id:
        label = unit.site_label
        lat, lon = unit.latitude, unit.longitude
    site = label or (tenant.site_name or "") or station_id
    return {
        "station_id": station_id,
        "site": site,
        "latitude": lat,
        "longitude": lon,
        "has_coords": lat is not None and lon is not None,
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
    rc_recal_count = sum(1 for c in cals if c.kind == "rc_recal")
    antenna_checks = [c for c in cals if c.kind == "antenna_check"]

    evs = (scope(db.query(AlertEvent), AlertEvent, tenant.id)
           .filter(AlertEvent.station_id == station_id,
                   AlertEvent.timestamp >= start, AlertEvent.timestamp < nxt)
           .order_by(AlertEvent.timestamp.asc()).all())
    distances = [e.distance_km for e in evs if e.distance_km is not None]
    energies = [e.energy for e in evs if e.energy is not None]
    closest = min(distances) if distances else None

    month_label = start.strftime("%B %Y")
    return {
        "tenant": tenant,
        "meta": station_meta(db, tenant, station_id),
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
        "calibration": {"rc_recal_count": rc_recal_count,
                        "antenna_checks": antenna_checks,
                        "total": len(cals)},
        "strikes": {"total": len(evs), "closest": closest},
        "energy_legend": energy_bands_legend(),
        "charts": {
            "cpu": charts.cpu_trend_svg(
                hbs, t_start=start, t_end=nxt,
                title=f"CPU temperature (deg C) - {month_label}"),
            "distance": charts.distance_histogram_svg(distances),
            "energy": charts.energy_band_histogram_svg(energies),
            "uptime": charts.uptime_gauge_svg(uptime),
            "storm": charts.storm_rings_svg(
                [{"distance_km": e.distance_km, "energy": e.energy}
                 for e in evs], 40),
        },
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
