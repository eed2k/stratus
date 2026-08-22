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


def _polyline(points, colour, width=2):
    if not points:
        return ""
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    return (f'<polyline fill="none" stroke="{colour}" stroke-width="{width}" '
            f'stroke-linejoin="round" stroke-linecap="round" points="{pts}"/>')


def cpu_chart_svg(samples, hours=24):
    """Build an inline SVG string for a unit's CPU temp/load trend.

    samples: iterable of objects with .ts (datetime), .cpu_temp_c (float),
             .cpu_load_pct (float|None), assumed ordered oldest -> newest.
    Returns an SVG string. If there is no data, returns a small placeholder.
    """
    # Geometry
    W, H = 480, 160
    pad_l, pad_r, pad_t, pad_b = 36, 36, 14, 22
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
            f'<rect x="0" y="0" width="{W}" height="{H}" fill="#fafafa" '
            f'stroke="#e0e0e0"/>'
            f'<text x="{W//2}" y="{H//2}" text-anchor="middle" '
            f'font-family="Arial" font-size="11" fill="#888">'
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

    # Horizontal gridlines + left (temp) axis labels
    for frac in (0.0, 0.5, 1.0):
        gy = y0 + plot_h - frac * plot_h
        tval = t_lo + frac * (t_hi - t_lo)
        parts.append(
            f'<line x1="{x0}" y1="{gy:.1f}" x2="{x0+plot_w}" y2="{gy:.1f}" '
            f'stroke="#eee" stroke-width="1"/>'
        )
        parts.append(
            f'<text x="{x0-4}" y="{gy+3:.1f}" text-anchor="end" '
            f'font-family="Arial" font-size="9" fill="#c0392b">{tval:.0f}</text>'
        )
        # right (load) axis label
        lval = l_lo + frac * (l_hi - l_lo)
        parts.append(
            f'<text x="{x0+plot_w+4}" y="{gy+3:.1f}" text-anchor="start" '
            f'font-family="Arial" font-size="9" fill="#2c7fb8">{lval:.0f}</text>'
        )

    # X axis time labels (start, mid, end)
    for frac, lbl in ((0.0, "-24h"), (0.5, "-12h"), (1.0, "now")):
        gx = x0 + frac * plot_w
        parts.append(
            f'<text x="{gx:.1f}" y="{H-6}" text-anchor="middle" '
            f'font-family="Arial" font-size="9" fill="#999">{lbl}</text>'
        )

    # Data lines: temperature (red), load (blue)
    parts.append(_polyline(temp_pts, "#c0392b"))
    if load_pts:
        parts.append(_polyline(load_pts, "#2c7fb8"))

    # Legend
    parts.append(
        f'<text x="{x0}" y="{pad_t+0}" font-family="Arial" font-size="9" '
        f'fill="#c0392b">&#9632; Temp &deg;C</text>'
    )
    legend2 = "&#9632; Load %" if load_pts else "&#9632; Load % (awaiting unit update)"
    parts.append(
        f'<text x="{x0+70}" y="{pad_t+0}" font-family="Arial" font-size="9" '
        f'fill="#2c7fb8">{legend2}</text>'
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

_ARIAL = "Arial, Helvetica, sans-serif"
_INK = "#111111"
_MUTED = "#6b7280"
_NAVY = "#1b3a5b"
_GRID = "#e6e9ee"


def _svg_head(w, h, label):
    return (
        f'<svg viewBox="0 0 {w} {h}" width="100%" '
        f'preserveAspectRatio="xMidYMid meet" role="img" aria-label="{label}" '
        f'xmlns="http://www.w3.org/2000/svg">'
        f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff" '
        f'stroke="#d9dee5"/>'
    )


def _text(x, y, s, size=11, colour=_INK, anchor="start", weight="normal"):
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" '
        f'font-family="{_ARIAL}" font-size="{size}" font-weight="{weight}" '
        f'fill="{colour}">{s}</text>'
    )


