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
