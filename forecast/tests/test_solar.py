"""Solar geometry, decomposition, transposition and PV yield.

Named after the correctness properties they defend: P1 plane-of-array bounds,
P2 decomposition closure, P3 transposition, P4 night is zero not None, P15 a
missing sensor is None.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta

import pytest

from app import solar

# A real southern-hemisphere site: Potchefstroom, on the Highveld.
LAT, LON, OFFSET = -26.7145, 27.0977, 2.0


def _positions_through(day: datetime, step_min: int = 15):
    out = []
    t = day
    end = day + timedelta(days=1)
    while t < end:
        p = solar.solar_position(t, LAT, LON, OFFSET)
        if p is not None:
            out.append((t, p))
        t += timedelta(minutes=step_min)
    return out


# ---------------------------------------------------------------------------
#  Position
# ---------------------------------------------------------------------------

def test_azimuth_is_always_in_range():
    for _t, p in _positions_through(datetime(2026, 1, 1)):
        assert 0.0 <= p.azimuth <= 360.0


def test_the_midday_sun_is_in_the_north_for_a_southern_site():
    """P2 convention: at the day's highest sun a southern site looks north,
    azimuth near 0. This is the sign-of-latitude rule made observable."""
    samples = _positions_through(datetime(2026, 6, 21))     # winter solstice
    _t, top = max(samples, key=lambda s: s[1].elevation)
    assert top.elevation > 0.0
    assert min(top.azimuth, 360.0 - top.azimuth) < 12.0


def test_air_mass_is_none_at_night_and_present_by_day():
    night = solar.solar_position(datetime(2026, 1, 1, 2, 0), LAT, LON, OFFSET)
    noon = solar.solar_position(datetime(2026, 1, 1, 12, 0), LAT, LON, OFFSET)
    assert not night.is_up and night.air_mass is None
    assert noon.is_up and noon.air_mass is not None and noon.air_mass >= 1.0


# ---------------------------------------------------------------------------
#  P2: decomposition closure
# ---------------------------------------------------------------------------

def test_decomposition_closes_on_ghi():
    when = datetime(2026, 1, 1, 12, 0)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    ghi, _src = solar.clear_sky_ghi(pos)
    comp = solar.decompose(ghi, pos, when)
    cos_z = math.cos(math.radians(pos.zenith))
    assert comp.dhi + comp.dni * cos_z == pytest.approx(ghi, abs=1e-6)


def test_low_sun_is_all_diffuse():
    """R2.6: below three degrees the beam split diverges, so it is all diffuse
    rather than an enormous direct-normal figure."""
    # Walk dawn until the sun is just above the horizon but under the cutoff.
    when = datetime(2026, 1, 1, 4, 0)
    found = None
    for _ in range(240):
        pos = solar.solar_position(when, LAT, LON, OFFSET)
        if 0.0 < pos.elevation < solar.MIN_BEAM_ELEVATION_DEG:
            found = (when, pos)
            break
        when += timedelta(minutes=1)
    assert found, "no sub-cutoff daylight sample found"
    when, pos = found
    comp = solar.decompose(200.0, pos, when)
    assert comp.dni == 0.0
    assert comp.dhi == 200.0


# ---------------------------------------------------------------------------
#  P1 / P3: plane of array
# ---------------------------------------------------------------------------

def test_flat_plane_equals_ghi():
    """R2.8: at zero tilt the geometric plane-of-array is exactly GHI."""
    when = datetime(2026, 1, 1, 9, 30)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    ghi, _ = solar.clear_sky_ghi(pos)
    comp = solar.decompose(ghi, pos, when)
    poa = solar.plane_of_array(comp, pos, when, tilt_deg=0.0,
                               surface_azimuth_deg=0.0)
    assert poa.global_ == pytest.approx(ghi, abs=1e-6)


def test_plane_of_array_never_exceeds_extraterrestrial_normal():
    """P1: no surface can receive more than the top-of-atmosphere normal."""
    for when, pos in _positions_through(datetime(2026, 1, 1)):
        if not pos.is_up:
            continue
        ghi, _ = solar.clear_sky_ghi(pos)
        comp = solar.decompose(ghi, pos, when)
        i0n = solar.extraterrestrial_normal(when)
        for tilt in (0.0, 30.0, 60.0):
            poa = solar.plane_of_array(comp, pos, when, tilt, 0.0)
            assert poa.global_ <= i0n + 1e-6, (when, tilt, poa.global_, i0n)


def test_the_incidence_modifier_only_reduces_the_beam():
    when = datetime(2026, 1, 1, 8, 0)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    ghi, _ = solar.clear_sky_ghi(pos)
    comp = solar.decompose(ghi, pos, when)
    poa = solar.plane_of_array(comp, pos, when, tilt_deg=30.0,
                               surface_azimuth_deg=0.0)
    assert 0.0 <= poa.iam <= 1.0
    assert poa.effective <= poa.global_ + 1e-9
    for part in (poa.beam, poa.diffuse, poa.ground):
        assert part >= 0.0


def test_a_tilted_north_facing_plane_gains_over_horizontal_in_winter():
    """P3: transposition is worth doing. On a winter morning a north-facing tilt
    collects more than the horizontal, which is the whole point of a plane."""
    when = datetime(2026, 6, 21, 9, 0)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    ghi, _ = solar.clear_sky_ghi(pos)
    comp = solar.decompose(ghi, pos, when)
    tilted = solar.plane_of_array(comp, pos, when, tilt_deg=35.0,
                                  surface_azimuth_deg=0.0)
    assert tilted.global_ > ghi


# ---------------------------------------------------------------------------
#  P4: night is zero, not None
# ---------------------------------------------------------------------------

def test_night_irradiance_is_zero_not_none():
    when = datetime(2026, 1, 1, 1, 0)
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    assert not pos.is_up
    comp = solar.decompose(0.0, pos, when)
    assert comp is not None
    assert (comp.ghi, comp.dni, comp.dhi) == (0.0, 0.0, 0.0)
    poa = solar.plane_of_array(comp, pos, when, 30.0, 0.0)
    assert poa is not None and poa.global_ == 0.0


# ---------------------------------------------------------------------------
#  P15: a missing sensor or missing position is None, never an exception
# ---------------------------------------------------------------------------

def test_missing_inputs_return_none():
    when = datetime(2026, 1, 1, 12, 0)
    assert solar.solar_position(when, None, LON, OFFSET) is None
    pos = solar.solar_position(when, LAT, LON, OFFSET)
    assert solar.decompose(None, pos, when) is None          # no pyranometer
    assert solar.plane_of_array(None, pos, when, 30.0, 0.0) is None
    assert solar.module_temperature(None, 20.0, 2.0) is None
    assert solar.dc_yield_ratio(None, 800.0) is None
    assert solar.optimal_fixed_orientation(None) is None
    assert solar.tracker_angle(None) is None


# ---------------------------------------------------------------------------
#  Orientation, clear-sky provenance
# ---------------------------------------------------------------------------

def test_optimal_orientation_follows_the_hemisphere():
    """R2.12: a southern site faces north (0), a northern site faces south."""
    tilt_s, az_s = solar.optimal_fixed_orientation(-26.7)
    tilt_n, az_n = solar.optimal_fixed_orientation(40.0)
    assert az_s == 0.0
    assert az_n == 180.0
    assert tilt_s == pytest.approx(26.7, abs=0.1)


def test_clear_sky_prefers_the_provider_and_names_the_source():
    """R2.13 / R2.13b: a provider value wins and the source is reported."""
    pos = solar.solar_position(datetime(2026, 1, 1, 12, 0), LAT, LON, OFFSET)
    value, source = solar.clear_sky_ghi(pos, provider_wm2=742.0)
    assert value == 742.0 and source == "provider"
    value2, source2 = solar.clear_sky_ghi(pos)
    assert source2 == "haurwitz" and value2 > 0.0


# ---------------------------------------------------------------------------
#  Cell temperature and DC yield (R3.1, R3.2, R3.3)
# ---------------------------------------------------------------------------

def test_module_runs_hotter_with_sun_and_at_altitude():
    dark = solar.module_temperature(0.0, 20.0, 2.0)
    sunny = solar.module_temperature(800.0, 20.0, 2.0)
    assert dark == pytest.approx(20.0)
    assert sunny > 40.0
    # Thinner air at altitude cools the module less, so it runs hotter for the
    # same wind. Station pressure comes from thermo.air_density (R3.3).
    sea_level = solar.module_temperature(800.0, 20.0, 2.0, pressure_hpa=1013.25)
    highveld = solar.module_temperature(800.0, 20.0, 2.0, pressure_hpa=860.0)
    assert highveld > sea_level


def test_dc_yield_derates_with_heat():
    at_stc = solar.dc_yield_ratio(25.0, 1000.0)
    hot = solar.dc_yield_ratio(55.0, 1000.0)
    assert at_stc == pytest.approx(1.0, abs=1e-9)
    assert hot < at_stc
    assert solar.dc_yield_ratio(40.0, 0.0) == 0.0


def test_tracker_backtracks_toward_flat_at_low_sun():
    """R2.14: with rows close together the tracker gives up angle at low sun to
    avoid shading the next row, so a low sun yields a flatter array."""
    high = solar.solar_position(datetime(2026, 1, 1, 12, 0), LAT, LON, OFFSET)
    low = solar.solar_position(datetime(2026, 1, 1, 6, 40), LAT, LON, OFFSET)
    assert low.is_up
    high_angle = abs(solar.tracker_angle(high, gcr=0.5))
    low_angle = abs(solar.tracker_angle(low, gcr=0.5))
    # True-tracking would tilt hardest at low sun; backtracking flattens it.
    assert low_angle < 90.0
    no_backtrack = abs(solar.tracker_angle(low, gcr=0.5, backtrack=False))
    assert low_angle <= no_backtrack + 1e-9
