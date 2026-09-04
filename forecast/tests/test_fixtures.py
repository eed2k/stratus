"""The generated TOA5 fixture and its opt-in sensor channels (Requirement 9).

These channels are what make the frost typing, the photovoltaic validation and
the soiling model testable. They are generated on demand rather than shipped as
a file, so the suite carries no sample data.
"""
from __future__ import annotations

from pathlib import Path

from app import ingest

from conftest import make_toa5


def _night(obs, variable):
    """Values of `variable` on observations that fall in the night window."""
    return [o.values[variable] for o in obs
            if variable in o.values
            and (o.observed_at.hour < 6 or o.observed_at.hour >= 19)]


# ---------------------------------------------------------------------------
#  The default fixture is unchanged: no group means no extra channels
# ---------------------------------------------------------------------------

def test_the_default_fixture_carries_no_extra_channels():
    """A station that never had these sensors is still the default, so every
    test written against the base fixture keeps passing."""
    text = make_toa5(hours=6)
    for col in ("Temp8m_Avg", "DeltaTemp_Avg", "MOD_TEMP_Avg",
                "MPPT_SolP_Avg", "PM2_5_Avg", "PM10_Avg"):
        assert col not in text
    _obs, rep = ingest.parse_dat(text)
    assert "temperature8m" not in rep.mapped
    assert "moduleTemperature" not in rep.mapped
    assert "pm25" not in rep.mapped


# ---------------------------------------------------------------------------
#  Both frost regimes are reachable
# ---------------------------------------------------------------------------

def test_an_inversion_night_shows_a_positive_gradient():
    """The radiative-frost regime: 8 m air clearly warmer than the surface, the
    signal that lets the frost typing claim an inversion and reason about fans.
    """
    obs, rep = ingest.parse_dat(make_toa5(hours=48, airshed=True,
                                          inversion=True))
    assert "deltaTemperature" in rep.mapped
    deltas = _night(obs, "deltaTemperature")
    assert deltas
    assert max(deltas) > 2.0


def test_a_well_mixed_night_shows_no_gradient():
    """The regime where the surface has not decoupled, so fans cannot help and
    the typing must not claim they will."""
    obs, _rep = ingest.parse_dat(make_toa5(hours=48, airshed=True,
                                           inversion=False))
    deltas = _night(obs, "deltaTemperature")
    assert deltas
    assert max(deltas) < 1.0


# ---------------------------------------------------------------------------
#  Photovoltaic and air-quality channels parse and store
# ---------------------------------------------------------------------------

def test_photovoltaic_channels_parse_and_store():
    obs, rep = ingest.parse_dat(make_toa5(hours=24, photovoltaic=True))
    assert "moduleTemperature" in rep.mapped
    assert "mpptSolarPower" in rep.mapped
    midday = [o for o in obs if o.observed_at.hour == 12]
    assert midday
    # The module runs hotter than the air in the sun, and makes power.
    assert midday[0].values["moduleTemperature"] > midday[0].values["temperature"]
    assert midday[0].values["mpptSolarPower"] > 0.0


def test_air_quality_channels_parse_and_store():
    obs, rep = ingest.parse_dat(make_toa5(hours=24, air_quality=True))
    assert "pm25" in rep.mapped
    assert "pm10" in rep.mapped
    paired = [o for o in obs if "pm25" in o.values and "pm10" in o.values]
    assert paired
    for o in paired:
        assert o.values["pm25"] > 0.0
        assert o.values["pm10"] >= o.values["pm25"]      # coarse >= fine


def test_all_channel_groups_can_be_combined():
    obs, rep = ingest.parse_dat(
        make_toa5(hours=24, airshed=True, photovoltaic=True, air_quality=True))
    for v in ("temperature8m", "deltaTemperature", "moduleTemperature",
              "mpptSolarPower", "pm25", "pm10"):
        assert v in rep.mapped, v
    assert obs


# ---------------------------------------------------------------------------
#  Fixtures stay generated: nothing is committed as sample data
# ---------------------------------------------------------------------------

def test_no_sample_data_files_are_committed():
    tests_dir = Path(__file__).resolve().parent
    stray = sorted(p.name for p in tests_dir.rglob("*")
                   if p.suffix.lower() in (".dat", ".csv", ".toa5", ".tob1"))
    assert not stray, f"fixtures must be generated, found data files: {stray}"
