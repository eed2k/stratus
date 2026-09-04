"""Inline SVG charts, rendered on the server.

No charting library and no client-side JavaScript. The panel already draws its
report charts this way, and the reasons hold here too: the container stays small
enough to run alongside everything else on a 951 MB host, the page works with
scripting blocked, and a chart that is part of the HTML prints and screenshots
correctly without waiting for a canvas to paint.

Styling follows the panel: navy, white, black, neutral grays for frames.
"""
from __future__ import annotations

import html
import math
from datetime import datetime

NAVY = "#0a2540"
INK = "#111418"
MUTED = "#5b6875"
LINE = "#b9c2cf"
BAND = "#cdd8e6"
WARN = "#e08a1e"
BAD = "#c0392b"
GOOD = "#1f7a4d"


def _esc(text) -> str:
    return html.escape(str(text), quote=True)


def _nice_bounds(lo: float, hi: float) -> tuple[float, float]:
    """Round an axis outward to a readable step.

    A axis that starts at 11.06 and ends at 24.83 gives gridlines nobody can
    read against. Widening to a round step costs a little space and makes the
    numbers legible.
    """
    if hi < lo:
        lo, hi = hi, lo
    if abs(hi - lo) < 1e-9:
        lo, hi = lo - 1.0, hi + 1.0
    span = hi - lo
    raw = span / 4.0
    magnitude = 10.0 ** math.floor(math.log10(raw)) if raw > 0 else 1.0
    for mult in (1, 2, 2.5, 5, 10):
        step = magnitude * mult
        if step >= raw:
            break
    lo2 = math.floor(lo / step) * step
    hi2 = math.ceil(hi / step) * step
    return lo2, hi2


