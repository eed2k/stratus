"""Short-range forecast engine driven by a single station's own history.

WHY THIS SHAPE

A nano-climate forecast is not a small version of a national forecast. What a
site owner needs to know is whether *their* hollow will frost tonight, whether
dew will sit on the crop until nine, whether there is a spray window at six.
Those questions are dominated by local effects - cold air pooling, shelter,
aspect, soil - that a 9 km grid cell cannot resolve and that a station standing
in the middle of them measures directly.

So the default engine uses nothing but the station's own observations. That is
also the only lawful default: the free tiers of the public forecast APIs are
licensed for non-commercial use, and Stratus has paying clients. An external
model can be plugged in (see nwp.py) but it is off unless an operator supplies
their own licensed endpoint and key.

THE METHOD, AND ITS HONEST LIMITS

Three components, blended by lead time:

  1. Harmonic climatology. The site's characteristic daily curve, fitted as a
     mean plus two harmonics of hour-of-day over a trailing window. This carries
     the diurnal shape - when the site actually reaches its minimum, which is
     often nowhere near sunrise in a valley.

  2. Damped anomaly persistence. How far the site is from its own climatology
     right now, decayed toward zero with an e-folding time measured from the
     station's own autocorrelation. This is the classic skillful baseline for the
     first several hours and beats climatology alone by a wide margin.

  3. Analog ensemble. Find the k past days whose recent trajectory most
     resembles the last few hours, and use what actually happened next on those
     days as an ensemble. This is a published technique (AnEn) that works with a
     single site's archive and no model output, and it is the only one of the
     three that produces an honest spread rather than a single line.

  Weighting moves from persistence-dominated at short lead to
  climatology-dominated at long lead, because that is where each is skillful.

What this CANNOT do, and the UI says so: it cannot see a front, a cut-off low or
a thunderstorm coming, because none of those are in the station's past unless a
similar day happens to be in the archive. Rainfall in particular is close to
unforecastable this way beyond a few hours - it is reported as a climatological
probability, not a promise, and never as a quantity. For synoptic skill you need
a real atmospheric model, which is what nwp.py is for.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# Observations closer together than this are treated as the same instant.
HOUR = 3600.0

# Variables the engine will forecast, and how each behaves.
#   circular : a direction in degrees, averaged as a vector
#   bounded  : clipped to a physical range after blending
#   diurnal  : has a real daily cycle worth fitting harmonics to
VARIABLE_RULES = {
    "temperature":     {"bounded": (-40.0, 60.0), "diurnal": True},
    "humidity":        {"bounded": (0.0, 100.0), "diurnal": True},
    "dew_point":       {"bounded": (-40.0, 40.0), "diurnal": True},
    "pressure":        {"bounded": (800.0, 1100.0), "diurnal": True},
    "wind_speed":      {"bounded": (0.0, 200.0), "diurnal": True},
    "wind_gust":       {"bounded": (0.0, 250.0), "diurnal": True},
    "wind_direction":  {"circular": True, "diurnal": True},
    "solar_radiation": {"bounded": (0.0, 1500.0), "diurnal": True},
    "rainfall":        {"bounded": (0.0, 200.0)},
}


# ---------------------------------------------------------------------------
#  Small statistical helpers
# ---------------------------------------------------------------------------

def mean(values):
    """Arithmetic mean, or None for an empty sequence."""
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def median(values):
    """Median, or None for an empty sequence."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    n = len(vals)
    mid = n // 2
    if n % 2:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2.0


