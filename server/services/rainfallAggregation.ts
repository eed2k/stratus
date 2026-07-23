// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Rainfall aggregation: a single, station-config-aware helper used by both
 * /rainfall-yearly and /rainfall-monthly endpoints.
 *
 * If the station has an entry in STATION_RAINFALL_CONFIG, the aggregation
 * is deterministic (incremental → SUM, cumulative → MAX-MIN with reset
 * detection, tip_count → SUM × tipFactor). Otherwise it falls back to the
 * legacy distribution-shape heuristic (auto-detect incremental vs
 * cumulative). Either way the per-bucket result is normalised to mm.
 */

import * as postgres from '../db-postgres';
import {
  getRainfallConfig,
  DEFAULT_TIMEZONE_OFFSET_HOURS,
  DEFAULT_TIP_FACTOR,
  type RainfallType,
} from '../config/stationRainfallConfig';

export type Bucket = 'year' | 'month';

export interface RainfallTotalRow {
  year: number;
  month?: number;       // 1-12 when bucket === 'month'
  total: number;        // mm, rounded to 1 decimal
  readings: number;
  resetCount: number;
  mode: RainfallType | 'auto-incremental' | 'auto-cumulative';
  isCurrent: boolean;
}

const RAINFALL_FIELDS = [
  'Rain_mm_Tot',
  'Rain_Tot',
  'Precip_Tot',
  'Rain_1_Tot',
  'Rain_Tot_1',
  'rainfall',
  'Rain_mm',
  'Precip',
  'Rain',
  'Rainfall',
];

function buildRainfallExpr(sourceField?: string): string {
  if (sourceField) {
    return `(data->>'${sourceField.replace(/'/g, "''")}')::numeric`;
  }
  const coalesce = RAINFALL_FIELDS.map(f => `data->>'${f}'`).join(', ');
  return `COALESCE(${coalesce})::numeric`;
}

function buildBucketExprs(bucket: Bucket, tzOffsetHours: number): {
  selects: string;
  groupBy: string;
} {
  // Shift timestamp into station-local time so year/month boundaries fall
  // at local midnight rather than UTC.
  const localTs = `(timestamp + INTERVAL '${tzOffsetHours} hours')`;
  if (bucket === 'year') {
    return {
      selects: `EXTRACT(YEAR FROM ${localTs})::int AS year, NULL::int AS month`,
      groupBy: `EXTRACT(YEAR FROM ${localTs})`,
    };
  }
  return {
    selects: `EXTRACT(YEAR FROM ${localTs})::int AS year, EXTRACT(MONTH FROM ${localTs})::int AS month`,
    groupBy: `EXTRACT(YEAR FROM ${localTs}), EXTRACT(MONTH FROM ${localTs})`,
  };
}

/**
 * Compute rainfall totals per year (and optionally per month) for a
 * station, honouring per-station config when available.
 */
