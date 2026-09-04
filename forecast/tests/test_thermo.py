"""Thermodynamics tests, checked against textbook values and known conditions."""
from __future__ import annotations

import math

import pytest

from app import thermo


# ---------------------------------------------------------------------------
#  Density against reference conditions
# ---------------------------------------------------------------------------

def test_isa_sea_level_reproduces_the_standard_density():
    """15 C at 1013.25 hPa dry must give 1.225 kg/m3."""
    rho = thermo.air_density(thermo.ISA_TEMP_C, thermo.ISA_PRESSURE_HPA)
    assert rho == pytest.approx(1.225, abs=0.001)


def test_density_ratio_is_one_at_isa_sea_level():
    ratio = thermo.air_density_ratio(15.0, 1013.25)
    assert ratio == pytest.approx(1.0, abs=0.001)


def test_highveld_density_deficit_is_material():
    """The claim that motivates the module: a real Potchefstroom afternoon.

    861 hPa at 20 C. A sea-level power curve is optimistic by the deficit.
    """
    rho = thermo.air_density(20.0, 861.0, 40.0)
    ratio = thermo.air_density_ratio(20.0, 861.0, 40.0)
    assert 1.00 < rho < 1.05, rho
    # Somewhere between 12 and 20 percent thinner than sea level.
    deficit = (1.0 - ratio) * 100.0
    assert 12.0 < deficit < 20.0, deficit


def test_density_falls_with_temperature():
    cold = thermo.air_density(0.0, 861.0)
    hot = thermo.air_density(35.0, 861.0)
    assert cold > hot


def test_density_falls_with_altitude():
    sea = thermo.air_density(15.0, 1013.25)
    high = thermo.air_density(15.0, 861.0)
    assert sea > high


def test_moist_air_is_less_dense_than_dry_air():
    """Counter-intuitive but correct: water vapor is lighter than air."""
    dry = thermo.air_density(25.0, 1013.25, 0.0)
    humid = thermo.air_density(25.0, 1013.25, 95.0)
    assert humid < dry
    # The effect is small in temperate conditions.
    assert (dry - humid) / dry < 0.02


def test_density_without_humidity_is_the_dry_value():
    assert thermo.air_density(20.0, 900.0) == pytest.approx(
        thermo.air_density(20.0, 900.0, 0.0), abs=1e-9)


# ---------------------------------------------------------------------------
#  Virtual temperature
# ---------------------------------------------------------------------------

def test_virtual_temperature_never_below_actual():
    for t in (-10.0, 0.0, 15.0, 30.0, 45.0):
        for rh in (0.0, 25.0, 50.0, 75.0, 100.0):
            tv = thermo.virtual_temperature_c(t, rh, 1013.25)
            assert tv is not None
            assert tv >= t - 1e-9, (t, rh, tv)


def test_virtual_temperature_equals_actual_in_dry_air():
    assert thermo.virtual_temperature_c(20.0, 0.0, 1013.25) == pytest.approx(
        20.0, abs=1e-9)


def test_virtual_temperature_rises_with_humidity():
    dry = thermo.virtual_temperature_c(30.0, 10.0, 1013.25)
    wet = thermo.virtual_temperature_c(30.0, 90.0, 1013.25)
    assert wet > dry


# ---------------------------------------------------------------------------
#  Humidity measures
# ---------------------------------------------------------------------------

def test_specific_humidity_is_below_mixing_ratio():
    """q = w/(1+w), so q < w always."""
    q = thermo.specific_humidity(25.0, 80.0, 1013.25)
    w = thermo.mixing_ratio(25.0, 80.0, 1013.25)
    assert 0 < q < w


def test_mixing_ratio_matches_the_q_relation():
    q = thermo.specific_humidity(25.0, 80.0, 1013.25)
    w = thermo.mixing_ratio(25.0, 80.0, 1013.25)
    assert q == pytest.approx(w / (1.0 + w), rel=1e-9)


def test_humidity_measures_are_zero_in_bone_dry_air():
    assert thermo.specific_humidity(20.0, 0.0, 1013.25) == pytest.approx(0.0)
    assert thermo.mixing_ratio(20.0, 0.0, 1013.25) == pytest.approx(0.0)
    assert thermo.absolute_humidity(20.0, 0.0) == pytest.approx(0.0)


