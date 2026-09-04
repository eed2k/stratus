"""Forecast runner tests: the grid, the horizons, and honesty about data."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import engine, forecasting, ingest
from app.db import Database

from conftest import make_toa5


def test_hourly_grid_averages_the_sub_hourly_readings(database):
    observations, rep = ingest.parse_dat(make_toa5(hours=6, step_minutes=30))
    sid = database.upsert_station("s", "S", "")
    database.insert_observations(sid, observations)
    timeline, columns = database and forecasting.build_hourly_grid(
        database, sid, ["temperature"], *database.observation_span(sid))
    assert len(timeline) == 6
    # Two half-hourly readings per hour, so each slot is their mean.
    assert all(v is not None for v in columns["temperature"])


def test_hourly_grid_leaves_gaps_as_gaps(database):
    """A missing hour must not be filled in, or analogs match invented data."""
    sid = database.upsert_station("s", "S", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    obs = [ingest.Observation(observed_at=t0 + timedelta(hours=h),
                             values={"temperature": 10.0 + h})
           for h in (0, 1, 4, 5)]
    database.insert_observations(sid, obs)
    timeline, columns = forecasting.build_hourly_grid(
        database, sid, ["temperature"], t0, t0 + timedelta(hours=5))
    assert len(timeline) == 6
    assert columns["temperature"][2] is None
    assert columns["temperature"][3] is None


def test_direction_grid_uses_a_vector_mean(database):
    sid = database.upsert_station("s", "S", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    obs = [
        ingest.Observation(observed_at=t0, values={"wind_direction": 350.0}),
        ingest.Observation(observed_at=t0 + timedelta(minutes=30),
                          values={"wind_direction": 10.0}),
        # A second hour, because a single-slot grid is refused by design.
        ingest.Observation(observed_at=t0 + timedelta(hours=1),
                          values={"wind_direction": 180.0}),
    ]
    database.insert_observations(sid, obs)
    _timeline, columns = forecasting.build_hourly_grid(
        database, sid, ["wind_direction"], t0, t0 + timedelta(hours=1))
    got = columns["wind_direction"][0]
    assert min(abs(got - 0.0), abs(got - 360.0)) < 1e-6, got


@pytest.mark.parametrize("days,expected_hours", [(1, 24), (3, 72), (5, 120)])
def test_each_horizon_produces_its_hours(database, loaded_station, days,
                                        expected_hours):
    summary = forecasting.run_forecast(database, loaded_station,
                                      forecasting.HORIZON_HOURS[days])
    assert summary.horizon_hours == expected_hours
    points = database.run_points(summary.run_id, "temperature")
    assert len(points) == expected_hours
    leads = sorted(p["lead_hours"] for p in points)
    assert leads[0] == 1.0 and leads[-1] == float(expected_hours)


def test_base_time_is_the_last_observed_hour_not_the_clock(database,
                                                          loaded_station):
    summary = forecasting.run_forecast(database, loaded_station, 24)
    _lo, hi = database.observation_span(loaded_station.id)
    assert summary.base_time <= hi
    assert summary.base_time.year == hi.year
    # Emphatically not "now".
    assert summary.base_time.year == 2026


def test_baselines_are_recorded_with_every_point(database, loaded_station):
    """Scoring needs the baseline as it was at issue, not reconstructed later."""
    summary = forecasting.run_forecast(database, loaded_station, 24)
    points = database.run_points(summary.run_id, "temperature")
    assert all(p["persistence"] is not None for p in points)
    assert all(p["climatology"] is not None for p in points)
    # Persistence is a constant: the value at the base hour.
    assert len({round(p["persistence"], 6) for p in points}) == 1


def test_values_are_clipped_to_physical_ranges(database, loaded_station):
    for days in (1, 3, 5):
        summary = forecasting.run_forecast(
            database, loaded_station, forecasting.HORIZON_HOURS[days])
        for variable, (lo, hi) in (
                ("humidity", (0.0, 100.0)),
                ("wind_speed", (0.0, 200.0)),
                ("solar_radiation", (0.0, 1500.0))):
            for p in database.run_points(summary.run_id, variable):
                if p["value"] is not None:
                    assert lo <= p["value"] <= hi, (variable, p["value"])


def test_wind_direction_stays_on_the_compass(database, loaded_station):
    summary = forecasting.run_forecast(database, loaded_station, 72)
    for p in database.run_points(summary.run_id, "wind_direction"):
        if p["value"] is not None:
            assert 0.0 <= p["value"] < 360.0, p["value"]


def test_short_record_reports_why_there_is_no_ensemble(database):
    """Two days of data cannot support an analog ensemble, and says so."""
    observations, rep = ingest.parse_dat(make_toa5(hours=48))
    sid = database.upsert_station("short", "Short", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    summary = forecasting.run_forecast(database, station, 24)
    assert summary.sufficiency.analogs_found == 0
    assert summary.sufficiency.analog_limited_by_history is True
    assert any("analog" in n.lower() for n in summary.sufficiency.notes)
    # With no ensemble there is no spread to report.
    points = database.run_points(summary.run_id, "temperature")
    assert all(p["p10"] is None for p in points)


def test_long_record_does_find_analogs(database):
    observations, _rep = ingest.parse_dat(make_toa5(hours=24 * 30))
    sid = database.upsert_station("long", "Long", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    summary = forecasting.run_forecast(database, station, 24)
    assert summary.sufficiency.analogs_found > 0
    points = database.run_points(summary.run_id, "temperature")
    assert any(p["p10"] is not None and p["p90"] is not None for p in points)


def test_coverage_is_reported(database, loaded_station):
    summary = forecasting.run_forecast(database, loaded_station, 24)
    assert summary.sufficiency.coverage_pct > 95.0
    assert summary.sufficiency.hours_with_data > 0


def test_no_observations_raises_not_enough_data(database):
    sid = database.upsert_station("bare", "Bare", "")
    station = database.get_station(sid)
    with pytest.raises(forecasting.NotEnoughData):
        forecasting.run_forecast(database, station, 24)


def test_station_with_only_unforecastable_variables_is_refused(database):
    # Soil moisture is a stored (tier 3) variable the engine never forecasts.
    sid = database.upsert_station("soil", "Soil moisture only", "")
    t0 = datetime(2026, 1, 1)
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=h),
                          values={"soil_moisture": 0.0}) for h in range(40)])
    station = database.get_station(sid)
    with pytest.raises(forecasting.NotEnoughData, match="forecastable"):
        forecasting.run_forecast(database, station, 24)


def test_rerunning_the_same_base_replaces_the_run(database, loaded_station):
    a = forecasting.run_forecast(database, loaded_station, 24)
    b = forecasting.run_forecast(database, loaded_station, 24)
    runs = [r for r in database.list_runs(loaded_station.id)
            if r["horizon_hours"] == 24]
    assert len(runs) == 1
    assert a.run_id != b.run_id


def test_run_all_horizons_makes_three_runs(database, loaded_station):
    summaries = forecasting.run_all_horizons(database, loaded_station)
    assert [s.horizon_hours for s in summaries] == [24, 72, 120]
    assert len(database.list_runs(loaded_station.id)) == 3


def test_nwp_is_not_used_unless_the_station_opts_in(database, loaded_station):
    summary = forecasting.run_forecast(database, loaded_station, 24)
    assert summary.sufficiency.nwp_provider is None
    run = database.latest_run(loaded_station.id, 24)
    assert run["provider"] == ""
    assert "station history only" in run["notes"].lower()


def test_opting_in_without_coordinates_is_reported(database, toa5_text):
    observations, rep = ingest.parse_dat(toa5_text)
    sid = database.upsert_station("nopos", "No position", "")
    database.insert_observations(sid, observations)
    database.update_station_nwp(sid, True, ["xweather"], ["temperature"])
    station = database.get_station(sid)
    summary = forecasting.run_forecast(database, station, 24)
    assert any("coordinates" in n for n in summary.sufficiency.notes)


# ---------------------------------------------------------------------------
#  Backfill
# ---------------------------------------------------------------------------

def test_backfill_issues_runs_from_past_base_hours(database, loaded_station):
    runs = forecasting.backfill_runs(database, loaded_station, 24,
                                    step_hours=24, max_runs=10)
    assert len(runs) >= 5
    bases = [r.base_time for r in runs]
    assert bases == sorted(bases)
    _lo, hi = database.observation_span(loaded_station.id)
    # Every base must leave a full horizon of observations to score against.
    for base in bases:
        assert base + timedelta(hours=24) <= hi + timedelta(hours=1)


def test_backfill_does_not_see_the_future(database, loaded_station):
    """The point of the exercise: each run trains only on its own past."""
    runs = forecasting.backfill_runs(database, loaded_station, 24,
                                    step_hours=48, max_runs=4)
    assert runs
    for summary in runs:
        points = database.run_points(summary.run_id, "temperature")
        assert points
        for p in points:
            valid = datetime.strptime(p["valid_at"], "%Y-%m-%d %H:%M:%S")
            assert valid > summary.base_time


def test_backfill_refuses_a_record_that_is_too_short(database):
    observations, _rep = ingest.parse_dat(make_toa5(hours=30))
    sid = database.upsert_station("tiny", "Tiny", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    with pytest.raises(forecasting.NotEnoughData, match="too short"):
        forecasting.backfill_runs(database, station, 120)