def series_chart(points: list[dict], variable: str, unit: str = "",
                 width: int = 940, height: int = 300,
                 observed: list[tuple[datetime, float]] | None = None,
                 title: str = "") -> str:
    """Forecast line with its confidence band, and observations where known.

    `points` are dicts with valid_at (datetime), value, p10, p90.

    Observations are drawn on the same axes on purpose. Once the forecast period
    has passed, the two lines side by side are the most direct answer to "was it
    right", and it is far more convincing than a table of error statistics.
    """
    if not points:
        return _empty_box(width, height,
                          "No forecast points for this variable.")

    xs = [p["valid_at"] for p in points]
    t0, t1 = xs[0], xs[-1]
    total = max(1.0, (t1 - t0).total_seconds())

    values = [p["value"] for p in points if p.get("value") is not None]
    lows = [p["p10"] for p in points if p.get("p10") is not None]
    highs = [p["p90"] for p in points if p.get("p90") is not None]
    obs_vals = [v for _t, v in (observed or [])]
    if not values and not obs_vals:
        return _empty_box(width, height, "No values to plot.")

    lo = min(values + lows + obs_vals) if (values or obs_vals) else 0.0
    hi = max(values + highs + obs_vals) if (values or obs_vals) else 1.0
    lo, hi = _nice_bounds(lo, hi)

    pad_l, pad_r, pad_t, pad_b = 58, 14, 26 if title else 12, 34
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    def sx(when: datetime) -> float:
        return pad_l + plot_w * ((when - t0).total_seconds() / total)

    def sy(value: float) -> float:
        return pad_t + plot_h * (1.0 - (value - lo) / (hi - lo))

    parts: list[str] = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="{_esc(title or variable)}" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]
    if title:
        parts.append(f'<text x="{pad_l}" y="16" font-size="12" fill="{NAVY}">'
                     f'{_esc(title)}</text>')

    # Gridlines and y labels.
    steps = 4
    for i in range(steps + 1):
        value = lo + (hi - lo) * i / steps
        y = sy(value)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + plot_w}" '
                     f'y2="{y:.1f}" stroke="{LINE}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{y + 3:.1f}" font-size="10" '
                     f'text-anchor="end" fill="{MUTED}">'
                     f'{value:.1f}</text>')

    # Day boundaries, so a 5 day forecast is readable.
    day = None
    for p in points:
        when = p["valid_at"]
        if day is None or when.date() != day:
            day = when.date()
            x = sx(when)
            parts.append(f'<line x1="{x:.1f}" y1="{pad_t}" x2="{x:.1f}" '
                         f'y2="{pad_t + plot_h}" stroke="{LINE}" '
                         f'stroke-width="1" stroke-dasharray="2 3"/>')
            parts.append(f'<text x="{x + 3:.1f}" '
                         f'y="{pad_t + plot_h + 13:.1f}" font-size="10" '
                         f'fill="{MUTED}">{when.strftime("%d %b")}</text>')

    # Confidence band.
    band = [p for p in points
            if p.get("p10") is not None and p.get("p90") is not None]
    if len(band) >= 2:
        top = " ".join(f"{sx(p['valid_at']):.1f},{sy(p['p90']):.1f}"
                       for p in band)
        bottom = " ".join(f"{sx(p['valid_at']):.1f},{sy(p['p10']):.1f}"
                          for p in reversed(band))
        parts.append(f'<polygon points="{top} {bottom}" fill="{BAND}" '
                     f'fill-opacity="0.55"/>')

    # Forecast line.
    line = [p for p in points if p.get("value") is not None]
    if len(line) >= 2:
        pts = " ".join(f"{sx(p['valid_at']):.1f},{sy(p['value']):.1f}"
                       for p in line)
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{NAVY}" '
                     f'stroke-width="2"/>')

    # Observations, drawn over the forecast.
    if observed:
        obs = [(t, v) for t, v in observed if t0 <= t <= t1]
        if len(obs) >= 2:
            pts = " ".join(f"{sx(t):.1f},{sy(v):.1f}" for t, v in obs)
            parts.append(f'<polyline points="{pts}" fill="none" '
                         f'stroke="{BAD}" stroke-width="1.6" '
                         f'stroke-dasharray="5 3"/>')

    parts.append(f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" '
                 f'height="{plot_h}" fill="none" stroke="#8c98a8" '
                 f'stroke-width="1"/>')
    if unit:
        parts.append(f'<text x="4" y="{pad_t + 10}" font-size="10" '
                     f'fill="{MUTED}">{_esc(unit)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def error_chart(timeline: list[dict], variable: str, unit: str = "",
                width: int = 940, height: int = 220) -> str:
    """Mean absolute error per day, so drift shows as a trend.

    An all-time average hides a sensor that started failing last week. A daily
    series does not.
    """
    rows = [r for r in timeline if r.get("mae") is not None]
    if not rows:
        return _empty_box(width, height,
                          "No scored days yet for this variable.")

    lo, hi = _nice_bounds(0.0, max(r["mae"] for r in rows))
    pad_l, pad_r, pad_t, pad_b = 58, 14, 14, 40
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    n = len(rows)
    slot = plot_w / n
    bar_w = max(3.0, min(38.0, slot * 0.6))

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Mean absolute error per day for {_esc(variable)}" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]

    def sy(value: float) -> float:
        return pad_t + plot_h * (1.0 - (value - lo) / (hi - lo))

    for i in range(5):
        value = lo + (hi - lo) * i / 4
        y = sy(value)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + plot_w}" '
                     f'y2="{y:.1f}" stroke="{LINE}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{y + 3:.1f}" font-size="10" '
                     f'text-anchor="end" fill="{MUTED}">{value:.2f}</text>')

    every = max(1, n // 12)
    for i, r in enumerate(rows):
        cx = pad_l + slot * (i + 0.5)
        y = sy(r["mae"])
        parts.append(f'<rect x="{cx - bar_w / 2:.1f}" y="{y:.1f}" '
                     f'width="{bar_w:.1f}" '
                     f'height="{pad_t + plot_h - y:.1f}" fill="{NAVY}"/>')
        if i % every == 0:
            parts.append(f'<text x="{cx:.1f}" y="{pad_t + plot_h + 14:.1f}" '
                         f'font-size="9" text-anchor="middle" fill="{MUTED}">'
                         f'{_esc(str(r["date"])[5:])}</text>')

    parts.append(f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" '
                 f'height="{plot_h}" fill="none" stroke="#8c98a8" '
                 f'stroke-width="1"/>')
    label = f"MAE {unit}".strip()
    parts.append(f'<text x="4" y="{pad_t + 10}" font-size="10" '
                 f'fill="{MUTED}">{_esc(label)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def skill_bar(skill: float | None, width: int = 130) -> str:
    """A small signed bar for a skill score, negative to the left of zero.

    Drawn rather than tabulated because the sign is the whole message and a
    minus sign in a dense table is easy to miss.
    """
    if skill is None:
        return '<span class="muted">n/a</span>'
    clamped = max(-1.0, min(1.0, skill))
    height = 12
    mid = width / 2.0
    length = abs(clamped) * (width / 2.0 - 2)
    color = GOOD if clamped > 0.02 else (BAD if clamped < -0.02 else MUTED)
    x = mid if clamped >= 0 else mid - length
    return (
        f'<svg viewBox="0 0 {width} {height}" width="{width}" '
        f'height="{height}" role="img" '
        f'aria-label="skill {skill:.2f}">'
        f'<rect x="0" y="0" width="{width}" height="{height}" '
        f'fill="#f4f6f9"/>'
        f'<rect x="{x:.1f}" y="2" width="{length:.1f}" height="{height - 4}" '
        f'fill="{color}"/>'
        f'<line x1="{mid}" y1="0" x2="{mid}" y2="{height}" '
        f'stroke="#8c98a8" stroke-width="1"/>'
        f'</svg>')


def _empty_box(width: int, height: int, message: str) -> str:
    return (
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="{_esc(message)}" '
        f'style="max-width:{width}px;height:auto;">'
        f'<rect x="0" y="0" width="{width}" height="{height}" '
        f'fill="#ffffff" stroke="#b9c2cf"/>'
        f'<text x="{width / 2}" y="{height / 2}" font-size="12" '
        f'text-anchor="middle" fill="{MUTED}">{_esc(message)}</text>'
        f'</svg>')


UNITS = {
    "temperature": "deg C",
    "dew_point": "deg C",
    "soil_temperature": "deg C",
    "humidity": "%",
    "pressure": "hPa",
    "wind_speed": "km/h",
    "wind_gust": "km/h",
    "wind_direction": "deg",
    "solar_radiation": "W/m2",
    "rainfall": "mm",
}

LABELS = {
    "temperature": "Air temperature",
    "dew_point": "Dew point",
    "soil_temperature": "Soil temperature",
    "humidity": "Relative humidity",
    "pressure": "Station pressure",
    "wind_speed": "Wind speed",
    "wind_gust": "Wind gust",
    "wind_direction": "Wind direction",
    "solar_radiation": "Solar radiation",
    "rainfall": "Rainfall",
}


def unit_for(variable: str) -> str:
    return UNITS.get(variable, "")


def label_for(variable: str) -> str:
    return LABELS.get(variable, variable.replace("_", " ").capitalize())


# ===========================================================================
#  Sector charts
#
#  Same conventions as the charts above: a viewBox with a percentage width so
#  the drawing scales, an aria-label so it is not an unlabeled image, and no
#  script anywhere. Each one degrades to a stated absence rather than an empty
#  frame, because a blank axis reads as a broken page.
# ===========================================================================

def wind_rose(sectors, width: int = 420, height: int = 420,
              title: str = "") -> str:
    """A wind rose from `wind.sector_statistics`, petals scaled by frequency.

    Frequency, not mean speed, sets the petal length, and the shading carries the
    mean speed. Length is what the eye reads first, and how often the wind comes
    from a sector is the question a rose is asked.
    """
    stats = [s for s in (sectors or []) if s is not None]
    if not stats:
        return _empty_box(width, height, "No wind direction data.")

    max_freq = max((s.frequency for s in stats), default=0.0)
    if max_freq <= 0.0:
        return _empty_box(width, height, "No wind direction data.")

    cx, cy = width / 2.0, height / 2.0 + 6
    radius = min(width, height) / 2.0 - 42
    speeds = [s.mean_speed_kmh for s in stats if s.count]
    fastest = max(speeds) if speeds else 1.0

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="{_esc(title or "Wind rose")}" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]
    if title:
        parts.append(f'<text x="{cx:.1f}" y="14" font-size="12" '
                     f'text-anchor="middle" fill="{NAVY}">{_esc(title)}</text>')

    # Range rings, labeled in percent so the petal lengths are readable.
    for frac in (0.25, 0.5, 0.75, 1.0):
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" '
                     f'r="{radius * frac:.1f}" fill="none" stroke="{LINE}" '
                     f'stroke-width="1"/>')
        parts.append(f'<text x="{cx + 3:.1f}" '
                     f'y="{cy - radius * frac + 10:.1f}" font-size="9" '
                     f'fill="{MUTED}">{max_freq * frac * 100:.0f}%</text>')

    for label, bearing in (("N", 0.0), ("E", 90.0), ("S", 180.0), ("W", 270.0)):
        rad = math.radians(bearing - 90.0)
        lx = cx + (radius + 16) * math.cos(rad)
        ly = cy + (radius + 16) * math.sin(rad) + 4
        parts.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-size="11" '
                     f'text-anchor="middle" fill="{INK}">{label}</text>')

    half = 360.0 / len(stats) / 2.0 * 0.86
    for s in stats:
        if not s.count:
            continue
        length = radius * (s.frequency / max_freq)
        a0 = math.radians(s.center_deg - half - 90.0)
        a1 = math.radians(s.center_deg + half - 90.0)
        x0 = cx + length * math.cos(a0)
        y0 = cy + length * math.sin(a0)
        x1 = cx + length * math.cos(a1)
        y1 = cy + length * math.sin(a1)
        # Darker petal means a faster mean wind from that sector.
        shade = 0.30 + 0.55 * (s.mean_speed_kmh / fastest if fastest else 0.0)
        parts.append(
            f'<path d="M {cx:.1f} {cy:.1f} L {x0:.1f} {y0:.1f} '
            f'A {length:.1f} {length:.1f} 0 0 1 {x1:.1f} {y1:.1f} Z" '
            f'fill="{NAVY}" fill-opacity="{min(0.92, shade):.2f}" '
            f'stroke="#ffffff" stroke-width="0.6"/>')

    parts.append(f'<text x="{cx:.1f}" y="{height - 6}" font-size="9" '
                 f'text-anchor="middle" fill="{MUTED}">'
                 f'Petal length: share of hours. Shading: mean speed, up to '
                 f'{fastest:.0f} km/h.</text>')
    parts.append("</svg>")
    return "".join(parts)