export async function getRainfallTotals(
  stationId: number,
  bucket: Bucket,
  options: { months?: number; years?: number } = {}
): Promise<RainfallTotalRow[]> {
  const cfg = getRainfallConfig(stationId);
  const tzOffset = cfg?.timezoneOffsetHours ?? DEFAULT_TIMEZONE_OFFSET_HOURS;
  const offset = cfg?.offset ?? 0;
  const tipFactor = cfg?.tipFactor ?? DEFAULT_TIP_FACTOR;

  const rainExprRaw = buildRainfallExpr(cfg?.sourceField);
  // Apply offset (cumulative counters) BEFORE clamping at 0; tipFactor is
  // applied AFTER aggregation (it's just a unit multiplier).
  const rainExpr = offset > 0
    ? `GREATEST(0, ${rainExprRaw} - ${offset})`
    : rainExprRaw;

  const { selects, groupBy } = buildBucketExprs(bucket, tzOffset);

  const params: any[] = [stationId];
  let tableFilter = '';
  if (cfg?.sourceTable) {
    params.push(cfg.sourceTable);
    tableFilter = `AND table_name = $${params.length}`;
  }

  // Limit defaults: 6 years for yearly, 24 months for monthly.
  const defaultLimit = bucket === 'year' ? 6 : 24;
  const limit = bucket === 'year'
    ? Math.max(1, Math.min(20, options.years ?? defaultLimit))
    : Math.max(1, Math.min(120, options.months ?? defaultLimit));

  const sql = `
    WITH readings AS (
      SELECT
        ${selects},
        timestamp,
        ${rainExpr} AS rainfall_val,
        LAG(${rainExpr}) OVER (
          PARTITION BY ${groupBy}
          ORDER BY timestamp
        ) AS prev_val
      FROM weather_data
      WHERE station_id = $1
        AND ${rainExprRaw} IS NOT NULL
        ${tableFilter}
    )
    SELECT
      year,
      month,
      COUNT(*)::int                                                              AS readings,
      MAX(rainfall_val)                                                          AS max_val,
      MIN(rainfall_val)                                                          AS min_val,
      SUM(CASE WHEN rainfall_val >= 0 AND rainfall_val < 1000 THEN rainfall_val ELSE 0 END) AS sum_total,
      SUM(CASE
            WHEN prev_val IS NOT NULL AND rainfall_val >= prev_val
                 AND (rainfall_val - prev_val) < 1000
            THEN rainfall_val - prev_val
            ELSE 0
          END)                                                                   AS delta_sum,
      COUNT(CASE WHEN rainfall_val = 0 THEN 1 END)::int                          AS zero_count,
      COUNT(CASE WHEN rainfall_val > 0 AND rainfall_val < 100 THEN 1 END)::int   AS positive_count,
      AVG(CASE WHEN rainfall_val > 0 AND rainfall_val < 100 THEN rainfall_val END) AS mean_positive,
      COUNT(CASE WHEN prev_val IS NOT NULL AND rainfall_val > prev_val + 0.01 THEN 1 END)::int AS increase_count,
      COUNT(CASE WHEN prev_val IS NOT NULL AND rainfall_val < prev_val - 0.5 THEN 1 END)::int  AS reset_count
    FROM readings
    GROUP BY year, month
    HAVING COUNT(*) >= 2
    ORDER BY year DESC ${bucket === 'month' ? ', month DESC' : ''}
    LIMIT ${limit}
  `;

  const result = await postgres.query(sql, params);

  // Determine "current" bucket for highlighting in the UI.
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return result.rows.map((row: any) => {
    const year = Number(row.year);
    const month = row.month != null ? Number(row.month) : undefined;
    const readings = Number(row.readings);
    const sumTotal = Number(row.sum_total) || 0;
    const deltaSum = Number(row.delta_sum) || 0;
    const resetCount = Number(row.reset_count) || 0;
    const maxVal = Number(row.max_val) || 0;
    const zeroCount = Number(row.zero_count) || 0;
    const positiveCount = Number(row.positive_count) || 0;
    const increaseCount = Number(row.increase_count) || 0;
    const meanPositive = Number(row.mean_positive) || 0;

    let total: number;
    let mode: RainfallTotalRow['mode'];

    if (cfg) {
      // Config-driven: deterministic.
      switch (cfg.type) {
        case 'incremental':
          total = sumTotal;
          mode = 'incremental';
          break;
        case 'tip_count':
          total = sumTotal * tipFactor;
          mode = 'tip_count';
          break;
        case 'cumulative_yearly':
        case 'cumulative_lifetime':
          total = deltaSum;
          mode = cfg.type;
          break;
      }
    } else {
      // Legacy heuristic - same as the previous endpoint.
      const zeroFraction = readings > 0 ? zeroCount / readings : 0;
      const increaseFraction = readings > 0 ? increaseCount / readings : 0;

      if (zeroFraction >= 0.30 && meanPositive < 20 && maxVal < 100) {
        total = sumTotal;
        mode = 'auto-incremental';
      } else if (increaseFraction >= 0.40 || maxVal >= 50 || resetCount > 0) {
        total = deltaSum;
        mode = 'auto-cumulative';
      } else if (positiveCount === 0) {
        total = 0;
        mode = 'auto-incremental';
      } else {
        // Conservative fallback to avoid gross over-reporting.
        if (sumTotal <= deltaSum) { total = sumTotal; mode = 'auto-incremental'; }
        else { total = deltaSum; mode = 'auto-cumulative'; }
      }
    }

    // Sanity clamp: ignore impossible bucket totals.
    const cap = bucket === 'year' ? 5000 : 1000;
    if (total > cap) total = bucket === 'year' ? Math.min(deltaSum, sumTotal) : 0;
    if (total > cap) total = 0;

    const isCurrent = bucket === 'year'
      ? year === currentYear
      : (year === currentYear && month === currentMonth);

    return {
      year,
      month,
      total: Math.round(Math.max(0, total) * 10) / 10,
      readings,
      resetCount,
      mode,
      isCurrent,
    };
  });
}
