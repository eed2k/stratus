"""Tests for the plain-language forecast summaries.

These sentences are what a non-specialist actually acts on, so they are pinned
here rather than eyeballed in a browser.
"""
from datetime import date, datetime, timedelta

from app import plain


def _pts(start: datetime, values, p10=None, p90=None):
    """Hourly points from `start`, one per value."""
    out = []
    for i, v in enumerate(values):
        p = {"valid_at": start + timedelta(hours=i), "value": v}
        if p10 is not None and p90 is not None:
            p["p10"] = v - p10
            p["p90"] = v + p90
        out.append(p)
    return out


# ---------------------------------------------------------------------------
# Day labels
# ---------------------------------------------------------------------------

def test_day_labels_are_relative_then_named():
    today = date(2026, 9, 7)          # a Monday
    assert plain.day_label(today, today) == "Today"
    assert plain.day_label(today + timedelta(days=1), today) == "Tomorrow"
    # Two days out is named, not "in 2 days".
    assert plain.day_label(today + timedelta(days=2), today) == "Wednesday"


# ---------------------------------------------------------------------------
# Rainfall: accumulated, and never given an invented probability
# ---------------------------------------------------------------------------

def test_rain_below_a_trace_is_reported_as_no_rain():
    assert plain.describe_rain(0.0) == "no rain expected"
    assert plain.describe_rain(0.1) == "no rain expected"


def test_rain_wording_escalates_with_amount():
    assert "light rain" in plain.describe_rain(1.0)
    assert "rain likely" in plain.describe_rain(5.0)
    assert "substantial" in plain.describe_rain(15.0)
    assert "heavy" in plain.describe_rain(40.0)


def test_rain_never_claims_a_percentage():
    """A percent chance is not something the engine produces for rainfall."""
    for mm in (0.0, 0.5, 3.0, 12.0, 60.0):
        assert "%" not in plain.describe_rain(mm)


def test_missing_rainfall_is_not_reported_as_dry():
    """No rainfall forecast is a different statement from "no rain"."""
    assert plain.describe_rain(None) == "no rainfall forecast"


def test_daily_rainfall_is_summed_not_averaged():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"rainfall": _pts(start, [0.4] * 24)}
    out = plain.build_outlook(series, today=start.date())
    assert len(out) == 1
    # 24 hours of 0.4 mm is 9.6 mm of rain, not 0.4.
    assert out[0].rain_mm == 9.6


# ---------------------------------------------------------------------------
# Temperature is a daily range, not an average
# ---------------------------------------------------------------------------

def test_temperature_is_reduced_to_the_day_range():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"temperature": _pts(start, [8, 12, 19, 26, 24, 15])}
    out = plain.build_outlook(series, today=start.date())
    assert out[0].temp_min == 8
    assert out[0].temp_max == 26
    assert "8 to 26 degrees" in out[0].summary


def test_points_are_split_across_local_days():
    start = datetime(2026, 9, 7, 22, 0)
    # 6 hourly points straddling midnight.
    series = {"temperature": _pts(start, [10, 9, 8, 7, 6, 5])}
    out = plain.build_outlook(series, today=start.date())
    assert [o.label for o in out] == ["Today", "Tomorrow"]
    assert out[0].temp_min == 9      # 22:00, 23:00
    assert out[1].temp_min == 5      # 00:00 onward


# ---------------------------------------------------------------------------
# Confidence comes from the band, and absence of a band is not confidence
# ---------------------------------------------------------------------------

def test_a_tight_band_reads_as_high_confidence():
    assert plain.confidence_for("temperature", 1.0) == "high"


def test_a_wide_band_reads_as_low_confidence():
    assert plain.confidence_for("temperature", 8.0) == "low"


def test_a_missing_band_is_moderate_not_high():
    assert plain.confidence_for("temperature", None) == "moderate"


def test_confidence_thresholds_are_per_variable():
    """3 degrees and 3 km/h are not the same amount of doubt."""
    assert plain.confidence_for("temperature", 3.0) == "moderate"
    assert plain.confidence_for("wind_speed", 3.0) == "high"


