// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Per-station rainfall offset configuration.
 *
 * Historically a hard-coded map; now backed by the `station_calibration`
 * table maintained from the admin `/calibration` page (see
 * server/services/calibrationCache.ts). Callers do not need to change -
 * `applyRainfallOffset(stationId, raw)` keeps the same signature.
 *
 * Some stations (e.g. RIKA cloud-fed devices) report a CUMULATIVE rainfall
 * counter that includes rain accumulated before the device was integrated
 * into Stratus. The offset is the cumulative value AT THE POINT OF INTEGRATION
 * - subtracting it gives the cumulative rain since integration.
 *
 * The offset is also useful for suppressing PHANTOM RAIN after a hardware
 * counter reset.
 */

import { getCalibrationCached } from "../services/calibrationCache";

/**
 * Resolve the calibration factors for a station.
 *
 * Single place that decides what "scale" and "offset" mean, so the JavaScript
 * and SQL renderings below cannot drift apart. They HAVE drifted before: the
 * per-record mapper applied the scaling multiplier while the SQL aggregation in
 * rainfallAggregation.ts did not, so the same station reported different totals
 * depending on which code path answered the request.
 */
function factors(stationId: number): { scale: number; offset: number } {
  const cal = getCalibrationCached(stationId);
  if (!cal) return { scale: 1, offset: 0 };
  const scale = cal.scalingMultiplier && cal.scalingMultiplier > 0 ? cal.scalingMultiplier : 1;
  const offset = cal.rainfallOffset ?? 0;
  return {
    scale: Number.isFinite(scale) ? scale : 1,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

/**
 * Apply the per-station rainfall calibration to ONE reading, clamping to 0.
 *
 * Apply this exactly once per reading, and never to an already-summed total:
 * the scale is linear so scaling a sum happens to work, but the offset is a
 * per-reading correction and subtracting it once from a period total is a
 * different (wrong) calculation. Aggregators must use
 * `rainfallSqlTransform` instead so the offset lands on every term.
 */
export function applyRainfallOffset(stationId: number, raw: number | null): number | null {
  if (raw === null || raw === undefined) return raw;
  const cal = getCalibrationCached(stationId);
  if (!cal) return raw;
  const { scale, offset } = factors(stationId);
  return Math.max(0, raw * scale - offset);
}

/**
 * SQL rendering of the exact transform `applyRainfallOffset` performs, for
 * aggregation queries that must sum calibrated values inside Postgres.
 *
 * `rawExpr` must be a numeric SQL expression yielding one reading in mm.
 * Factors are read from our own numeric DB columns and coerced through
 * `Number`, so there is no interpolation risk from operator input.
 */
export function rainfallSqlTransform(stationId: number, rawExpr: string): string {
  const { scale, offset } = factors(stationId);
  if (scale === 1 && offset === 0) return `(${rawExpr})`;
  const s = Number(scale);
  const o = Number(offset);
  return `GREATEST(0, (${rawExpr}) * ${s} - ${o})`;
}

/** Read-only diagnostic accessor; runtime should call `applyRainfallOffset`. */
export function getRainfallOffset(stationId: number): number {
  return getCalibrationCached(stationId)?.rainfallOffset ?? 0;
}

/** Read-only diagnostic accessor for the configured scaling multiplier. */
export function getRainfallScale(stationId: number): number {
  return factors(stationId).scale;
}
