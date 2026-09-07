"""The adaptive site-correction loop.

The properties tested here are the ones that decide whether this feature helps or
quietly makes the forecast worse: it must not act on thin evidence, it must not
train on its own output, it must not count an observation twice, and it must
handle a wrapped axis correctly.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import adaptive                                      # noqa: E402
from app.db import Database                                   # noqa: E402
from app.ingest import Observation                            # noqa: E402

T0 = datetime(2026, 6, 1, 3, 0)          # 03:00, inside the 00-06 hour bucket


# ---------------------------------------------------------------------------
#  Keys
# ---------------------------------------------------------------------------

def test_lead_buckets_cover_every_hour_of_the_longest_horizon():
    """No lead hour may fall through, or its error is never learned."""
    for lead in range(1, 121):
        assert adaptive.lead_bucket(lead)


def test_lead_beyond_the_table_is_held_in_the_last_bucket():
    """Held rather than dropped, so a longer horizon still learns."""
    assert adaptive.lead_bucket(500) == adaptive.lead_bucket(120)


def test_hour_buckets_separate_night_from_afternoon():
    """The nano-climate term: a cold-air hollow is wrong before dawn only."""
    assert adaptive.hour_bucket(T0) == "00-06"
    assert adaptive.hour_bucket(T0.replace(hour=14)) == "12-18"
    assert adaptive.hour_bucket(T0) != adaptive.hour_bucket(T0.replace(hour=14))


# ---------------------------------------------------------------------------
#  Learning
# ---------------------------------------------------------------------------

def _feed(model, n, error, variable="temperature", provider="xweather",
          lead=3.0, when=T0):
    for _ in range(n):
        model.observe(variable=variable, provider=provider, lead_hours=lead,
                      valid_at=when, forecast=10.0 + error, observed=10.0)


def test_a_thin_cell_is_not_trusted():
    """One observation is not evidence of a site's offset."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 1, -4.0)
    assert m.correction("temperature", "xweather", 3.0, T0) == 0.0


def test_a_repeated_offset_is_learned_and_corrected_in_the_right_direction():
    """A forecast running 4 degrees cold must be corrected upward."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, adaptive.MIN_SAMPLES + 4, -4.0)
    corr = m.correction("temperature", "xweather", 3.0, T0)
    assert corr == pytest.approx(4.0, abs=0.3)


def test_the_first_sample_is_taken_whole_rather_than_crept_toward():
    """Starting from an assumed zero would waste dozens of observations."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 1, -4.0)
    cell = m.cells[("temperature", "xweather", adaptive.lead_bucket(3.0),
                    adaptive.hour_bucket(T0))]
    assert cell.bias == pytest.approx(-4.0)


def test_the_average_forgets_an_old_offset():
    """A site's offset moves with the season, so the old one must decay out."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 40, -5.0)
    _feed(m, 40, +2.0)
    corr = m.correction("temperature", "xweather", 3.0, T0)
    # Tracking the new regime, not averaging the two.
    assert corr == pytest.approx(-2.0, abs=0.5)


def test_an_offset_that_is_a_small_part_of_the_error_is_left_alone():
    """The guard whose absence made this module harm five of seven variables.

    Measured over eight months at Quaggasklip, the Day 1 temperature forecast has a
    mean absolute error of 2.31 and an offset of 0.10. There is essentially nothing
    systematic to remove, so subtracting the offset from every hour trades a known
    tiny bias for added scatter, and the A/B run showed exactly that. Solar
    radiation over the same period carries an offset that is a third of its error,
    and removing it cut the error by 18 percent.
    """
    m = adaptive.BiasModel(station_id=1)
    when = T0
    # Alternating +2.4 / -2.6 errors: mean -0.1, mean absolute 2.5, so the offset
    # is 4 percent of the error, as in the real measurement.
    for i in range(40):
        err = 2.4 if i % 2 == 0 else -2.6
        m.observe(variable="temperature", provider="xweather", lead_hours=3.0,
                  valid_at=when, forecast=10.0 + err, observed=10.0)
    cell = m.cells[("temperature", "xweather", adaptive.lead_bucket(3.0),
                    adaptive.hour_bucket(when))]
    assert abs(cell.bias) < 0.4
    assert cell.mae > 2.0
    assert cell.worth_correcting() is False
    assert m.correction("temperature", "xweather", 3.0, when) == 0.0


def test_a_dominant_offset_is_still_corrected():
    """The other side of the same guard: a real offset must not be suppressed."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 40, -4.0)
    cell = m.cells[("temperature", "xweather", adaptive.lead_bucket(3.0),
                    adaptive.hour_bucket(T0))]
    assert cell.worth_correcting() is True
    assert m.correction("temperature", "xweather", 3.0, T0) > 3.0