def test_absolute_humidity_at_saturation_is_plausible():
    """Saturated air at 20 C holds about 17 g/m3."""
    ah = thermo.absolute_humidity(20.0, 100.0)
    assert 16.0 < ah < 18.5, ah


def test_vapor_pressure_hpa_is_ten_times_the_kpa_value():
    from app.products import actual_vapor_pressure
    assert thermo.vapor_pressure_hpa(20.0, 60.0) == pytest.approx(
        actual_vapor_pressure(20.0, 60.0) * 10.0, rel=1e-12)


# ---------------------------------------------------------------------------
#  Density altitude
# ---------------------------------------------------------------------------

def test_density_altitude_is_zero_at_isa_sea_level():
    da = thermo.density_altitude_m(15.0, 1013.25)
    assert abs(da) < 30.0, da


def test_density_altitude_exceeds_true_altitude_when_hot():
    """The number a pilot cares about, and the intuitive way to state thin air."""
    cool = thermo.density_altitude_m(6.0, 861.0)     # near ISA for 1350 m
    hot = thermo.density_altitude_m(32.0, 861.0)
    assert hot > cool
    assert hot > 1350.0


def test_density_altitude_rises_monotonically_with_temperature():
    values = [thermo.density_altitude_m(t, 861.0)
              for t in (0.0, 10.0, 20.0, 30.0, 40.0)]
    assert values == sorted(values)


# ---------------------------------------------------------------------------
#  Pressure reduction round trip
# ---------------------------------------------------------------------------

def test_sea_level_reduction_round_trips():
    station = 861.0
    reduced = thermo.sea_level_pressure_hpa(station, 20.0, 1350.0)
    back = thermo.station_pressure_hpa(reduced, 20.0, 1350.0)
    assert back == pytest.approx(station, rel=1e-9)


def test_reduction_produces_a_plausible_sea_level_value():
    """861 hPa at 1350 m must reduce to something near 1010, not 900."""
    reduced = thermo.sea_level_pressure_hpa(861.0, 20.0, 1350.0)
    assert 995.0 < reduced < 1030.0, reduced


def test_reduction_is_the_identity_at_sea_level():
    assert thermo.sea_level_pressure_hpa(1013.0, 20.0, 0.0) == pytest.approx(
        1013.0, rel=1e-12)


def test_isa_pressure_matches_known_values():
    assert thermo.isa_pressure_hpa(0.0) == pytest.approx(1013.25, abs=0.01)
    # ~899 hPa at 1000 m, ~795 at 2000 m in the standard atmosphere.
    assert thermo.isa_pressure_hpa(1000.0) == pytest.approx(898.7, abs=2.0)
    assert thermo.isa_pressure_hpa(2000.0) == pytest.approx(795.0, abs=3.0)


def test_pressure_plausibility_flag_catches_a_reduced_series():
    """The exact mistake ingest.py warns about, caught arithmetically."""
    good = thermo.air_summary(20.0, 861.0, 45.0, elevation_m=1350.0)
    assert good["pressure_plausible"] is True
    # A sea-level-reduced reading presented as a 1350 m station reading.
    bad = thermo.air_summary(20.0, 1013.0, 45.0, elevation_m=1350.0)
    assert bad["pressure_plausible"] is False


# ---------------------------------------------------------------------------
#  Wind power density
# ---------------------------------------------------------------------------

def test_wind_power_density_known_value():
    """10 m/s = 36 km/h at ISA density gives 0.5*1.225*1000 = 612.5 W/m2."""
    pd = thermo.wind_power_density(36.0)
    assert pd == pytest.approx(612.5, rel=1e-6)


def test_wind_power_density_scales_with_the_cube_of_speed():
    a = thermo.wind_power_density(18.0)
    b = thermo.wind_power_density(36.0)
    assert b / a == pytest.approx(8.0, rel=1e-9)


def test_wind_power_density_scales_linearly_with_density():
    full = thermo.wind_power_density(36.0, 1.225)
    thin = thermo.wind_power_density(36.0, 1.0)
    assert thin / full == pytest.approx(1.0 / 1.225, rel=1e-9)


