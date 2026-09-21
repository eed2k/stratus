"""Lightweight inline-SVG charts for the dashboard.

Pure-Python, no third-party plotting dependency (keeps the container small
and the render instant). Produces a compact dual-axis 24h line chart of
CPU temperature and CPU load for a detector unit.
"""
from datetime import timedelta

from .timeutil import now_sast


def _x_for(ts, t_start, t_end, x0, w):
    span = (t_end - t_start).total_seconds() or 1.0
    frac = (ts - t_start).total_seconds() / span
    frac = max(0.0, min(1.0, frac))
    return x0 + frac * w


def _scale_y(val, lo, hi, y0, h):
    if hi <= lo:
        hi = lo + 1
    frac = (val - lo) / (hi - lo)
    frac = max(0.0, min(1.0, frac))
    # SVG y grows downward; invert so higher value sits higher.
    return y0 + h - frac * h


def _polyline(points, color, width=2.6):
    if not points:
        return ""
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    return (f'<polyline fill="none" stroke="{color}" stroke-width="{width}" '
            f'stroke-linejoin="round" stroke-linecap="round" '
            f'vector-effect="non-scaling-stroke" points="{pts}"/>')


def cpu_chart_svg(samples, hours=24):
    """Build an inline SVG string for a unit's CPU temp/load trend.

    samples: iterable of objects with .ts (datetime), .cpu_temp_c (float),
             .cpu_load_pct (float|None), assumed ordered oldest -> newest.
    Returns an SVG string. If there is no data, returns a small placeholder.
    """
    # Geometry. The SVG is rendered at width:100% with height:auto, so these
    # numbers set the aspect ratio and the coordinate space, not the pixel size.
    # Enlarged from 480x160 so there is room for a denser grid and more time
    # labels without the text colliding once the chart fills the page width.
    W, H = 960, 300
    pad_l, pad_r, pad_t, pad_b = 52, 52, 24, 32
    plot_w = W - pad_l - pad_r
    plot_h = H - pad_t - pad_b
    x0, y0 = pad_l, pad_t

    t_end = now_sast()
    t_start = t_end - timedelta(hours=hours)

    # Filter to the window and keep ordered
    rows = [s for s in samples if s.ts and s.ts >= t_start]

    if not rows:
        return (
            f'<svg viewBox="0 0 {W} {H}" width="100%" '
            f'preserveAspectRatio="xMidYMid meet" role="img" '
            f'aria-label="CPU trend (no data yet)">'
            f'<rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff" '
            f'stroke="#e0e0e0"/>'
            f'<text x="{W//2}" y="{H//2}" text-anchor="middle" '
            f'font-family="{_ARIAL}" font-size="11" fill="#000000">'
            f'Collecting data - chart fills over the next 24 h</text></svg>'
        )

    temps = [s.cpu_temp_c for s in rows if s.cpu_temp_c is not None]
    loads = [s.cpu_load_pct for s in rows if s.cpu_load_pct is not None]

    # Temperature axis (left): pad range a little
    t_lo = min(temps) - 2 if temps else 20
    t_hi = max(temps) + 2 if temps else 60
    t_lo = max(0, round(t_lo))
    t_hi = round(t_hi)

    # Load axis (right): 0..max(100, peak)
    l_hi = max(100, round(max(loads))) if loads else 100
    l_lo = 0

    temp_pts = [
        (_x_for(s.ts, t_start, t_end, x0, plot_w),
         _scale_y(s.cpu_temp_c, t_lo, t_hi, y0, plot_h))
        for s in rows if s.cpu_temp_c is not None
    ]
    load_pts = [
        (_x_for(s.ts, t_start, t_end, x0, plot_w),
         _scale_y(s.cpu_load_pct, l_lo, l_hi, y0, plot_h))
        for s in rows if s.cpu_load_pct is not None
    ]

    parts = [
        f'<svg viewBox="0 0 {W} {H}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" '
        f'aria-label="CPU temperature and load, last {hours} h">',
        f'<rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff" stroke="#e0e0e0"/>',
    ]

    # Horizontal gridlines + left (temp) and right (load) axis labels.
    # Five lines rather than three: at full page width three was too sparse to
    # read a value off the chart.
    for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
        gy = y0 + plot_h - frac * plot_h
        tval = t_lo + frac * (t_hi - t_lo)
        parts.append(
            f'<line x1="{x0}" y1="{gy:.1f}" x2="{x0+plot_w}" y2="{gy:.1f}" '
            f'stroke="#eaeef2" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{x0-6}" y="{gy+4:.1f}" text-anchor="end" '
            f'font-family="{_ARIAL}" font-size="11" fill="#ef4444">{tval:.0f}</text>'
        )
        lval = l_lo + frac * (l_hi - l_lo)
        parts.append(
            f'<text x="{x0+plot_w+6}" y="{gy+4:.1f}" text-anchor="start" '
            f'font-family="{_ARIAL}" font-size="11" fill="#2563eb">{lval:.0f}</text>'
        )

    # Faint vertical gridlines every 4 hours, so a reading can be placed in time.
    steps = max(1, hours // 4)
    for i in range(steps + 1):
        frac = i / steps
        gx = x0 + frac * plot_w
        parts.append(
            f'<line x1="{gx:.1f}" y1="{y0}" x2="{gx:.1f}" y2="{y0+plot_h}" '
            f'stroke="#f2f5f8" stroke-width="1"/>'
        )
        hrs_ago = hours - frac * hours
        lbl = "now" if hrs_ago < 0.5 else f"-{hrs_ago:.0f}h"
        parts.append(
            f'<text x="{gx:.1f}" y="{H-10}" text-anchor="middle" '
            f'font-family="{_ARIAL}" font-size="10" fill="#000000">{lbl}</text>'
        )

    # Data lines: temperature (red), load (blue)
    parts.append(_polyline(temp_pts, "#ef4444"))
    if load_pts:
        parts.append(_polyline(load_pts, "#2563eb"))

    # Legend: text only, no marker glyphs. The label is drawn in the same color
    # as its line, which identifies the series without a square in front of it.
    parts.append(
        f'<text x="{x0}" y="{pad_t-6}" font-family="{_ARIAL}" font-size="11" '
        f'fill="#ef4444">Temp &deg;C</text>'
    )
    legend2 = "Load %" if load_pts else "Load % (awaiting unit update)"
    parts.append(
        f'<text x="{x0+110}" y="{pad_t-6}" font-family="{_ARIAL}" font-size="11" '
        f'fill="#2563eb">{legend2}</text>'
    )

    parts.append('</svg>')
    return "".join(parts)


# ===========================================================================
#  Report chart builders (vector SVG, Arial, valid XML, no em dashes)
# ===========================================================================
#  These produce standalone SVG strings for embedding in the PDF reports.
#  They avoid named XML entities (only numeric entities) so the output parses
#  as well-formed XML, and use plain hyphens rather than em dashes.

from .metrics import (energy_band, energy_bands_legend, ENERGY_MAX,
                      CPU_WARN_C, CPU_CRIT_C)

# One font stack for the whole PDF. The same family list as the `body` rule in
# templates/reports/_base.html: chart labels sitting in a different font from the
# surrounding prose was the visible inconsistency in the reports. Arial resolves
# to metric-compatible Liberation Sans in the container, which is why
# fonts-liberation is installed in the Dockerfile.
#
# Single quotes around the family name are load-bearing. This string is
# interpolated into font-family="..." on SVG <text>, so a double-quoted family
# would close the attribute early and make the whole chart unparseable XML.
_ARIAL = "Arial, 'Liberation Sans', Helvetica, sans-serif"
_INK = "#000000"
# Axis and tick labels. Black, not grey: these charts are read on a wall-mounted
# console and printed into technical reports, and the axis numbers are the part a
# reader checks a value against.
_MUTED = "#000000"
_NAVY = "#1b3a5b"
# Gridlines only, never text. Kept very light so the plot reads as lines on white
# rather than as a shaded block: the previous value tinted the whole plot area.
_GRID = "#f4f6f8"


def _svg_head(w, h, label):
    return (
        f'<svg viewBox="0 0 {w} {h}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" aria-label="{label}" '
        f'xmlns="http://www.w3.org/2000/svg">'
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff" '
        f'stroke="#d9dee5"/>'
    )


def _esc(s):
    """Escape text for XML content.

    Needed because some labels are comparison operators, e.g. "< 10 km". A raw
    "<" in text content makes the whole SVG unparseable, which in a PDF report
    surfaces as a failed render rather than a slightly wrong label.

    Uses numeric entities only, matching the no-named-entities rule above.
    """
    return (str(s).replace("&", "&#38;")
                  .replace("<", "&#60;")
                  .replace(">", "&#62;")
                  .replace('"', "&#34;")
                  .replace("\u2264", "&#8804;")
                  .replace("\u2265", "&#8805;"))


def _text(x, y, s, size=11, color=_INK, anchor="start", weight="normal"):
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" '
        f'font-family="{_ARIAL}" font-size="{size}" font-weight="{weight}" '
        f'fill="{color}">{s}</text>'
    )