def test_there_is_no_all_leads_cell():
    """Pooling lead 1 with lead 24 described neither and was applied to both.

    It learned a temperature offset of -4.76 for a station whose true mean error
    over the same period was -0.10.
    """
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 20, -4.0, lead=3.0)
    keys = set(m.cells)
    assert not any(lead == adaptive.ANY for (_v, _p, lead, _h) in keys)


def test_a_long_lead_error_does_not_leak_into_a_short_lead_correction():
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 30, -6.0, lead=20.0)       # lead bucket 13-24 runs cold
    # Nothing was ever observed at lead 3, so nothing is corrected there.
    assert m.correction("temperature", "xweather", 3.0, T0) == 0.0
    assert m.correction("temperature", "xweather", 20.0, T0) > 0.0


def test_correction_is_bounded():
    """A sensor swap or a units change must degrade the forecast, not wreck it."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 40, -500.0)
    corr = m.correction("temperature", "xweather", 3.0, T0)
    assert abs(corr) <= adaptive.MAX_CORRECTION["temperature"]


def test_rainfall_is_never_corrected():
    """Its error is intermittency, not offset. Shifting it invents drizzle."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 40, 2.0, variable="rainfall")
    assert m.correction("rainfall", "xweather", 3.0, T0) == 0.0
    assert m.apply("rainfall", "xweather", 3.0, T0, 0.0) == (0.0, 0.0)


# ---------------------------------------------------------------------------
#  Separation of concerns between cells
# ---------------------------------------------------------------------------

