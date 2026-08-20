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

# Ordered low -> high. Each band is (name, lower_inclusive, accent_colour).
# Colours are data accents that sit inside the white/navy/black theme.
_ENERGY_BANDS = (
    ("Low",      0,        "#8aa0b8"),   # light grey-blue
    ("Moderate", _Q,       "#1b3a5b"),   # navy
    ("High",     _Q * 2,   "#e08a1e"),   # amber
    ("Extreme",  _Q * 3,   "#c0392b"),   # red
)


def energy_band(energy):
    """Classify a relative energy value into a named band.

    Returns a dict: {"name", "index", "colour"}. The function is total over the
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
    for i, (_name, lower, _colour) in enumerate(_ENERGY_BANDS):
        if e >= lower:
            idx = i
    name, _lower, colour = _ENERGY_BANDS[idx]
    return {"name": name, "index": idx, "colour": colour}


def energy_band_name(energy):
    """Convenience: just the band name."""
    return energy_band(energy)["name"]


def energy_bands_legend():
    """Legend rows for display: name, colour, and human-readable range.

    The ranges are expressed against full scale so the reader understands the
    relative nature of the value.
    """
    rows = []
    n = len(_ENERGY_BANDS)
    for i, (name, lower, colour) in enumerate(_ENERGY_BANDS):
        upper = _ENERGY_BANDS[i + 1][1] - 1 if i + 1 < n else ENERGY_MAX
        rows.append({
            "name": name,
            "colour": colour,
            "lower": lower,
            "upper": upper,
        })
    return rows


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
