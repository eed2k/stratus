"""Turn a station's uploaded history into 1, 3 and 5 day forecasts.

WHAT THIS ORCHESTRATES

  engine.py holds the statistics and knows nothing about storage. This module is
  the part that reads a station's observations, puts them on a regular grid,
  drives the engine over every lead hour, and writes the result down so it can
  be scored later.

WHY THE HISTORY IS RESAMPLED TO HOURLY

  A Campbell logger typically records every five or ten minutes. The engine's
  analog search compares trajectories hour by hour and its climatology is fitted
  against hour-of-day, so feeding it five-minute data would make the trajectory
  window twelve times shorter in real time than intended and the analog search
  twelve times slower for no gain. Hourly is also the resolution any model
  background arrives at, so the two line up without interpolation.

  Gaps stay as gaps. An hour with no readings becomes None rather than being
  filled, because inventing a value would let the analog search match against
  something that never happened.

WHY THE BASELINES ARE STORED WITH THE FORECAST

  Every forecast point is written alongside what persistence and climatology
  would have said for that same hour. A forecast that cannot beat "it will stay
  as it is now" has no value, and the only way to make that comparison
  trustworthy is to record the baseline at the moment of issue rather than
  reconstructing it afterwards, when the answer is already known.

WHAT HONEST LOOKS LIKE WITH LITTLE DATA

  A 5 day forecast from 8 days of history is mostly climatology, and the analog
  ensemble will be empty because no past moment has 120 hours of record after
  it. That is reported rather than hidden: `Sufficiency` says what was available
  and which components actually contributed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import adaptive, engine
from .db import Database, Station
from .providers import registry

# The three horizons the interface offers, in days and hours.
HORIZON_DAYS = (1, 3, 5)
HORIZON_HOURS = {1: 24, 3: 72, 5: 120}

# How much history to read. Five weeks gives the harmonic fit a stable diurnal
# shape without letting a season-old regime dominate the current one.
DEFAULT_HISTORY_DAYS = 35

# Below this many hourly samples there is no diurnal cycle worth fitting and the
# forecast degrades to persistence.
MIN_HOURS_FOR_CLIMATOLOGY = 24
# Below this, an analog ensemble is not worth attempting even if the arithmetic
# would succeed: a handful of candidates gives a spread that means nothing.
MIN_HOURS_FOR_ANALOGS = 24 * 10


@dataclass
class Sufficiency:
    """What the run had to work with, in the operator's terms."""

    hourly_slots: int = 0
    hours_with_data: int = 0
    history_days: float = 0.0
    coverage_pct: float = 0.0
    climatology_fitted: list[str] = field(default_factory=list)
    analogs_found: int = 0
    analog_limited_by_history: bool = False
    nwp_provider: str | None = None
    nwp_resolution_km: float | None = None
    nwp_variables: list[str] = field(default_factory=list)
    #: How many learned site-correction cells were trusted enough to be applied
    #: to this run. Zero on a station that has not been verified yet, which is
    #: the honest answer: nothing has been learned about it so far.
    learned_cells: int = 0
    notes: list[str] = field(default_factory=list)


@dataclass
class RunSummary:
    run_id: int
    station_id: int
    base_time: datetime
    horizon_hours: int
    variables: list[str] = field(default_factory=list)
    points_written: int = 0
    sufficiency: Sufficiency = field(default_factory=Sufficiency)
    warnings: list[str] = field(default_factory=list)


class NotEnoughData(Exception):
    """Too little history to forecast anything at all."""


# ---------------------------------------------------------------------------
#  Putting observations on a regular hourly grid
# ---------------------------------------------------------------------------

def _floor_hour(when: datetime) -> datetime:
    return when.replace(minute=0, second=0, microsecond=0)


