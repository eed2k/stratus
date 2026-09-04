"""Property-based and unit tests for app.metrics (Properties 2-6).

These tests use only the standard library plus pytest and hypothesis; they do
not import the web app or touch a database.
"""
from datetime import datetime, timedelta

import pytest
from hypothesis import given, strategies as st

from app import metrics


# ---------------------------------------------------------------------------
# Property 2: Energy band totality and monotonicity
# ---------------------------------------------------------------------------

@given(st.integers(min_value=0, max_value=metrics.ENERGY_MAX))
def test_energy_band_total_over_domain(e):
    band = metrics.energy_band(e)
    assert band["name"] in {"Low", "Moderate", "High", "Extreme"}
    assert 0 <= band["index"] <= 3
    assert band["color"].startswith("#")


@given(
    st.integers(min_value=0, max_value=metrics.ENERGY_MAX),
    st.integers(min_value=0, max_value=metrics.ENERGY_MAX),
)
def test_energy_band_monotonic(a, b):
    lo, hi = sorted((a, b))
    assert metrics.energy_band(lo)["index"] <= metrics.energy_band(hi)["index"]


@given(st.integers())
def test_energy_band_never_raises_and_clamps(e):
    # Includes negatives and values beyond full scale.
    band = metrics.energy_band(e)
    assert 0 <= band["index"] <= 3


def test_energy_band_boundaries_exact():
    assert metrics.energy_band(0)["name"] == "Low"
    assert metrics.energy_band(524_287)["name"] == "Low"
    assert metrics.energy_band(524_288)["name"] == "Moderate"
    assert metrics.energy_band(1_048_575)["name"] == "Moderate"
    assert metrics.energy_band(1_048_576)["name"] == "High"
    assert metrics.energy_band(1_572_863)["name"] == "High"
    assert metrics.energy_band(1_572_864)["name"] == "Extreme"
    assert metrics.energy_band(metrics.ENERGY_MAX)["name"] == "Extreme"


def test_energy_legend_covers_full_scale_without_gaps():
    rows = metrics.energy_bands_legend()
    assert rows[0]["lower"] == 0
    assert rows[-1]["upper"] == metrics.ENERGY_MAX
    for i in range(len(rows) - 1):
        # Next band starts exactly one above the previous upper bound.
        assert rows[i]["upper"] + 1 == rows[i + 1]["lower"]


# ---------------------------------------------------------------------------
# Property 3: Coordinate validation
# ---------------------------------------------------------------------------

@given(
    st.floats(min_value=-90, max_value=90, allow_nan=False, allow_infinity=False),
    st.floats(min_value=-180, max_value=180, allow_nan=False, allow_infinity=False),
)
def test_valid_coords_accepts_in_range(lat, lon):
    assert metrics.valid_coords(lat, lon) is True


@given(st.floats(allow_nan=True, allow_infinity=True),
       st.floats(allow_nan=True, allow_infinity=True))
def test_valid_coords_matches_definition(lat, lon):
    expected = (
        lat == lat and lon == lon                       # not NaN
        and lat not in (float("inf"), float("-inf"))
        and lon not in (float("inf"), float("-inf"))
        and -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0
    )
    assert metrics.valid_coords(lat, lon) is expected


def test_valid_coords_rejects_non_numeric():
    assert metrics.valid_coords("abc", 10) is False
    assert metrics.valid_coords(None, None) is False


# ---------------------------------------------------------------------------
# Property 4: Uptime bounds
# ---------------------------------------------------------------------------

@given(
    st.integers(min_value=0, max_value=10_000),
    st.integers(min_value=0, max_value=10_000),
)
def test_uptime_in_bounds(received, expected):
    pct = metrics.uptime_pct(received, expected)
    assert 0.0 <= pct <= 100.0


@given(st.integers(min_value=1, max_value=10_000),
       st.integers(min_value=1, max_value=10_000))
def test_uptime_full_when_received_ge_expected(received, expected):
    if received >= expected:
        assert metrics.uptime_pct(received, expected) == 100.0


@given(
    st.integers(min_value=0, max_value=10_000),
    st.integers(min_value=0, max_value=10_000),
    st.integers(min_value=1, max_value=10_000),
)
def test_uptime_non_decreasing_in_received(r1, r2, expected):
    lo, hi = sorted((r1, r2))
    assert metrics.uptime_pct(lo, expected) <= metrics.uptime_pct(hi, expected)


def test_uptime_zero_expected_is_full():
    assert metrics.uptime_pct(0, 0) == 100.0


# ---------------------------------------------------------------------------
# Property 5: SAST month window
# ---------------------------------------------------------------------------

@given(
    st.integers(min_value=2020, max_value=2035),
    st.integers(min_value=1, max_value=12),
)
def test_month_window_half_open(year, month):
    start, nxt = metrics.sast_month_window(year, month)
    assert start < nxt
    assert start.day == 1
    assert nxt.day == 1
    # start is inside, next_start is outside
    assert metrics.in_month(start, year, month) is True
    assert metrics.in_month(nxt, year, month) is False
    assert metrics.in_month(nxt - timedelta(seconds=1), year, month) is True


