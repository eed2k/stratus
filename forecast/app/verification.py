"""Score stored forecasts against the observations that later arrived.

WHY A SKILL SCORE AND NOT JUST AN ERROR

  "Mean absolute error 1.8 degrees" sounds respectable and means almost nothing
  on its own. The question that matters is whether the forecast beats the free
  alternatives, and there are two of those:

    persistence   assume nothing changes from the base hour. Very hard to beat
                  in the first few hours, and the honest benchmark at short lead.
    climatology   assume the site does what it usually does at this hour. Hard
                  to beat at long lead, and the honest benchmark there.

  A skill score is the fractional improvement over a baseline:

      skill = 1 - MAE_forecast / MAE_baseline

  Positive means better than the baseline, zero means no better, negative means
  worse. Reporting the negative case plainly is the point of doing this at all:
  a forecast that loses to persistence at 6 hours needs to be known about, not
  averaged away.

WHY THE INTERVAL IS CHECKED TOO

  The p10 to p90 band claims to contain the truth 80% of the time. If it
  actually contains it 40% of the time the forecast is overconfident and the
  band is worse than no band, because someone will plan around it. Coverage is
  measured and shown next to the errors.

DIRECTIONS ARE SCORED ON A CIRCLE

  A forecast of 350 degrees against an observation of 10 is a 20 degree error,
  not 340. Every error here goes through the angular difference for circular
  variables, or wind direction would look catastrophically bad at random.
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field

from . import engine
from . import thermo
from .db import Database, from_db

# Lead-time buckets, in hours, matching the 1/3/5 day horizons the interface
# offers so the table reads the same way the forecast does.
DAY_BUCKETS = (
    ("Day 1", 1, 24),
    ("Day 2", 25, 48),
    ("Day 3", 49, 72),
    ("Day 4", 73, 96),
    ("Day 5", 97, 120),
)


def _error(variable: str, forecast: float, observed: float) -> float:
    """Signed error, forecast minus observed, on the right kind of axis.

    Signed, not absolute. The mean of these is the bias, and an absolute
    difference would make the bias equal the mean absolute error for every
    direction variable, which reads as a huge systematic veer that does not
    exist.
    """
    if engine.VARIABLE_RULES.get(variable, {}).get("circular"):
        return engine.signed_angular_difference(forecast, observed)
    return forecast - observed


@dataclass
class Score:
    """Verification statistics for one variable in one lead bucket."""

    variable: str
    bucket: str
    lead_from: int
    lead_to: int
    n: int = 0
    mae: float | None = None
    bias: float | None = None
    rmse: float | None = None
    mae_persistence: float | None = None
    mae_climatology: float | None = None
    skill_vs_persistence: float | None = None
    skill_vs_climatology: float | None = None
    interval_coverage_pct: float | None = None
    interval_n: int = 0

    @property
    def beats_persistence(self) -> bool | None:
        if self.skill_vs_persistence is None:
            return None
        return self.skill_vs_persistence > 0.0

    @property
    def beats_climatology(self) -> bool | None:
        if self.skill_vs_climatology is None:
            return None
        return self.skill_vs_climatology > 0.0

    @property
    def verdict(self) -> str:
        """One plain sentence, because a table of numbers is not a conclusion."""
        if self.n == 0:
            return "Nothing scored yet."
        parts = []
        if self.skill_vs_persistence is not None:
            pct = abs(self.skill_vs_persistence) * 100.0
            if self.skill_vs_persistence > 0.02:
                parts.append(f"{pct:.0f}% better than persistence")
            elif self.skill_vs_persistence < -0.02:
                parts.append(f"{pct:.0f}% WORSE than persistence")
            else:
                parts.append("no better than persistence")
        if self.skill_vs_climatology is not None:
            pct = abs(self.skill_vs_climatology) * 100.0
            if self.skill_vs_climatology > 0.02:
                parts.append(f"{pct:.0f}% better than climatology")
            elif self.skill_vs_climatology < -0.02:
                parts.append(f"{pct:.0f}% WORSE than climatology")
            else:
                parts.append("no better than climatology")
        return ", ".join(parts) if parts else "No baseline to compare against."


@dataclass
class VerificationReport:
    station_id: int
    horizon_hours: int | None = None
    pairs_scored: int = 0
    variables: list[str] = field(default_factory=list)
    scores: list[Score] = field(default_factory=list)
    #: Rolling series per variable, for the error-over-time chart.
    timeline: dict[str, list[dict]] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def by_variable(self, variable: str) -> list[Score]:
        return [s for s in self.scores if s.variable == variable]

    def headline(self, variable: str = "temperature") -> Score | None:
        """Day 1 for the named variable: the number to lead with."""
        for s in self.scores:
            if s.variable == variable and s.bucket == "Day 1":
                return s
        return None


def _summarize(variable: str, bucket: str, lo: int, hi: int,
               rows: list[dict]) -> Score:
    score = Score(variable=variable, bucket=bucket, lead_from=lo, lead_to=hi)
    if not rows:
        return score

    errors, p_errors, c_errors = [], [], []
    inside = 0
    interval_n = 0

    for r in rows:
        observed = r["observed"]
        err = _error(variable, r["forecast"], observed)
        errors.append(err)

        if r.get("persistence") is not None:
            p_errors.append(_error(variable, r["persistence"], observed))
        if r.get("climatology") is not None:
            c_errors.append(_error(variable, r["climatology"], observed))

        p10, p90 = r.get("p10"), r.get("p90")
        if p10 is not None and p90 is not None and p90 >= p10:
            interval_n += 1
            if p10 <= observed <= p90:
                inside += 1

    n = len(errors)
    score.n = n
    score.mae = sum(abs(e) for e in errors) / n
    score.bias = sum(errors) / n
    score.rmse = math.sqrt(sum(e * e for e in errors) / n)

    if p_errors:
        score.mae_persistence = sum(abs(e) for e in p_errors) / len(p_errors)
        if score.mae_persistence > 1e-9:
            score.skill_vs_persistence = 1.0 - score.mae / score.mae_persistence
    if c_errors:
        score.mae_climatology = sum(abs(e) for e in c_errors) / len(c_errors)
        if score.mae_climatology > 1e-9:
            score.skill_vs_climatology = 1.0 - score.mae / score.mae_climatology

    score.interval_n = interval_n
    if interval_n:
        score.interval_coverage_pct = 100.0 * inside / interval_n
    return score


def verify(db: Database, station_id: int, variable: str | None = None,
           horizon_hours: int | None = None) -> VerificationReport:
    """Build the verification report for a station.

    Only forecast points whose valid time has both passed and been uploaded
    appear here, so the report fills in as observations arrive. A station whose
    forecasts are all still in the future produces an empty report, which is the
    correct answer rather than an error.
    """
    pairs = db.matched_pairs(station_id, variable=variable,
                             horizon_hours=horizon_hours)
    report = VerificationReport(station_id=station_id,
                                horizon_hours=horizon_hours,
                                pairs_scored=len(pairs))
    if not pairs:
        report.notes.append(
            "Nothing to score yet. A forecast can only be checked once the "
            "hour it predicted has passed and the observations covering it "
            "have been uploaded. Use the backfill option to score the record "
            "you already hold.")
        return report

    variables = sorted({r["variable"] for r in pairs})
    report.variables = variables

    for var in variables:
        var_rows = [r for r in pairs if r["variable"] == var]
        for bucket, lo, hi in DAY_BUCKETS:
            in_bucket = [r for r in var_rows
                         if lo <= r["lead_hours"] <= hi]
            if not in_bucket:
                continue
            report.scores.append(_summarize(var, bucket, lo, hi, in_bucket))

        # Rolling daily error, so a drift or a sensor failure shows up as a
        # trend rather than being buried in an all-time average.
        by_day: dict[str, list[float]] = {}
        for r in var_rows:
            day = str(r["valid_at"])[:10]
            by_day.setdefault(day, []).append(
                abs(_error(var, r["forecast"], r["observed"])))
        report.timeline[var] = [
            {"date": day, "mae": sum(v) / len(v), "n": len(v)}
            for day, v in sorted(by_day.items())
        ]

    overconfident = [s for s in report.scores
                     if s.interval_coverage_pct is not None
                     and s.interval_n >= 20
                     and s.interval_coverage_pct < 60.0]
    if overconfident:
        names = ", ".join(sorted({f"{s.variable} {s.bucket}"
                                  for s in overconfident}))
        report.notes.append(
            f"The confidence band is too narrow for: {names}. It claims to "
            f"contain the observation 80% of the time. Treat the band as "
            f"indicative only.")

    losing = [s for s in report.scores
              if s.beats_persistence is False and s.n >= 20]
    if losing:
        names = ", ".join(sorted({f"{s.variable} {s.bucket}"
                                  for s in losing}))
        report.notes.append(
            f"Worse than simple persistence for: {names}. At short lead times "
            f"this is common and expected; if it holds at Day 2 and beyond, the "
            f"training window is probably too short.")

    return report


def summary_table(report: VerificationReport) -> list[dict]:
    """Flatten the report for rendering, rounded for display."""
    def r(x, places=2):
        return None if x is None else round(x, places)

    return [{
        "variable": s.variable,
        "bucket": s.bucket,
        "n": s.n,
        "mae": r(s.mae),
        "bias": r(s.bias),
        "rmse": r(s.rmse),
        "mae_persistence": r(s.mae_persistence),
        "mae_climatology": r(s.mae_climatology),
        "skill_vs_persistence": r(s.skill_vs_persistence, 3),
        "skill_vs_climatology": r(s.skill_vs_climatology, 3),
        "interval_coverage_pct": r(s.interval_coverage_pct, 1),
        "verdict": s.verdict,
    } for s in report.scores]


# ===========================================================================
#  Probabilistic verification
#
#  The deterministic scores above answer "how close was the middle of the
#  forecast". These answer the two questions an ensemble raises instead: is the
#  whole distribution any good (CRPS), and is it honest about its own spread
#  (rank histogram, reliability diagram). The reliability diagram is what makes
#  the single frost probability the interface presents checkable, which is the
#  reason that probability is the ensemble one and not the heuristic score.
# ===========================================================================

#: Ranks below this many scored pairs are too few to read anything into, so the
#: rank histogram says so rather than inviting a story about four samples.
MIN_PAIRS_FOR_HISTOGRAM = 20

#: How ties are broken when an observation exactly equals one or more ensemble
#: members. Stated as a constant because an unstated rule makes a rank histogram
#: unreproducible: two implementations disagree on the shape and neither is
#: wrong. The rule here places the observation ABOVE any equal member, so the
#: rank is the count of members at or below the observation.
TIE_RULE = "observation ranked above an equal member"


def crps(members, observed: float | None) -> float | None:
    """Continuous ranked probability score for one ensemble forecast.

    The exact ensemble form (Hersbach, 2000):

        CRPS = mean|x_i - y| - (1 / 2n^2) * sum_i sum_j |x_i - x_j|

    Lower is better, and it is in the units of the variable, which is what makes
    it comparable with the mean absolute error above. For a single-member
    ensemble the second term vanishes and CRPS is exactly the absolute error;
    that reduction is the check that this is implemented correctly, and it is
    asserted in the tests.
    """
    values = [float(m) for m in (members or ())
              if m is not None and not isinstance(m, bool)]
    if not values or observed is None:
        return None
    n = len(values)
    term1 = sum(abs(x - observed) for x in values) / n
    spread = 0.0
    for x in values:
        for y in values:
            spread += abs(x - y)
    term2 = spread / (2.0 * n * n)
    return term1 - term2


def mean_crps(pairs, decode=None) -> tuple[float | None, int]:
    """Mean CRPS over scored pairs, and how many carried an ensemble.

    `pairs` are rows from `Database.matched_pairs`; `decode` is the members
    decoder, normally `Database.decode_members`. Rows without members are
    skipped rather than counted as perfect, so the sample size is reported.
    """
    decode = decode or Database.decode_members
    scores = []
    for r in pairs or ():
        members = decode(r.get("members"))
        value = crps(members, r.get("observed"))
        if value is not None:
            scores.append(value)
    if not scores:
        return None, 0
    return sum(scores) / len(scores), len(scores)


@dataclass
class RankHistogram:
    """Where the observation falls inside the ensemble, over many forecasts.

    A flat histogram means the spread is about right. A U shape means the
    ensemble is too narrow, the common failure: the truth keeps landing outside
    it. A dome means it is too wide. Bins are one more than the member count,
    because the observation can fall below every member or above every member.
    """

    counts: list[int]
    pairs: int
    members: int
    tie_rule: str = TIE_RULE
    note: str = ""

    @property
    def shape(self) -> str:
        """Flat, U or dome, judged against the count a flat histogram expects.

        The comparison is against the mean bin count rather than against the end
        bins' share of the total. Share-based thresholds look reasonable and are
        not: with four bins the end bins' fair share is already one half, so any
        multiplier above two is unreachable and a perfect U would be reported as
        flat. Comparing each end bin to the expected count works for any number
        of members and is symmetric between the two failure modes.
        """
        if self.pairs < MIN_PAIRS_FOR_HISTOGRAM or not self.counts:
            return "too few forecasts to read"
        n = len(self.counts)
        expected = self.pairs / n
        if expected <= 0:
            return "too few forecasts to read"
        end_mean = (self.counts[0] + self.counts[-1]) / 2.0
        if end_mean > 1.5 * expected:
            return "under-dispersed: the ensemble is too narrow"
        if end_mean < 0.5 * expected:
            return "over-dispersed: the ensemble is too wide"
        return "well calibrated spread"


def rank_of(members, observed: float | None) -> int | None:
    """The observation's rank inside a sorted ensemble, 0 to len(members).

    Ties follow TIE_RULE: the observation sits above any member equal to it, so
    the rank counts members at or below it.
    """
    values = [float(m) for m in (members or ()) if m is not None]
    if not values or observed is None:
        return None
    return sum(1 for v in values if v <= observed)


def rank_histogram(pairs, decode=None) -> RankHistogram | None:
    """Rank histogram over scored pairs.

    Only pairs whose ensembles are all the same size are counted, because a
    histogram over mixed member counts has no consistent bin meaning. The
    dominant size is used and the rest are reported as skipped.
    """
    decode = decode or Database.decode_members
    ensembles = []
    for r in pairs or ():
        members = decode(r.get("members"))
        if members and r.get("observed") is not None:
            ensembles.append((members, r["observed"]))
    if not ensembles:
        return None

    sizes: dict[int, int] = {}
    for members, _obs in ensembles:
        sizes[len(members)] = sizes.get(len(members), 0) + 1
    size = max(sizes, key=lambda k: sizes[k])

    counts = [0] * (size + 1)
    used = 0
    for members, obs in ensembles:
        if len(members) != size:
            continue
        rank = rank_of(members, obs)
        if rank is None:
            continue
        counts[rank] += 1
        used += 1

    skipped = len(ensembles) - used
    note = ""
    if skipped:
        note = (f"{skipped} forecast(s) had a different member count and were "
                f"left out, so every bin means the same thing.")
    if used < MIN_PAIRS_FOR_HISTOGRAM:
        note = (note + " " if note else "") + (
            f"Only {used} forecasts scored; at least "
            f"{MIN_PAIRS_FOR_HISTOGRAM} are needed before the shape means "
            f"anything.")
    return RankHistogram(counts=counts, pairs=used, members=size,
                         note=note.strip())


@dataclass
class ReliabilityBin:
    lower: float
    upper: float
    forecast_mean: float
    observed_frequency: float
    n: int

    @property
    def label(self) -> str:
        return f"{self.lower * 100:.0f} to {self.upper * 100:.0f}%"


@dataclass
class Reliability:
    """A reliability diagram plus the Brier score and its decomposition.

    Perfect reliability is observed frequency equal to forecast probability in
    every bin, the diagonal. Above the diagonal means the event happened more
    often than forecast (under-forecasting), below means it happened less
    (over-forecasting, the more dangerous direction for a frost warning).
    """

    bins: list = field(default_factory=list)
    n: int = 0
    brier: float | None = None
    reliability_term: float | None = None
    resolution_term: float | None = None
    uncertainty_term: float | None = None
    base_rate: float | None = None

    @property
    def verdict(self) -> str:
        if self.n < MIN_PAIRS_FOR_HISTOGRAM:
            return (f"Only {self.n} forecast-outcome pairs; too few to judge "
                    f"calibration.")
        if self.reliability_term is None or self.uncertainty_term is None:
            return "Not enough spread in the forecasts to judge calibration."
        if self.uncertainty_term <= 0.0:
            return ("The event never varied over this record, so calibration "
                    "cannot be judged.")
        # Reliability is a penalty: smaller is better, zero is perfect.
        share = self.reliability_term / self.uncertainty_term
        if share < 0.05:
            return "Well calibrated: forecast probabilities match outcomes."
        if share < 0.15:
            return "Roughly calibrated, with some bias in places."
        return ("Poorly calibrated: the stated probabilities do not match how "
                "often the event happened.")


def reliability(forecasts, outcomes, bins: int = 10) -> Reliability | None:
    """Bin forecast probabilities against observed outcome frequencies.

    `forecasts` are probabilities in 0 to 1; `outcomes` are the matching
    booleans, True when the event happened. Also returns the Brier score and the
    Murphy (1973) decomposition into reliability, resolution and uncertainty,
    where Brier = reliability - resolution + uncertainty.
    """
    pairs = []
    for p, o in zip(forecasts or (), outcomes or ()):
        if p is None or o is None:
            continue
        try:
            prob = float(p)
        except (TypeError, ValueError):
            continue
        if not 0.0 <= prob <= 1.0:
            continue
        pairs.append((prob, 1.0 if o else 0.0))
    if not pairs or bins < 2:
        return None

    n = len(pairs)
    base_rate = sum(o for _p, o in pairs) / n
    brier = sum((p - o) ** 2 for p, o in pairs) / n

    width = 1.0 / bins
    out_bins = []
    reliability_term = 0.0
    resolution_term = 0.0
    for i in range(bins):
        lo = i * width
        hi = (i + 1) * width
        # The top bin includes 1.0 so a confident forecast is not discarded.
        if i == bins - 1:
            members = [(p, o) for p, o in pairs if lo <= p <= hi]
        else:
            members = [(p, o) for p, o in pairs if lo <= p < hi]
        if not members:
            continue
        k = len(members)
        f_mean = sum(p for p, _o in members) / k
        o_freq = sum(o for _p, o in members) / k
        out_bins.append(ReliabilityBin(lower=lo, upper=hi, forecast_mean=f_mean,
                                       observed_frequency=o_freq, n=k))
        reliability_term += k * (f_mean - o_freq) ** 2
        resolution_term += k * (o_freq - base_rate) ** 2

    reliability_term /= n
    resolution_term /= n
    uncertainty_term = base_rate * (1.0 - base_rate)

    return Reliability(bins=out_bins, n=n, brier=brier,
                       reliability_term=reliability_term,
                       resolution_term=resolution_term,
                       uncertainty_term=uncertainty_term,
                       base_rate=base_rate)


# ===========================================================================
#  Method version
# ===========================================================================

#: Every module-level constant in engine.py that this version hash accounts for.
#: The test that guards this asserts engine.py has no module-level constant
#: outside this set, so adding one forces a deliberate decision about whether it
#: changes the forecast method.
KNOWN_ENGINE_CONSTANTS = frozenset({
    "HOUR",                       # a unit, not a tuning choice
    "VARIABLE_RULES",
    "ANALOG_WEIGHTS",
    "ANALOG_TRAJECTORY_HOURS",
    "NWP_MAX_WEIGHT",
    "ANALOG_MAX_WEIGHT_WITH_NWP",
    "ANALOG_MAX_WEIGHT_NO_NWP",
})

#: Constants that actually change the numbers a forecast produces. HOUR is
#: excluded deliberately: it is the definition of an hour, not a choice.
_VERSIONED_CONSTANTS = (
    "VARIABLE_RULES",
    "ANALOG_WEIGHTS",
    "ANALOG_TRAJECTORY_HOURS",
    "NWP_MAX_WEIGHT",
    "ANALOG_MAX_WEIGHT_WITH_NWP",
    "ANALOG_MAX_WEIGHT_NO_NWP",
)

_VERSIONED_FORECASTING_CONSTANTS = (
    "DEFAULT_HISTORY_DAYS",
    "MIN_HOURS_FOR_CLIMATOLOGY",
    "MIN_HOURS_FOR_ANALOGS",
)


def _canonical(value) -> str:
    """A stable string for a constant, so dict ordering cannot change the hash."""
    if isinstance(value, dict):
        inner = ",".join(f"{k!r}:{_canonical(value[k])}"
                         for k in sorted(value, key=repr))
        return "{" + inner + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical(v) for v in value) + "]"
    if isinstance(value, (set, frozenset)):
        return "{" + ",".join(sorted(_canonical(v) for v in value)) + "}"
    return repr(value)


def method_version() -> str:
    """A short hash of the forecast method's tuning constants.

    Stamped on every run so a change of method is visible in the verification
    history instead of silently mixing two methods into one average.

    It hashes an explicit, named tuple of constants rather than the source files
    on purpose: hashing sources would make a comment or a docstring edit look
    like a new forecast method and would invalidate every historical comparison,
    which is exactly the trend this is meant to protect.
    """
    from . import forecasting

    parts = []
    for name in _VERSIONED_CONSTANTS:
        parts.append(f"engine.{name}={_canonical(getattr(engine, name))}")
    for name in _VERSIONED_FORECASTING_CONSTANTS:
        parts.append(
            f"forecasting.{name}={_canonical(getattr(forecasting, name))}")
    blob = ";".join(parts).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:12]


# ===========================================================================
#  Solar model validation, as a hindcast
# ===========================================================================

@dataclass
class Residual:
    """How far a modeled quantity sat from the measured one."""

    quantity: str
    unit: str
    n: int
    mae: float | None
    bias: float | None
    rmse: float | None

    @property
    def verdict(self) -> str:
        if not self.n:
            return "Not measured at this station."
        if self.bias is None or self.mae is None:
            return "Too few paired samples to judge."
        direction = "over" if self.bias > 0 else "under"
        return (f"Modeled {self.quantity} runs {direction} the measurement by "
                f"{abs(self.bias):.1f} {self.unit} on average, with a typical "
                f"error of {self.mae:.1f} {self.unit} over {self.n} hours.")


@dataclass
class SolarValidation:
    """Solar model residuals against measurement.

    This is a HINDCAST, not forecast verification, and the distinction is the
    point. The models are driven by OBSERVED irradiance, air temperature and
    wind, so what is measured here is the error of the photovoltaic model alone.
    Feeding it forecast weather instead would mix two different errors and make
    a bad solar page impossible to attribute.

    Cell temperature and DC yield are deliberately NOT forecast variables: the
    engine is out of scope, and `matched_pairs` joins on variable, so making them
    forecast variables would have been the wrong shape entirely.
    """

    residuals: list = field(default_factory=list)
    hours_available: int = 0
    label: str = "Model hindcast against measurement, not forecast skill"
    notes: list = field(default_factory=list)


def _residual(quantity: str, unit: str, modeled, measured) -> Residual:
    errors = [m - o for m, o in zip(modeled, measured)
              if m is not None and o is not None]
    if not errors:
        return Residual(quantity=quantity, unit=unit, n=0, mae=None, bias=None,
                        rmse=None)
    n = len(errors)
    return Residual(
        quantity=quantity, unit=unit, n=n,
        mae=sum(abs(e) for e in errors) / n,
        bias=sum(errors) / n,
        rmse=math.sqrt(sum(e * e for e in errors) / n))


def validate_solar_model(db: Database, station_id: int,
                         rated_w: float | None = None,
                         tilt_deg: float | None = None,
                         surface_azimuth_deg: float | None = None
                         ) -> SolarValidation | None:
    """Score the cell-temperature and DC-yield models against measurement.

    Runs only where a station actually reports `moduleTemperature` or
    `mpptSolarPower`. Without those channels there is nothing to validate
    against, and the honest answer is None rather than a page of zeros.
    """
    from . import solar

    station = db.get_station(station_id)
    if station is None:
        return None

    available = set(db.station_variables(station_id))
    has_module = "moduleTemperature" in available
    has_power = "mpptSolarPower" in available
    if not (has_module or has_power):
        return None

    def as_map(variable):
        return {t: v for t, v in db.series(station_id, variable)}

    ghi = as_map("solar_radiation")
    temp = as_map("temperature")
    wind = as_map("wind_speed")
    press = as_map("pressure")
    module_obs = as_map("moduleTemperature") if has_module else {}
    power_obs = as_map("mpptSolarPower") if has_power else {}

    result = SolarValidation()
    if not ghi or not temp:
        result.notes.append(
            "Irradiance and air temperature observations are both needed to "
            "drive the model; one of them is missing.")
        return result

    use_tilt = tilt_deg
    use_azimuth = surface_azimuth_deg
    if (use_tilt is None or use_azimuth is None) and station.latitude is not None:
        orientation = solar.optimal_fixed_orientation(station.latitude)
        if orientation:
            if use_tilt is None:
                use_tilt = orientation[0]
            if use_azimuth is None:
                use_azimuth = orientation[1]
    if use_tilt is None:
        use_tilt, use_azimuth = 0.0, 0.0
        result.notes.append(
            "The station has no coordinates, so the model was run on the "
            "horizontal plane rather than a tilted one.")

    modeled_module, measured_module = [], []
    modeled_power, measured_power = [], []
    hours = 0

    for when in sorted(set(ghi) & set(temp)):
        g, t = ghi[when], temp[when]
        w = wind.get(when)
        p = press.get(when)
        w_ms = w * thermo.KMH_TO_MS if w is not None else None

        poa_eff = g
        if station.latitude is not None and station.longitude is not None:
            pos = solar.solar_position(when, station.latitude,
                                       station.longitude,
                                       station.utc_offset_hours)
            comp = solar.decompose(g, pos, when)
            poa = solar.plane_of_array(comp, pos, when, use_tilt,
                                       use_azimuth or 0.0)
            if poa is not None:
                poa_eff = poa.effective

        hours += 1
        if when in module_obs:
            modeled = solar.module_temperature(poa_eff, t, w_ms, p)
            if modeled is not None:
                modeled_module.append(modeled)
                measured_module.append(module_obs[when])
        if when in power_obs and rated_w:
            modeled = solar.dc_power(poa_eff, t, w_ms, rated_w, p)
            if modeled is not None:
                modeled_power.append(modeled)
                measured_power.append(power_obs[when])

    result.hours_available = hours
    if has_module:
        result.residuals.append(_residual(
            "module temperature", "C", modeled_module, measured_module))
    if has_power:
        if rated_w:
            result.residuals.append(_residual(
                "DC power", "W", modeled_power, measured_power))
        else:
            result.notes.append(
                "Measured DC power is available but the array rating is not "
                "configured, so modeled power cannot be compared against it.")
    return result
