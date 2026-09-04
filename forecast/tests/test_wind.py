"""Wind resource assessment.

Named after the properties they defend: P5 density lowers the resource, P6 cube
before average, P7 shear provenance, P8 exceedance ordering, P14 circular
directions, P15 a missing sensor is None, P20 a gust factor is not turbulence
intensity.
"""
from __future__ import annotations

import math

import pytest

from app import wind


# ---------------------------------------------------------------------------
#  P6: power density is the mean of the cubes (R4.5, R4.6)
# ---------------------------------------------------------------------------

def test_mean_power_density_exceeds_power_of_the_mean_speed():
    speeds = [5.0, 25.0]          # same mean as a steady 15, far more energy
    mean_pd = wind.mean_power_density(speeds, density=1.2)
    steady = wind.power_density(sum(speeds) / len(speeds), density=1.2)
    assert mean_pd > steady


# ---------------------------------------------------------------------------
#  P5: air density lowers the resource at fixed speed (R4.7)
# ---------------------------------------------------------------------------

def test_power_density_falls_with_air_density():
    dense = wind.power_density(20.0, density=1.20)
    thin = wind.power_density(20.0, density=1.00)
    assert dense > thin


# ---------------------------------------------------------------------------
#  P7: shear extrapolation states measured vs assumed (R4.1-R4.4)
# ---------------------------------------------------------------------------

def test_assumed_shear_is_labeled_assumed():
    s = wind.extrapolate_to_hub(18.0, 10.0, 80.0)
    assert s is not None
    assert s.basis == "assumed"
    assert s.exponent == pytest.approx(wind.DEFAULT_SHEAR_EXPONENT)
    assert s.speed_kmh > 18.0            # wind grows with height


def test_measured_shear_is_labeled_measured_and_computed_from_the_data():
    s = wind.extrapolate_to_hub(10.0, 10.0, 80.0,
                                second_speed_kmh=12.0, second_height_m=20.0)
    assert s.basis == "measured"
    assert s.exponent == pytest.approx(math.log(1.2) / math.log(2.0), abs=1e-9)


# ---------------------------------------------------------------------------
#  P8: exceedance ordering (R4.10)
# ---------------------------------------------------------------------------

def test_p90_is_below_p50_is_below_p10():
    members = [3.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 12.0, 14.0, 18.0]
    p90 = wind.energy_exceedance(members, 90.0)
    p50 = wind.energy_exceedance(members, 50.0)
    p10 = wind.energy_exceedance(members, 10.0)
    assert p90 <= p50 <= p10


# ---------------------------------------------------------------------------
#  P14: directions are circular (R4.13)
# ---------------------------------------------------------------------------

def test_circular_mean_wraps_around_north():
    m = wind.circular_mean_direction([350.0, 10.0])
    assert min(m, 360.0 - m) < 1e-6            # 0, not 180

def test_every_direction_output_is_in_range():
    records = [(12.0, 350.0), (14.0, 10.0), (20.0, 5.0), (3.0, 180.0)]
    prevailing = wind.prevailing_direction(records)
    assert 0.0 <= prevailing <= 360.0
    for s in wind.sector_statistics(records):
        assert 0.0 <= s.center_deg < 360.0


def test_sector_frequencies_sum_to_one():
    records = [(10.0, d) for d in range(0, 360, 5)]
    stats = wind.sector_statistics(records, n_sectors=12)
    assert len(stats) == 12
    assert sum(s.frequency for s in stats) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
#  P20: a gust factor is not turbulence intensity (R4.11, R4.11a, R4.11b)
# ---------------------------------------------------------------------------

def test_gust_factor_without_a_speed_sigma_gives_no_turbulence_intensity():
    t = wind.describe_turbulence(mean_speed_kmh=20.0, gust_kmh=34.0)
    assert t.gust_factor == pytest.approx(1.7)
    assert t.turbulence_intensity is None
    assert t.iec_class is None


def test_turbulence_intensity_only_from_a_real_speed_sigma():
    t = wind.describe_turbulence(mean_speed_kmh=20.0, sigma_u_kmh=3.0)
    assert t.turbulence_intensity == pytest.approx(0.15)
    assert t.iec_class == "A"            # 0.14 < 0.15 <= 0.16


def test_iec_class_boundaries():
    assert wind.iec_turbulence_class(0.11) == "C"
    assert wind.iec_turbulence_class(0.13) == "B"
    assert wind.iec_turbulence_class(0.155) == "A"
    assert wind.iec_turbulence_class(0.20) == "exceeds A"


# ---------------------------------------------------------------------------
#  Weibull, AEP, extreme wind
# ---------------------------------------------------------------------------

def test_weibull_fit_is_reasonable():
    # A gently variable series around 20 km/h.
    speeds = [12, 15, 18, 20, 22, 25, 28, 16, 19, 21, 24, 17, 23, 20, 18]
    w = wind.weibull_fit(speeds)
    assert w is not None
    assert 1.0 < w.shape < 6.0
    assert w.scale > w.mean_speed * 0.8


def test_power_curve_interpolation_and_cut_out():
    curve = [(3.0, 0.0), (12.0, 1500.0), (25.0, 1500.0)]
    assert wind.interpolate_power(curve, 2.0) == 0.0       # below cut-in
    assert wind.interpolate_power(curve, 30.0) == 0.0      # above cut-out
    mid = wind.interpolate_power(curve, 7.5)               # halfway 3->12
    assert 0.0 < mid < 1500.0


def test_annual_energy_production_is_positive():
    curve = [(3.0, 0.0), (12.0, 1500.0), (25.0, 1500.0)]
    speeds = [s * 3.6 for s in (5, 7, 9, 11, 13, 8, 6, 10)]   # km/h
    aep = wind.annual_energy_production(speeds, curve)
    assert aep is not None and aep > 0.0


def test_extreme_wind_reports_its_record_length():
    maxima = [92.0, 101.0, 88.0, 110.0, 97.0]
    ext = wind.gumbel_extreme(maxima, return_period_years=50)
    assert ext is not None
    assert ext.return_period_years == 50
    assert ext.record_years == 5
    assert ext.speed_kmh > max(maxima)       # a 50-year value exceeds 5 years


# ---------------------------------------------------------------------------
#  P15: no anemometer is None everywhere, never an exception
# ---------------------------------------------------------------------------

def test_missing_wind_data_returns_none():
    assert wind.extrapolate_to_hub(None, 10.0, 80.0) is None
    assert wind.mean_power_density([]) is None
    assert wind.power_density(None) is None
    assert wind.weibull_fit([]) is None
    assert wind.sector_statistics([]) is None
    assert wind.prevailing_direction([]) is None
    assert wind.circular_mean_direction([]) is None
    assert wind.describe_turbulence(None) is None
    assert wind.annual_energy_production([], []) is None
    assert wind.gumbel_extreme([]) is None