def test_a_model_backed_run_and_a_history_only_run_do_not_share_a_cell():
    """They have unrelated systematic errors; one must not correct the other."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 40, -4.0, provider="xweather")
    assert m.correction("temperature", "", 3.0, T0) == 0.0
    assert m.correction("temperature", "xweather", 3.0, T0) != 0.0


def test_hours_of_the_day_are_learned_separately():
    """The whole point of the hour bucket."""
    m = adaptive.BiasModel(station_id=1)
    night = T0.replace(hour=3)
    afternoon = T0.replace(hour=14)
    _feed(m, 40, -5.0, when=night)
    _feed(m, 40, 0.0, when=afternoon)
    assert m.correction("temperature", "xweather", 3.0, night) > 3.0
    assert abs(m.correction("temperature", "xweather", 3.0, afternoon)) < 1.0


def test_a_sparse_cell_falls_back_to_a_coarser_key():
    """Better a broad offset than none, once the broad one has evidence."""
    m = adaptive.BiasModel(station_id=1)
    # Spread samples over hours so no single hour cell reaches its floor, but the
    # all-hours fallback does.
    for i in range(adaptive.MIN_SAMPLES_FALLBACK + 6):
        when = T0.replace(hour=i % 24)
        m.observe(variable="temperature", provider="xweather", lead_hours=3.0,
                  valid_at=when, forecast=6.0, observed=10.0)
    unseen = T0.replace(hour=3, minute=0)
    exact = m.cells[("temperature", "xweather", adaptive.lead_bucket(3.0),
                     adaptive.hour_bucket(unseen))]
    assert exact.samples < adaptive.MIN_SAMPLES_FALLBACK
    # Still corrected, via the all-hours cell.
    assert m.correction("temperature", "xweather", 3.0, unseen) > 0.0


# ---------------------------------------------------------------------------
#  Wrapped axis
# ---------------------------------------------------------------------------

def test_wind_direction_error_wraps_the_short_way():
    """Forecast 010 against observed 350 is 20 degrees, not 340."""
    m = adaptive.BiasModel(station_id=1)
    for _ in range(40):
        m.observe(variable="wind_direction", provider="xweather",
                  lead_hours=3.0, valid_at=T0, forecast=10.0, observed=350.0)
    corr = m.correction("wind_direction", "xweather", 3.0, T0)
    assert corr == pytest.approx(-20.0, abs=3.0)


def test_a_corrected_direction_stays_in_range():
    m = adaptive.BiasModel(station_id=1)
    for _ in range(40):
        m.observe(variable="wind_direction", provider="xweather",
                  lead_hours=3.0, valid_at=T0, forecast=10.0, observed=350.0)
    for raw in (0.0, 5.0, 180.0, 359.0):
        out, _ = m.apply("wind_direction", "xweather", 3.0, T0, raw)
        assert 0.0 <= out < 360.0


# ---------------------------------------------------------------------------
#  Physical limits
# ---------------------------------------------------------------------------

def test_a_correction_cannot_push_a_value_below_its_floor():
    """Negative wind speed or negative irradiance is not a forecast."""
    m = adaptive.BiasModel(station_id=1)
    for _ in range(40):
        m.observe(variable="wind_speed", provider="xweather", lead_hours=3.0,
                  valid_at=T0, forecast=8.0, observed=2.0)
    out, delta = m.apply("wind_speed", "xweather", 3.0, T0, 1.0)
    assert delta < 0
    assert out >= 0.0


def test_humidity_stays_within_zero_to_one_hundred():
    m = adaptive.BiasModel(station_id=1)
    for _ in range(40):
        m.observe(variable="humidity", provider="xweather", lead_hours=3.0,
                  valid_at=T0, forecast=50.0, observed=70.0)
    out, _ = m.apply("humidity", "xweather", 3.0, T0, 95.0)
    assert 0.0 <= out <= 100.0


# ---------------------------------------------------------------------------
#  The loop against a real database
# ---------------------------------------------------------------------------

def _db_with_scored_run(tmp_path, forecast_value, observed_value,
                        bias_applied=0.0, n_hours=6, n_runs=10):
    """A station with `n_runs` scored runs, each `n_hours` long.

    Several runs rather than one long one, because a run contributes ONE sample per
    cell: its hours are a single forecast, not independent evidence. A single run,
    however many hours it covers, is correctly one sample and will not reach the
    trust floor.
    """
    db = Database(str(tmp_path / "f.db"))
    sid = db.upsert_station("site", "Site", "CR300")
    db.update_station_position(sid, -31.2, 18.4, 262.0)

    obs = []
    for run in range(n_runs):
        # Runs a day apart, all launched at midnight, so every forecast hour lands
        # in the same lead and hour-of-day buckets and therefore the same cell.
        base = datetime(2026, 6, 1, 0, 0) + timedelta(days=run)
        points = []
        for lead in range(1, n_hours + 1):
            valid = base + timedelta(hours=lead)
            obs.append(Observation(observed_at=valid,
                                  values={"temperature": observed_value}))
            points.append((valid, float(lead), "temperature", forecast_value,
                           None, None, None, None, {}, [], bias_applied))
        run_id = db.create_run(sid, base, n_hours, provider="xweather")
        db.insert_points(run_id, points)
    db.insert_observations(sid, obs)
    return db, sid


def test_the_loop_learns_from_scored_runs(tmp_path):
    db, sid = _db_with_scored_run(tmp_path, forecast_value=6.0,
                                 observed_value=10.0)
    result = adaptive.update_from_verified(db, sid)
    assert result.points_consumed == 60          # 10 runs x 6 hours
    assert result.cells_written > 0
    model = adaptive.load(db, sid)
    # Forecast ran 4 cold every hour, so the correction adds about 4. The offset is
    # the entire error here, so it comfortably clears the significance guard.
    assert model.correction("temperature", "xweather", 3.0,
                            datetime(2026, 6, 1, 3, 0)) == pytest.approx(4.0, abs=0.6)


def test_one_run_is_one_sample(tmp_path):
    """A run's hours are one forecast, not independent evidence of an offset.

    Counting each hour separately let a single run reach the trust floor on its own,
    and because hours arrive in lead order the decaying average then tracked the
    longest lead rather than the mean.
    """
    db, sid = _db_with_scored_run(tmp_path, forecast_value=6.0,
                                 observed_value=10.0, n_hours=6, n_runs=1)
    adaptive.update_from_verified(db, sid)
    model = adaptive.load(db, sid)
    cell = model.cells[("temperature", "xweather", adaptive.lead_bucket(3.0),
                        adaptive.hour_bucket(datetime(2026, 6, 1, 3, 0)))]
    assert cell.samples == 1
    # One sample is under the floor, so nothing is corrected yet.
    assert model.correction("temperature", "xweather", 3.0,
                            datetime(2026, 6, 1, 3, 0)) == 0.0


def test_the_loop_does_not_consume_the_same_observation_twice(tmp_path):
    """A duplicated sample count would let a thin cell look trustworthy."""
    db, sid = _db_with_scored_run(tmp_path, forecast_value=6.0,
                                 observed_value=10.0)
    first = adaptive.update_from_verified(db, sid)
    second = adaptive.update_from_verified(db, sid)
    assert first.points_consumed == 60
    assert second.points_consumed == 0


def test_the_loop_trains_on_the_raw_value_not_on_its_own_correction(tmp_path):
    """The property that stops the correction compounding away from reality.

    Both databases hold a forecast that was 4 too cold BEFORE correction. In the
    second, 4 was already added, so the stored value matches the observation. If
    the learner read the stored value it would conclude the forecast is perfect
    and forget the offset it just applied; reading the raw value, it must reach
    the same conclusion in both.
    """
    db_a, sid_a = _db_with_scored_run(tmp_path / "a", forecast_value=6.0,
                                      observed_value=10.0, bias_applied=0.0)
    db_b, sid_b = _db_with_scored_run(tmp_path / "b", forecast_value=10.0,
                                      observed_value=10.0, bias_applied=4.0)
    adaptive.update_from_verified(db_a, sid_a)
    adaptive.update_from_verified(db_b, sid_b)
    when = datetime(2026, 6, 1, 3, 0)
    a = adaptive.load(db_a, sid_a).correction("temperature", "xweather", 3.0, when)
    b = adaptive.load(db_b, sid_b).correction("temperature", "xweather", 3.0, when)
    assert a == pytest.approx(b, abs=1e-6)
    assert b == pytest.approx(4.0, abs=0.6)


def test_reset_forgets_everything(tmp_path):
    """What a recalibration calls for: the old sensor's offset must not persist."""
    db, sid = _db_with_scored_run(tmp_path, forecast_value=6.0,
                                 observed_value=10.0)
    adaptive.update_from_verified(db, sid)
    assert adaptive.load(db, sid).cells
    db.reset_bias(sid)
    assert not adaptive.load(db, sid).cells


def test_state_survives_a_round_trip_through_the_database(tmp_path):
    db, sid = _db_with_scored_run(tmp_path, forecast_value=6.0,
                                 observed_value=10.0)
    adaptive.update_from_verified(db, sid)
    before = adaptive.load(db, sid)
    db.save_bias_rows(before.to_rows())
    after = adaptive.load(db, sid)
    assert {k: (round(v.bias, 6), v.samples) for k, v in before.cells.items()} \
        == {k: (round(v.bias, 6), v.samples) for k, v in after.cells.items()}


def test_summary_hides_cells_that_would_not_be_used(tmp_path):
    """A table of two-sample cells invites false confidence."""
    m = adaptive.BiasModel(station_id=1)
    _feed(m, 2, -4.0)
    assert m.summary() == []
    _feed(m, adaptive.MIN_SAMPLES_FALLBACK + 4, -4.0)
    assert m.summary()
