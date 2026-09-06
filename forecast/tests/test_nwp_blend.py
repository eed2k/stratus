"""Tests for the NWP background and the provider layer.

Nothing here touches the network. The Xweather adapter is exercised against a
recorded response shape, so the suite does not spend the operator's access
budget and does not fail when a third party is unreachable.
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import engine                                    # noqa: E402
from app.providers import base, registry, xweather        # noqa: E402

UTC = timezone.utc
T0 = datetime(2026, 8, 30, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
#  Backwards compatibility: the default must not move
# ---------------------------------------------------------------------------

def test_without_nwp_the_result_is_unchanged():
    """Omitting nwp_value must reproduce the station-history-only forecast."""
    fp = engine.blend_forecast(
        "temperature", T0, 6.0,
        climatology_value=20.0, current_anomaly=2.0, efold=12.0,
        analog_values=[21.0, 22.0, 23.0])
    assert "nwp" not in fp.sources
    w_persist = engine.persistence_weight(6.0, 12.0)
    baseline = 20.0 + engine.damped_anomaly(2.0, 6.0, 12.0)
    w_analog = min(engine.ANALOG_MAX_WEIGHT_NO_NWP,
                   0.25 + 0.35 * (1.0 - w_persist))
    expected = (1.0 - w_analog) * baseline + w_analog * 22.0
    assert fp.value == pytest.approx(expected)


def test_source_weights_sum_to_one():
    for lead in (0.0, 1.0, 6.0, 24.0, 72.0):
        for nwp in (None, 18.0):
            fp = engine.blend_forecast(
                "temperature", T0, lead,
                climatology_value=20.0, current_anomaly=1.5, efold=10.0,
                analog_values=[19.0, 20.0, 21.0],
                nwp_value=nwp, nwp_bias=-0.5)
            assert sum(fp.sources.values()) == pytest.approx(1.0), (
                f"lead={lead} nwp={nwp} sources={fp.sources}")


# ---------------------------------------------------------------------------
#  The model background behaves the way the design claims
# ---------------------------------------------------------------------------

def test_nwp_weight_grows_with_lead_time():
    shares = []
    for lead in (1.0, 6.0, 24.0, 48.0):
        fp = engine.blend_forecast(
            "temperature", T0, lead,
            climatology_value=20.0, current_anomaly=0.0, efold=12.0,
            analog_values=None, nwp_value=15.0, nwp_bias=0.0)
        shares.append(fp.sources.get("nwp", 0.0))
    assert shares == sorted(shares), shares
    assert shares[0] < shares[-1]


def test_nwp_weight_is_near_zero_at_zero_lead():
    """At zero lead persistence owns it: the observation is nearly the truth."""
    fp = engine.blend_forecast(
        "temperature", T0, 0.0,
        climatology_value=20.0, current_anomaly=3.0, efold=12.0,
        analog_values=None, nwp_value=10.0, nwp_bias=0.0)
    assert fp.sources.get("nwp", 0.0) == pytest.approx(0.0, abs=1e-9)
    assert fp.value == pytest.approx(23.0)


def test_bias_is_the_downscaling_term():
    """A station that runs colder than the grid cell keeps running colder."""
    warm = engine.blend_forecast(
        "temperature", T0, 12.0, climatology_value=20.0, current_anomaly=0.0,
        efold=1e6, analog_values=None, nwp_value=18.0, nwp_bias=0.0)
    cold = engine.blend_forecast(
        "temperature", T0, 12.0, climatology_value=20.0, current_anomaly=0.0,
        efold=1e6, analog_values=None, nwp_value=18.0, nwp_bias=-3.0)
    # A large efold keeps the bias almost undecayed, so the cold site must come
    # out below the unbiased blend.
    assert cold.value < warm.value


def test_nwp_alone_carries_a_station_with_no_climatology():
    fp = engine.blend_forecast(
        "temperature", T0, 12.0, climatology_value=None, current_anomaly=None,
        efold=12.0, analog_values=None, nwp_value=17.5, nwp_bias=1.0)
    assert fp.sources == {"nwp": 1.0}
    assert fp.value == pytest.approx(17.5 + engine.damped_anomaly(1.0, 12.0,
                                                                 12.0))


def test_climatology_keeps_a_stake_even_at_long_lead():
    """The model never claims the whole background."""
    fp = engine.blend_forecast(
        "temperature", T0, 500.0, climatology_value=20.0, current_anomaly=0.0,
        efold=12.0, analog_values=None, nwp_value=5.0, nwp_bias=0.0)
    assert fp.sources["nwp"] == pytest.approx(engine.NWP_MAX_WEIGHT, abs=1e-6)
    assert fp.sources["climatology"] > 0.0


# ---------------------------------------------------------------------------
#  Wind direction must not be blended on a straight line
# ---------------------------------------------------------------------------

def test_direction_blend_wraps_correctly():
    """350 and 10 degrees must blend to due north, not to south."""
    got = engine._mix(350.0, 10.0, 0.5, circular=True)
    assert min(abs(got - 0.0), abs(got - 360.0)) < 1e-6, got


def test_direction_blend_linear_would_have_been_wrong():
    linear = engine._mix(350.0, 10.0, 0.5, circular=False)
    assert linear == pytest.approx(180.0)          # the bug being avoided


def test_wind_direction_forecast_stays_in_range():
    for nwp in (None, 5.0, 355.0, 180.0):
        fp = engine.blend_forecast(
            "wind_direction", T0, 12.0, climatology_value=350.0,
            current_anomaly=0.0, efold=12.0, analog_values=[10.0, 350.0],
            nwp_value=nwp, nwp_bias=0.0)
        assert fp.value is None or 0.0 <= fp.value < 360.0, fp.value
        # No interval is offered for a wrapped axis.
        assert fp.p10 is None and fp.p90 is None


# ---------------------------------------------------------------------------
#  Provider plumbing
# ---------------------------------------------------------------------------

def test_opt_in_is_off_by_default():
    cfg = registry.StationNwpConfig()
    assert cfg.enabled is False
    assert registry.fetch_background(-26.7, 27.1, cfg) is None


def test_enabled_but_no_variables_still_makes_no_call():
    """Enabling a station is not consent to blend every variable."""
    cfg = registry.StationNwpConfig(enabled=True, variables=[])
    assert registry.fetch_background(-26.7, 27.1, cfg) is None


def test_sanitized_drops_unknown_names():
    cfg = registry.StationNwpConfig(
        enabled=True, providers=["xweather", "not_a_provider"],
        variables=["temperature", "not_a_variable"]).sanitized()
    assert cfg.providers == ["xweather"]
    assert cfg.variables == ["temperature"]


def test_only_xweather_ships():
    """The Lekwena/NWU WRF adapter was removed at the operator's request."""
    assert registry.ALL_PROVIDER_NAMES == ("xweather",)
    names = {p.name for p in registry.build_providers()}
    assert names == {"xweather"}
    labels = " ".join(p["label"] for p in registry.describe_providers()).lower()
    assert "lekwena" not in labels and "wrf" not in labels