def poa_day_chart(rows, width: int = 940, height: int = 300,
                  title: str = "") -> str:
    """Irradiance through a day: clear sky, GHI and plane of array.

    Three lines on one axis because the comparison is the message. Clear sky is
    the ceiling for the day, GHI is what the sensor saw, and plane of array is
    what the modules receive; a tilted plane exceeding GHI in winter is the whole
    argument for tilting.
    """
    points = [r for r in (rows or []) if r.get("valid_at") is not None]
    if not points:
        return _empty_box(width, height, "No irradiance for this run.")

    t0, t1 = points[0]["valid_at"], points[-1]["valid_at"]
    total = max(1.0, (t1 - t0).total_seconds())
    values = [v for r in points
              for v in (r.get("ghi"), r.get("poa"), r.get("clear_sky"))
              if v is not None]
    if not values:
        return _empty_box(width, height, "No irradiance values to plot.")
    lo, hi = _nice_bounds(0.0, max(values))

    pad_l, pad_r, pad_t, pad_b = 58, 14, 26 if title else 12, 34
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    def sx(when) -> float:
        return pad_l + plot_w * ((when - t0).total_seconds() / total)

    def sy(value: float) -> float:
        return pad_t + plot_h * (1.0 - (value - lo) / (hi - lo))

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="{_esc(title or "Irradiance")}" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]
    if title:
        parts.append(f'<text x="{pad_l}" y="16" font-size="12" fill="{NAVY}">'
                     f'{_esc(title)}</text>')
    for i in range(5):
        value = lo + (hi - lo) * i / 4
        y = sy(value)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + plot_w}" '
                     f'y2="{y:.1f}" stroke="{LINE}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{y + 3:.1f}" font-size="10" '
                     f'text-anchor="end" fill="{MUTED}">{value:.0f}</text>')

    for key, color, dash in (("clear_sky", MUTED, "4 3"),
                             ("ghi", WARN, ""),
                             ("poa", NAVY, "")):
        line = [(r["valid_at"], r[key]) for r in points
                if r.get(key) is not None]
        if len(line) < 2:
            continue
        pts = " ".join(f"{sx(t):.1f},{sy(v):.1f}" for t, v in line)
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" '
                     f'stroke-width="2"{dash_attr}/>')

    day = None
    for r in points:
        when = r["valid_at"]
        if day is None or when.date() != day:
            day = when.date()
            x = sx(when)
            parts.append(f'<text x="{x + 3:.1f}" '
                         f'y="{pad_t + plot_h + 13:.1f}" font-size="10" '
                         f'fill="{MUTED}">{when.strftime("%d %b")}</text>')

    parts.append(f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" '
                 f'height="{plot_h}" fill="none" stroke="#8c98a8" '
                 f'stroke-width="1"/>')
    parts.append(f'<text x="4" y="{pad_t + 10}" font-size="10" '
                 f'fill="{MUTED}">W/m2</text>')
    parts.append("</svg>")
    return "".join(parts)