def test_zero_and_negative_speed_give_zero_power():
    assert thermo.wind_power_density(0.0) == 0.0
    assert thermo.wind_power_density(-5.0) == 0.0


def test_cube_then_average_beats_average_then_cube():
    """The error this helper exists to prevent.

    Two hours at 10 and 30 km/h. Averaging the speed first loses most of the
    resource, because power goes as the cube.
    """
    samples = [(10.0, 1.0), (30.0, 1.0)]
    correct = thermo.mean_wind_power_density(samples)
    naive = thermo.wind_power_density(20.0, 1.0)      # mean speed, then cubed
    assert correct > naive
    assert correct / naive > 1.5


def test_mean_power_density_ignores_unusable_samples():
    samples = [(36.0, 1.225), (None, 1.225), ("bad", 1.225)]
    assert thermo.mean_wind_power_density(samples) == pytest.approx(612.5,
                                                                   rel=1e-6)


def test_mean_power_density_of_nothing_is_none():
    assert thermo.mean_wind_power_density([]) is None


def test_density_corrected_speed_preserves_power():
    """The IEC 61400-12-1 normalization must be power-equivalent."""
    rho = 1.03
    speed = 40.0
    corrected = thermo.density_corrected_speed(speed, rho)
    assert thermo.wind_power_density(corrected, thermo.ISA_DENSITY) == \
        pytest.approx(thermo.wind_power_density(speed, rho), rel=1e-9)


def test_thin_air_reduces_the_corrected_speed():
    assert thermo.density_corrected_speed(40.0, 1.0) < 40.0


# ---------------------------------------------------------------------------
#  Potential temperature
# ---------------------------------------------------------------------------

def test_potential_temperature_equals_actual_at_the_reference():
    assert thermo.potential_temperature_c(20.0, 1000.0) == pytest.approx(
        20.0, abs=1e-9)


def test_potential_temperature_exceeds_actual_aloft():
    """Lower pressure means the parcel warms on compression to 1000 hPa."""
    assert thermo.potential_temperature_c(6.0, 861.0) > 6.0


# ---------------------------------------------------------------------------
#  Robustness: nothing here may raise on bad input
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fn,args", [
    (thermo.air_density, (None, 1013.0)),
    (thermo.air_density, (20.0, None)),
    (thermo.air_density, (20.0, 0.0)),
    (thermo.air_density, (20.0, -5.0)),
    (thermo.air_density, (float("nan"), 1013.0)),
    (thermo.air_density_ratio, (None, None)),
    (thermo.density_altitude_m, (None, 1013.0)),
    (thermo.virtual_temperature_c, (20.0, None, 1013.0)),
    (thermo.specific_humidity, (20.0, 50.0, 0.0)),
    (thermo.mixing_ratio, (20.0, 50.0, None)),
    (thermo.absolute_humidity, (None, 50.0)),
    (thermo.potential_temperature_c, (20.0, 0.0)),
    (thermo.sea_level_pressure_hpa, (None, 20.0, 1000.0)),
    (thermo.station_pressure_hpa, (1013.0, None, 1000.0)),
    (thermo.isa_pressure_hpa, (None,)),
    (thermo.wind_power_density, (None,)),
    (thermo.density_corrected_speed, (40.0, 0.0)),
])
def test_bad_input_returns_none_rather_than_raising(fn, args):
    assert fn(*args) is None


def test_summary_is_complete_and_none_safe():
    full = thermo.air_summary(20.0, 861.0, 45.0, elevation_m=1350.0)
    for key in ("density", "density_ratio", "density_deficit_pct",
                "density_altitude_m", "virtual_temperature",
                "specific_humidity", "mixing_ratio", "absolute_humidity",
                "potential_temperature", "vapor_pressure_hpa",
                "sea_level_pressure", "isa_pressure_at_elevation",
                "pressure_plausible"):
        assert key in full, key
        assert full[key] is not None, key

    empty = thermo.air_summary(None, None, None)
    assert empty["density"] is None
    assert empty["density_ratio"] is None


def test_summary_deficit_matches_the_ratio():
    s = thermo.air_summary(20.0, 861.0, 45.0)
    assert s["density_deficit_pct"] == pytest.approx(
        (1.0 - s["density_ratio"]) * 100.0, rel=1e-12)
