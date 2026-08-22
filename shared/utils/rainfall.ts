// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Canonical rainfall maths.
 *
 * Rain is the one field where different station families disagree about what a
 * reading MEANS, and getting it wrong is not a rounding error - it either
 * invents hundreds of millimetres of rain or reports a dry month during a storm.
 *
 * Two shapes exist in the wild:
 *
 *   incremental / tip_count  each reading is the rain that fell during that
 *                            logging interval, so a period total is the SUM.
 *   cumulative_*             each reading is a running counter (RIKA reports
 *                            millimetres since the device was commissioned), so
 *                            a period total is the sum of POSITIVE DELTAS.
 *
 * Summing a cumulative counter is the classic failure: 24 hourly readings of a
 * counter sitting at ~250 mm sums to ~6000 mm of "rain". Equally, diffing an
 * incremental series returns almost nothing during steady rain.
 *
 * Before this module the conversion was reimplemented four times in the client
 * with different spike caps and two different ways of deciding which shape a
 * station used (one checked `connectionType === 'rikacloud'`, another checked
 * the operator-configured rainfall type). They disagreed, so the same station
 * showed different totals in different cards. This is now the single source of
 * truth; callers pass the configured type and get one answer.
 */

/** Rainfall shapes, matching the station_calibration.rainfall_type column. */
export type RainfallType =
  | "incremental"
  | "cumulative_yearly"
  | "cumulative_lifetime"
  | "tip_count"
  | "auto";

/**
 * Largest believable rise between two consecutive readings, in mm.
 *
 * Rain gauges top out around 100-150 mm/h in extreme cloudbursts, so anything
 * larger across one logging interval is a counter glitch or a backfilled gap
 * rather than weather. Rejecting those keeps one corrupt sample from dominating
 * a monthly total.
 */
const MAX_STEP_MM = 60;

/** Largest believable single incremental reading, in mm. */
const MAX_INCREMENT_MM = 100;

/**
 * Decide whether a series looks like a running counter.
 *
 * Only used when the station has no explicit configuration ('auto'). A counter
 * is monotonic-ish and usually large; an incremental series is mostly zeros
 * with small positive bursts.
 */
export function looksCumulative(values: number[]): boolean {
  if (values.length < 3) return false;
  const max = Math.max(...values);
  let rises = 0;
  let falls = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0.001) rises++;
    else if (d < -0.001) falls++;
  }
  // A counter climbs and effectively never falls (a fall means a reset).
  const mostlyRising = rises > 0 && falls <= Math.max(1, values.length * 0.05);
  return max > 50 || mostlyRising;
}

/** True when the configured type means "each reading is a running total". */
export function isCumulativeType(type: RainfallType): boolean {
  return type === "cumulative_yearly" || type === "cumulative_lifetime";
}

/**
 * Total rainfall (mm) represented by an ordered series of readings.
 *
 * `values` MUST already be sorted oldest-first; callers that hold unsorted data
 * should sort by timestamp first, because a single out-of-order sample turns
 * into a bogus negative delta (which is discarded) and a bogus positive one on
 * the way back (which is not).
 *
 * @param values readings in mm, oldest first, nulls already removed
 * @param type   configured rainfall shape; 'auto' falls back to detection
 * @param tipFactor mm per tip, applied only for tip_count stations
 */
export function rainfallTotal(
  values: number[],
  type: RainfallType = "auto",
  tipFactor = 0.2,
): number {
  if (values.length === 0) return 0;

  const cumulative = type === "auto" ? looksCumulative(values) : isCumulativeType(type);

  let total = 0;
  if (cumulative) {
    // Sum positive steps. A negative step is a counter reset (or a device
    // swap): the rain that fell across that boundary is unknowable, so it is
    // skipped rather than guessed at.
    for (let i = 1; i < values.length; i++) {
      const step = values[i] - values[i - 1];
      if (step > 0 && step <= MAX_STEP_MM) total += step;
    }
  } else {
    for (const v of values) {
      if (v > 0 && v <= MAX_INCREMENT_MM) total += v;
    }
    if (type === "tip_count") total *= tipFactor > 0 ? tipFactor : 0.2;
  }

  return Math.round(total * 100) / 100;
}

/**
 * Convenience wrapper for records carrying a timestamp and a rainfall field.
 * Sorts defensively, drops nulls, then delegates to `rainfallTotal`.
 */
export function rainfallTotalFromRecords<
  T extends { timestamp: string | number | Date; rainfall?: number | string | null },
>(records: T[], type: RainfallType = "auto", tipFactor = 0.2): number {
  const values = [...records]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((r) => {
      const v = r.rainfall;
      if (v === null || v === undefined) return null;
      const n = typeof v === "string" ? parseFloat(v) : v;
      return Number.isFinite(n) ? n : null;
    })
    .filter((v): v is number => v !== null);

  return rainfallTotal(values, type, tipFactor);
}