def test_restrict_to_opted_in_strips_other_variables():
    fc = base.NwpForecast(
        provider="x", issued_at=T0,
        points=[base.NwpPoint(valid_at=T0,
                              values={"temperature": 20.0,
                                      "wind_speed": 15.0})])
    cfg = registry.StationNwpConfig(enabled=True, variables=["temperature"])
    out = registry.restrict_to_opted_in(fc, cfg)
    assert out is not None
    assert out.points[0].values == {"temperature": 20.0}


def test_restrict_returns_none_when_nothing_survives():
    fc = base.NwpForecast(
        provider="x", issued_at=T0,
        points=[base.NwpPoint(valid_at=T0, values={"wind_speed": 15.0})])
    cfg = registry.StationNwpConfig(enabled=True, variables=["temperature"])
    assert registry.restrict_to_opted_in(fc, cfg) is None


def test_nearest_point_refuses_to_stretch():
    fc = base.NwpForecast(
        provider="x", issued_at=T0,
        points=[base.NwpPoint(valid_at=T0, values={"temperature": 20.0})])
    assert fc.at(T0 + timedelta(minutes=30)) is not None
    assert fc.at(T0 + timedelta(hours=5)) is None


def test_mixed_time_awareness_is_not_covered_rather_than_an_exception():
    """The crash that switching the model background on used to produce.

    Xweather stamps its periods in UTC, so its points are timezone-aware, while
    a station's history is naive local time. forecasting.run_forecast asks twice,
    once with the station's offset attached and once naive, so that an aware
    provider is answered by the first call and a naive one by the second. The
    call that does not match used to reach a subtraction of a naive datetime from
    an aware one, and TypeError out of a method the engine calls once per
    variable per lead hour, which killed the entire run.
    """
    # Built here rather than from T0, whose awareness is not the point of this
    # test and must not silently decide its outcome.
    naive_when = datetime(2026, 8, 30, 12, 0)
    aware_when = naive_when.replace(tzinfo=timezone.utc)

    aware_series = base.NwpForecast(
        provider="x", issued_at=aware_when,
        points=[base.NwpPoint(valid_at=aware_when,
                              values={"temperature": 20.0})])
    # Naive query against an aware series: declined, not raised.
    assert aware_series.at(naive_when) is None
    # The matching query still resolves.
    assert aware_series.at(aware_when) is not None

    naive_series = base.NwpForecast(
        provider="x", issued_at=naive_when,
        points=[base.NwpPoint(valid_at=naive_when,
                              values={"temperature": 20.0})])
    assert naive_series.at(aware_when) is None
    assert naive_series.at(naive_when) is not None