def percentile(values, pct):
    """Linear-interpolated percentile. `pct` is 0..100."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    pos = (len(vals) - 1) * (pct / 100.0)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return vals[lo]
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def stdev(values):
    """Population standard deviation, or None when there is too little data."""
    vals = [v for v in values if v is not None]
    if len(vals) < 2:
        return None
    m = sum(vals) / len(vals)
    return math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals))


def circular_mean(degrees):
    """Vector mean of directions in degrees, 0..360.

    Averaging 350 and 10 arithmetically gives 180, which points the wind the
    wrong way entirely. Directions must be averaged as unit vectors.
    """
    vals = [d for d in degrees if d is not None]
    if not vals:
        return None
    x = sum(math.cos(math.radians(d)) for d in vals)
    y = sum(math.sin(math.radians(d)) for d in vals)
    if abs(x) < 1e-12 and abs(y) < 1e-12:
        return None                       # directions canceled out entirely
    return math.degrees(math.atan2(y, x)) % 360.0


def angular_difference(a, b):
    """Smallest absolute difference between two bearings, 0..180."""
    if a is None or b is None:
        return None
    return abs((a - b + 180.0) % 360.0 - 180.0)


def signed_angular_difference(a, b):
    """`a` minus `b` as a bearing, wrapped to -180..180.

    The signed form is needed wherever the direction of the difference carries
    meaning, and using the absolute form in those places is a real error rather
    than an approximation:

      anomalies    a direction anomaly must keep its sign, or the damped
                   persistence term always pushes the forecast clockwise no
                   matter which way the wind actually shifted.
      bias         an unsigned bias is identical to the mean absolute error by
                   construction, so it reports a systematic veer that is not
                   there and hides one that is.
    """
    if a is None or b is None:
        return None
    return (a - b + 180.0) % 360.0 - 180.0


# ---------------------------------------------------------------------------
#  Harmonic climatology
# ---------------------------------------------------------------------------

@dataclass
class Climatology:
    """The site's characteristic daily curve for one variable.

    `coefficients` holds the fitted mean and the cosine/sine pairs for each
    harmonic. Two harmonics are enough to represent a daily cycle that is not a
    pure sinusoid - a fast morning rise and a slow afternoon decay, which is
    what most sites actually do.
    """

    mean_value: float
    harmonics: list = field(default_factory=list)   # [(a1, b1), (a2, b2), ...]
    sample_count: int = 0
    residual_stdev: float | None = None

    def at(self, hour_of_day: float) -> float:
        """The climatological value at a given hour, 0..24."""
        theta = 2.0 * math.pi * (hour_of_day / 24.0)
        value = self.mean_value
        for n, (a, b) in enumerate(self.harmonics, start=1):
            value += a * math.cos(n * theta) + b * math.sin(n * theta)
        return value


def fit_climatology(samples, n_harmonics: int = 2) -> Climatology | None:
    """Least-squares fit of mean + harmonics of hour-of-day.

    `samples` is a sequence of (hour_of_day, value).

    Solved directly rather than with a matrix library: the basis functions are
    orthogonal over a full, evenly-sampled day, so the normal equations collapse
    to simple sums. Real data is neither complete nor perfectly even, so this is
    an approximation - good enough for a diurnal shape, and it keeps the
    container free of a linear-algebra dependency.
    """
    pairs = [(h, v) for h, v in samples if v is not None]
    if len(pairs) < 24:
        return None                       # less than a day: no cycle to fit

    n = len(pairs)
    m = sum(v for _h, v in pairs) / n
    harmonics = []
    residual = [v - m for _h, v in pairs]

    for k in range(1, n_harmonics + 1):
        # Projection onto cos and sin of the k-th harmonic.
        cos_sum = sum(v * math.cos(k * 2.0 * math.pi * h / 24.0)
                      for h, v in zip((p[0] for p in pairs), residual))
        sin_sum = sum(v * math.sin(k * 2.0 * math.pi * h / 24.0)
                      for h, v in zip((p[0] for p in pairs), residual))
        # Normalizing by n/2 is the orthogonal-basis result.
        a = 2.0 * cos_sum / n
        b = 2.0 * sin_sum / n
        harmonics.append((a, b))
        # Remove this harmonic before fitting the next, so an uneven sample
        # does not let them fight over the same variance.
        residual = [
            r - (a * math.cos(k * 2.0 * math.pi * h / 24.0)
                 + b * math.sin(k * 2.0 * math.pi * h / 24.0))
            for r, (h, _v) in zip(residual, pairs)
        ]

    return Climatology(mean_value=m, harmonics=harmonics, sample_count=n,
                       residual_stdev=stdev(residual))


def fit_circular_climatology(samples) -> Climatology | None:
    """Climatology for a direction, fitted on the unwrapped series.

    Wind direction has a real daily cycle at many sites - a valley that drains
    downslope overnight and reverses by mid-morning. Fitting it needs the series
    unwrapped first, or every pass through north destroys the fit.
    """
    pairs = [(h, v) for h, v in samples if v is not None]
    if len(pairs) < 24:
        return None
    # Unwrap: keep each successive value within 180 degrees of the previous.
    unwrapped = []
    previous = None
    for h, v in pairs:
        if previous is None:
            unwrapped.append((h, v))
            previous = v
            continue
        delta = (v - previous + 180.0) % 360.0 - 180.0
        value = unwrapped[-1][1] + delta
        unwrapped.append((h, value))
        previous = v
    return fit_climatology(unwrapped, n_harmonics=1)


# ---------------------------------------------------------------------------
#  Anomaly persistence
# ---------------------------------------------------------------------------

def efolding_hours(anomalies, max_lag: int = 48) -> float:
    """Hours for an anomaly to decay to 1/e, from the series' autocorrelation.

    Measured rather than assumed, because it is a property of the site and the
    season: a coastal site returns to its climatology far faster than a
    continental one under a stable high. Falls back to 12 hours when the series
    is too short to say, which is a middling value for temperature.
    """
    vals = [a for a in anomalies if a is not None]
    if len(vals) < 24:
        return 12.0
    m = sum(vals) / len(vals)
    centered = [v - m for v in vals]
    denom = sum(v * v for v in centered)
    if denom <= 0:
        return 12.0

    target = 1.0 / math.e
    previous = 1.0
    for lag in range(1, min(max_lag, len(centered) - 1)):
        num = sum(centered[i] * centered[i + lag]
                  for i in range(len(centered) - lag))
        rho = num / denom
        if rho <= target:
            # Interpolate between the bracketing lags for a smoother estimate.
            if previous == rho:
                return float(lag)
            frac = (previous - target) / (previous - rho)
            return max(1.0, (lag - 1) + frac)
        previous = rho
    return float(min(max_lag, 24))


def damped_anomaly(current_anomaly: float, lead_hours: float,
                   efold: float) -> float:
    """Decay an anomaly exponentially with lead time."""
    if current_anomaly is None:
        return 0.0
    if efold <= 0:
        return 0.0
    return current_anomaly * math.exp(-lead_hours / efold)


# ---------------------------------------------------------------------------
#  Analog ensemble
# ---------------------------------------------------------------------------

# Which variables define "a similar situation", and how much each counts.
# Pressure tendency matters more than pressure itself for what happens next,
# and is included via the trajectory rather than as a separate term.
ANALOG_WEIGHTS = {
    "temperature": 1.0,
    "dew_point": 0.8,
    "pressure": 0.9,
    "wind_speed": 0.5,
    "solar_radiation": 0.4,
}

# Hours of recent history compared when judging similarity.
ANALOG_TRAJECTORY_HOURS = 6


@dataclass
class AnalogMatch:
    """One past moment judged similar to now."""

    index: int
    timestamp: datetime
    distance: float


def find_analogs(series, variables, now_index: int, k: int = 15,
                 trajectory_hours: int = ANALOG_TRAJECTORY_HOURS,
                 horizon_hours: int = 48,
                 exclude_hours: int = 36) -> list:
    """Find the k past moments whose recent trajectory most resembles `now`.

    `series` is the hourly record, `variables` the per-variable value lists.

    Two rules that matter:
      - A candidate must have `horizon_hours` of record after it, or there is
        nothing to learn from it.
      - Candidates within `exclude_hours` of now are skipped. The hours either
        side of now are trivially similar to now and would fill the ensemble
        with the present, collapsing the spread to nothing and making the
        forecast look far more certain than it is.
    """
    if now_index < trajectory_hours:
        return []

    # Normalize each variable by its own spread, so a 5 hPa pressure difference
    # and a 5 degree temperature difference are not treated as equally unusual.
    scales = {}
    for name in variables:
        if name not in ANALOG_WEIGHTS:
            continue
        s = stdev(variables[name])
        scales[name] = s if s and s > 1e-6 else None

    matches = []
    last_usable = len(series) - horizon_hours
    for i in range(trajectory_hours, last_usable):
        if abs(i - now_index) <= exclude_hours:
            continue
        total = 0.0
        weight_used = 0.0
        for name, weight in ANALOG_WEIGHTS.items():
            scale = scales.get(name)
            if scale is None:
                continue
            values = variables.get(name)
            if not values:
                continue
            diff_sq = 0.0
            counted = 0
            for back in range(trajectory_hours):
                a = values[now_index - back]
                b = values[i - back]
                if a is None or b is None:
                    continue
                # Recent hours count for more than older ones.
                recency = 1.0 - (back / (trajectory_hours * 1.5))
                diff_sq += recency * ((a - b) / scale) ** 2
                counted += 1
            if counted:
                total += weight * (diff_sq / counted)
                weight_used += weight
        if weight_used <= 0:
            continue
        matches.append(AnalogMatch(index=i, timestamp=series[i],
                                   distance=math.sqrt(total / weight_used)))

    matches.sort(key=lambda m: m.distance)
    return matches[:k]


# ---------------------------------------------------------------------------
#  Blending
# ---------------------------------------------------------------------------

def persistence_weight(lead_hours: float, efold: float) -> float:
    """How much to trust "it will stay like this" at a given lead time.

    Follows the same exponential as the anomaly decay, so the two are consistent:
    when the anomaly has decayed away there is nothing left to persist.
    """
    if efold <= 0:
        return 0.0
    return math.exp(-lead_hours / max(efold, 1.0))


@dataclass
class ForecastPoint:
    """One hour of forecast for one variable."""

    valid_at: datetime
    lead_hours: float
    value: float | None
    p10: float | None = None
    p90: float | None = None
    # Which components contributed, for the "how was this made" panel.
    sources: dict = field(default_factory=dict)


# Ceiling on how much of the background a model may claim, and the ceiling on
# the analog ensemble once a model is present.
#
# NWP_MAX_WEIGHT is not 1.0 on purpose. Even a good 3 km model carries a
# systematic error at a specific mast that the station's own record knows about,
# so the site's climatology keeps a stake in the background at every lead time.
NWP_MAX_WEIGHT = 0.70
# With a model in play the analogs are the weaker mid-range guide, but they are
# still the only source of spread, so their weight is trimmed rather than cut.
ANALOG_MAX_WEIGHT_WITH_NWP = 0.40
ANALOG_MAX_WEIGHT_NO_NWP = 0.60


def blend_forecast(variable: str, valid_at: datetime, lead_hours: float,
                   climatology_value: float | None,
                   current_anomaly: float | None,
                   efold: float,
                   analog_values: list | None,
                   nwp_value: float | None = None,
                   nwp_bias: float | None = None) -> ForecastPoint:
    """Combine climatology, damped persistence, the analog ensemble and NWP.

    The analog ensemble supplies the spread. Where there are too few analogs to
    say anything about spread, the climatological residual is used instead, and
    the caller is told the spread is weaker by the absence of p10/p90.

    THE MODEL BACKGROUND

    `nwp_value` is a model's value for this valid time, already in canonical
    units, and it is optional: with it None this function behaves exactly as it
    did before, which keeps station-history-only the default.

    `nwp_bias` is the station's observed value minus the model's value for the
    same recent moment. That single number is the downscaling: it is what the
    3 to 13 km grid cell cannot know about a mast in a hollow, behind a
    treeline, or on a north slope. It is decayed with the same e-folding time as
    the persistence term, because a bias measured an hour ago is good evidence
    about the next hour and progressively weaker evidence after that.

    The model earns weight as persistence fades. At very short lead the
    observation is nearly the truth and nothing beats persistence; by a day out
    the model is the only component that knows a front is coming, while the
    climatology only knows what a typical day looks like.
    """
    is_circular = VARIABLE_RULES.get(variable, {}).get("circular", False)

    if climatology_value is None:
        # No fitted climatology. A model background can still carry the
        # forecast on its own, which matters for a newly commissioned station
        # with too little history to fit anything.
        if nwp_value is not None:
            value = nwp_value + damped_anomaly(nwp_bias or 0.0,
                                               lead_hours, efold)
            return ForecastPoint(valid_at=valid_at, lead_hours=lead_hours,
                                 value=value, sources={"nwp": 1.0})
        if analog_values:
            center = (circular_mean(analog_values) if is_circular
                      else median(analog_values))
            return ForecastPoint(
                valid_at=valid_at, lead_hours=lead_hours,
                value=center,
                p10=None if is_circular else percentile(analog_values, 10),
                p90=None if is_circular else percentile(analog_values, 90),
                sources={"analog": 1.0})
        return ForecastPoint(valid_at=valid_at, lead_hours=lead_hours,
                             value=None, sources={})

    w_persist = persistence_weight(lead_hours, efold)
    clim_background = climatology_value + damped_anomaly(
        current_anomaly or 0.0, lead_hours, efold)

    # --- background: climatology, optionally blended with the model ---
    if nwp_value is None:
        background = clim_background
        w_nwp = 0.0
    else:
        nwp_background = nwp_value + damped_anomaly(nwp_bias or 0.0,
                                                    lead_hours, efold)
        w_nwp = NWP_MAX_WEIGHT * (1.0 - w_persist)
        background = _mix(clim_background, nwp_background, w_nwp, is_circular)

    analog_centre = None
    if analog_values:
        analog_centre = (circular_mean(analog_values) if is_circular
                         else median(analog_values))

    if analog_centre is None:
        return ForecastPoint(
            valid_at=valid_at, lead_hours=lead_hours, value=background,
            sources=_sources(w_persist, w_nwp, 0.0))

    # The analog ensemble earns more weight as persistence fades, because that
    # is the range where "what happened on days like this" is the better guide.
    cap = (ANALOG_MAX_WEIGHT_WITH_NWP if nwp_value is not None
           else ANALOG_MAX_WEIGHT_NO_NWP)
    w_analog = min(cap, 0.25 + 0.35 * (1.0 - w_persist))
    value = _mix(background, analog_centre, w_analog, is_circular)

    # A direction has no meaningful percentile, so no interval is offered for
    # it rather than printing one that reads as certainty about a wrapped axis.
    if is_circular:
        return ForecastPoint(
            valid_at=valid_at, lead_hours=lead_hours, value=value % 360.0,
            sources=_sources(w_persist, w_nwp, w_analog))

    # Center the ensemble spread on the blended value rather than on the analog
    # median, or the interval can exclude the forecast it is supposed to bracket.
    p10_raw = percentile(analog_values, 10)
    p90_raw = percentile(analog_values, 90)
    offset = value - analog_centre
    p10 = p10_raw + offset if p10_raw is not None else None
    p90 = p90_raw + offset if p90_raw is not None else None

    return ForecastPoint(
        valid_at=valid_at, lead_hours=lead_hours, value=value,
        p10=p10, p90=p90,
        sources=_sources(w_persist, w_nwp, w_analog))


def _mix(a: float, b: float, weight_b: float, circular: bool) -> float:
    """Weighted blend of two values, respecting a wrapped axis.

    Linear interpolation is wrong for a direction: 350 and 10 degrees average to
    180, pointing south when both inputs point north. Directions are therefore
    mixed as vectors. Everything else is a plain linear mix.
    """
    if not circular:
        return (1.0 - weight_b) * a + weight_b * b
    ar = math.radians(a)
    br = math.radians(b)
    x = (1.0 - weight_b) * math.cos(ar) + weight_b * math.cos(br)
    y = (1.0 - weight_b) * math.sin(ar) + weight_b * math.sin(br)
    if abs(x) < 1e-12 and abs(y) < 1e-12:
        # Exactly opposing directions with equal weight: no defensible answer,
        # so keep the first rather than inventing one.
        return a % 360.0
    return math.degrees(math.atan2(y, x)) % 360.0


def _sources(w_persist: float, w_nwp: float, w_analog: float) -> dict:
    """Attribution for the "how was this made" panel.

    The weights are reported as fractions of the final value so they sum to 1,
    which is the only form in which they are readable to a non-specialist.
    """
    background_share = 1.0 - w_analog
    clim_and_persist = background_share * (1.0 - w_nwp)
    out = {
        "climatology": clim_and_persist * (1.0 - w_persist),
        "persistence": clim_and_persist * w_persist,
    }
    if w_nwp > 0.0:
        out["nwp"] = background_share * w_nwp
    if w_analog > 0.0:
        out["analog"] = w_analog
    return {k: v for k, v in out.items() if v > 1e-9}


def clip_to_physical_range(variable: str, value: float | None):
    """Keep a blended value inside what the variable can physically be.

    Blending can put humidity at 103% or wind at -2 km/h, which is obviously
    wrong and undermines trust in everything else on the page.
    """
    if value is None:
        return None
    rules = VARIABLE_RULES.get(variable, {})
    bounds = rules.get("bounded")
    if not bounds:
        return value
    lo, hi = bounds
    return max(lo, min(hi, value))
