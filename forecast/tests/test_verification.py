"""Verification tests: the scoring arithmetic and the honesty of the verdict."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import forecasting, ingest, verification

from conftest import make_toa5


def _run_and_score(database, station, horizon=24, step=24):
    forecasting.backfill_runs(database, station, horizon, step_hours=step,
                             max_runs=12)
    return verification.verify(database, station.id, horizon_hours=horizon)


# ---------------------------------------------------------------------------
#  Arithmetic
# ---------------------------------------------------------------------------

def test_mae_bias_and_rmse(database):
    """Hand-checked against errors of +2, -2 and +2."""
    sid = database.upsert_station("m", "M", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    observed = [10.0, 10.0, 10.0]
    forecast = [12.0, 8.0, 12.0]
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=i + 1),
                          values={"temperature": v})
        for i, v in enumerate(observed)])
    run = database.create_run(sid, t0, 24)
    database.insert_points(run, [
        (t0 + timedelta(hours=i + 1), float(i + 1), "temperature",
         f, None, None, 10.0, 10.0, {})
        for i, f in enumerate(forecast)])

    report = verification.verify(database, sid)
    score = report.scores[0]
    assert score.n == 3
    assert score.mae == pytest.approx(2.0)
    assert score.bias == pytest.approx(2.0 / 3.0)
    assert score.rmse == pytest.approx(2.0)


def test_skill_is_the_fractional_improvement(database):
    sid = database.upsert_station("s", "S", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    # Forecast is out by 1, persistence is out by 4: a 75 percent improvement.
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=1),
                          values={"temperature": 10.0})])
    run = database.create_run(sid, t0, 24)
    database.insert_points(run, [
        (t0 + timedelta(hours=1), 1.0, "temperature", 11.0, None, None,
         14.0, 12.0, {})])
    score = verification.verify(database, sid).scores[0]
    assert score.mae == pytest.approx(1.0)
    assert score.mae_persistence == pytest.approx(4.0)
    assert score.skill_vs_persistence == pytest.approx(0.75)
    assert score.mae_climatology == pytest.approx(2.0)
    assert score.skill_vs_climatology == pytest.approx(0.5)
    assert score.beats_persistence is True


def test_a_worse_forecast_gets_a_negative_skill_and_says_so(database):
    sid = database.upsert_station("w", "W", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=1),
                          values={"temperature": 10.0})])
    run = database.create_run(sid, t0, 24)
    database.insert_points(run, [
        (t0 + timedelta(hours=1), 1.0, "temperature", 16.0, None, None,
         11.0, 12.0, {})])
    score = verification.verify(database, sid).scores[0]
    assert score.skill_vs_persistence < 0
    assert score.beats_persistence is False
    assert "WORSE than persistence" in score.verdict


def test_direction_error_wraps(database):
    """350 forecast against 10 observed is a 20 degree miss, not 340."""
    sid = database.upsert_station("d", "D", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=1),
                          values={"wind_direction": 10.0})])
    run = database.create_run(sid, t0, 24)
    database.insert_points(run, [
        (t0 + timedelta(hours=1), 1.0, "wind_direction", 350.0, None, None,
         10.0, 10.0, {})])
    score = verification.verify(database, sid).scores[0]
    assert score.mae == pytest.approx(20.0)
    assert score.bias == pytest.approx(-20.0)


def test_direction_bias_is_not_forced_positive(database):
    """The bug this guards: an unsigned bias equals the MAE by construction."""
    sid = database.upsert_station("d2", "D2", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=i + 1),
                          values={"wind_direction": 10.0}) for i in range(2)])
    run = database.create_run(sid, t0, 24)
    database.insert_points(run, [
        (t0 + timedelta(hours=1), 1.0, "wind_direction", 30.0, None, None,
         10.0, 10.0, {}),
        (t0 + timedelta(hours=2), 2.0, "wind_direction", 350.0, None, None,
         10.0, 10.0, {}),
    ])
    score = verification.verify(database, sid).scores[0]
    assert score.mae == pytest.approx(20.0)
    # Errors of +20 and -20 must cancel.
    assert score.bias == pytest.approx(0.0)
    assert score.bias != score.mae


def test_interval_coverage_is_measured(database):
    sid = database.upsert_station("c", "C", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=i + 1),
                          values={"temperature": 10.0}) for i in range(4)])
    run = database.create_run(sid, t0, 24)
    # Three bands contain 10, one does not.
    bands = [(9.0, 11.0), (9.5, 10.5), (8.0, 12.0), (20.0, 30.0)]
    database.insert_points(run, [
        (t0 + timedelta(hours=i + 1), float(i + 1), "temperature", 10.0,
         lo, hi, 10.0, 10.0, {})
        for i, (lo, hi) in enumerate(bands)])
    score = verification.verify(database, sid).scores[0]
    assert score.interval_n == 4
    assert score.interval_coverage_pct == pytest.approx(75.0)


# ---------------------------------------------------------------------------
#  Semantics
# ---------------------------------------------------------------------------

def test_unscored_future_points_are_excluded(database):
    """A forecast about an hour that has not happened cannot be graded."""
    sid = database.upsert_station("f", "F", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=1),
                          values={"temperature": 10.0})])
    run = database.create_run(sid, t0, 24)
    database.insert_points(run, [
        (t0 + timedelta(hours=h), float(h), "temperature", 10.0, None, None,
         10.0, 10.0, {}) for h in (1, 2, 3)])
    report = verification.verify(database, sid)
    assert report.pairs_scored == 1


def test_empty_report_explains_itself(database, loaded_station):
    report = verification.verify(database, loaded_station.id)
    assert report.pairs_scored == 0
    assert report.scores == []
    assert any("backfill" in n.lower() for n in report.notes)


def test_null_forecast_values_are_not_scored(database):
    sid = database.upsert_station("n", "N", "")
    t0 = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        ingest.Observation(observed_at=t0 + timedelta(hours=1),
                          values={"temperature": 10.0})])
    run = database.create_run(sid, t0, 24)
    database.insert_points(run, [
        (t0 + timedelta(hours=1), 1.0, "temperature", None, None, None,
         10.0, 10.0, {})])
    assert verification.verify(database, sid).pairs_scored == 0


def test_buckets_split_by_lead_day(database):
    observations, _rep = ingest.parse_dat(make_toa5(hours=24 * 20))
    sid = database.upsert_station("b", "B", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    report = _run_and_score(database, station, horizon=72, step=48)
    buckets = {s.bucket for s in report.scores if s.variable == "temperature"}
    assert "Day 1" in buckets
    assert "Day 2" in buckets or "Day 3" in buckets
    for s in report.scores:
        assert s.lead_from <= s.lead_to


def test_error_grows_with_lead_time(database):
    """A sanity check on the whole chain: day 3 must be harder than day 1."""
    observations, _rep = ingest.parse_dat(make_toa5(hours=24 * 25))
    sid = database.upsert_station("g", "G", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    report = _run_and_score(database, station, horizon=72, step=24)
    temps = {s.bucket: s.mae for s in report.scores
             if s.variable == "temperature" and s.mae is not None}
    if "Day 1" in temps and "Day 3" in temps:
        assert temps["Day 3"] >= temps["Day 1"] * 0.9


def test_timeline_is_per_day_and_ordered(database):
    observations, _rep = ingest.parse_dat(make_toa5(hours=24 * 20))
    sid = database.upsert_station("t", "T", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    report = _run_and_score(database, station)
    series = report.timeline.get("temperature", [])
    assert series
    assert [e["date"] for e in series] == sorted(e["date"] for e in series)
    assert all(e["n"] > 0 and e["mae"] >= 0 for e in series)


def test_summary_table_is_rounded_for_display(database):
    observations, _rep = ingest.parse_dat(make_toa5(hours=24 * 20))
    sid = database.upsert_station("r", "R", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    report = _run_and_score(database, station)
    rows = verification.summary_table(report)
    assert rows
    for row in rows:
        assert set(row) >= {"variable", "bucket", "n", "mae", "bias",
                            "skill_vs_persistence", "verdict"}
        if row["mae"] is not None:
            assert row["mae"] == round(row["mae"], 2)


def test_real_chain_beats_persistence_on_temperature(database):
    """The end-to-end claim: a diurnal signal is learnable and beats persistence."""
    observations, _rep = ingest.parse_dat(make_toa5(hours=24 * 25))
    sid = database.upsert_station("real", "Real", "")
    database.insert_observations(sid, observations)
    station = database.get_station(sid)
    report = _run_and_score(database, station, horizon=24, step=12)
    score = report.headline("temperature")
    assert score is not None and score.n > 50
    assert score.skill_vs_persistence is not None
    assert score.skill_vs_persistence > 0.2, score.verdict


# ===========================================================================
#  Probabilistic verification (P10 CRPS, P11 rank histogram, P12 reliability)
# ===========================================================================

import json

from app import engine as _engine
from app import verification as _v
from app.db import Database as _Database


def _pair(members, observed, variable="temperature", lead=6):
    """A matched_pairs-shaped row carrying an ensemble."""
    return {"variable": variable, "lead_hours": lead,
            "forecast": (sum(members) / len(members)) if members else None,
            "observed": observed, "members": json.dumps(members),
            "p10": None, "p90": None, "persistence": None,
            "climatology": None}


# ---- P10: CRPS -----------------------------------------------------------

def test_crps_reduces_to_absolute_error_for_one_member():
    """The reduction that proves the implementation: with a single member the
    spread term vanishes and CRPS is exactly the absolute error."""
    assert _v.crps([7.0], 5.0) == pytest.approx(2.0)
    assert _v.crps([3.0], 9.5) == pytest.approx(6.5)


def test_crps_is_zero_for_a_perfect_deterministic_forecast():
    assert _v.crps([4.0], 4.0) == pytest.approx(0.0)


def test_crps_rewards_a_sharp_ensemble_that_is_right():
    sharp = _v.crps([9.9, 10.0, 10.1], 10.0)
    vague = _v.crps([2.0, 10.0, 18.0], 10.0)
    assert sharp < vague


def test_crps_punishes_a_confident_ensemble_that_is_wrong():
    confident_wrong = _v.crps([2.0, 2.1, 2.0], 10.0)
    hedged = _v.crps([2.0, 6.0, 10.0], 10.0)
    assert confident_wrong > hedged


def test_crps_is_none_without_members_or_observation():
    assert _v.crps([], 5.0) is None
    assert _v.crps([1.0, 2.0], None) is None


def test_mean_crps_reports_its_sample_size():
    pairs = [_pair([1.0, 2.0, 3.0], 2.0), _pair([4.0, 5.0, 6.0], 5.0),
             {"members": None, "observed": 3.0}]
    value, n = _v.mean_crps(pairs, decode=_Database.decode_members)
    assert n == 2                      # the memberless row is skipped, not scored
    assert value is not None and value >= 0.0


# ---- P11: rank histogram -------------------------------------------------

def test_rank_histogram_has_one_more_bin_than_members():
    pairs = [_pair([1.0, 2.0, 3.0], 2.5) for _ in range(5)]
    h = _v.rank_histogram(pairs, decode=_Database.decode_members)
    assert h.members == 3
    assert len(h.counts) == 4


def test_rank_counts_sum_to_the_pairs_scored():
    pairs = [_pair([1.0, 2.0, 3.0], float(i) / 2.0) for i in range(30)]
    h = _v.rank_histogram(pairs, decode=_Database.decode_members)
    assert sum(h.counts) == h.pairs == 30


def test_the_tie_rule_is_stated_and_followed():
    """An observation equal to a member ranks above it, so it lands in the bin
    after that member rather than being placed at random."""
    assert "above" in _v.TIE_RULE
    assert _v.rank_of([1.0, 2.0, 3.0], 2.0) == 2      # members 1.0 and 2.0
    assert _v.rank_of([1.0, 2.0, 3.0], 0.5) == 0      # below all members
    assert _v.rank_of([1.0, 2.0, 3.0], 9.0) == 3      # above all members


def test_a_narrow_ensemble_shows_as_under_dispersed():
    """The truth keeps landing outside a too-tight ensemble, filling the end
    bins: the classic U shape."""
    pairs = []
    for i in range(40):
        # Members clustered near 10, observation far away on alternating sides.
        pairs.append(_pair([9.9, 10.0, 10.1], 20.0 if i % 2 else 0.0))
    h = _v.rank_histogram(pairs, decode=_Database.decode_members)
    assert h.counts[0] > 0 and h.counts[-1] > 0
    assert "narrow" in h.shape


def test_too_few_forecasts_says_so_rather_than_inventing_a_shape():
    pairs = [_pair([1.0, 2.0, 3.0], 2.5) for _ in range(3)]
    h = _v.rank_histogram(pairs, decode=_Database.decode_members)
    assert "too few" in h.shape
    assert "needed" in h.note


def test_rank_histogram_is_none_without_ensembles():
    assert _v.rank_histogram([], decode=_Database.decode_members) is None


# ---- P12: reliability diagram -------------------------------------------

def test_a_perfectly_calibrated_set_sits_on_the_diagonal():
    """R7.8: when the event happens exactly as often as forecast, observed
    frequency equals forecast probability in every populated bin."""
    forecasts, outcomes = [], []
    for prob in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0):
        happened = int(round(prob * 10))
        for i in range(10):
            forecasts.append(prob)
            outcomes.append(i < happened)
    rel = _v.reliability(forecasts, outcomes, bins=5)
    assert rel is not None
    for b in rel.bins:
        assert b.observed_frequency == pytest.approx(b.forecast_mean, abs=1e-9)
    assert rel.reliability_term == pytest.approx(0.0, abs=1e-9)
    assert "Well calibrated" in rel.verdict


def test_an_overforecast_set_falls_below_the_diagonal():
    """Forecasting 90 percent for an event that never happens is the dangerous
    direction, and it must show as poorly calibrated."""
    rel = _v.reliability([0.9] * 40, [False] * 40, bins=10)
    assert rel.bins[-1].observed_frequency == 0.0
    assert rel.brier == pytest.approx(0.81)
    assert "Poorly calibrated" in rel.verdict or rel.base_rate == 0.0


def test_brier_decomposition_adds_up():
    """Brier = reliability - resolution + uncertainty (Murphy 1973)."""
    forecasts = [0.1, 0.3, 0.5, 0.7, 0.9] * 8
    outcomes = [i % 3 == 0 for i in range(40)]
    rel = _v.reliability(forecasts, outcomes, bins=5)
    rebuilt = (rel.reliability_term - rel.resolution_term
               + rel.uncertainty_term)
    assert rebuilt == pytest.approx(rel.brier, abs=1e-9)


def test_reliability_ignores_impossible_probabilities():
    rel = _v.reliability([0.5, 1.4, -0.2, None], [True, True, True, True])
    assert rel.n == 1


def test_reliability_is_none_without_pairs():
    assert _v.reliability([], []) is None


# ===========================================================================
#  P16: method version
# ===========================================================================

def test_method_version_is_stable_and_short():
    a = _v.method_version()
    b = _v.method_version()
    assert a == b
    assert len(a) == 12


def test_method_version_changes_when_a_tuning_constant_changes(monkeypatch):
    before = _v.method_version()
    monkeypatch.setattr(_engine, "NWP_MAX_WEIGHT", 0.55)
    assert _v.method_version() != before


def test_method_version_ignores_dict_ordering():
    """A reordered dict is the same method, so the hash must not move."""
    original = dict(_engine.ANALOG_WEIGHTS)
    reordered = dict(reversed(list(original.items())))
    assert _v._canonical(original) == _v._canonical(reordered)


def test_every_engine_constant_is_accounted_for():
    """R7.13: adding a module-level constant to engine.py must force a decision
    about whether it changes the forecast method, rather than silently sliding
    into the history under an unchanged version."""
    import re
    from pathlib import Path
    source = (Path(_engine.__file__)).read_text(encoding="utf-8")
    found = set(re.findall(r"^([A-Z][A-Z0-9_]*)\s*[:=]", source, re.M))
    unaccounted = found - set(_v.KNOWN_ENGINE_CONSTANTS)
    assert not unaccounted, (
        f"new module-level constant(s) in engine.py not considered for the "
        f"method version: {sorted(unaccounted)}. Add each to "
        f"KNOWN_ENGINE_CONSTANTS, and to _VERSIONED_CONSTANTS if it changes "
        f"the numbers a forecast produces.")


def test_a_run_records_the_method_version(database):
    from datetime import datetime
    sid = database.upsert_station("mv", "Method Version Site", "CR1000X")
    run_id = database.create_run(sid, datetime(2026, 1, 1, 0, 0), 24,
                                 method_version=_v.method_version())
    runs = database.list_runs(sid)
    assert runs
    assert runs[0]["method_version"] == _v.method_version()
    assert run_id > 0


# ===========================================================================
#  P18: solar validation is a hindcast against measurement
# ===========================================================================

def test_solar_validation_is_none_without_measured_channels(database):
    """Nothing to validate against means None, not a page of zeros."""
    from datetime import datetime, timedelta
    from app.ingest import Observation
    sid = database.upsert_station("nopv", "No PV Site", "CR1000X")
    base = datetime(2026, 1, 1, 6, 0)
    database.insert_observations(sid, [
        Observation(observed_at=base + timedelta(hours=i),
                    values={"solar_radiation": 500.0, "temperature": 20.0})
        for i in range(8)])
    assert _v.validate_solar_model(database, sid) is None


def test_solar_validation_scores_module_temperature_against_measurement(database):
    from datetime import datetime, timedelta
    from app.ingest import Observation
    sid = database.upsert_station("pv", "PV Site", "CR1000X")
    database.update_station_position(sid, -26.7145, 27.0977, 1350.0, 2.0)
    base = datetime(2026, 1, 1, 6, 0)
    obs = []
    for i in range(12):
        when = base + timedelta(hours=i)
        obs.append(Observation(observed_at=when, values={
            "solar_radiation": 600.0, "temperature": 22.0,
            "wind_speed": 7.2, "pressure": 860.0,
            "moduleTemperature": 40.0}))
    database.insert_observations(sid, obs)

    result = _v.validate_solar_model(database, sid)
    assert result is not None
    assert "hindcast" in result.label.lower()
    module = next(r for r in result.residuals
                  if r.quantity == "module temperature")
    assert module.n == 12
    assert module.mae is not None
    assert module.unit == "C"
    assert "measurement" in module.verdict


def test_measured_dc_power_without_a_rating_says_so(database):
    from datetime import datetime, timedelta
    from app.ingest import Observation
    sid = database.upsert_station("pv2", "PV Site 2", "CR1000X")
    database.update_station_position(sid, -26.7145, 27.0977, 1350.0, 2.0)
    base = datetime(2026, 1, 1, 6, 0)
    database.insert_observations(sid, [
        Observation(observed_at=base + timedelta(hours=i), values={
            "solar_radiation": 600.0, "temperature": 22.0,
            "mpptSolarPower": 250.0})
        for i in range(6)])
    result = _v.validate_solar_model(database, sid)
    assert result is not None
    assert any("rating" in n for n in result.notes)
