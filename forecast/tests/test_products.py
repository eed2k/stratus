"""Extended agricultural products: frost typing, leaf wetness, chill, THI.

The frost tests are the ones that matter most: they defend the two decisions
that cost a grower money, that a frost-fan claim is only made from a measured
inversion (P13) and that exactly one frost probability is ever presented (P19).
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import products


def _night(temps, *, wind=None, delta=None, dew=-3.0, hum=95.0):
    """Build an overnight run of hour dicts, one per entry in `temps`."""
    base = datetime(2026, 6, 10, 20, 0)
    out = []
    for i, t in enumerate(temps):
        h = {"valid_at": base + timedelta(hours=i), "temperature": t,
             "dew_point": dew, "humidity": hum}
        if wind is not None:
            h["wind_speed"] = wind
        if delta is not None:
            h["delta_temperature"] = delta
        out.append(h)
    return out


# ---------------------------------------------------------------------------
#  Frost typing: basis and the frost-fan gate (P13, R5.7-R5.10)
# ---------------------------------------------------------------------------

def test_measured_inversion_says_fans_help():
    fa = products.assess_frost(_night([-1.0, -2.0, -1.5, 0.0, 2.0],
                                       wind=3.0, delta=3.0))
    assert fa.frost_type_basis == "inversion"
    assert fa.frost_type == "radiation"
    assert fa.frost_fans_help is True
    assert any("fans" in r.lower() for r in fa.reasoning)


def test_measured_mixed_layer_says_fans_do_not_help():
    fa = products.assess_frost(_night([-1.0, -2.0, -1.5, 0.0, 2.0],
                                       wind=25.0, delta=0.2))
    assert fa.frost_type_basis == "inversion"
    assert fa.frost_type == "advection"
    assert fa.frost_fans_help is False


def test_wind_proxy_makes_no_claim_about_fans():
    """R5.10: with only wind, the type may be inferred but the fan question,
    which costs money, must be left unanswered."""
    fa = products.assess_frost(_night([-1.0, -2.0, -1.5, 0.0], wind=3.0))
    assert fa.frost_type_basis == "wind_proxy"
    assert fa.frost_type == "radiation"
    assert fa.frost_fans_help is None
    # It may explain why it stays silent, but it must never affirm that fans
    # will help from a wind proxy.
    assert not any("expected to help" in r.lower() for r in fa.reasoning)


def test_no_wind_and_no_second_height_is_undetermined():
    fa = products.assess_frost(_night([-1.0, -2.0, -1.5, 0.0]))
    assert fa.frost_type_basis == "undetermined"
    assert fa.frost_type is None
    assert fa.frost_fans_help is None


def test_only_one_frost_number_and_it_is_not_a_probability():
    """P19 / R5.10b: the heuristic assessment exposes a band and a score, never
    a second probability to argue with the ensemble figure."""
    fa = products.assess_frost(_night([-1.0, -2.0], wind=3.0, delta=3.0))
    assert hasattr(fa, "heuristic_score")
    assert not hasattr(fa, "probability")
    assert 0.0 <= fa.heuristic_score <= 1.0
    assert fa.risk in ("none", "slight", "moderate", "severe")


# ---------------------------------------------------------------------------
#  Leaf wetness: derived, with a drying allowance (R5.3, R5.4)
# ---------------------------------------------------------------------------

def test_leaf_wetness_is_labeled_derived():
    hours = [{"valid_at": datetime(2026, 3, 1, h), "temperature": 12.0,
              "dew_point": 11.5, "humidity": 96.0, "wind_speed": 3.0}
             for h in range(0, 8)]
    dew = products.assess_dew(hours)
    assert dew.expected is True
    assert dew.duration_is_measured is False
    assert any("derived" in r.lower() for r in dew.reasoning)


def test_a_warm_breezy_margin_hour_is_dried_off():
    """The drying allowance removes a warm, windy, marginally-wet hour."""
    calm = [{"valid_at": datetime(2026, 3, 1, h), "temperature": 12.0,
             "dew_point": 11.5, "humidity": 96.0, "wind_speed": 2.0}
            for h in range(0, 6)]
    windy_margin = [{"valid_at": datetime(2026, 3, 1, 6), "temperature": 22.0,
                     "dew_point": 20.5, "humidity": 90.0, "wind_speed": 22.0}]
    without = products.assess_dew(calm)
    with_margin = products.assess_dew(calm + windy_margin)
    # The extra hour is dried off, so it does not extend the wet duration.
    assert with_margin.duration_hours == without.duration_hours


# ---------------------------------------------------------------------------
#  Chill: three models together, with the caveat (R5.11, R5.12)
# ---------------------------------------------------------------------------

def test_chill_summary_reports_three_models_and_a_caveat():
    hours = [{"temperature": t} for t in
             ([4.0] * 100 + [6.0] * 100 + [20.0] * 40)]
    s = products.chill_summary(hours)
    assert s.chill_hours > 0
    assert s.utah_chill_units is not None
    assert s.chill_portions is not None and s.chill_portions > 0.0
    assert "underestimate" in s.note.lower()


def test_utah_units_penalize_a_warm_spell():
    cold = products.utah_chill_units([{"temperature": 5.0}] * 24)
    warmed = products.utah_chill_units(
        [{"temperature": 5.0}] * 24 + [{"temperature": 22.0}] * 24)
    assert warmed < cold        # heat undoes accumulated chill


# ---------------------------------------------------------------------------
#  Livestock heat load (R5.13)
# ---------------------------------------------------------------------------

def test_thi_category_depends_on_species():
    # A THI that is severe for poultry is milder for beef cattle.
    poultry = products.livestock_thi(32.0, 60.0, species="poultry")
    beef = products.livestock_thi(32.0, 60.0, species="beef_cattle")
    assert poultry.thi == pytest.approx(beef.thi, abs=1e-9)
    order = ["comfortable", "mild", "moderate", "severe"]
    assert order.index(poultry.category) >= order.index(beef.category)


def test_thi_none_without_inputs_or_species():
    assert products.livestock_thi(None, 50.0) is None
    assert products.livestock_thi(30.0, 50.0, species="dragon") is None


# ---------------------------------------------------------------------------
#  Spray-time surface inversion (R5.14)
# ---------------------------------------------------------------------------

def test_spray_inversion_detected_from_two_heights():
    hours = _night([8.0, 7.0, 6.0], delta=2.5)
    haz = products.spray_inversion_hazard(hours)
    assert haz.detected is True
    assert haz.basis == "inversion"
    assert haz.hours


def test_spray_inversion_undetermined_without_a_second_height():
    hours = _night([8.0, 7.0, 6.0], wind=5.0)
    haz = products.spray_inversion_hazard(hours)
    assert haz.detected is False
    assert haz.basis == "undetermined"


# ---------------------------------------------------------------------------
#  Disease models name themselves and show their inputs (R5.5, R5.6)
# ---------------------------------------------------------------------------

def test_disease_models_are_named_with_inputs():
    risks = products.disease_risks(leaf_wetness_h=20.0, mean_temp_c=22.0)
    names = {r.crop for r in risks}
    assert {"small grains", "grapevine", "citrus", "potato"} <= names
    for r in risks:
        assert r.model
        assert "leaf_wetness_h" in r.inputs and "mean_temp_c" in r.inputs
        assert r.level in ("low", "moderate", "high")


def test_a_long_warm_wet_period_raises_late_blight():
    low = products.disease_risks(leaf_wetness_h=2.0, mean_temp_c=8.0)
    high = products.disease_risks(leaf_wetness_h=18.0, mean_temp_c=15.0)
    blight_low = next(r for r in low if r.crop == "potato")
    blight_high = next(r for r in high if r.crop == "potato")
    assert blight_low.level == "low"
    assert blight_high.level == "high"


# ---------------------------------------------------------------------------
#  ETc is a demand, never an irrigation instruction (R5.1, R5.2)
# ---------------------------------------------------------------------------

def test_crop_etc_is_et0_times_kc():
    kc = products.crop_coefficient("maize", days_after_planting=60)
    etc = products.crop_etc(5.0, "maize", days_after_planting=60)
    assert kc is not None
    assert etc == pytest.approx(5.0 * kc)


def test_crop_coefficient_moves_through_the_season():
    early = products.crop_coefficient("maize", 5)      # initial
    mid = products.crop_coefficient("maize", 70)       # mid-season plateau
    assert mid > early
    assert products.crop_coefficient("nonsense", 10) is None