def _empty_svg(w, h, message):
    return (
        _svg_head(w, h, "no data")
        + _text(w / 2, h / 2, message, size=11, color=_MUTED, anchor="middle")
        + "</svg>"
    )


def cpu_trend_svg(samples, hours=24, warn=CPU_WARN_C, crit=CPU_CRIT_C,
                  t_start=None, t_end=None, title=None):
    """Line chart of CPU temperature over a window, with WARN/CRIT lines.

    samples: objects with .ts (datetime), .cpu_temp_c (float),
             .cpu_load_pct (float|None), ordered oldest -> newest.

    By default the window is the last `hours` up to now (live dashboard use).
    Pass explicit t_start/t_end for an arbitrary window (for example a report
    month). Axis labels switch to dates when the span exceeds two days.
    """
    W, H = 520, 200
    pad_l, pad_r, pad_t, pad_b = 44, 16, 26, 26
    plot_w, plot_h = W - pad_l - pad_r, H - pad_t - pad_b
    x0, y0 = pad_l, pad_t

    if t_end is None:
        t_end = now_sast()
    if t_start is None:
        t_start = t_end - timedelta(hours=hours)
    rows = [s for s in samples
            if getattr(s, "ts", None) and t_start <= s.ts <= t_end]
    if not rows:
        return _empty_svg(W, H, "Collecting data - chart fills as heartbeats arrive")

    temps = [s.cpu_temp_c for s in rows if s.cpu_temp_c is not None]
    lo = min(temps) if temps else 20.0
    hi = max(temps) if temps else 60.0
    # Include the thresholds in the visible range so the lines are in context.
    t_lo = min(30.0, lo - 2.0)
    t_hi = max(crit + 4.0, hi + 2.0)
    if t_hi <= t_lo:
        t_hi = t_lo + 1.0

    def px(ts):
        span = (t_end - t_start).total_seconds() or 1.0
        return x0 + max(0.0, min(1.0, (ts - t_start).total_seconds() / span)) * plot_w

    def py(v):
        return y0 + plot_h - (max(t_lo, min(t_hi, v)) - t_lo) / (t_hi - t_lo) * plot_h

    span_h = (t_end - t_start).total_seconds() / 3600.0
    if title is None:
        title = "CPU temperature (deg C)"
    parts = [_svg_head(W, H, "CPU temperature")]
    parts.append(_text(x0, 16, title, size=12, color=_NAVY, weight="bold"))

    # Gridlines and left axis labels.
    for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
        gy = y0 + plot_h - frac * plot_h
        val = t_lo + frac * (t_hi - t_lo)
        parts.append(f'<line x1="{x0}" y1="{gy:.1f}" x2="{x0+plot_w}" '
                     f'y2="{gy:.1f}" stroke="{_GRID}" stroke-width="1"/>')
        parts.append(_text(x0 - 5, gy + 3, f"{val:.0f}", size=9,
                           color=_MUTED, anchor="end"))

    # Threshold lines (dashed) if within range.
    for thr, color, name in ((warn, "#e08a1e", "WARN"), (crit, "#c0392b", "CRIT")):
        if t_lo <= thr <= t_hi:
            ty = py(thr)
            parts.append(f'<line x1="{x0}" y1="{ty:.1f}" x2="{x0+plot_w}" '
                         f'y2="{ty:.1f}" stroke="{color}" stroke-width="1" '
                         f'stroke-dasharray="4 3"/>')
            parts.append(_text(x0 + plot_w, ty - 3, f"{name} {thr:.0f}",
                               size=8, color=color, anchor="end"))

    # Temperature polyline.
    pts = " ".join(f"{px(s.ts):.1f},{py(s.cpu_temp_c):.1f}"
                   for s in rows if s.cpu_temp_c is not None)
    if pts:
        parts.append(f'<polyline fill="none" stroke="{_NAVY}" stroke-width="2.6" '
                     f'stroke-linejoin="round" stroke-linecap="round" '
                     f'points="{pts}"/>')

    # X axis end labels: dates for long spans, relative for short live windows.
    if span_h > 48:
        left_lbl = t_start.strftime("%d %b")
        right_lbl = t_end.strftime("%d %b")
    else:
        left_lbl = f"-{int(round(span_h))}h"
        right_lbl = "now"
    parts.append(_text(x0, H - 8, left_lbl, size=9, color=_MUTED))
    parts.append(_text(x0 + plot_w, H - 8, right_lbl, size=9, color=_MUTED,
                       anchor="end"))
    parts.append("</svg>")
    return "".join(parts)