def reliability_diagram(rel, width: int = 380, height: int = 380) -> str:
    """Forecast probability against observed frequency, with the diagonal.

    The diagonal is perfect calibration. A point below it means the event
    happened less often than forecast, which for a frost warning is the
    dangerous direction, so the diagonal is drawn first and labeled.
    """
    if rel is None or not getattr(rel, "bins", None):
        return _empty_box(width, height,
                          "No probability forecasts scored yet.")

    pad = 46
    plot = min(width, height) - pad - 16

    def px(p: float) -> float:
        return pad + plot * max(0.0, min(1.0, p))

    def py(p: float) -> float:
        return pad + plot * (1.0 - max(0.0, min(1.0, p)))

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Reliability diagram" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
        f'<line x1="{px(0)}" y1="{py(0)}" x2="{px(1)}" y2="{py(1)}" '
        f'stroke="{MUTED}" stroke-width="1" stroke-dasharray="4 3"/>',
    ]
    for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
        parts.append(f'<line x1="{pad}" y1="{py(frac):.1f}" '
                     f'x2="{pad + plot}" y2="{py(frac):.1f}" '
                     f'stroke="{LINE}" stroke-width="1"/>')
        parts.append(f'<text x="{pad - 6}" y="{py(frac) + 3:.1f}" '
                     f'font-size="9" text-anchor="end" fill="{MUTED}">'
                     f'{frac * 100:.0f}%</text>')
        parts.append(f'<text x="{px(frac):.1f}" y="{pad + plot + 14:.1f}" '
                     f'font-size="9" text-anchor="middle" fill="{MUTED}">'
                     f'{frac * 100:.0f}%</text>')

    pts = []
    for b in rel.bins:
        x, y = px(b.forecast_mean), py(b.observed_frequency)
        pts.append(f"{x:.1f},{y:.1f}")
        # Radius carries the sample size, so a bin resting on one case cannot
        # be mistaken for a well-populated one.
        r = 3.0 + min(7.0, (b.n ** 0.5))
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" '
                     f'fill="{NAVY}" fill-opacity="0.75"/>')
    if len(pts) >= 2:
        parts.append(f'<polyline points="{" ".join(pts)}" fill="none" '
                     f'stroke="{NAVY}" stroke-width="1.6"/>')

    parts.append(f'<rect x="{pad}" y="{pad}" width="{plot}" height="{plot}" '
                 f'fill="none" stroke="#8c98a8" stroke-width="1"/>')
    parts.append(f'<text x="{pad}" y="{pad - 10}" font-size="10" '
                 f'fill="{MUTED}">observed frequency vs forecast '
                 f'probability</text>')
    parts.append(f'<text x="{width / 2:.0f}" y="{height - 6}" font-size="9" '
                 f'text-anchor="middle" fill="{MUTED}">'
                 f'Dashed line is perfect calibration. Circle size is the '
                 f'number of forecasts in the bin.</text>')
    parts.append("</svg>")
    return "".join(parts)