def build_hourly_grid(db: Database, station_id: int, variables: list[str],
                      start: datetime, end: datetime):
    """A regular hourly timeline and one aligned value list per variable.

    Directions are averaged as vectors. Averaging 350 and 10 degrees
    arithmetically gives 180, which points the wind the opposite way, so the
    circular case is handled separately rather than by the same mean.
    """
    start_h = _floor_hour(start)
    end_h = _floor_hour(end)
    slots = int((end_h - start_h).total_seconds() // 3600) + 1
    if slots < 2:
        raise NotEnoughData(
            "The uploaded record covers less than two hours.")

    timeline = [start_h + timedelta(hours=i) for i in range(slots)]
    index_of = {t: i for i, t in enumerate(timeline)}

    out: dict[str, list] = {}
    for variable in variables:
        buckets: list[list[float]] = [[] for _ in range(slots)]
        for when, value in db.series(station_id, variable, start_h,
                                     end_h + timedelta(hours=1)):
            idx = index_of.get(_floor_hour(when))
            if idx is not None:
                buckets[idx].append(value)

        circular = engine.VARIABLE_RULES.get(variable, {}).get("circular")
        values: list[float | None] = []
        for bucket in buckets:
            if not bucket:
                values.append(None)
            elif circular:
                values.append(engine.circular_mean(bucket))
            else:
                values.append(sum(bucket) / len(bucket))
        out[variable] = values

    return timeline, out


# ---------------------------------------------------------------------------
#  The run
# ---------------------------------------------------------------------------

def _last_index_with_data(values: list) -> int | None:
    for i in range(len(values) - 1, -1, -1):
        if values[i] is not None:
            return i
    return None


def _to_naive_local(when: datetime, utc_offset_hours: float) -> datetime:
    """A model's aware UTC time expressed in the logger's naive local time.

    Without this the model background would be compared against observations
    two hours out of step at a South African site, which shows up as a forecast
    that is confidently wrong at exactly the times of day the diurnal curve is
    steepest.
    """
    if when.tzinfo is None:
        return when
    tz = timezone(timedelta(hours=utc_offset_hours))
    return when.astimezone(tz).replace(tzinfo=None)


def _covers_lead_window(background, base: datetime, horizon_hours: int,
                        utc_offset_hours: float) -> bool:
    """True when the model series reaches at least one of the run's lead hours.

    Asked with both time conventions, matching how the engine queries the series
    everywhere else: aware with the station's offset for a provider that stamps
    in UTC, naive local for one that does not.

    One covered hour is enough to be a real background. A series that clips the
    end of a five day run still carries the front that matters; a series that
    covers none of it is simply about a different week.
    """
    tz = timezone(timedelta(hours=utc_offset_hours))
    for lead in range(1, horizon_hours + 1):
        valid = base + timedelta(hours=lead)
        if (background.at(valid.replace(tzinfo=tz)) is not None
                or background.at(valid) is not None):
            return True
    return False


def run_forecast(db: Database, station: Station, horizon_hours: int,
                 history_days: int = DEFAULT_HISTORY_DAYS,
                 base_time: datetime | None = None,
                 adaptive_correction: bool = True) -> RunSummary:
    """Produce and store one forecast run for one station.

    `adaptive_correction` False issues the forecast without the learned site
    correction and without folding the result back into it. That is what
    measuring the correction is worth requires: a baseline pass over the same base
    hours with the correction absent, against which a second pass can be
    compared. It is not a debugging flag - a skill claim that cannot be reproduced
    against an uncorrected baseline is not a skill claim.

    `base_time` defaults to the most recent hour that has observations, not to
    the wall clock. An operator uploading last month's export wants a forecast
    launched from the end of that file, and scoring it against the rest of the
    file is exactly how the skill numbers get built up.
    """
    available = [v for v in db.station_variables(station.id)
                 if v in engine.VARIABLE_RULES]
    if not available:
        raise NotEnoughData(
            "No forecastable variables in this station's record. The engine "
            "needs at least one of: "
            + ", ".join(sorted(engine.VARIABLE_RULES)))

    span_start, span_end = db.observation_span(station.id)
    if span_start is None or span_end is None:
        raise NotEnoughData("This station has no observations yet.")

    end = _floor_hour(base_time or span_end)
    start = max(_floor_hour(span_start), end - timedelta(days=history_days))
    timeline, columns = build_hourly_grid(db, station.id, available,
                                          start, end)

    suff = Sufficiency(hourly_slots=len(timeline))
    suff.history_days = round((end - start).total_seconds() / 86400.0, 2)
    filled = sum(1 for i in range(len(timeline))
                 if any(columns[v][i] is not None for v in available))
    suff.hours_with_data = filled
    suff.coverage_pct = round(100.0 * filled / max(1, len(timeline)), 1)

    now_index = None
    for variable in available:
        idx = _last_index_with_data(columns[variable])
        if idx is not None:
            now_index = idx if now_index is None else max(now_index, idx)
    if now_index is None:
        raise NotEnoughData("Every hour in the window is empty.")

    base = timeline[now_index]

    # --- climatology and anomaly persistence, per variable ---
    climatologies: dict[str, engine.Climatology] = {}
    efolds: dict[str, float] = {}
    anomaly_now: dict[str, float] = {}

    for variable in available:
        values = columns[variable]
        samples = [(t.hour + t.minute / 60.0, v)
                   for t, v in zip(timeline, values) if v is not None]
        if len(samples) < MIN_HOURS_FOR_CLIMATOLOGY:
            continue
        circular = engine.VARIABLE_RULES.get(variable, {}).get("circular")
        clim = (engine.fit_circular_climatology(samples) if circular
                else engine.fit_climatology(samples))
        if clim is None:
            continue
        climatologies[variable] = clim
        suff.climatology_fitted.append(variable)

        anomalies = []
        for t, v in zip(timeline, values):
            if v is None:
                anomalies.append(None)
                continue
            expected = clim.at(t.hour + t.minute / 60.0)
            if circular:
                # Signed: an unsigned anomaly would make the damped
                # persistence term veer the forecast one way regardless of
                # which way the wind actually shifted.
                anomalies.append(
                    engine.signed_angular_difference(v, expected))
            else:
                anomalies.append(v - expected)
        efolds[variable] = engine.efolding_hours(
            [a for a in anomalies if a is not None])
        if anomalies[now_index] is not None:
            anomaly_now[variable] = anomalies[now_index]
        else:
            last = _last_index_with_data(anomalies)
            anomaly_now[variable] = anomalies[last] if last is not None else 0.0

    if not climatologies:
        suff.notes.append(
            f"Not enough history to fit a daily cycle: {filled} hours with "
            f"data, {MIN_HOURS_FOR_CLIMATOLOGY} needed. The forecast is "
            f"persistence only.")

    # --- analog ensemble, computed once for the whole run ---
    analogs: list = []
    if filled >= MIN_HOURS_FOR_ANALOGS:
        analogs = engine.find_analogs(
            timeline, {k: v for k, v in columns.items()}, now_index,
            horizon_hours=horizon_hours)
        suff.analogs_found = len(analogs)
        if not analogs:
            suff.analog_limited_by_history = True
            suff.notes.append(
                f"No analog days found. A candidate needs {horizon_hours} "
                f"hours of record after it, and this station has "
                f"{suff.history_days:.1f} days in total.")
    else:
        suff.analog_limited_by_history = True
        suff.notes.append(
            f"Analog ensemble skipped: it needs about "
            f"{MIN_HOURS_FOR_ANALOGS // 24} days of history and this station "
            f"has {suff.history_days:.1f} days. Without it the forecast has no "
            f"ensemble spread, so no confidence band is shown.")

    # --- optional model background ---
    background = None
    if station.nwp_enabled and station.has_position:
        cfg = registry.StationNwpConfig(
            enabled=True,
            providers=list(station.nwp_providers or []),
            variables=list(station.nwp_variables or []))
        background = registry.restrict_to_opted_in(
            registry.fetch_background(station.latitude, station.longitude,
                                      cfg, hours=horizon_hours + 6), cfg)
        # A background that does not reach this run's lead window is not a
        # background. Providers serve a forecast from the current hour forward,
        # so a run launched from a base hour in the past - which is exactly what
        # backfill_runs does to build a skill history - gets a series covering
        # next week for a forecast about last March. Every lead hour then fails
        # the nearest-point test and the run is station history in substance
        # while being recorded as model-backed, which makes the verification
        # history unable to tell the two methods apart.
        if background is not None and not _covers_lead_window(
                background, base, horizon_hours, station.utc_offset_hours):
            suff.notes.append(
                f"A {background.provider} background was fetched but it does "
                f"not cover this run's period, so the run is station history "
                f"only. This is expected for a backfilled run: a provider "
                f"serves the current forecast, not an archive.")
            background = None
        if background is not None:
            suff.nwp_provider = background.provider
            suff.nwp_resolution_km = background.resolution_km
            suff.nwp_variables = sorted(background.variables())
        else:
            suff.notes.append(
                "A model background was requested but none was available, so "
                "this run is station history only.")
    elif station.nwp_enabled and not station.has_position:
        suff.notes.append(
            "A model background is switched on but this station has no "
            "coordinates, so none could be fetched.")

    # Bias against the model at the base hour: the site-specific part.
    nwp_bias: dict[str, float] = {}
    if background is not None:
        base_point = background.at(
            base.replace(tzinfo=timezone(
                timedelta(hours=station.utc_offset_hours))))
        if base_point is None:
            # Match on naive local instead, in case the provider returned
            # naive times.
            base_point = background.at(base)
        if base_point is not None:
            for variable in base_point.values:
                observed = columns.get(variable, [None])[now_index] \
                    if variable in columns else None
                modeled = base_point.get(variable)
                if observed is not None and modeled is not None:
                    if engine.VARIABLE_RULES.get(variable, {}).get("circular"):
                        nwp_bias[variable] = \
                            engine.signed_angular_difference(observed,
                                                             modeled)
                    else:
                        nwp_bias[variable] = observed - modeled

    # --- drive the engine over every lead hour ---
    # Imported here rather than at the top of the module: verification reads this
    # module's tuning constants to build the version hash, so a module-level
    # import in both directions would be a cycle.
    from . import verification

    # The learned site correction, loaded once for the whole run.
    #
    # Keyed on the provider this run actually used, so a model-backed run is
    # corrected by what model-backed runs got wrong here and a history-only run
    # by what history-only runs got wrong. The two have unrelated offsets and
    # sharing one number between them would make both worse.
    run_provider = background.provider if background else ""
    bias_model = (adaptive.load(db, station.id) if adaptive_correction
                  else adaptive.BiasModel(station_id=station.id))
    suff.learned_cells = len(bias_model.summary())

    run_id = db.create_run(
        station.id, base, horizon_hours,
        provider=(background.provider if background else ""),
        resolution_km=(background.resolution_km if background else None),
        notes=(background.notes if background else
               "Station history only: harmonic climatology, damped anomaly "
               "and analog ensemble."),
        method_version=verification.method_version())

    rows = []
    forecast_variables: list[str] = []

    for variable in available:
        clim = climatologies.get(variable)
        efold = efolds.get(variable, 12.0)
        current = anomaly_now.get(variable)
        values = columns[variable]
        last_obs = values[now_index]
        if last_obs is None:
            li = _last_index_with_data(values)
            last_obs = values[li] if li is not None else None
        circular = engine.VARIABLE_RULES.get(variable, {}).get("circular")
        produced = 0

        for lead in range(1, horizon_hours + 1):
            valid_at = base + timedelta(hours=lead)
            hour_of_day = valid_at.hour + valid_at.minute / 60.0
            clim_value = clim.at(hour_of_day) if clim else None

            analog_values = []
            for match in analogs:
                j = match.index + lead
                if 0 <= j < len(values) and values[j] is not None:
                    analog_values.append(values[j])
            analog_median = (
                (engine.circular_mean(analog_values) if circular
                 else engine.median(analog_values))
                if analog_values else None)

            nwp_value = None
            if background is not None:
                point = background.at(valid_at.replace(
                    tzinfo=timezone(
                        timedelta(hours=station.utc_offset_hours))))
                if point is None:
                    point = background.at(valid_at)
                if point is not None:
                    nwp_value = point.get(variable)

            fp = engine.blend_forecast(
                variable, valid_at, float(lead),
                climatology_value=clim_value,
                current_anomaly=current,
                efold=efold,
                analog_values=analog_values or None,
                nwp_value=nwp_value,
                nwp_bias=nwp_bias.get(variable))

            value = engine.clip_to_physical_range(variable, fp.value)
            if value is None and last_obs is None:
                continue
            if value is None:
                # Nothing to say beyond "unchanged".
                value = last_obs

            # The learned site correction.
            #
            # Applied here, to the blended value, rather than to the model
            # background alone: the measured offset is present in a
            # history-only run too, so it is a property of the whole pipeline at
            # this site and not of the provider. Applied AFTER the blend and
            # BEFORE the percentiles and the ensemble are derived, so all three
            # describe the same forecast.
            #
            # It is deliberately not damped with lead time the way the
            # instantaneous base-hour bias is. That term is a transient - "it is
            # two degrees warmer than the model says right now" - and should fade.
            # This one is a standing difference between the grid cell and the
            # mast, and it does not fade; the cell is keyed by lead bucket so the
            # size can differ per lead without being decayed toward zero.
            value, bias_applied = bias_model.apply(
                variable, run_provider, float(lead), valid_at, value)

            p10 = engine.clip_to_physical_range(variable, fp.p10)
            p90 = engine.clip_to_physical_range(variable, fp.p90)
            if bias_applied:
                # Shift the interval with the value. Leaving it put would move
                # the forecast out of its own confidence band.
                if p10 is not None:
                    p10 = engine.clip_to_physical_range(variable,
                                                        p10 + bias_applied)
                if p90 is not None:
                    p90 = engine.clip_to_physical_range(variable,
                                                        p90 + bias_applied)

            # Baselines, recorded now so the later comparison is not
            # retrospective.
            persistence = last_obs
            climatology_baseline = (
                engine.clip_to_physical_range(variable, clim_value)
                if clim_value is not None else None)
            if circular and value is not None:
                value %= 360.0

            # The ensemble members are kept so any threshold probability can be
            # answered empirically later, and so CRPS and a rank histogram are
            # possible at all. They are shifted onto the blended value the same
            # way p10/p90 are, or a probability read off them would describe the
            # raw analogs rather than the forecast that was actually issued.
            members = []
            if analog_values and analog_median is not None \
                    and value is not None:
                offset = value - analog_median
                for m in analog_values:
                    shifted = engine.clip_to_physical_range(
                        variable, m + offset)
                    if shifted is not None:
                        members.append(shifted % 360.0 if circular else shifted)

            rows.append((valid_at, float(lead), variable, value, p10, p90,
                         persistence, climatology_baseline, fp.sources,
                         members, bias_applied))
            produced += 1

        if produced:
            forecast_variables.append(variable)

    written = db.insert_points(run_id, rows)

    summary = RunSummary(
        run_id=run_id, station_id=station.id, base_time=base,
        horizon_hours=horizon_hours, variables=forecast_variables,
        points_written=written, sufficiency=suff)

    if suff.coverage_pct < 80.0:
        summary.warnings.append(
            f"Only {suff.coverage_pct:.0f}% of the hours in the training "
            f"window have data. Gaps weaken the daily-cycle fit and the analog "
            f"search.")
    if horizon_hours >= 72 and not analogs:
        summary.warnings.append(
            f"A {horizon_hours // 24} day forecast from "
            f"{suff.history_days:.0f} days of history leans almost entirely on "
            f"the daily cycle. Upload a longer record for the ensemble to "
            f"contribute.")

    # Close the loop.
    #
    # Every hour this run just wrote is unverifiable for now, but hours from
    # earlier runs have had their observations arrive since, and this is the
    # natural moment to fold them in: it costs one indexed query, it keeps the
    # learned bias current without a scheduler, and it means the correction
    # improves on exactly the cadence that new ground truth arrives.
    #
    # Wrapped because a forecast that was produced correctly must not be lost to
    # a failure in the part that learns from it.
    if adaptive_correction:
        try:
            adaptive.update_from_verified(db, station.id)
        except Exception as exc:                              # pragma: no cover
            summary.warnings.append(
                f"The forecast was produced but the site correction could not "
                f"be updated from it: {type(exc).__name__}: {exc}")
    return summary


def run_all_horizons(db: Database, station: Station,
                     history_days: int = DEFAULT_HISTORY_DAYS
                     ) -> list[RunSummary]:
    """1, 3 and 5 day runs from the same base hour."""
    out = []
    for days in HORIZON_DAYS:
        out.append(run_forecast(db, station, HORIZON_HOURS[days],
                                history_days=history_days))
    return out


# ---------------------------------------------------------------------------
#  Backfill, which is what makes the verification page useful on day one
# ---------------------------------------------------------------------------

def backfill_runs(db: Database, station: Station, horizon_hours: int,
                  step_hours: int = 24, max_runs: int = 40,
                  history_days: int = DEFAULT_HISTORY_DAYS,
                  adaptive_correction: bool = True) -> list[RunSummary]:
    """Issue forecasts from past base hours so they can be scored immediately.

    Without this, a newly uploaded station has nothing to verify: every forecast
    it can make is about the future, and the operator would have to wait days to
    see whether the thing works. Re-forecasting from base times that are already
    in the past, using only the data that existed before each base hour, gives an
    honest skill estimate straight away.

    The "using only data that existed before" part is the whole point. Each run
    is built from a window ending at its own base hour, so a run launched from
    the 3rd cannot see the 4th. Anything else would be scoring the model against
    data it had already been shown, which always looks excellent and means
    nothing.

    Base hours are issued oldest first, which makes a backfill with
    `adaptive_correction` on a walk-forward test of the learned correction: each
    run is corrected using only what the runs before it had already been scored
    on. Running it newest first would let a run be corrected by a bias learned
    from its own future, and the result would be a number that cannot be
    reproduced in service.
    """
    span_start, span_end = db.observation_span(station.id)
    if span_start is None:
        raise NotEnoughData("This station has no observations yet.")

    # Leave the horizon at the end unscored: a run launched later than this has
    # nothing after it to be checked against.
    latest_base = _floor_hour(span_end) - timedelta(hours=horizon_hours)
    earliest_base = _floor_hour(span_start) + timedelta(
        hours=MIN_HOURS_FOR_CLIMATOLOGY)
    if latest_base <= earliest_base:
        raise NotEnoughData(
            f"The record is too short to backfill a "
            f"{horizon_hours // 24} day forecast and still have observations "
            f"left to score it against. It covers "
            f"{(span_end - span_start).days} days; about "
            f"{(horizon_hours // 24) + 2} would be the minimum.")

    bases: list[datetime] = []
    cursor = latest_base
    while cursor >= earliest_base and len(bases) < max_runs:
        bases.append(cursor)
        cursor -= timedelta(hours=step_hours)
    bases.reverse()

    out: list[RunSummary] = []
    for base in bases:
        try:
            out.append(run_forecast(db, station, horizon_hours,
                                    history_days=history_days,
                                    base_time=base,
                                    adaptive_correction=adaptive_correction))
        except NotEnoughData:
            continue
    return out