def _bar_chart_svg(labels, counts, colors, title, label_note=""):
    """Generic vertical bar chart used by the distance and energy charts."""
    W, H = 520, 200
    pad_l, pad_r, pad_t, pad_b = 40, 16, 28, 34
    plot_w, plot_h = W - pad_l - pad_r, H - pad_t - pad_b
    x0, y0 = pad_l, pad_t
    n = len(labels)
    parts = [_svg_head(W, H, title)]
    parts.append(_text(x0, 16, title, size=12, color=_NAVY, weight="bold"))
    top = max(counts) if counts and max(counts) > 0 else 1
    # Y gridlines.
    for frac in (0.0, 0.5, 1.0):
        gy = y0 + plot_h - frac * plot_h
        parts.append(f'<line x1="{x0}" y1="{gy:.1f}" x2="{x0+plot_w}" '
                     f'y2="{gy:.1f}" stroke="{_GRID}" stroke-width="1"/>')
        parts.append(_text(x0 - 5, gy + 3, f"{int(round(top*frac))}", size=9,
                           color=_MUTED, anchor="end"))
    if n:
        slot = plot_w / n
        bw = slot * 0.6
        for i, (lab, cnt, col) in enumerate(zip(labels, counts, colors)):
            bh = (cnt / top) * plot_h if top else 0
            bx = x0 + i * slot + (slot - bw) / 2
            by = y0 + plot_h - bh
            parts.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" '
                         f'height="{bh:.1f}" fill="{col}"/>')
            parts.append(_text(bx + bw / 2, by - 3, str(cnt), size=9,
                               color=_INK, anchor="middle"))
            parts.append(_text(bx + bw / 2, y0 + plot_h + 14, lab, size=9,
                               color=_MUTED, anchor="middle"))
    if label_note:
        parts.append(_text(x0, H - 4, label_note, size=8, color=_MUTED))
    parts.append("</svg>")
    return "".join(parts)