def rank_histogram_chart(hist, width: int = 380, height: int = 260) -> str:
    """Rank histogram bars, with the flat line a calibrated ensemble expects.

    The reference line is what makes the shape readable: bars above it at both
    ends is a too-narrow ensemble, and that is the failure worth spotting.
    """
    if hist is None or not getattr(hist, "counts", None):
        return _empty_box(width, height, "No ensemble forecasts scored yet.")

    counts = hist.counts
    n = len(counts)
    pad_l, pad_r, pad_t, pad_b = 46, 12, 16, 44
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    top = max(max(counts), 1)
    lo, hi = 0.0, float(top)
    slot = plot_w / n
    bar_w = max(3.0, slot * 0.72)

    def sy(value: float) -> float:
        return pad_t + plot_h * (1.0 - (value - lo) / (hi - lo))

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Rank histogram" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]
    for i in range(5):
        value = lo + (hi - lo) * i / 4
        y = sy(value)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + plot_w}" '
                     f'y2="{y:.1f}" stroke="{LINE}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{y + 3:.1f}" font-size="9" '
                     f'text-anchor="end" fill="{MUTED}">{value:.0f}</text>')

    for i, count in enumerate(counts):
        cx = pad_l + slot * (i + 0.5)
        y = sy(count)
        parts.append(f'<rect x="{cx - bar_w / 2:.1f}" y="{y:.1f}" '
                     f'width="{bar_w:.1f}" '
                     f'height="{pad_t + plot_h - y:.1f}" fill="{NAVY}"/>')

    if hist.pairs:
        expected = hist.pairs / n
        ey = sy(expected)
        parts.append(f'<line x1="{pad_l}" y1="{ey:.1f}" '
                     f'x2="{pad_l + plot_w}" y2="{ey:.1f}" stroke="{BAD}" '
                     f'stroke-width="1.4" stroke-dasharray="5 3"/>')

    parts.append(f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" '
                 f'height="{plot_h}" fill="none" stroke="#8c98a8" '
                 f'stroke-width="1"/>')
    parts.append(f'<text x="{pad_l}" y="{pad_t + plot_h + 14:.1f}" '
                 f'font-size="9" fill="{MUTED}">below all</text>')
    parts.append(f'<text x="{pad_l + plot_w:.1f}" '
                 f'y="{pad_t + plot_h + 14:.1f}" font-size="9" '
                 f'text-anchor="end" fill="{MUTED}">above all</text>')
    parts.append(f'<text x="{width / 2:.0f}" y="{height - 6}" font-size="9" '
                 f'text-anchor="middle" fill="{MUTED}">'
                 f'Dashed line is a flat, calibrated spread.</text>')
    parts.append("</svg>")
    return "".join(parts)