def test_outlook_carries_the_band_through_to_confidence():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"temperature": _pts(start, [15] * 6, p10=0.4, p90=0.4)}
    out = plain.build_outlook(series, today=start.date())
    assert out[0].confidence == "high"


# ---------------------------------------------------------------------------
# Wind: mentioned when it matters, gust only when it adds something
# ---------------------------------------------------------------------------

def test_light_wind_is_left_out_of_the_day_sentence():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"temperature": _pts(start, [20]),
              "wind_speed": _pts(start, [5])}
    out = plain.build_outlook(series, today=start.date())
    assert "km/h" not in out[0].summary


def test_strong_wind_is_named_in_the_day_sentence():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"temperature": _pts(start, [20]),
              "wind_speed": _pts(start, [45])}
    out = plain.build_outlook(series, today=start.date())
    assert "strong wind" in out[0].summary


def test_a_gust_close_to_the_wind_is_not_repeated():
    assert "gusting" not in plain.describe_wind(30.0, 32.0)


def test_a_gust_well_above_the_wind_is_called_out():
    assert "gusting 55" in plain.describe_wind(30.0, 55.0)


# ---------------------------------------------------------------------------
# Headline and multi-day rain statement
# ---------------------------------------------------------------------------

def test_headline_describes_the_nearest_day():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"temperature": _pts(start, [10, 24])}
    out = plain.build_outlook(series, today=start.date())
    assert plain.headline(out).startswith("Today:")


def test_headline_is_explicit_when_there_is_no_forecast():
    assert "no forecast" in plain.headline([]).lower()


def test_rain_outlook_states_a_dry_period_plainly():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"rainfall": _pts(start, [0.0] * 48)}
    out = plain.build_outlook(series, today=start.date())
    assert "No rain is expected" in plain.rain_outlook(out)


def test_rain_outlook_names_the_wet_days():
    start = datetime(2026, 9, 7, 0, 0)
    # Dry today, 5 mm tomorrow.
    series = {"rainfall": _pts(start, [0.0] * 24 + [5.0] + [0.0] * 23)}
    out = plain.build_outlook(series, today=start.date())
    text = plain.rain_outlook(out)
    assert "one day" in text and "Tomorrow" in text


# ---------------------------------------------------------------------------
# What the forecast is built from
# ---------------------------------------------------------------------------

def test_backing_says_station_only_when_no_model_is_enabled():
    text = plain.describe_backing([])
    assert "own recorded history" in text
    assert "No external weather model" in text


def test_backing_names_the_model_backed_variables():
    text = plain.describe_backing(["temperature", "pressure"])
    assert "pressure, temperature" in text


# ---------------------------------------------------------------------------
# Robustness: bad input must not take the page down
# ---------------------------------------------------------------------------

def test_empty_input_yields_no_days():
    assert plain.build_outlook({}) == []
    assert plain.build_outlook({"temperature": []}) == []


def test_string_timestamps_are_accepted():
    series = {"temperature": [
        {"valid_at": "2026-09-07 06:00:00", "value": 11.0},
        {"valid_at": "2026-09-07 15:00:00", "value": 25.0},
    ]}
    out = plain.build_outlook(series, today=date(2026, 9, 7))
    assert out[0].temp_min == 11.0 and out[0].temp_max == 25.0


def test_unparseable_and_null_points_are_skipped():
    series = {"temperature": [
        {"valid_at": "not-a-date", "value": 5.0},
        {"valid_at": datetime(2026, 9, 7, 9), "value": None},
        {"valid_at": datetime(2026, 9, 7, 10), "value": 18.0},
    ]}
    out = plain.build_outlook(series, today=date(2026, 9, 7))
    assert len(out) == 1
    assert out[0].temp_max == 18.0


def test_day_count_is_capped():
    start = datetime(2026, 9, 7, 0, 0)
    series = {"temperature": _pts(start, [20] * (24 * 10))}
    out = plain.build_outlook(series, today=start.date(), max_days=3)
    assert len(out) == 3