def distance_histogram_svg(distances):
    """Bar chart of strike counts by distance band (km)."""
    bands = [(0, 10), (10, 20), (20, 30), (30, 40)]
    labels = [f"{lo}-{hi}" for lo, hi in bands]
    counts = [0] * len(bands)
    for d in distances:
        try:
            dv = float(d)
        except (TypeError, ValueError):
            continue
        for i, (lo, hi) in enumerate(bands):
            # Lower-inclusive, upper-inclusive on the final band.
            if (lo <= dv < hi) or (i == len(bands) - 1 and dv >= lo and dv <= hi):
                counts[i] += 1
                break
    colors = [_NAVY] * len(bands)
    return _bar_chart_svg(labels, counts, colors,
                          "Strikes by distance (km)")


def energy_band_histogram_svg(energies):
    """Bar chart of strike counts by energy band, colored per band."""
    legend = energy_bands_legend()
    labels = [row["name"] for row in legend]
    colors = [row["color"] for row in legend]
    counts = [0] * len(legend)
    for e in energies:
        idx = energy_band(e)["index"]
        counts[idx] += 1
    return _bar_chart_svg(labels, counts, colors,
                          "Strikes by energy band",
                          label_note="Energy is a relative, dimensionless scale "
                                     "(0 to 2,097,151), not Joules or Watts.")


