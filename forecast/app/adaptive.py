"""Adaptive bias correction: the part that learns this specific site.

WHAT PROBLEM THIS SOLVES

  Measured on Quaggasklip's own record, over 2400 scored forecast hours, the
  Day 1 temperature error was 4.04 degrees mean absolute, of which 3.60 degrees
  was a CONSTANT OFFSET: the forecast ran cold, nearly every hour, by nearly the
  same amount. Remove that offset and the same forecasts score 2.39 degrees.
  Pressure was worse in proportion, 98 percent of its error being offset.

  An error that is almost entirely offset is not a hard forecast. It is a
  systematic difference between the place the number describes and the place the
  sensor stands, and it is the one kind of error a station's own record can
  remove outright. That is what this module does.

WHY A DECAYING AVERAGE RATHER THAN A FIT

  The obvious alternative is to regress the forecast onto the observation over a
  long training period. That is rejected for three reasons:

    1. A site's offset is not constant. It moves with season, with soil moisture
       and with vegetation, and a regression over a year averages those into a
       number that is wrong in every individual month.
    2. It needs a training set, a refit schedule and a way to decide when the
       old fit is stale, all of which is machinery to maintain.
    3. It cannot start until the training set exists.

  A decaying average - the standard operational choice, and what national
  centres use for model bias - has none of those problems. It is one number per
  cell, updated once per verified observation, and it forgets at a fixed rate, so
  it tracks a moving offset instead of averaging over it. It also starts
  contributing after a handful of samples rather than after a season.

WHAT IS LEARNED, AND WHY THE KEY LOOKS LIKE THIS

  One bias per (station, variable, provider, lead bucket, hour-of-day bucket).

    station    an offset is a property of a place; nothing is shared between
               sites, because the whole point is that this mast is not the grid
               cell.
    variable   temperature and wind speed are wrong for unrelated reasons.
    provider   a model-backed run and a station-history-only run have different
               systematic errors, so learning them into one number would let a
               backfilled history-only run corrupt the correction applied to a
               live model-backed one.
    lead       error grows with lead time and does so at its own rate per site.
    hour       this is the nano-climate term. A hollow that pools cold air is
               several degrees cold before dawn and correct by mid-afternoon. A
               single daily number would split the difference and be wrong twice
               a day. Six-hour blocks are coarse enough to fill up quickly and
               fine enough to separate night from afternoon.

  A cell with too few samples is not trusted. The lookup falls back to a coarser
  key rather than applying a number built from three observations, and if even
  the coarsest key is thin it declines to correct at all.

WHAT IS DELIBERATELY NOT DONE

  The correction is bounded, and it is never applied to a variable whose error is
  not mostly offset in the first place. Rainfall is excluded outright: its error
  is intermittency, not offset, and shifting every hour by a learned millimetre
  would invent drizzle on dry days and is the classic way this technique is
  misused.

  Nothing here touches the ensemble spread. A corrected mean with an uncorrected
  spread is honest; scaling the spread by a bias statistic is not, and the
  reliability diagram in verification.py is the right instrument for that
  question.

FEEDBACK

  The learner must never read its own output, or the correction compounds and
  runs away. Each stored forecast point carries the correction that was applied
  to it, so the raw value is recoverable, and learning always uses the raw value.
  See db.record_bias_applied and update_from_verified below.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
#  Tuning
# ---------------------------------------------------------------------------

#: How fast the average forgets. 0.08 gives an effective memory of about 25
#: samples, which for one observation per lead hour per day is roughly three
#: weeks of the same time of day: long enough to be stable, short enough to
#: follow a season turning.
LEARNING_RATE = 0.08

#: Below this many samples a cell is not trusted on its own and the lookup falls
#: back to a coarser key. Chosen so a cell must have seen the same hour of the
#: day about a week running before it is allowed to move a forecast.
MIN_SAMPLES = 6

#: Even a coarse fallback needs some evidence.
MIN_SAMPLES_FALLBACK = 12

#: How much of a cell's error must be offset before the offset is removed.
#:
#: Set from measurement, not taste. Over eight months at Quaggasklip the Day 1
#: temperature offset is 4 percent of the error and correcting it made the
#: forecast very slightly worse; the solar radiation offset is 31 percent and
#: correcting it cut the error by 18 percent. A third is the line between the two,
#: and it also has the right shape: as an offset shrinks relative to the scatter,
#: the expected gain from removing it goes to zero while the risk of chasing noise
#: does not.
MIN_OFFSET_SHARE = 0.30

#: Lead-time buckets, in hours. Boundaries follow where the blend itself changes
#: character: persistence owns the first few hours, the model earns most of its
#: weight through the first day, and beyond three days the spread dominates.
LEAD_BUCKETS: tuple[tuple[int, int], ...] = (
    (1, 6), (7, 12), (13, 24), (25, 48), (49, 72), (73, 120),
)

#: Hour-of-day buckets, in station local time. Four six-hour blocks: night,
#: morning, afternoon, evening.
HOUR_BUCKET_SIZE = 6

#: The largest correction that may be applied, per variable, in the variable's
#: own units. A learned offset bigger than this is far more likely to be a data
#: problem - a sensor swap, a units change, a clock error - than a real
#: micro-climate signal, and clamping means such a fault degrades the forecast
#: slightly instead of destroying it.
MAX_CORRECTION: dict[str, float] = {
    "temperature": 6.0,
    "dew_point": 6.0,
    "humidity": 20.0,
    "pressure": 12.0,
    "wind_speed": 8.0,
    "wind_gust": 12.0,
    "wind_direction": 45.0,
    "solar_radiation": 250.0,
}

#: Variables this technique is appropriate for. Rainfall is absent on purpose:
#: see the module docstring.
CORRECTABLE: frozenset[str] = frozenset(MAX_CORRECTION)

#: Physical limits applied after correction, so a correction cannot produce a
#: value that cannot exist. None means unbounded on that side.
VALUE_LIMITS: dict[str, tuple[float | None, float | None]] = {
    "humidity": (0.0, 100.0),
    "wind_speed": (0.0, None),
    "wind_gust": (0.0, None),
    "solar_radiation": (0.0, None),
    "pressure": (300.0, 1100.0),
}


# ---------------------------------------------------------------------------
#  Keys
# ---------------------------------------------------------------------------

def lead_bucket(lead_hours: float) -> str:
    """Name of the lead bucket a lead time falls in.

    Anything past the last boundary is held in the last bucket rather than
    dropped, so a horizon longer than the table still learns something.
    """
    lead = max(1, int(round(lead_hours)))
    for lo, hi in LEAD_BUCKETS:
        if lo <= lead <= hi:
            return f"{lo}-{hi}"
    lo, hi = LEAD_BUCKETS[-1]
    return f"{lo}-{hi}"


def hour_bucket(valid_at: datetime) -> str:
    """Name of the time-of-day block, in station local time."""
    start = (valid_at.hour // HOUR_BUCKET_SIZE) * HOUR_BUCKET_SIZE
    return f"{start:02d}-{start + HOUR_BUCKET_SIZE:02d}"


#: Sentinel used in place of a bucket when a cell is aggregated over it.
ANY = "*"


def _fallback_keys(variable: str, provider: str, lead: str,
                   hour: str) -> list[tuple[str, str, str, str]]:
    """The keys to try, most specific first.

    Dropping the hour before the lead is deliberate. Lead time changes the size of
    the error more than time of day does, so an offset learned across all hours at
    the right lead is a better guess than one learned at the right hour across
    every lead.

    There is deliberately NO all-leads cell. One existed and it was actively
    harmful: it pooled a lead-1 error with a lead-24 error, and lead 24 is several
    times the size, so the pooled figure described neither and was then applied to
    both. It learned a temperature offset of -4.76 for a station whose true mean
    error over the same period was -0.10. A forecast is better off with no
    correction than with one borrowed from a different lead time.
    """
    return [
        (variable, provider, lead, hour),
        (variable, provider, lead, ANY),
    ]


# ---------------------------------------------------------------------------
#  State
# ---------------------------------------------------------------------------

@dataclass
class BiasCell:
    """One learned offset, its typical error size, and its evidence.

    `mae` is carried alongside `bias` because the two together are what decide
    whether correcting is worth doing. A cell whose mean error is 2.3 and whose
    offset is 0.1 has no offset worth removing, and subtracting 0.1 from every
    hour only adds noise. See MIN_OFFSET_SHARE.
    """

    bias: float = 0.0
    mae: float = 0.0
    samples: int = 0

    def update(self, error: float, circular: bool = False,
               abs_error: float | None = None) -> None:
        """Fold one observation of this cell's error into the decaying averages.

        `error` is forecast minus observed, so a positive bias means the forecast
        reads high and the correction subtracts. `abs_error` is the mean ABSOLUTE
        error of the same sample, which is not abs(error) when the caller has
        already averaged several hours together: a run that was 3 high in one hour
        and 3 low in the next has a mean error of 0 and a mean absolute error of 3,
        and conflating them would hide exactly the case where correcting is
        pointless.

        The first sample is taken whole rather than blended toward from zero.
        Starting at zero and creeping toward the truth at the learning rate would
        mean a cell needs dozens of samples before it says anything useful, and
        one observation is better evidence of a site's offset than an assumed
        zero.
        """
        mag = abs(error) if abs_error is None else abs_error
        if self.samples == 0:
            self.bias = error
            self.mae = mag
        elif circular:
            # Average on the circle: adding a scalar to an angle is only valid
            # for the signed difference, which is what `error` already is.
            self.bias = _wrap180(self.bias + LEARNING_RATE
                                 * _wrap180(error - self.bias))
            self.mae = (1.0 - LEARNING_RATE) * self.mae + LEARNING_RATE * mag
        else:
            self.bias = (1.0 - LEARNING_RATE) * self.bias + LEARNING_RATE * error
            self.mae = (1.0 - LEARNING_RATE) * self.mae + LEARNING_RATE * mag
        self.samples += 1

    def worth_correcting(self) -> bool:
        """Whether this cell's offset is a large enough share of its error.

        The guard that was missing, and its absence is what made the first version
        of this module harm five of seven variables. Measured over eight months,
        Quaggasklip's Day 1 temperature forecast has a mean absolute error of 2.31
        and an offset of only 0.10: there is essentially no bias to remove, so a
        corrector can only add noise, and it did. Solar radiation over the same
        period carries an offset of 18.2 against an error of 58.5, and correcting
        that cut the error by 18 percent.

        So the test is not "do we know the offset" but "is the offset a meaningful
        part of what is wrong". A cell that fails it is left alone.
        """
        if self.mae <= 0.0:
            return False
        return abs(self.bias) / self.mae >= MIN_OFFSET_SHARE


@dataclass
class BiasModel:
    """Every learned cell for one station, with lookup and correction."""

    station_id: int
    cells: dict[tuple[str, str, str, str], BiasCell] = field(default_factory=dict)

    # -- learning -------------------------------------------------------

    def observe(self, variable: str, provider: str, lead_hours: float,
                valid_at: datetime, forecast: float, observed: float) -> None:
        """Fold one verified forecast hour into every cell it belongs to.

        Prefer observe_batch where several hours of the same run land in the same
        cell. A decaying average is order-dependent, and folding a run's hours in
        one at a time makes a cell converge on whichever hour happened to be last
        rather than on the run's average. This method is the single-sample case,
        where there is no ordering to get wrong.
        """
        self.observe_batch(variable, provider, lead_hours, valid_at,
                           [(forecast, observed)])

    def observe_batch(self, variable: str, provider: str, lead_hours: float,
                      valid_at: datetime, pairs) -> None:
        """Fold a group of hours that share a cell in as ONE sample.

        This is the fix for a real defect rather than an optimization. Verified
        hours arrive ordered by lead time within a run, so updating a cell once per
        hour left it holding roughly the error of the last hour folded in - which
        was always the longest lead, and therefore the largest error. Measured
        effect: the module learned a temperature offset of -4.76 for a station
        whose actual mean error over the same period was -0.10, and applying it
        made five of seven variables worse.

        Averaging within a group first makes each update order-independent, and a
        run is the natural group: it is one forecast, issued once, and its hours
        are not independent evidence of anything.

        The mean absolute error is carried separately because it is not the
        absolute value of the mean error. A run 3 high in one hour and 3 low in the
        next has zero offset and an error of 3, and only keeping both apart reveals
        that there is nothing to correct.
        """
        if variable not in CORRECTABLE:
            return
        circular = variable == "wind_direction"
        errors = []
        for forecast, observed in pairs:
            errors.append(_wrap180(forecast - observed) if circular
                          else forecast - observed)
        if not errors:
            return
        if circular:
            mean_error = _wrap180(_circular_mean_of_differences(errors))
        else:
            mean_error = sum(errors) / len(errors)
        mean_abs = sum(abs(e) for e in errors) / len(errors)

        lead = lead_bucket(lead_hours)
        hour = hour_bucket(valid_at)
        for key in _fallback_keys(variable, provider, lead, hour):
            self.cells.setdefault(key, BiasCell()).update(
                mean_error, circular, abs_error=mean_abs)

    # -- applying -------------------------------------------------------

    def correction(self, variable: str, provider: str, lead_hours: float,
                   valid_at: datetime) -> float:
        """How much to add to a raw forecast value. Zero when not confident.

        Returns the NEGATIVE of the learned bias: a forecast that has been
        reading 3.6 degrees high is corrected by subtracting 3.6.
        """
        if variable not in CORRECTABLE:
            return 0.0
        lead = lead_bucket(lead_hours)
        hour = hour_bucket(valid_at)
        keys = _fallback_keys(variable, provider, lead, hour)
        for i, key in enumerate(keys):
            cell = self.cells.get(key)
            if cell is None:
                continue
            floor = MIN_SAMPLES if i == 0 else MIN_SAMPLES_FALLBACK
            if cell.samples < floor:
                continue
            # Enough evidence, but is there anything worth correcting? A cell
            # whose offset is a small part of its error is left alone; removing it
            # would trade a known small bias for added scatter.
            if not cell.worth_correcting():
                return 0.0
            limit = MAX_CORRECTION.get(variable, 0.0)
            return max(-limit, min(limit, -cell.bias))
        return 0.0

    def apply(self, variable: str, provider: str, lead_hours: float,
              valid_at: datetime, value: float | None
              ) -> tuple[float | None, float]:
        """Correct one value. Returns (corrected, correction_applied).

        The correction is returned as well as applied because it has to be stored
        with the point: without it the raw value cannot be recovered and the
        learner would end up training on its own output.
        """
        if value is None:
            return None, 0.0
        delta = self.correction(variable, provider, lead_hours, valid_at)
        if delta == 0.0:
            return value, 0.0
        out = value + delta
        if variable == "wind_direction":
            return out % 360.0, delta
        lo, hi = VALUE_LIMITS.get(variable, (None, None))
        if lo is not None:
            out = max(lo, out)
        if hi is not None:
            out = min(hi, out)
        return out, delta

    # -- reporting ------------------------------------------------------

    def summary(self) -> list[dict]:
        """Every trusted cell, for the "how was this made" panel.

        Only cells that would actually be used are listed. A table full of cells
        holding two samples each invites the reader to believe the model knows
        more than it does.
        """
        out = []
        for (variable, provider, lead, hour), cell in sorted(self.cells.items()):
            floor = (MIN_SAMPLES if lead != ANY and hour != ANY
                     else MIN_SAMPLES_FALLBACK)
            if cell.samples < floor:
                continue
            out.append({
                "variable": variable,
                "provider": provider or "station history only",
                "lead_hours": lead,
                "hour_of_day": hour,
                "bias": round(cell.bias, 3),
                "correction": round(-cell.bias, 3),
                "samples": cell.samples,
            })
        return out

    # -- serialization --------------------------------------------------

    def to_rows(self) -> list[tuple]:
        return [(self.station_id, v, p, l, h, c.bias, c.mae, c.samples)
                for (v, p, l, h), c in self.cells.items()]

    @classmethod
    def from_rows(cls, station_id: int, rows) -> "BiasModel":
        model = cls(station_id=station_id)
        for r in rows:
            keys = r.keys()
            model.cells[(r["variable"], r["provider"], r["lead_bucket"],
                         r["hour_bucket"])] = BiasCell(
                bias=float(r["bias"]),
                # A row written before the error magnitude was tracked has no mae.
                # Zero makes worth_correcting decline, which is the right default:
                # such a cell relearns its magnitude before it is trusted again.
                mae=float(r["mae"]) if "mae" in keys and r["mae"] is not None
                    else 0.0,
                samples=int(r["samples"]))
        return model


def _wrap180(deg: float) -> float:
    """Fold an angle difference into -180..180, so 350 minus 10 is -20."""
    return (deg + 180.0) % 360.0 - 180.0


def _circular_mean_of_differences(errors) -> float:
    """Mean of a set of ALREADY-WRAPPED angle differences.

    Averaged as vectors rather than arithmetically: a set containing +170 and -170
    averages to zero the arithmetic way, which claims the forecast is unbiased when
    in fact it is wrong by nearly half a turn in both directions. As vectors the
    same set gives a near-zero resultant length, which correctly reports no usable
    offset.
    """
    xs = sum(math.cos(math.radians(e)) for e in errors)
    ys = sum(math.sin(math.radians(e)) for e in errors)
    if abs(xs) < 1e-12 and abs(ys) < 1e-12:
        return 0.0
    return math.degrees(math.atan2(ys, xs))


# ---------------------------------------------------------------------------
#  The loop
# ---------------------------------------------------------------------------

@dataclass
class LearningResult:
    """What one pass of the learner consumed."""

    station_id: int
    points_consumed: int = 0
    cells_written: int = 0
    last_run_id: int = 0
    trusted_cells: int = 0


def load(db, station_id: int) -> BiasModel:
    """The learned model for a station, or an empty one."""
    return BiasModel.from_rows(station_id, db.load_bias_rows(station_id))


def update_from_verified(db, station_id: int,
                         reset: bool = False) -> LearningResult:
    """Fold every newly verifiable forecast hour into the learned bias.

    This is the loop. It is called after a forecast run, and it is cheap because
    it only looks at runs newer than the last one it consumed.

    Two properties this has to keep, or the whole thing is worse than nothing:

      - Each observation is counted once. A decaying average driven with
        duplicates converges to the right value but reports a sample count that
        overstates its evidence, and the sample count is what decides whether a
        cell is trusted. bias_progress records how far it has read.
      - It trains on the raw forecast, never on the corrected one. See
        db.verified_points.

    `reset` throws away what was learned and starts again, which is what a sensor
    recalibration calls for.
    """
    if reset:
        db.reset_bias(station_id)

    model = load(db, station_id)
    after = 0 if reset else db.bias_progress(station_id)
    rows = db.verified_points(station_id, after_run_id=after)

    # Group by (run, cell) before folding anything in, so a run contributes one
    # sample per cell instead of one per hour. See BiasModel.observe_batch: doing
    # it per hour made a cell converge on its longest lead rather than its mean.
    groups: dict[tuple, list[tuple[float, float]]] = {}
    meta: dict[tuple, tuple[str, str, float, datetime]] = {}
    consumed = 0
    last_run_id = after
    for r in rows:
        raw = r["raw"]
        observed = r["observed"]
        if raw is None or observed is None:
            continue
        variable = r["variable"]
        if variable not in CORRECTABLE:
            continue
        provider = r["provider"] or ""
        lead = float(r["lead_hours"])
        valid_at = from_db(r["valid_at"])
        run_id = int(r["run_id"])
        key = (run_id, variable, provider, lead_bucket(lead),
               hour_bucket(valid_at))
        groups.setdefault(key, []).append((float(raw), float(observed)))
        # Any member of the group resolves to the same buckets, so the first one
        # seen is enough to replay the call with.
        meta.setdefault(key, (variable, provider, lead, valid_at))
        consumed += 1
        last_run_id = max(last_run_id, run_id)

    # Oldest run first, so the decaying average ends up weighted toward recent
    # weather rather than toward whatever order the rows happened to arrive in.
    for key in sorted(groups, key=lambda k: k[0]):
        variable, provider, lead, valid_at = meta[key]
        model.observe_batch(variable, provider, lead, valid_at, groups[key])

    written = db.save_bias_rows(model.to_rows())
    if last_run_id > after:
        db.set_bias_progress(station_id, last_run_id)
    return LearningResult(station_id=station_id, points_consumed=consumed,
                         cells_written=written, last_run_id=last_run_id,
                         trusted_cells=len(model.summary()))


def from_db(text: str) -> datetime:
    """Parse a stored timestamp.

    Local to this module rather than imported from db, which imports nothing from
    here: keeping the dependency one-directional avoids a cycle, and the format is
    a single constant.
    """
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