def dli_comparison(budget, width: int = 380, height: int = 220) -> str:
    """Daily light integral in the open against under the array."""
    if budget is None:
        return _empty_box(width, height, "Array geometry is not configured.")

    bars = [("Open field", budget.dli_open, WARN),
            ("Under array", budget.dli_under_array, NAVY)]
    top = max((v for _l, v, _c in bars), default=1.0) or 1.0
    lo, hi = _nice_bounds(0.0, top)
    pad_l, pad_r, pad_t, pad_b = 50, 14, 18, 40
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b
    slot = plot_w / len(bars)

    def sy(value: float) -> float:
        return pad_t + plot_h * (1.0 - (value - lo) / (hi - lo))

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Daily light integral, open against under the array" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]
    for i in range(5):
        value = lo + (hi - lo) * i / 4
        y = sy(value)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + plot_w}" '
                     f'y2="{y:.1f}" stroke="{LINE}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{y + 3:.1f}" font-size="9" '
                     f'text-anchor="end" fill="{MUTED}">{value:.0f}</text>')

    for i, (label, value, color) in enumerate(bars):
        cx = pad_l + slot * (i + 0.5)
        y = sy(value)
        parts.append(f'<rect x="{cx - 34:.1f}" y="{y:.1f}" width="68" '
                     f'height="{pad_t + plot_h - y:.1f}" fill="{color}"/>')
        parts.append(f'<text x="{cx:.1f}" y="{y - 5:.1f}" font-size="10" '
                     f'text-anchor="middle" fill="{INK}">{value:.1f}</text>')
        parts.append(f'<text x="{cx:.1f}" y="{pad_t + plot_h + 15:.1f}" '
                     f'font-size="10" text-anchor="middle" fill="{MUTED}">'
                     f'{_esc(label)}</text>')

    parts.append(f'<text x="4" y="{pad_t + 10}" font-size="9" '
                 f'fill="{MUTED}">mol/m2/day</text>')
    parts.append("</svg>")
    return "".join(parts)