def uptime_gauge_svg(pct):
    """Horizontal availability gauge (0 to 100 percent)."""
    W, H = 520, 84
    pad_l, pad_r, pad_t = 16, 16, 30
    bar_w = W - pad_l - pad_r
    bar_h = 22
    y = pad_t
    try:
        p = max(0.0, min(100.0, float(pct)))
    except (TypeError, ValueError):
        p = 0.0
    fill = "#2e7d32" if p >= 99 else ("#e08a1e" if p >= 95 else "#c0392b")
    parts = [_svg_head(W, H, "System availability")]
    parts.append(_text(pad_l, 18, "System availability", size=12,
                       color=_NAVY, weight="bold"))
    parts.append(f'<rect x="{pad_l}" y="{y}" width="{bar_w}" height="{bar_h}" '
                 f'fill="#eef1f5" stroke="#d9dee5"/>')
    parts.append(f'<rect x="{pad_l}" y="{y}" width="{bar_w * p / 100.0:.1f}" '
                 f'height="{bar_h}" fill="{fill}"/>')
    parts.append(_text(pad_l + bar_w, y + bar_h + 14, f"{p:.1f}%", size=11,
                       color=_INK, anchor="end"))
    parts.append("</svg>")
    return "".join(parts)


# Cumulonimbus silhouette, shared verbatim with drawCloud() in
# static/js/storm-view.js so the report and the dashboard draw the same cloud.
# Keep the two in step.
#
# One continuous outline rather than a stack of ellipses: stacked ellipses each
# carry their own stroke, so their edges showed through as circular rings across
# the top and a hard ring around the base, and the overlapping arcs read as
# lumpy. Wider at the shoulders (+/-27) than at the base (+/-24), which is the
# anvil spread that makes it read as a thunderstorm. The flat base is what a
# real cumulonimbus base looks like.
_CB_BODY = ("M-24 11C-33 11-35 1-27-3C-30-12-20-17-12-14"
            "C-8-22 6-24 12-17C22-20 30-12 26-4C34-1 32 11 24 11Z")

# Lightning is blue-white rather than the band color, matching
# static/js/storm-view.js.
#
# The two cannot use identical values. On the dashboard the channel is
# near-white (#eaf4ff) and is legible only because a blurred blue bloom sits
# behind it. A report is printed on white paper with no bloom layer, so that
# near-white would be invisible. Here the blue does the work of the body and
# white is kept for the hot core, which reads as the same object in print.
_BOLT_MAIN = "#7dbcff"          # storm-view.js BOLT_GLOW, used as the body
_BOLT_CORE = "#ffffff"          # storm-view.js BOLT_CORE

# The channel, as three fixed paths shared verbatim with storm-view.js. Authored
# for a 104 x 78 cell with the channel spanning y 42 to 73.5; _bolt_geometry maps
# them onto whatever box it is given. Glow is fattest, core thinnest and inset,
# and all three converge on the same point.
_BOLT_GLOW_D = ("M53.6 42L61.4 42L55.2 54.6L60.6 54.6L46.4 73.5"
                "L51.4 57.4L45.6 57.4L50.2 42Z")