def _empty_svg(w, h, message):
    return (
        _svg_head(w, h, "no data")
        + _text(w / 2, h / 2, message, size=11, colour=_MUTED, anchor="middle")
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
    parts.append(_text(x0, 16, title, size=12, colour=_NAVY, weight="bold"))

    # Gridlines and left axis labels.
    for frac in (0.0, 0.25, 0.5, 0.75, 1.0):
        gy = y0 + plot_h - frac * plot_h
        val = t_lo + frac * (t_hi - t_lo)
        parts.append(f'<line x1="{x0}" y1="{gy:.1f}" x2="{x0+plot_w}" '
                     f'y2="{gy:.1f}" stroke="{_GRID}" stroke-width="1"/>')
        parts.append(_text(x0 - 5, gy + 3, f"{val:.0f}", size=9,
                           colour=_MUTED, anchor="end"))

    # Threshold lines (dashed) if within range.
    for thr, colour, name in ((warn, "#e08a1e", "WARN"), (crit, "#c0392b", "CRIT")):
        if t_lo <= thr <= t_hi:
            ty = py(thr)
            parts.append(f'<line x1="{x0}" y1="{ty:.1f}" x2="{x0+plot_w}" '
                         f'y2="{ty:.1f}" stroke="{colour}" stroke-width="1" '
                         f'stroke-dasharray="4 3"/>')
            parts.append(_text(x0 + plot_w, ty - 3, f"{name} {thr:.0f}",
                               size=8, colour=colour, anchor="end"))

    # Temperature polyline.
    pts = " ".join(f"{px(s.ts):.1f},{py(s.cpu_temp_c):.1f}"
                   for s in rows if s.cpu_temp_c is not None)
    if pts:
        parts.append(f'<polyline fill="none" stroke="{_NAVY}" stroke-width="2" '
                     f'stroke-linejoin="round" stroke-linecap="round" '
                     f'points="{pts}"/>')

    # X axis end labels: dates for long spans, relative for short live windows.
    if span_h > 48:
        left_lbl = t_start.strftime("%d %b")
        right_lbl = t_end.strftime("%d %b")
    else:
        left_lbl = f"-{int(round(span_h))}h"
        right_lbl = "now"
    parts.append(_text(x0, H - 8, left_lbl, size=9, colour=_MUTED))
    parts.append(_text(x0 + plot_w, H - 8, right_lbl, size=9, colour=_MUTED,
                       anchor="end"))
    parts.append("</svg>")
    return "".join(parts)


def _bar_chart_svg(labels, counts, colours, title, label_note=""):
    """Generic vertical bar chart used by the distance and energy charts."""
    W, H = 520, 200
    pad_l, pad_r, pad_t, pad_b = 40, 16, 28, 34
    plot_w, plot_h = W - pad_l - pad_r, H - pad_t - pad_b
    x0, y0 = pad_l, pad_t
    n = len(labels)
    parts = [_svg_head(W, H, title)]
    parts.append(_text(x0, 16, title, size=12, colour=_NAVY, weight="bold"))
    top = max(counts) if counts and max(counts) > 0 else 1
    # Y gridlines.
    for frac in (0.0, 0.5, 1.0):
        gy = y0 + plot_h - frac * plot_h
        parts.append(f'<line x1="{x0}" y1="{gy:.1f}" x2="{x0+plot_w}" '
                     f'y2="{gy:.1f}" stroke="{_GRID}" stroke-width="1"/>')
        parts.append(_text(x0 - 5, gy + 3, f"{int(round(top*frac))}", size=9,
                           colour=_MUTED, anchor="end"))
    if n:
        slot = plot_w / n
        bw = slot * 0.6
        for i, (lab, cnt, col) in enumerate(zip(labels, counts, colours)):
            bh = (cnt / top) * plot_h if top else 0
            bx = x0 + i * slot + (slot - bw) / 2
            by = y0 + plot_h - bh
            parts.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" '
                         f'height="{bh:.1f}" fill="{col}"/>')
            parts.append(_text(bx + bw / 2, by - 3, str(cnt), size=9,
                               colour=_INK, anchor="middle"))
            parts.append(_text(bx + bw / 2, y0 + plot_h + 14, lab, size=9,
                               colour=_MUTED, anchor="middle"))
    if label_note:
        parts.append(_text(x0, H - 4, label_note, size=8, colour=_MUTED))
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
    colours = [_NAVY] * len(bands)
    return _bar_chart_svg(labels, counts, colours,
                          "Strikes by distance (km)")


def energy_band_histogram_svg(energies):
    """Bar chart of strike counts by energy band, coloured per band."""
    legend = energy_bands_legend()
    labels = [row["name"] for row in legend]
    colours = [row["colour"] for row in legend]
    counts = [0] * len(legend)
    for e in energies:
        idx = energy_band(e)["index"]
        counts[idx] += 1
    return _bar_chart_svg(labels, counts, colours,
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
                       colour=_NAVY, weight="bold"))
    parts.append(f'<rect x="{pad_l}" y="{y}" width="{bar_w}" height="{bar_h}" '
                 f'fill="#eef1f5" stroke="#d9dee5"/>')
    parts.append(f'<rect x="{pad_l}" y="{y}" width="{bar_w * p / 100.0:.1f}" '
                 f'height="{bar_h}" fill="{fill}"/>')
    parts.append(_text(pad_l + bar_w, y + bar_h + 14, f"{p:.1f}%", size=11,
                       colour=_INK, anchor="end"))
    parts.append("</svg>")
    return "".join(parts)


def storm_rings_svg(strikes, radius_km=40):
    """Concentric distance-ring plot of strikes, coloured by energy band.

    Positions strikes by distance only (the sensor has no bearing); angles are
    spread deterministically so overlapping distances remain visible.
    """
    import math
    W = H = 300
    cx, cy = W / 2, H / 2
    max_r = min(W, H) / 2 - 18
    radius_km = radius_km or 40
    rings = [10, 20, 30, 40]
    parts = [_svg_head(W, H, "Recent strikes by distance")]
    # Rings and labels.
    for rk in rings:
        rr = (rk / radius_km) * max_r
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{rr:.1f}" fill="none" '
                     f'stroke="{_GRID}" stroke-width="1"/>')
        parts.append(_text(cx + 2, cy - rr + 10, f"{rk} km", size=8,
                           colour=_MUTED))
    # Station marker at centre.
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="3" fill="{_NAVY}"/>')
    # Strikes.
    golden = math.pi * (3 - math.sqrt(5))  # spread angle
    for i, s in enumerate(strikes):
        try:
            d = float(s.get("distance_km"))
        except (TypeError, ValueError, AttributeError):
            continue
        rr = (max(0.0, min(radius_km, d)) / radius_km) * max_r
        ang = i * golden
        sx = cx + rr * math.cos(ang)
        sy = cy + rr * math.sin(ang)
        colour = s.get("colour") or energy_band(s.get("energy", 0))["colour"]
        parts.append(f'<circle cx="{sx:.1f}" cy="{sy:.1f}" r="3.5" '
                     f'fill="{colour}" fill-opacity="0.85"/>')
    parts.append(_text(cx, H - 6, "Distance only - bearing not measured",
                       size=8, colour=_MUTED, anchor="middle"))
    parts.append("</svg>")
    return "".join(parts)