# ---------------------------------------------------------------------------
#  Xweather adapter
# ---------------------------------------------------------------------------

RECORDED = {
    "success": True,
    "response": [{"periods": [{
        "timestamp": int(T0.timestamp()),
        "dateTimeISO": "2026-08-30T14:00:00+02:00",
        "tempC": 25.3, "dewpointC": 3.0, "humidity": 23,
        "pressureMB": 1018, "spressureMB": 875,
        "windSpeedKPH": 8, "windGustKPH": 16, "windDirDEG": 312,
        "solradWM2": 101, "ghi": 134, "precipMM": 0, "pop": 0,
        "sky": 72, "cloudsCoded": "BK", "uvi": 0, "visibilityKM": 16,
        "wetBulbGlobeTempC": 18.1, "feelslikeC": 25.3,
    }]}],
}


def _provider_with_recorded(tmp_path, monkeypatch):
    monkeypatch.setenv("XWEATHER_ENABLED", "true")
    p = xweather.XweatherProvider(client_id="cid", client_secret="sec",
                                  cache_dir=tmp_path)
    monkeypatch.setattr(p, "_call", lambda lat, lon, hours: RECORDED)
    return p


def test_xweather_maps_station_pressure_not_sea_level(tmp_path, monkeypatch):
    """The whole point of the spressureMB choice."""
    p = _provider_with_recorded(tmp_path, monkeypatch)
    fc = p.fetch(-26.7145, 27.0977)
    assert fc is not None
    vals = fc.points[0].values
    assert vals["pressure"] == 875.0, "must be station pressure"
    assert vals["pressure"] != 1018.0, "must not be sea-level reduced"


def test_xweather_maps_canonical_variables(tmp_path, monkeypatch):
    p = _provider_with_recorded(tmp_path, monkeypatch)
    fc = p.fetch(-26.7145, 27.0977)
    vals = fc.points[0].values
    assert vals["temperature"] == 25.3
    assert vals["dew_point"] == 3.0
    assert vals["humidity"] == 23.0
    assert vals["wind_speed"] == 8.0
    assert vals["wind_gust"] == 16.0
    assert vals["wind_direction"] == 312.0
    assert vals["solar_radiation"] == 101.0
    assert vals["rainfall"] == 0.0
    for name in vals:
        assert name in base.CANONICAL_VARIABLES, name


def test_xweather_is_unavailable_without_the_enable_flag(tmp_path,
                                                        monkeypatch):
    monkeypatch.delenv("XWEATHER_ENABLED", raising=False)
    p = xweather.XweatherProvider(client_id="cid", client_secret="sec",
                                  cache_dir=tmp_path)
    assert p.available() is False
    assert p.fetch(-26.7, 27.1) is None


def test_xweather_is_unavailable_without_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv("XWEATHER_ENABLED", "true")
    p = xweather.XweatherProvider(client_id="", client_secret="",
                                  cache_dir=tmp_path)
    assert p.available() is False


def test_xweather_second_call_is_served_from_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("XWEATHER_ENABLED", "true")
    p = xweather.XweatherProvider(client_id="cid", client_secret="sec",
                                  cache_dir=tmp_path)
    calls = {"n": 0}

    def counted(lat, lon, hours):
        calls["n"] += 1
        return RECORDED

    monkeypatch.setattr(p, "_call", counted)
    first = p.fetch(-26.7145, 27.0977)
    second = p.fetch(-26.7145, 27.0977)
    assert calls["n"] == 1, "the access budget must not be spent twice"
    assert first.from_cache is False
    assert second.from_cache is True


def test_xweather_survives_a_network_failure(tmp_path, monkeypatch):
    monkeypatch.setenv("XWEATHER_ENABLED", "true")
    p = xweather.XweatherProvider(client_id="cid", client_secret="sec",
                                  cache_dir=tmp_path)
    monkeypatch.setattr(p, "_call", lambda lat, lon, hours: None)
    assert p.fetch(-26.7, 27.1) is None      # degrades, does not raise
