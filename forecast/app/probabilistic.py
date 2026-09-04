"""Threshold probabilities and exceedance levels from the analog ensemble.

WHY THIS IS THE MOST USEFUL THING THE FORECAST CAN PRODUCE

A forecast of "minimum 0.4 degrees" tells a farmer almost nothing, because the
decision is binary and the error bar straddles it. "78 percent chance of frost
between 03:00 and 06:00" is the same information expressed as the thing being
decided, and it is actionable: at 78 percent you start the fans, at 8 percent
you do not.

The same applies to every other user. A solar developer does not want expected
annual yield, they want P90, because that is what the debt is sized against. A
contractor does not want mean wind speed, they want the probability the crane
limit is exceeded in the shift.

All of it comes out of the analog ensemble the engine already builds, which is
why `forecast_points.members` stores the members rather than only p10 and p90.

EMPIRICAL, NOT FITTED

Probabilities here are counted from the members, not read off an assumed normal
distribution. That matters most exactly where it is most tempting to fit: frost
is a tail event, and the ensemble on a frost night is usually skewed. A normal
fit through p10 and p90 would smooth away the skew and misstate the risk.

The cost is resolution. With 15 members the finest probability that can be
expressed is about 7 percent, so values are reported alongside the member count
and never quoted more precisely than the ensemble can support.

ON P90, WHICH IS BACKWARDS FROM WHAT IT SOUNDS LIKE

In renewable-energy finance P90 is the value that will be EXCEEDED in 90 percent
of cases, which is the 10th percentile of the distribution. P50 is the median. So
P90 is a pessimistic number and P10 an optimistic one, the opposite of the
percentile that shares the digits. This is a well-known and expensive place to
make a sign error, so the exceedance helpers here are named for exceedance and
the conversion is done in one place.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from . import engine

#: Below this many members a probability is too coarse to be worth stating as a
#: number. Reported with `reliable=False` rather than suppressed, so a caller can
#: still show it with a caveat.
MIN_MEMBERS_FOR_PROBABILITY = 8


@dataclass
class Probability:
    """One probability, with enough context to judge how much to trust it."""

    #: 0.0 to 1.0.
    value: float
    #: Members supporting it.
    n: int
    #: How the question was phrased, for display.
    label: str = ""
    #: The threshold tested.
    threshold: float | None = None
    #: False when the ensemble is too small for the number to mean much.
    reliable: bool = True

    @property
    def percent(self) -> float:
        return self.value * 100.0

    @property
    def resolution_pct(self) -> float:
        """Finest distinction this ensemble size can express, in percent."""
        return 100.0 / self.n if self.n else 100.0

    def rounded_percent(self) -> int:
        """Percentage rounded to what the ensemble can actually resolve.

        Quoting 78.3 percent from 15 members implies a precision that is not
        there. Rounded to the nearest achievable step instead.
        """
        if not self.n:
            return 0
        step = 100.0 / self.n
        return int(round(round(self.percent / step) * step))

    def describe(self) -> str:
        """Plain wording, because a percentage alone invites over-reading."""
        p = self.rounded_percent()
        if not self.reliable:
            return f"about {p} percent, from only {self.n} past cases"
        if p >= 90:
            word = "very likely"
        elif p >= 70:
            word = "likely"
        elif p >= 40:
            word = "possible"
        elif p >= 15:
            word = "unlikely"
        elif p > 0:
            word = "very unlikely"
        else:
            word = "not indicated"
        return f"{p} percent, {word}"


# ---------------------------------------------------------------------------
#  Core counting
# ---------------------------------------------------------------------------

def _clean(members) -> list[float]:
    out = []
    for m in members or ():
        try:
            f = float(m)
        except (TypeError, ValueError):
            continue
        if f == f and f not in (float("inf"), float("-inf")):
            out.append(f)
    return out


def probability_at_or_below(members, threshold: float,
                            label: str = "") -> Probability | None:
    """P(X <= threshold), counted from the members."""
    vals = _clean(members)
    if not vals:
        return None
    hits = sum(1 for v in vals if v <= threshold)
    return Probability(value=hits / len(vals), n=len(vals), label=label,
                       threshold=threshold,
                       reliable=len(vals) >= MIN_MEMBERS_FOR_PROBABILITY)


def probability_at_or_above(members, threshold: float,
                            label: str = "") -> Probability | None:
    """P(X >= threshold), counted from the members."""
    vals = _clean(members)
    if not vals:
        return None
    hits = sum(1 for v in vals if v >= threshold)
    return Probability(value=hits / len(vals), n=len(vals), label=label,
                       threshold=threshold,
                       reliable=len(vals) >= MIN_MEMBERS_FOR_PROBABILITY)


def probability_between(members, low: float, high: float,
                        label: str = "") -> Probability | None:
    """P(low <= X <= high). Used for spray windows and comfort bands."""
    vals = _clean(members)
    if not vals:
        return None
    hits = sum(1 for v in vals if low <= v <= high)
    return Probability(value=hits / len(vals), n=len(vals), label=label,
                       reliable=len(vals) >= MIN_MEMBERS_FOR_PROBABILITY)


def percentile(members, pct: float) -> float | None:
    """Linear-interpolated percentile of the members.

    Reimplemented rather than reusing engine.percentile so this module can be
    read and tested on its own; the two agree, which a test asserts.
    """
    vals = sorted(_clean(members))
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    p = max(0.0, min(100.0, float(pct)))
    pos = (p / 100.0) * (len(vals) - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return vals[lo]
    frac = pos - lo
    return vals[lo] * (1.0 - frac) + vals[hi] * frac


# ---------------------------------------------------------------------------
#  Exceedance levels, the renewable-energy convention
# ---------------------------------------------------------------------------

def exceedance_level(members, exceedance_pct: float) -> float | None:
    """The value exceeded in `exceedance_pct` percent of members.

    P90 means "exceeded 90 percent of the time", so it is the 10th percentile.
    Call this with 90 to get P90 and read the docstring at the top of the module
    before changing anything here.
    """
    if members is None:
        return None
    e = max(0.0, min(100.0, float(exceedance_pct)))
    return percentile(members, 100.0 - e)


def exceedance_table(members,
                     levels=(10, 50, 75, 90, 99)) -> dict[str, float | None]:
    """P10, P50, P75, P90, P99 in the finance sense.

    P50 is the median either way. P90 is pessimistic, P10 optimistic. The keys
    are strings so the ordering in a template is explicit.
    """
    return {f"P{int(l)}": exceedance_level(members, l) for l in levels}


# ---------------------------------------------------------------------------
#  Named products
# ---------------------------------------------------------------------------

# Damage thresholds are stage-dependent and crop-dependent; these are the
# generally quoted screen-height air temperatures at which action is considered.
# A canopy or a hollow runs colder than the screen, which is why the light-frost
# threshold is above zero rather than at it.
FROST_THRESHOLDS = (
    (2.0, "ground frost possible"),
    (0.0, "air frost"),
    (-2.0, "damaging frost"),
    (-4.0, "severe frost"),
)


@dataclass
class NightRisk:
    """Overnight risk for one night, built from the coldest hours."""

    night_of: datetime | None = None
    from_hour: datetime | None = None
    to_hour: datetime | None = None
    hours_considered: int = 0
    coldest_expected: float | None = None
    probabilities: list[Probability] = field(default_factory=list)
    #: Hours whose own frost probability is above a tenth, for timing advice.
    risk_hours: list[tuple[datetime, float]] = field(default_factory=list)

    def probability_of(self, threshold: float) -> Probability | None:
        for p in self.probabilities:
            if p.threshold == threshold:
                return p
        return None

    @property
    def headline(self) -> Probability | None:
        """Air frost, the threshold most people mean by "frost"."""
        return self.probability_of(0.0)


def frost_risk(points, night_start_hour: int = 18,
               night_end_hour: int = 9) -> list[NightRisk]:
    """Frost probability per night from hourly ensemble points.

    `points` is an iterable of dicts with `valid_at` (datetime) and `members`
    (iterable of member temperatures).

    WHY THIS IS PER NIGHT AND NOT PER HOUR

    The decision is "do I protect the block tonight", taken once in the evening.
    An hourly probability answers a question nobody asks, and the maximum of the
    hourly probabilities is not the probability of frost during the night.

    So the night's members are pooled by taking, for each ensemble member, the
    coldest hour that member produced across the night. That gives a
    member-consistent distribution of the night's minimum, which is the quantity
    the threshold applies to. Taking the coldest value across all members and all
    hours instead would overstate the risk by mixing members.
    """
    by_night: dict[datetime, list[dict]] = {}
    for point in points or ():
        when = point.get("valid_at")
        if not isinstance(when, datetime):
            continue
        hour = when.hour
        if hour >= night_start_hour:
            night = when.date()
        elif hour <= night_end_hour:
            night = (when - timedelta(days=1)).date()
        else:
            continue                       # daytime, not part of a night
        key = datetime(night.year, night.month, night.day)
        by_night.setdefault(key, []).append(point)

    out: list[NightRisk] = []
    for night, rows in sorted(by_night.items()):
        rows.sort(key=lambda r: r["valid_at"])
        member_series: list[list[float]] = []
        for row in rows:
            vals = _clean(row.get("members"))
            if vals:
                member_series.append(vals)
        risk = NightRisk(
            night_of=night,
            from_hour=rows[0]["valid_at"],
            to_hour=rows[-1]["valid_at"],
            hours_considered=len(rows))

        expected = [r.get("value") for r in rows
                    if isinstance(r.get("value"), (int, float))]
        if expected:
            risk.coldest_expected = min(expected)

        if member_series:
            width = min(len(s) for s in member_series)
            # Per-member night minimum: index i is the same analog day in every
            # hour, so taking min across hours for a fixed i stays consistent.
            night_minima = [min(s[i] for s in member_series)
                            for i in range(width)]
            for threshold, name in FROST_THRESHOLDS:
                p = probability_at_or_below(night_minima, threshold, name)
                if p is not None:
                    risk.probabilities.append(p)
            for row in rows:
                hp = probability_at_or_below(row.get("members"), 0.0)
                if hp is not None and hp.value >= 0.1:
                    risk.risk_hours.append((row["valid_at"], hp.value))
        out.append(risk)
    return out


@dataclass
class WindowRisk:
    """Probability that a working window is usable."""

    from_hour: datetime | None = None
    to_hour: datetime | None = None
    #: P(every hour in the window is within limits).
    all_hours: Probability | None = None
    #: P(at least one hour is within limits).
    any_hour: Probability | None = None
    per_hour: list[tuple[datetime, Probability]] = field(default_factory=list)


def window_probability(points, low: float, high: float,
                       label: str = "") -> WindowRisk:
    """Probability a variable stays within limits over a set of hours.

    Both numbers are reported because they answer different questions. A spray
    operator wants `all_hours`: the whole window has to be usable or the job
    stops halfway. Someone scheduling a single lift wants `any_hour`.

    Member consistency again: the joint probability is counted per member across
    the window, not multiplied out per hour. Multiplying assumes the hours are
    independent, and consecutive hours of one weather pattern are the opposite of
    independent, which would understate a good window badly.
    """
    rows = [p for p in (points or ())
            if isinstance(p.get("valid_at"), datetime)]
    rows.sort(key=lambda r: r["valid_at"])
    risk = WindowRisk(from_hour=rows[0]["valid_at"] if rows else None,
                      to_hour=rows[-1]["valid_at"] if rows else None)
    series = []
    for row in rows:
        vals = _clean(row.get("members"))
        if vals:
            series.append(vals)
        p = probability_between(row.get("members"), low, high, label)
        if p is not None:
            risk.per_hour.append((row["valid_at"], p))
    if not series:
        return risk

    width = min(len(s) for s in series)
    n_all = 0
    n_any = 0
    for i in range(width):
        member_hours = [s[i] for s in series]
        inside = [low <= v <= high for v in member_hours]
        if all(inside):
            n_all += 1
        if any(inside):
            n_any += 1
    reliable = width >= MIN_MEMBERS_FOR_PROBABILITY
    risk.all_hours = Probability(value=n_all / width, n=width,
                                 label=f"{label} throughout".strip(),
                                 reliable=reliable)
    risk.any_hour = Probability(value=n_any / width, n=width,
                                label=f"{label} at some point".strip(),
                                reliable=reliable)
    return risk


def threshold_exceeded_probability(points, threshold: float,
                                   label: str = "") -> Probability | None:
    """P(the variable reaches `threshold` at any hour in `points`).

    For a limit that stops work the moment it is crossed: a crane wind limit, a
    heat-stress ceiling, a gust that grounds a spray drone. Counted per member
    across the hours, for the same reason as `window_probability`.
    """
    series = []
    for point in points or ():
        vals = _clean(point.get("members"))
        if vals:
            series.append(vals)
    if not series:
        return None
    width = min(len(s) for s in series)
    hits = 0
    for i in range(width):
        if any(s[i] >= threshold for s in series):
            hits += 1
    return Probability(value=hits / width, n=width, label=label,
                       threshold=threshold,
                       reliable=width >= MIN_MEMBERS_FOR_PROBABILITY)


def daily_exceedance(points, level_pct: float = 90.0) -> list[dict]:
    """Per-day exceedance levels, for a resource or yield table.

    Each day's members are summed per member first, so the daily total keeps
    member consistency, then the exceedance level is read off those totals. This
    is the right order for anything additive such as energy or rainfall: taking
    exceedance hour by hour and then summing produces a daily P90 that no single
    day could actually deliver.
    """
    by_day: dict[str, list[dict]] = {}
    for point in points or ():
        when = point.get("valid_at")
        if not isinstance(when, datetime):
            continue
        by_day.setdefault(when.date().isoformat(), []).append(point)

    out = []
    for day, rows in sorted(by_day.items()):
        series = [_clean(r.get("members")) for r in rows]
        series = [s for s in series if s]
        if not series:
            continue
        width = min(len(s) for s in series)
        totals = [sum(s[i] for s in series) for i in range(width)]
        out.append({
            "date": day,
            "hours": len(rows),
            "members": width,
            "mean": sum(totals) / width if width else None,
            "level": exceedance_level(totals, level_pct),
            "exceedance": exceedance_table(totals),
        })
    return out


def summarize_point(members, variable: str = "") -> dict:
    """Spread description for one hour, for a tooltip or a detail row."""
    vals = _clean(members)
    if not vals:
        return {"members": 0}
    return {
        "members": len(vals),
        "min": min(vals),
        "max": max(vals),
        "median": percentile(vals, 50),
        "p10": percentile(vals, 10),
        "p90": percentile(vals, 90),
        "spread": max(vals) - min(vals),
        "exceedance": exceedance_table(vals),
        "reliable": len(vals) >= MIN_MEMBERS_FOR_PROBABILITY,
        "variable": variable,
    }
