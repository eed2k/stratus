// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Per-station rainfall offset configuration.
 *
 * Historically a hard-coded map; now backed by the `station_calibration`
 * table maintained from the admin `/calibration` page (see
 * server/services/calibrationCache.ts). Callers do not need to change —
 * `applyRainfallOffset(stationId, raw)` keeps the same signature.
 *
 * Some stations (e.g. RIKA cloud-fed devices) report a CUMULATIVE rainfall
 * counter that includes rain accumulated before the device was integrated
 * into Stratus. The offset is the cumulative value AT THE POINT OF INTEGRATION
 * — subtracting it gives the cumulative rain since integration.
 *
 * The offset is also useful for suppressing PHANTOM RAIN after a hardware
 * counter reset.
 */

import { getCalibrationCached } from "../services/calibrationCache";

/**
 * Apply the per-station rainfall offset, clamping negatives to 0.
 * Returns the raw value unchanged if no offset is configured.
 * Also applies the configured scaling multiplier (default 1.0).
 */
export function applyRainfallOffset(stationId: number, raw: number | null): number | null {
  if (raw === null || raw === undefined) return raw;
  const cal = getCalibrationCached(stationId);
  if (!cal) return raw;
  const scale = cal.scalingMultiplier && cal.scalingMultiplier > 0 ? cal.scalingMultiplier : 1;
  const offset = cal.rainfallOffset ?? 0;
  return Math.max(0, raw * scale - offset);
}

/** Read-only diagnostic accessor; runtime should call `applyRainfallOffset`. */
export function getRainfallOffset(stationId: number): number {
  return getCalibrationCached(stationId)?.rainfallOffset ?? 0;
}