_BOLT_MAIN_D = ("M54 43L60 43L55.4 54.6L59.4 54.6L47.6 72.6"
                "L51.6 57.4L46.8 57.4L51 43Z")
_BOLT_CORE_D = ("M55.4 44.4L57.6 44.4L54.6 55.6L56.8 55.6L49.6 68.6"
                "L52.4 56.6L50 56.6L53.2 44.4Z")


def _cumulonimbus(cx, cy, s, active=True):
    """One small cumulonimbus, positioned by transform so the path data above
    can be shared with the browser renderer without recomputing coordinates."""
    body = "#dde5ee" if active else "#eceff3"
    return (
        f'<g transform="translate({cx:.1f},{cy:.1f}) scale({s:.3f})">'
        f'<path d="{_CB_BODY}" fill="{body}" stroke="#8c98a8" '
        f'stroke-width="1"/>'
        f'</g>'
    )


def _bolt_geometry(cx, y_top, y_end, seed):
    """Bolt paths, matching boltGeometry() in storm-view.js.

    FOUR TURNS, NOT ONE, AND NO BRANCH. The previous version built a centre-line
    of three points (base, one kink, tip) and thickened it. One direction
    reversal draws a letter Z rather than a discharge, so the shape is now the
    classic four-turn channel, held as fixed path data shared verbatim with the
    browser renderer.

    Three filled paths rather than two plus a stroke. A stroke has uniform width
    and cannot converge, so the old stroked centre-line put a blunt end back on
    the tip that the filled outline had just sharpened.

    Position is jittered from the seed rather than random, so a regenerated
    report is byte-identical instead of drawing a different channel each run.
    Only the horizontal offset varies: wobbling vertices independently distorted
    the silhouette into something that stopped reading as lightning.

    The paths are authored for a 104 x 78 cell with the channel spanning y 42 to
    73.5, so they are translated and scaled onto whatever box the caller asks
    for.

    Returns (glow_path, main_path, core_path).
    """
    import math
    import re

    def jitter(salt):
        """Deterministic value in [0, 1) from the seed."""
        v = math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453
        return v - math.floor(v)

    dx = (jitter(1) * 4.4) - 2.2

    # Authored span of the path data above, used to map it onto the caller's box.
    SRC_TOP, SRC_END, SRC_CX = 42.0, 73.5, 52.0
    sy = (y_end - y_top) / (SRC_END - SRC_TOP)

    def place(d):
        def repl(m):
            x = float(m.group(2)) - SRC_CX + dx
            y = float(m.group(3)) - SRC_TOP
            return f"{m.group(1)}{cx + x * sy:.1f} {y_top + y * sy:.1f}"
        return re.sub(r"([ML])(-?[\d.]+) (-?[\d.]+)", repl, d)

    return place(_BOLT_GLOW_D), place(_BOLT_MAIN_D), place(_BOLT_CORE_D)