def test_month_window_december_rolls_year():
    start, nxt = metrics.sast_month_window(2025, 12)
    assert start == datetime(2025, 12, 1)
    assert nxt == datetime(2026, 1, 1)


def test_month_window_rejects_bad_month():
    with pytest.raises(ValueError):
        metrics.sast_month_window(2025, 13)


# ---------------------------------------------------------------------------
# Property 6: Retention safety
# ---------------------------------------------------------------------------

@given(
    st.integers(min_value=0, max_value=400),
    st.integers(min_value=0, max_value=800),
)
def test_retention_partition(retention_days, age_days):
    now = datetime(2026, 6, 15, 12, 0, 0)
    ts = now - timedelta(days=age_days)
    keep = metrics.is_within_retention(ts, now, retention_days)
    # Kept iff age is within the window (ts >= cutoff).
    assert keep is (age_days <= retention_days)


def test_prune_cutoff_boundary():
    now = datetime(2026, 6, 15, 12, 0, 0)
    cutoff = metrics.prune_cutoff(now, 70)
    assert cutoff == now - timedelta(days=70)
    # A sample exactly at the cutoff is retained.
    assert metrics.is_within_retention(cutoff, now, 70) is True
    assert metrics.is_within_retention(cutoff - timedelta(seconds=1), now, 70) is False


# ---------------------------------------------------------------------------
# Distance bands for the storm-activity display
# ---------------------------------------------------------------------------

def test_distance_bands_are_exhaustive_and_disjoint():
    """Every strike must land in exactly one band.

    This is the property the whole display rests on: if the bands leak, the
    dashboard and the PDF quietly under-report storm activity.
    """
    probe = [0, 0.5, 1, 1.0001, 1.5, 4.9, 5, 9, 9.99, 10, 19.9, 20, 29.9,
             30, 34, 40, 63, 999]
    out = metrics.distance_band_summary(
        [{"distance_km": d, "energy": 1000} for d in probe])
    assert out["total"] == len(probe)
    assert out["unplaced"] == 0
    assert sum(b["count"] for b in out["bands"]) == len(probe)


def test_distance_bands_match_the_sensor_steps():
    """The AS3935's 15 discrete steps must each fall in one band, with the
    boundaries sitting between steps rather than on one."""
    steps = [1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40]
    out = metrics.distance_band_summary(
        [{"distance_km": d, "energy": 500000} for d in steps])
    counts = [b["count"] for b in out["bands"]]
    #        <=1  <10  <20  <30  30-40
    assert counts == [1, 3, 4, 3, 4]
    assert out["total"] == len(steps)


def test_distance_band_stats_are_correct():
    out = metrics.distance_band_summary([
        {"distance_km": 5, "energy": 100},
        {"distance_km": 6, "energy": 300},
        {"distance_km": 8, "energy": 500},
    ])
    near = out["bands"][1]
    assert near["count"] == 3
    assert near["peak"] == 500
    assert near["low"] == 100
    assert near["mean"] == 300
    assert near["share"] == 1.0
    # An empty band reports None rather than 0, so "no data" cannot be mistaken
    # for "a strike with no energy".
    assert out["bands"][0]["count"] == 0
    assert out["bands"][0]["peak"] is None
    assert out["bands"][0]["mean"] is None


def test_distance_band_summary_survives_bad_input():
    out = metrics.distance_band_summary([
        {"distance_km": None, "energy": 1},
        {"distance_km": "not a number", "energy": 1},
        {"distance_km": float("nan"), "energy": 1},
        {"distance_km": float("inf"), "energy": 1},
        {"distance_km": -3, "energy": 1},
    ])
    # Counted, not silently dropped: the caller can tell bad data from quiet.
    assert out["total"] == 0
    assert out["unplaced"] == 5
    assert all(b["count"] == 0 for b in out["bands"])


def test_distance_band_summary_handles_empty_and_none():
    for arg in ([], None):
        out = metrics.distance_band_summary(arg)
        assert out["total"] == 0
        assert out["peak"] is None
        assert len(out["bands"]) == len(metrics.DISTANCE_BANDS)


def test_distance_band_summary_clamps_energy_to_full_scale():
    out = metrics.distance_band_summary(
        [{"distance_km": 5, "energy": metrics.ENERGY_MAX * 10}])
    assert out["bands"][1]["peak"] == metrics.ENERGY_MAX


def test_distance_band_colors_come_from_the_energy_bands():
    """The cell tint must be the panel's own energy-band color, so the display
    cannot drift from the legend."""
    out = metrics.distance_band_summary(
        [{"distance_km": 5, "energy": metrics.ENERGY_MAX}])
    band = out["bands"][1]
    assert band["color"] == metrics.energy_band(metrics.ENERGY_MAX)["color"]
    assert band["band"] == metrics.energy_band(metrics.ENERGY_MAX)["name"]


def test_distance_band_summary_accepts_objects_as_well_as_dicts():
    """reports.py passes dicts, but ORM rows are the obvious next caller."""
    import types
    rows = [types.SimpleNamespace(distance_km=12, energy=900000)]
    out = metrics.distance_band_summary(rows)
    assert out["total"] == 1
    assert out["bands"][2]["count"] == 1
