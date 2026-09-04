"""Pure, dependency-free helpers for reports, charts, and validation.

Everything here is deterministic and uses only the standard library so it can
be unit- and property-tested in isolation, without a database, network, or the
web framework. Higher layers (routes, report builder, charts) import these.

Conventions
-----------
- The AS3935 energy value is a 21-bit relative, dimensionless number in the
  range 0..2_097_151. It is NOT calibrated to Joules or Watts. The band helper
  only classifies that relative value for display and legend purposes.
- Times are handled in SAST (UTC+2, no DST), matching the rest of the panel.
"""
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Energy scale (AS3935, 21-bit relative value)
# ---------------------------------------------------------------------------

# Detector CPU temperature thresholds (deg C), surfaced for chart reference
# lines and report statistics. These mirror the detector's configured limits.
CPU_WARN_C = 70.0
CPU_CRIT_C = 78.0

ENERGY_MAX = 2_097_151          # 2**21 - 1, full scale
_Q = (ENERGY_MAX + 1) // 4      # quarter of full scale (524_288)

# Manufacturer guidance: energy above ~1,000,000 (about half scale) marks a
# high-intensity strike / elevated fire risk. Drawn as a marker on legends.
ENERGY_FIRE_RISK_MARKER = 1_000_000

# Ordered low -> high. Each band is (name, lower_inclusive, accent_color).
# Colors are data accents that sit inside the white/navy/black theme.
_ENERGY_BANDS = (
    ("Low",      0,        "#8aa0b8"),   # light gray-blue
    ("Moderate", _Q,       "#1b3a5b"),   # navy
    ("High",     _Q * 2,   "#e08a1e"),   # amber
    ("Extreme",  _Q * 3,   "#c0392b"),   # red
)


def energy_band(energy):
    """Classify a relative energy value into a named band.

    Returns a dict: {"name", "index", "color"}. The function is total over the
    valid 21-bit domain and clamps out-of-range input so it never raises:
    negatives fold into the lowest band, values above full scale into the
    highest. Higher energy never yields a lower band index (monotonic).
    """
    try:
        e = int(energy)
    except (TypeError, ValueError):
        e = 0
    if e < 0:
        e = 0
    elif e > ENERGY_MAX:
        e = ENERGY_MAX

    idx = 0
    for i, (_name, lower, _color) in enumerate(_ENERGY_BANDS):
        if e >= lower:
            idx = i
    name, _lower, color = _ENERGY_BANDS[idx]
    return {"name": name, "index": idx, "color": color}


def energy_band_name(energy):
    """Convenience: just the band name."""
    return energy_band(energy)["name"]


def energy_bands_legend():
    """Legend rows for display: name, color, and human-readable range.

    The ranges are expressed against full scale so the reader understands the
    relative nature of the value.
    """
    rows = []
    n = len(_ENERGY_BANDS)
    for i, (name, lower, color) in enumerate(_ENERGY_BANDS):
        upper = _ENERGY_BANDS[i + 1][1] - 1 if i + 1 < n else ENERGY_MAX
        rows.append({
            "name": name,
            "color": color,
            "lower": lower,
            "upper": upper,
        })
    return rows


# ---------------------------------------------------------------------------
# Distance bands for the storm-activity display
# ---------------------------------------------------------------------------
#
# The AS3935 reports distance in 15 discrete steps
# [1,5,6,8,10,12,14,17,20,24,27,31,34,37,40] and does NOT report bearing, so
# the display groups strikes into proximity bands rather than plotting them in
# any direction. These bounds fall between the sensor's steps, so no step
# straddles a boundary.
#
# lower is inclusive, upper is EXCLUSIVE, and the last band has no upper bound.
# Together they cover [0, inf), which means every strike lands in exactly one
# band: the per-band counts always sum to the total, with nothing dropped and
# nothing double counted, including fractional distances.
DISTANCE_BANDS = (
    # (key,      label,        display range, lower, upper)
    ("0-1",   "OVERHEAD",   "\u2264 1 km",  0.0,  1.0001),
    ("1-10",  "VERY CLOSE", "< 10 km",      1.0001, 10.0),
    ("10-20", "CLOSE",      "< 20 km",     10.0,  20.0),
    ("20-30", "DISTANT",    "< 30 km",     20.0,  30.0),
    ("30-40", "FAR",        "30-40 km",    30.0,  None),
)


