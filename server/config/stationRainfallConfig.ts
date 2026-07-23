// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Per-station rainfall metadata.
 *
 * Historically a hard-coded map; now backed by the `station_calibration`
 * table maintained from the admin `/calibration` page (see
 * server/services/calibrationCache.ts). Callers don't change - they
 * still get a `StationRainfallConfig | null` from `getRainfallConfig`.
 *
 * CRBasic programs log rainfall in fundamentally different ways:
 *  - "incremental": each record holds the rain for that scan/period.
 *  - "cumulative_yearly": running counter that resets at year boundary.
 *  - "cumulative_lifetime": never-resetting running counter.
 *  - "tip_count": raw tip counter; multiply by `tipFactor` (default 0.1 mm).
 *
 * If a station's calibration row says `rainfallType = 'auto'` (the
 * default for newly-added stations), `getRainfallConfig` returns null
 * and the aggregation endpoints fall back to the legacy heuristic.
 */

import { getCalibrationCached } from "../services/calibrationCache";

export type RainfallType =
  | 'incremental'
  | 'cumulative_yearly'
  | 'cumulative_lifetime'
  | 'tip_count';

export interface StationRainfallConfig {
  type: RainfallType;
  sourceField?: string;
  sourceTable?: string;
  tipFactor?: number;
  offset?: number;
  timezoneOffsetHours?: number;
}

/** Default station-local timezone offset (hours) when not specified per station. */
export const DEFAULT_TIMEZONE_OFFSET_HOURS = 2;

/** Default mm-per-tip for tipping-bucket gauges when not specified per station. */
export const DEFAULT_TIP_FACTOR = 0.1;

/**
 * Look up the rainfall interpretation for a station. Returns null when
 * the calibration row says `auto` (or no row exists), in which case the
 * caller should fall back to the legacy heuristic.
 */
export function getRainfallConfig(stationId: number): StationRainfallConfig | null {
  const cal = getCalibrationCached(stationId);
  if (!cal) return null;
  if (!cal.rainfallType || cal.rainfallType === 'auto') return null;
  return {
    type: cal.rainfallType,
    sourceField: cal.sourceField ?? undefined,
    sourceTable: cal.sourceTable ?? undefined,
    tipFactor: cal.tipFactor ?? DEFAULT_TIP_FACTOR,
    offset: cal.rainfallOffset ?? 0,
    timezoneOffsetHours: cal.timezoneOffsetHours ?? DEFAULT_TIMEZONE_OFFSET_HOURS,
  };
}
