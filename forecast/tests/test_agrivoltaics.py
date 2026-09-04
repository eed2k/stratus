"""Agrivoltaics: PAR, DLI, shading, the tradeoff and microclimate.

Properties defended: P1 physical bounds, P3 transposition feeds yield, P4 night
is zero not None, P15 unconfigured geometry is None rather than a page of zeros.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import agrivoltaics as av
from app import solar

LAT, LON, OFFSET, ALT = -26.7145, 27.0977, 2.0, 1350.0


def _clear_day(day=datetime(2026, 1, 1)):
    """A day of hourly dicts with clear-sky irradiance and mild weather."""
    hours = []
    for i in range(24):
        when = day + timedelta(hours=i)
        pos = solar.solar_position(when, LAT, LON, OFFSET)
        ghi, _src = solar.clear_sky_ghi(pos)
        hours.append({"valid_at": when, "solar_radiation": ghi,
                      "temperature": 18.0 + 8.0 * (1 if 9 <= i <= 16 else 0),
                      "humidity": 45.0, "wind_speed": 8.0,
                      "pressure": 860.0})
    return hours


def _geometry(**kw):
    base = dict(collector_width_m=2.0, row_pitch_m=5.0, tilt_deg=25.0,
                surface_azimuth_deg=0.0)
    base.update(kw)
    return av.ArrayGeometry(**base)


# ---------------------------------------------------------------------------
#  PAR and DLI (R6.1, R6.2)
# ---------------------------------------------------------------------------

def test_ppfd_uses_the_documented_factor():
    assert av.ppfd_from_ghi(1000.0) == pytest.approx(2020.0)
    assert av.ppfd_from_ghi(0.0) == 0.0
    assert av.ppfd_from_ghi(None) is None


def test_daily_light_integral_is_in_moles():
    # A steady 1000 micromol/m2/s for one hour is 3.6 mol/m2.
    assert av.daily_light_integral([1000.0], 3600.0) == pytest.approx(3.6)
    assert av.daily_light_integral([]) is None


def test_a_clear_summer_day_gives_a_plausible_dli():
    """A clear Highveld midsummer day should land in the 40-70 mol/m2/day band
    that crop science reports for such sites."""
    hours = _clear_day()
    ppfd = [av.ppfd_from_ghi(h["solar_radiation"]) for h in hours]
    dli = av.daily_light_integral(ppfd)
    assert 30.0 < dli < 80.0


# ---------------------------------------------------------------------------
#  Shading (R6.3)
# ---------------------------------------------------------------------------

def test_wider_rows_let_more_light_through():
    """Ground cover ratio drives the shading, so a sparser array shades less."""
    when = datetime(2026, 1, 1, 12, 0)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    ghi, _ = solar.clear_sky_ghi(pos)
    comp = solar.decompose(ghi, pos, when)
    dense = av.shading(_geometry(row_pitch_m=3.0), comp, pos, when)
    sparse = av.shading(_geometry(row_pitch_m=10.0), comp, pos, when)
    assert sparse.transmitted_fraction > dense.transmitted_fraction


def test_transmitted_fraction_is_a_fraction():
    for i in range(24):
        when = datetime(2026, 1, 1) + timedelta(hours=i)
        pos = solar.solar_position(when, LAT, LON, OFFSET)
        ghi, _ = solar.clear_sky_ghi(pos)
        comp = solar.decompose(ghi, pos, when)
        sh = av.shading(_geometry(), comp, pos, when)
        assert 0.0 <= sh.transmitted_fraction <= 1.0
        assert 0.0 <= sh.beam_transmitted <= 1.0
        assert 0.0 <= sh.diffuse_transmitted <= 1.0


def test_at_night_no_light_is_being_withheld():
    """P4: darkness is not shading. The fraction is 1.0, not 0.0, because the
    array is taking nothing from the crop when there is nothing to take."""
    when = datetime(2026, 1, 1, 1, 0)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    comp = solar.decompose(0.0, pos, when)
    sh = av.shading(_geometry(), comp, pos, when)
    assert sh is not None
    assert sh.transmitted_fraction == 1.0


def test_light_budget_reports_open_under_and_difference():
    lb = av.light_budget(_geometry(), _clear_day(), LAT, LON, OFFSET)
    assert lb is not None
    assert lb.dli_open > lb.dli_under_array > 0.0
    assert lb.dli_difference == pytest.approx(lb.dli_open - lb.dli_under_array)
    assert 0.0 < lb.mean_transmitted_fraction < 1.0
    assert "2.02" in lb.assumption          # the factor is stated


# ---------------------------------------------------------------------------
#  The tradeoff (R6.5, R6.6, R6.7)
# ---------------------------------------------------------------------------

def test_tradeoff_reports_both_branches_unweighted():
    t = av.evaluate_tradeoff(_geometry(), _clear_day(), LAT, LON, OFFSET)
    assert t is not None
    assert t.hours
    # Energy branch makes more power; crop branch passes more light.
    assert t.dc_energy_open_wh_per_m2 >= t.dc_energy_crop_wh_per_m2
    assert t.dli_crop_branch >= t.dli_energy_branch
    assert t.dc_energy_given_up_wh_per_m2 >= 0.0
    # Unweighted by default: no preference is expressed.
    assert t.weighting is None
    assert all(h.preferred is None for h in t.hours)


def test_a_weighting_adds_a_preference_without_hiding_the_quantities():
    t = av.evaluate_tradeoff(_geometry(), _clear_day(), LAT, LON, OFFSET,
                             weighting=1.0)
    assert t.weighting == 1.0
    assert any(h.preferred in ("energy", "crop") for h in t.hours)
    # The raw quantities are still there beside the preference.
    assert t.dc_energy_open_wh_per_m2 > 0.0
    assert t.dli_crop_branch > 0.0
    for h in t.hours:
        assert h.energy.poa_wm2 >= 0.0 and h.crop.crop_ppfd >= 0.0


def test_the_crop_branch_gives_up_energy_to_gain_light():
    t = av.evaluate_tradeoff(_geometry(), _clear_day(), LAT, LON, OFFSET)
    midday = [h for h in t.hours if h.valid_at.hour == 12]
    assert midday
    h = midday[0]
    assert h.dc_given_up_w_per_m2 > 0.0
    assert h.crop_ppfd_gained > 0.0


# ---------------------------------------------------------------------------
#  Microclimate (R6.8)
# ---------------------------------------------------------------------------

def test_et_avoided_comes_from_two_et0_calls():
    hours = _clear_day()
    m = av.microclimate(hours, transmitted_fraction=0.6,
                        latitude_deg=LAT, altitude_m=ALT,
                        dli_under_array=25.0)
    assert m is not None
    assert m.et0_open_mm > m.et0_shaded_mm > 0.0
    assert m.et_avoided_mm == pytest.approx(m.et0_open_mm - m.et0_shaded_mm)
    assert m.water_use_efficiency == pytest.approx(25.0 / m.et0_shaded_mm)
    assert "twice" in m.note


def test_full_sun_avoids_no_water():
    hours = _clear_day()
    m = av.microclimate(hours, transmitted_fraction=1.0,
                        latitude_deg=LAT, altitude_m=ALT)
    assert m.et_avoided_mm == pytest.approx(0.0, abs=1e-9)


# ---------------------------------------------------------------------------
#  Bifacial (R6.9)
# ---------------------------------------------------------------------------

def test_bifacial_gain_uses_the_albedo_table_and_states_the_caveat():
    g = av.bifacial_gain(900.0, _geometry(albedo_surface="crop"), 950.0)
    assert g is not None
    assert g.albedo == solar.ALBEDO["crop"]
    assert g.gain_fraction > 0.0
    assert "growth stage" in g.caveat


def test_brighter_ground_gives_more_rear_irradiance():
    dark = av.bifacial_gain(900.0, _geometry(albedo_surface="asphalt"), 950.0)
    bright = av.bifacial_gain(900.0, _geometry(albedo_surface="sand"), 950.0)
    assert bright.rear_irradiance_wm2 > dark.rear_irradiance_wm2


# ---------------------------------------------------------------------------
#  P15 / R6.10: unconfigured geometry is None, not a page of zeros
# ---------------------------------------------------------------------------

def test_unconfigured_geometry_is_none_everywhere():
    hours = _clear_day()
    assert av.light_budget(None, hours, LAT, LON, OFFSET) is None
    assert av.evaluate_tradeoff(None, hours, LAT, LON, OFFSET) is None
    assert av.bifacial_gain(900.0, None, 950.0) is None
    # A geometry with no pitch is not configured either.
    when = datetime(2026, 1, 1, 12, 0)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    comp = solar.decompose(500.0, pos, when)
    assert av.shading(_geometry(row_pitch_m=0.0), comp, pos, when) is None


def test_missing_coordinates_or_weather_is_none():
    hours = _clear_day()
    assert av.light_budget(_geometry(), hours, None, LON, OFFSET) is None
    assert av.evaluate_tradeoff(_geometry(), hours, LAT, None, OFFSET) is None
    assert av.microclimate(hours, None, LAT, ALT) is None
    assert av.microclimate([], 0.5, LAT, ALT) is None