def tradeoff_curve(tradeoff, width: int = 940, height: int = 260) -> str:
    """DC power given up against crop PAR gained, hour by hour.

    Two series on separate scales, which is honest: the exchange rate between
    watts and micromoles is the reader's to decide, so they are not combined
    into a single index here.
    """
    if tradeoff is None or not getattr(tradeoff, "hours", None):
        return _empty_box(width, height, "Array geometry is not configured.")

    rows = tradeoff.hours
    t0, t1 = rows[0].valid_at, rows[-1].valid_at
    total = max(1.0, (t1 - t0).total_seconds())
    max_dc = max((h.dc_given_up_w_per_m2 for h in rows), default=0.0) or 1.0
    max_par = max((h.crop_ppfd_gained for h in rows), default=0.0) or 1.0

    pad_l, pad_r, pad_t, pad_b = 54, 54, 18, 36
    plot_w = width - pad_l - pad_r
    plot_h = height - pad_t - pad_b

    def sx(when) -> float:
        return pad_l + plot_w * ((when - t0).total_seconds() / total)

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="Energy given up against crop light gained" '
        f'style="max-width:{width}px;height:auto;">',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]
    for i in range(5):
        y = pad_t + plot_h * (1.0 - i / 4)
        parts.append(f'<line x1="{pad_l}" y1="{y:.1f}" x2="{pad_l + plot_w}" '
                     f'y2="{y:.1f}" stroke="{LINE}" stroke-width="1"/>')
        parts.append(f'<text x="{pad_l - 6}" y="{y + 3:.1f}" font-size="9" '
                     f'text-anchor="end" fill="{MUTED}">'
                     f'{max_dc * i / 4:.0f}</text>')
        parts.append(f'<text x="{pad_l + plot_w + 6}" y="{y + 3:.1f}" '
                     f'font-size="9" fill="{MUTED}">'
                     f'{max_par * i / 4:.0f}</text>')

    dc_pts = " ".join(
        f"{sx(h.valid_at):.1f},"
        f"{pad_t + plot_h * (1.0 - h.dc_given_up_w_per_m2 / max_dc):.1f}"
        for h in rows)
    par_pts = " ".join(
        f"{sx(h.valid_at):.1f},"
        f"{pad_t + plot_h * (1.0 - h.crop_ppfd_gained / max_par):.1f}"
        for h in rows)
    parts.append(f'<polyline points="{dc_pts}" fill="none" stroke="{BAD}" '
                 f'stroke-width="2"/>')
    parts.append(f'<polyline points="{par_pts}" fill="none" stroke="{GOOD}" '
                 f'stroke-width="2" stroke-dasharray="5 3"/>')

    parts.append(f'<rect x="{pad_l}" y="{pad_t}" width="{plot_w}" '
                 f'height="{plot_h}" fill="none" stroke="#8c98a8" '
                 f'stroke-width="1"/>')
    parts.append(f'<text x="4" y="{pad_t + 10}" font-size="9" fill="{BAD}">'
                 f'W/m2 given up</text>')
    parts.append(f'<text x="{pad_l + plot_w + 6}" y="{pad_t + 10}" '
                 f'font-size="9" fill="{GOOD}">PAR gained</text>')
    parts.append("</svg>")
    return "".join(parts)


# Units and labels for the sector quantities, so a template never has to guess.
UNITS.update({
    "temperature8m": "deg C",
    "deltaTemperature": "deg C",
    "moduleTemperature": "deg C",
    "panelTemperature": "deg C",
    "mpptSolarPower": "W",
    "mppt2SolarPower": "W",
    "solarMJTotal": "MJ/m2",
    "windDirStdDev": "deg",
    "windSpeedMin": "km/h",
    "pm25": "ug/m3",
    "pm10": "ug/m3",
    "particulateCount": "count",
    "poa": "W/m2",
    "dni": "W/m2",
    "dhi": "W/m2",
    "clear_sky": "W/m2",
    "dli": "mol/m2/day",
    "ppfd": "umol/m2/s",
    "power_density": "W/m2",
    "dc_power": "W",
    "et0": "mm/day",
    "thi": "index",
})

LABELS.update({
    "temperature8m": "Air temperature at 8 m",
    "deltaTemperature": "Temperature difference between heights",
    "moduleTemperature": "Measured module temperature",
    "panelTemperature": "Logger panel temperature",
    "mpptSolarPower": "Measured DC power",
    "mppt2SolarPower": "Measured DC power, charger 2",
    "solarMJTotal": "Daily solar total",
    "windDirStdDev": "Wind direction scatter",
    "windSpeedMin": "Minimum wind speed",
    "pm25": "Particulates PM2.5",
    "pm10": "Particulates PM10",
    "particulateCount": "Particulate count",
    "poa": "Plane-of-array irradiance",
    "dni": "Direct normal irradiance",
    "dhi": "Diffuse horizontal irradiance",
    "clear_sky": "Clear-sky irradiance",
    "dli": "Daily light integral",
    "ppfd": "Photosynthetic photon flux density",
    "power_density": "Wind power density",
    "dc_power": "Modeled DC power",
    "et0": "Reference evapotranspiration",
    "thi": "Temperature humidity index",
})