def distance_band_summary(strikes):
    """Aggregate strikes into the five proximity bands.

    `strikes` is any iterable of mappings or objects carrying `distance_km` and
    `energy`. Rows whose distance cannot be read as a number are counted as
    `unplaced` rather than silently discarded, so the caller can tell the
    difference between "quiet" and "bad data".

    Returns a dict::

        {"bands": [ {key, label, range, count, peak, mean, low,
                     band, color, share}, ... ],
         "total": int, "unplaced": int, "peak": int|None}

    `peak`/`mean`/`low` are None for an empty band. `band`/`color` describe the
    energy band that the band's MEAN energy falls into, which is what the cell
    is tinted with. `share` is the band's share of the total, 0.0-1.0, used to
    drive how often the cell animates.

    Both the dashboard JSON and the PDF report call this, so the two views
    cannot drift apart.
    """
    def _read(row, name):
        if isinstance(row, dict):
            return row.get(name)
        return getattr(row, name, None)

    buckets = [[] for _ in DISTANCE_BANDS]
    unplaced = 0

    for row in (strikes or []):
        try:
            d = float(_read(row, "distance_km"))
        except (TypeError, ValueError):
            unplaced += 1
            continue
        if d != d or d in (float("inf"), float("-inf")) or d < 0:
            unplaced += 1
            continue
        try:
            e = int(_read(row, "energy") or 0)
        except (TypeError, ValueError):
            e = 0
        e = max(0, min(ENERGY_MAX, e))

        for i, (_k, _l, _r, lower, upper) in enumerate(DISTANCE_BANDS):
            if d >= lower and (upper is None or d < upper):
                buckets[i].append(e)
                break
        else:
            # Unreachable while the last band is open-ended, but if the table
            # is ever edited into something non-exhaustive this keeps the
            # count honest instead of losing the strike.
            unplaced += 1

    total = sum(len(b) for b in buckets)
    rows = []
    for (key, label, rng, _lo, _up), es in zip(DISTANCE_BANDS, buckets):
        if es:
            mean = int(round(sum(es) / len(es)))
            eb = energy_band(mean)
            rows.append({
                "key": key, "label": label, "range": rng,
                "count": len(es), "peak": max(es), "mean": mean, "low": min(es),
                "band": eb["name"], "color": eb["color"],
                "share": (len(es) / total) if total else 0.0,
            })
        else:
            rows.append({
                "key": key, "label": label, "range": rng,
                "count": 0, "peak": None, "mean": None, "low": None,
                "band": None, "color": None, "share": 0.0,
            })

    peaks = [r["peak"] for r in rows if r["peak"] is not None]
    return {"bands": rows, "total": total, "unplaced": unplaced,
            "peak": max(peaks) if peaks else None}


# ---------------------------------------------------------------------------
# Coordinate validation
# ---------------------------------------------------------------------------

def valid_coords(lat, lon):
    """True iff lat is in [-90, 90] and lon is in [-180, 180].

    Non-numeric input is invalid (returns False) rather than raising.
    """
    try:
        la = float(lat)
        lo = float(lon)
    except (TypeError, ValueError):
        return False
    # Reject NaN and infinities: they are not valid coordinates.
    if la != la or lo != lo:            # NaN check
        return False
    if la in (float("inf"), float("-inf")) or lo in (float("inf"), float("-inf")):
        return False
    return -90.0 <= la <= 90.0 and -180.0 <= lo <= 180.0


# ---------------------------------------------------------------------------
# Uptime / availability
# ---------------------------------------------------------------------------

def uptime_pct(received, expected):
    """Availability percentage from received vs expected heartbeats.

    Clamped to [0, 100]. Returns 100.0 when nothing was expected (a period with
    no expected beats cannot be "down"). Non-decreasing in `received`.
    """
    try:
        r = float(received)
        e = float(expected)
    except (TypeError, ValueError):
        return 0.0
    if r < 0:
        r = 0.0
    if e <= 0:
        return 100.0
    pct = (r / e) * 100.0
    if pct < 0.0:
        return 0.0
    if pct > 100.0:
        return 100.0
    return pct


# ---------------------------------------------------------------------------
# SAST month windows
# ---------------------------------------------------------------------------

SAST = timezone(timedelta(hours=2), name="SAST")


def sast_month_window(year, month):
    """Return (start, next_start) naive-SAST datetimes for a calendar month.

    The window is half-open: a timestamp t belongs to the month iff
    start <= t < next_start. Datetimes are naive (no tzinfo) to match how the
    panel stores SAST in the database.
    """
    year = int(year)
    month = int(month)
    if not 1 <= month <= 12:
        raise ValueError("month must be 1..12")
    start = datetime(year, month, 1)
    if month == 12:
        next_start = datetime(year + 1, 1, 1)
    else:
        next_start = datetime(year, month + 1, 1)
    return start, next_start


def in_month(ts, year, month):
    """True iff naive datetime `ts` falls within the given SAST month."""
    if ts is None:
        return False
    start, next_start = sast_month_window(year, month)
    return start <= ts < next_start


def expected_hourly_samples(year, month, now=None):
    """How many hourly heartbeats a fully-online unit would send this month.

    For a past month this is the number of hours in the month. For the current
    month it is the hours elapsed so far (so availability is not diluted by the
    part of the month that has not happened yet). `now` is a naive SAST time.
    """
    start, next_start = sast_month_window(year, month)
    now = now or datetime.now(SAST).replace(tzinfo=None)
    end = next_start
    if now < next_start:
        end = now
    if end <= start:
        return 0
    seconds = (end - start).total_seconds()
    return int(seconds // 3600)


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

def prune_cutoff(now, retention_days):
    """The oldest timestamp to keep: rows with ts < cutoff should be deleted.

    A sample is retained iff its ts >= cutoff, i.e. its age is within the
    retention window. `now` is a naive SAST datetime.
    """
    days = int(retention_days)
    if days < 0:
        days = 0
    return now - timedelta(days=days)


def is_within_retention(ts, now, retention_days):
    """True iff `ts` should be kept under the retention window ending at `now`."""
    if ts is None:
        return False
    return ts >= prune_cutoff(now, retention_days)
