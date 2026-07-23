// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Station calibration cache.
 *
 * Backs the admin `/calibration` page. Holds an in-memory snapshot of the
 * `station_calibration` table so the hot-path rainfall helpers
 * (`applyRainfallOffset` in stationRainfallOffsets.ts and `getRainfallConfig`
 * in stationRainfallConfig.ts) can stay synchronous.
 *
 * The table is created on first use (idempotent CREATE TABLE IF NOT EXISTS)
 * - drizzle-kit migrations are not wired up in this deployment, so we
 * own the DDL here. After admin updates, call `reloadCalibrationCache()`
 * to refresh the snapshot.
 */

import { query } from "../db-postgres";

export type RainfallType =
  | "auto"
  | "incremental"
  | "cumulative_yearly"
  | "cumulative_lifetime"
  | "tip_count";

export interface CalibrationRow {
  stationId: number;
  rainfallType: RainfallType;
  rainfallOffset: number;
  tipFactor: number;
  dailyResetHour: number;
  scalingMultiplier: number;
  sourceField: string | null;
  sourceTable: string | null;
  timezoneOffsetHours: number;
  updatedAt: string | null;
}

let cache: Map<number, CalibrationRow> = new Map();
let initPromise: Promise<void> | null = null;

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS station_calibration (
    station_id INTEGER PRIMARY KEY,
    rainfall_type VARCHAR(32) NOT NULL DEFAULT 'auto',
    rainfall_offset REAL NOT NULL DEFAULT 0,
    tip_factor REAL NOT NULL DEFAULT 0.1,
    daily_reset_hour INTEGER NOT NULL DEFAULT 0,
    scaling_multiplier REAL NOT NULL DEFAULT 1,
    source_field TEXT,
    source_table TEXT,
    timezone_offset_hours INTEGER NOT NULL DEFAULT 2,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`;

function rowFromDb(r: any): CalibrationRow {
  return {
    stationId: Number(r.station_id),
    rainfallType: (r.rainfall_type || "auto") as RainfallType,
    rainfallOffset: Number(r.rainfall_offset) || 0,
    tipFactor: Number(r.tip_factor) || 0.1,
    dailyResetHour: Number(r.daily_reset_hour) || 0,
    scalingMultiplier: Number(r.scaling_multiplier) || 1,
    sourceField: r.source_field ?? null,
    sourceTable: r.source_table ?? null,
    timezoneOffsetHours: Number(r.timezone_offset_hours) || 2,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

/**
 * Ensure the table exists and the cache is populated. Safe to call many
 * times - the underlying CREATE / SELECT only runs once.
 */
export async function ensureCalibrationCache(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await query(CREATE_SQL);
      await reloadCalibrationCache();
      // Seed the historical RIKA R25021205 (station #2) offset if no
      // explicit row exists - preserves legacy behaviour for callers
      // upgrading from the hard-coded config.
      if (!cache.has(2)) {
        try {
          await query(
            `INSERT INTO station_calibration
              (station_id, rainfall_type, rainfall_offset)
             VALUES ($1, $2, $3)
             ON CONFLICT (station_id) DO NOTHING`,
            [2, "cumulative_lifetime", 212],
          );
          await reloadCalibrationCache();
        } catch {
          // Station #2 may not exist on this deployment - that's fine.
        }
      }
    } catch (err) {
      console.error("[calibrationCache] init failed:", err);
    }
  })();
  return initPromise;
}

/**
 * Re-read all rows from the table into the in-memory cache.
 */
export async function reloadCalibrationCache(): Promise<void> {
  try {
    const r = await query(`SELECT * FROM station_calibration`);
    const next = new Map<number, CalibrationRow>();
    for (const row of r.rows) next.set(Number(row.station_id), rowFromDb(row));
    cache = next;
  } catch (err) {
    console.error("[calibrationCache] reload failed:", err);
  }
}

/** Synchronous cache lookup. Returns null if no entry exists. */
export function getCalibrationCached(stationId: number): CalibrationRow | null {
  return cache.get(stationId) ?? null;
}

export function getAllCalibrationCached(): CalibrationRow[] {
  return Array.from(cache.values());
}

export interface CalibrationUpdate {
  rainfallType?: RainfallType;
  rainfallOffset?: number;
  tipFactor?: number;
  dailyResetHour?: number;
  scalingMultiplier?: number;
  sourceField?: string | null;
  sourceTable?: string | null;
  timezoneOffsetHours?: number;
}

/** Upsert a calibration row and refresh the cache. */
export async function upsertCalibration(
  stationId: number,
  patch: CalibrationUpdate,
): Promise<CalibrationRow> {
  await ensureCalibrationCache();
  const existing = cache.get(stationId);
  const next: CalibrationRow = {
    stationId,
    rainfallType: patch.rainfallType ?? existing?.rainfallType ?? "auto",
    rainfallOffset: patch.rainfallOffset ?? existing?.rainfallOffset ?? 0,
    tipFactor: patch.tipFactor ?? existing?.tipFactor ?? 0.2,
    dailyResetHour: patch.dailyResetHour ?? existing?.dailyResetHour ?? 0,
    scalingMultiplier: patch.scalingMultiplier ?? existing?.scalingMultiplier ?? 1,
    sourceField: patch.sourceField !== undefined ? patch.sourceField : existing?.sourceField ?? null,
    sourceTable: patch.sourceTable !== undefined ? patch.sourceTable : existing?.sourceTable ?? null,
    timezoneOffsetHours: patch.timezoneOffsetHours ?? existing?.timezoneOffsetHours ?? 2,
    updatedAt: null,
  };

  const r = await query(
    `INSERT INTO station_calibration
       (station_id, rainfall_type, rainfall_offset, tip_factor,
        daily_reset_hour, scaling_multiplier, source_field,
        source_table, timezone_offset_hours, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (station_id) DO UPDATE SET
       rainfall_type = EXCLUDED.rainfall_type,
       rainfall_offset = EXCLUDED.rainfall_offset,
       tip_factor = EXCLUDED.tip_factor,
       daily_reset_hour = EXCLUDED.daily_reset_hour,
       scaling_multiplier = EXCLUDED.scaling_multiplier,
       source_field = EXCLUDED.source_field,
       source_table = EXCLUDED.source_table,
       timezone_offset_hours = EXCLUDED.timezone_offset_hours,
       updated_at = NOW()
     RETURNING *`,
    [
      stationId,
      next.rainfallType,
      next.rainfallOffset,
      next.tipFactor,
      next.dailyResetHour,
      next.scalingMultiplier,
      next.sourceField,
      next.sourceTable,
      next.timezoneOffsetHours,
    ],
  );
  const saved = rowFromDb(r.rows[0]);
  cache.set(stationId, saved);
  return saved;
}