def storm_bands_svg(strikes, radius_km=40):
    """Storm activity as five proximity bands, one cumulonimbus each.

    Static mirror of the dashboard display in static/js/storm-view.js. Both are
    fed by metrics.distance_band_summary, so the report and the dashboard cannot
    show different numbers for the same window.

    The AS3935 measures distance but NOT bearing, so nothing is placed in any
    direction: the bands read nearest to farthest, left to right, which is a
    proximity ordering and not a map.
    """
    from .metrics import distance_band_summary

    summary = distance_band_summary(strikes)
    bands = summary["bands"]

    cell_w, gap = 104, 8
    pad_l, pad_t = 10, 10
    W = pad_l * 2 + cell_w * len(bands) + gap * (len(bands) - 1)
    head_h, cloud_h, data_h = 16, 84, 66
    H = pad_t + head_h + cloud_h + data_h + 24

    max_peak = max([b["peak"] for b in bands if b["peak"]] or [0])

    parts = [_svg_head(W, H, "Storm activity by distance band")]

    for i, b in enumerate(bands):
        x = pad_l + i * (cell_w + gap)
        active = b["count"] > 0
        color = b["color"] if active and b["color"] else "#93a0b0"

        # Band header.
        parts.append(f'<rect x="{x}" y="{pad_t}" width="{cell_w}" '
                     f'height="{head_h}" fill="{color if active else "#93a0b0"}"/>')
        parts.append(_text(x + cell_w / 2, pad_t + 11.5,
                           _esc(b["range"].upper()),
                           size=8, color="#ffffff", anchor="middle",
                           weight="bold"))

        # Cloud, sized on the band mean against the busiest peak on the page so
        # the cells stay comparable with one another.
        frac = (b["mean"] / max_peak) if (active and max_peak) else 0.0
        # Smaller cloud, matching storm-view.js: 0.56 to 0.62 active, 0.52 idle,
        # down from 0.62 to 0.92. It leaves the channel as the dominant element
        # in the cell. The trailing 0.80 is this renderer's own cell being
        # smaller than the browser's, and is unchanged.
        if active:
            s = (0.56 + min(1.0, max(0.0, frac)) * 0.06) * 0.80
        else:
            s = 0.52 * 0.80
        ccx = x + cell_w / 2
        ccy = pad_t + head_h + 26
        parts.append(_cumulonimbus(ccx, ccy, s, active))

        if active:
            # Shorter channel than before: 24 units rather than 30.
            glow_d, main_d, core_d = _bolt_geometry(ccx, ccy + 14, ccy + 38, i)
            # Filled outline for the channel, thin stroke for the hot core.
            # Blue-white, not the band color, matching the dashboard.
            # Three filled paths, so every layer converges to the same point.
            # The glow is drawn first and faintly, then the body, then the core.
            parts.append(f'<path d="{glow_d}" fill="{_BOLT_MAIN}" stroke="none" '
                         f'opacity="0.45"/>')
            parts.append(f'<path d="{main_d}" fill="{_BOLT_MAIN}" stroke="none" '
                         f'opacity="0.95"/>')
            parts.append(f'<path d="{core_d}" fill="{_BOLT_CORE}" stroke="none" '
                         f'opacity="0.9"/>')

        # Data block.
        dy = pad_t + head_h + cloud_h
        parts.append(f'<rect x="{x}" y="{dy}" width="{cell_w}" '
                     f'height="{data_h}" fill="#ffffff" stroke="#b9c2cf" '
                     f'stroke-width="1"/>')
        parts.append(f'<rect x="{x}" y="{dy}" width="{cell_w}" height="3" '
                     f'fill="{color}"/>')
        parts.append(_text(x + cell_w / 2, dy + 21, str(b["count"]), size=16,
                           color=_INK, anchor="middle", weight="bold"))
        parts.append(_text(x + cell_w / 2, dy + 31,
                           "strike" if b["count"] == 1 else "strikes",
                           size=7, color=_MUTED, anchor="middle"))
        parts.append(_text(x + cell_w / 2, dy + 41, _esc(b["label"]), size=7,
                           color=color, anchor="middle", weight="bold"))
        if active:
            for j, (k, v) in enumerate((("peak", b["peak"]),
                                        ("mean", b["mean"]),
                                        ("low", b["low"]))):
                ry = dy + 51 + j * 8
                parts.append(_text(x + 7, ry, k, size=7, color=_MUTED))
                parts.append(_text(x + cell_w - 7, ry, f"{v / 1e6:.2f}M",
                                   size=7, color=_INK, anchor="end",
                                   weight="bold"))
        else:
            parts.append(_text(x + cell_w / 2, dy + 54, "no strikes", size=7,
                               color="#8c98a8", anchor="middle"))

    total = summary["total"]
    foot = (f"{total} strike{'' if total == 1 else 's'} in this period. "
            f"Nearest band first. Distance only - bearing not measured. "
            f"Intensity is a relative sensor value, not joules.")
    parts.append(_text(pad_l, H - 8, _esc(foot), size=8, color=_MUTED))
    parts.append("</svg>")
    return "".join(parts)
