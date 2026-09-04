"""Probabilistic product tests.

The important ones here are the member-consistency tests. It is easy to write a
version of each of these functions that looks right and quietly mixes ensemble
members, which inflates or deflates the probability in ways nobody notices.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import engine, probabilistic as pb


def _point(when, members, value=None):
    return {"valid_at": when, "members": members,
            "value": value if value is not None else (
                sum(members) / len(members) if members else None)}


# ---------------------------------------------------------------------------
#  Counting
# ---------------------------------------------------------------------------

def test_probability_at_or_below_counts_members():
    members = [-2.0, -1.0, 0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
    p = pb.probability_at_or_below(members, 0.0)
    assert p.value == pytest.approx(0.3)      # -2, -1 and 0
    assert p.n == 10
    assert p.reliable is True


def test_probability_at_or_above_counts_members():
    members = list(range(10))
    p = pb.probability_at_or_above(members, 7.0)
    assert p.value == pytest.approx(0.3)      # 7, 8, 9


def test_probability_between_is_inclusive():
    members = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
    p = pb.probability_between(members, 2.0, 4.0)
    assert p.value == pytest.approx(3 / 8)


def test_thresholds_are_complementary():
    members = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    below = pb.probability_at_or_below(members, 5.0).value
    above = pb.probability_at_or_above(members, 5.0001).value
    assert below + above == pytest.approx(1.0)


def test_small_ensemble_is_flagged_unreliable():
    p = pb.probability_at_or_below([1.0, 2.0, 3.0], 2.0)
    assert p.n == 3
    assert p.reliable is False
    assert "only 3 past cases" in p.describe()


def test_empty_or_dirty_members_give_none():
    assert pb.probability_at_or_below([], 0.0) is None
    assert pb.probability_at_or_below(None, 0.0) is None
    assert pb.probability_at_or_below(["x", None], 0.0) is None


def test_dirty_members_are_skipped_not_fatal():
    p = pb.probability_at_or_below([1.0, "bad", None, 2.0,
                                    float("nan")], 1.5)
    assert p.n == 2
    assert p.value == pytest.approx(0.5)


def test_rounded_percent_respects_ensemble_resolution():
    """15 members cannot express 78.3 percent."""
    members = [0.0] * 7 + [10.0] * 8
    p = pb.probability_at_or_below(members, 0.0)
    assert p.n == 15
    assert p.resolution_pct == pytest.approx(100 / 15)
    # Must land on a multiple of the achievable step.
    step = 100.0 / 15
    assert abs(round(p.rounded_percent() / step) * step
               - p.rounded_percent()) < 1.0


@pytest.mark.parametrize("frac,word", [
    (1.0, "very likely"), (0.75, "likely"), (0.5, "possible"),
    (0.2, "unlikely"), (0.05, "very unlikely"), (0.0, "not indicated"),
])
def test_describe_wording(frac, word):
    n = 20
    members = [0.0] * int(round(frac * n)) + [10.0] * (n - int(round(frac * n)))
    p = pb.probability_at_or_below(members, 0.0)
    assert word in p.describe(), p.describe()


# ---------------------------------------------------------------------------
#  Percentiles and exceedance
# ---------------------------------------------------------------------------

def test_percentile_agrees_with_the_engine():
    members = [3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0]
    for pct in (0, 10, 25, 50, 75, 90, 100):
        assert pb.percentile(members, pct) == pytest.approx(
            engine.percentile(members, pct))


def test_percentile_of_one_member():
    assert pb.percentile([7.0], 50) == 7.0
    assert pb.percentile([7.0], 10) == 7.0


def test_p90_is_the_tenth_percentile_not_the_ninetieth():
    """The sign error this module is written to prevent."""
    members = list(range(101))               # 0..100
    p90 = pb.exceedance_level(members, 90)
    p10 = pb.exceedance_level(members, 10)
    assert p90 == pytest.approx(10.0)        # exceeded 90% of the time
    assert p10 == pytest.approx(90.0)        # exceeded only 10% of the time
    assert p90 < p10, "P90 must be the pessimistic figure"


def test_p50_is_the_median():
    members = list(range(101))
    assert pb.exceedance_level(members, 50) == pytest.approx(50.0)


def test_exceedance_table_is_monotonically_decreasing():
    members = [float(x) for x in range(50)]
    table = pb.exceedance_table(members)
    values = [table[k] for k in ("P10", "P50", "P75", "P90", "P99")]
    assert values == sorted(values, reverse=True), values


# ---------------------------------------------------------------------------
#  Frost
# ---------------------------------------------------------------------------

def _night(base_date, hourly_members):
    """Points from 18:00 to 09:00 with given per-hour member lists."""
    points = []
    when = datetime(base_date.year, base_date.month, base_date.day, 18, 0)
    for members in hourly_members:
        points.append(_point(when, members))
        when += timedelta(hours=1)
    return points


def test_frost_risk_groups_by_night_not_by_calendar_day():
    """Hours either side of midnight belong to the same night."""
    points = _night(datetime(2026, 6, 10), [[5.0] * 10 for _ in range(15)])
    nights = pb.frost_risk(points)
    assert len(nights) == 1
    assert nights[0].from_hour.hour == 18
    assert nights[0].to_hour.day == 11


def test_frost_probability_from_a_cold_night():
    # Ten members: four dip below zero at the coldest hour.
    warm = [4.0] * 10
    cold = [-1.5, -0.5, -0.2, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
    points = _night(datetime(2026, 6, 10), [warm, warm, cold, warm])
    night = pb.frost_risk(points)[0]
    head = night.headline
    assert head is not None
    assert head.threshold == 0.0
    assert head.value == pytest.approx(0.4)     # four members <= 0
    assert night.coldest_expected is not None


def test_frost_uses_per_member_night_minimum_not_the_global_minimum():
    """P9 member consistency: mixing members would overstate the risk.

    Member 0 is cold in hour one, member 1 is cold in hour two, and no single
    member is ever cold twice. The night minimum per member is still only one
    cold value each, so P(frost) is 2/4, not 1.0.
    """
    hour1 = [-1.0, 5.0, 5.0, 5.0]
    hour2 = [5.0, -1.0, 5.0, 5.0]
    points = _night(datetime(2026, 6, 10), [hour1, hour2])
    night = pb.frost_risk(points)[0]
    assert night.headline.value == pytest.approx(0.5)


def test_frost_thresholds_are_ordered_by_severity():
    members = [-5.0, -3.0, -1.0, 1.0, 3.0, 5.0, 7.0, 9.0, 11.0, 13.0]
    points = _night(datetime(2026, 6, 10), [members])
    night = pb.frost_risk(points)[0]
    ground = night.probability_of(2.0).value
    air = night.probability_of(0.0).value
    damaging = night.probability_of(-2.0).value
    severe = night.probability_of(-4.0).value
    assert ground >= air >= damaging >= severe


def test_frost_risk_hours_identify_the_timing():
    warm = [8.0] * 10
    cold = [-1.0] * 5 + [2.0] * 5
    points = _night(datetime(2026, 6, 10), [warm, cold, cold, warm])
    night = pb.frost_risk(points)[0]
    assert len(night.risk_hours) == 2
    assert all(v >= 0.1 for _t, v in night.risk_hours)


def test_daytime_hours_are_excluded_from_nights():
    points = [_point(datetime(2026, 6, 10, 13, 0), [20.0] * 10)]
    assert pb.frost_risk(points) == []


def test_warm_night_gives_zero_frost_probability():
    points = _night(datetime(2026, 1, 10), [[18.0] * 12 for _ in range(14)])
    night = pb.frost_risk(points)[0]
    assert night.headline.value == 0.0
    assert "not indicated" in night.headline.describe()


# ---------------------------------------------------------------------------
#  Working windows
# ---------------------------------------------------------------------------

def test_window_all_hours_versus_any_hour():
    # Four members. Member 0 is in limits both hours, member 1 only in hour one.
    hour1 = [5.0, 5.0, 20.0, 20.0]
    hour2 = [5.0, 20.0, 20.0, 5.0]
    points = [_point(datetime(2026, 3, 1, 6), hour1),
              _point(datetime(2026, 3, 1, 7), hour2)]
    risk = pb.window_probability(points, 0.0, 10.0, "in limits")
    assert risk.all_hours.value == pytest.approx(0.25)   # member 0 only
    assert risk.any_hour.value == pytest.approx(0.75)    # 0, 1 and 3
    assert risk.all_hours.value <= risk.any_hour.value


def test_window_does_not_multiply_independent_probabilities():
    """Consecutive hours are correlated; multiplying understates a good window.

    Every member is in limits in both hours, so the joint probability is 1.0.
    Multiplying the per-hour probabilities would also give 1.0 here, so the test
    uses a case where two members are always in and two always out: joint is 0.5,
    while multiplying per-hour (0.5 * 0.5) would give 0.25.
    """
    hour1 = [5.0, 5.0, 20.0, 20.0]
    hour2 = [5.0, 5.0, 20.0, 20.0]
    points = [_point(datetime(2026, 3, 1, 6), hour1),
              _point(datetime(2026, 3, 1, 7), hour2)]
    risk = pb.window_probability(points, 0.0, 10.0)
    assert risk.all_hours.value == pytest.approx(0.5)


def test_window_per_hour_values_are_reported():
    points = [_point(datetime(2026, 3, 1, 6), [1.0, 2.0, 30.0]),
              _point(datetime(2026, 3, 1, 7), [1.0, 30.0, 30.0])]
    risk = pb.window_probability(points, 0.0, 10.0)
    assert len(risk.per_hour) == 2
    assert risk.per_hour[0][1].value == pytest.approx(2 / 3)


def test_empty_window_is_safe():
    risk = pb.window_probability([], 0.0, 10.0)
    assert risk.all_hours is None
    assert risk.any_hour is None


# ---------------------------------------------------------------------------
#  Limit exceedance across a shift
# ---------------------------------------------------------------------------

def test_threshold_exceeded_across_hours_is_per_member():
    """A crane limit crossed by different members in different hours."""
    hour1 = [50.0, 10.0, 10.0, 10.0]
    hour2 = [10.0, 50.0, 10.0, 10.0]
    points = [_point(datetime(2026, 3, 1, 8), hour1),
              _point(datetime(2026, 3, 1, 9), hour2)]
    p = pb.threshold_exceeded_probability(points, 40.0, "over crane limit")
    assert p.value == pytest.approx(0.5)      # members 0 and 1


def test_threshold_never_exceeded():
    points = [_point(datetime(2026, 3, 1, 8), [5.0] * 10)]
    p = pb.threshold_exceeded_probability(points, 40.0)
    assert p.value == 0.0


def test_threshold_with_no_members_is_none():
    assert pb.threshold_exceeded_probability([], 40.0) is None


# ---------------------------------------------------------------------------
#  Daily totals
# ---------------------------------------------------------------------------

def test_daily_exceedance_sums_per_member_first():
    """The order that matters for anything additive.

    Two hours, two members. Member 0 gives 1+3=4, member 1 gives 3+1=4. Both
    daily totals are 4, so every exceedance level is 4. Taking hourly exceedance
    first and summing would give 1+1=2 for P90, a day no member produced.
    """
    points = [_point(datetime(2026, 3, 1, 8), [1.0, 3.0]),
              _point(datetime(2026, 3, 1, 9), [3.0, 1.0])]
    rows = pb.daily_exceedance(points, 90.0)
    assert len(rows) == 1
    assert rows[0]["level"] == pytest.approx(4.0)
    assert rows[0]["mean"] == pytest.approx(4.0)
    assert rows[0]["exceedance"]["P90"] == pytest.approx(4.0)


def test_daily_exceedance_splits_by_date():
    points = [_point(datetime(2026, 3, 1, 8), [1.0, 1.0]),
              _point(datetime(2026, 3, 2, 8), [2.0, 2.0])]
    rows = pb.daily_exceedance(points)
    assert [r["date"] for r in rows] == ["2026-03-01", "2026-03-02"]


def test_daily_exceedance_p90_is_below_p10():
    points = [_point(datetime(2026, 3, 1, h), [float(h + i)
                                               for i in range(12)])
              for h in range(6, 18)]
    row = pb.daily_exceedance(points)[0]
    assert row["exceedance"]["P90"] < row["exceedance"]["P10"]


# ---------------------------------------------------------------------------
#  Point summary
# ---------------------------------------------------------------------------

def test_summarize_point():
    s = pb.summarize_point([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0],
                           "temperature")
    assert s["members"] == 10
    assert s["min"] == 1.0 and s["max"] == 10.0
    assert s["median"] == pytest.approx(5.5)
    assert s["spread"] == pytest.approx(9.0)
    assert s["reliable"] is True
    assert s["variable"] == "temperature"
    assert s["exceedance"]["P90"] < s["exceedance"]["P10"]


def test_summarize_empty_point():
    assert pb.summarize_point([]) == {"members": 0}
