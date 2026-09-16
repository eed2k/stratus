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
import { rainfallSqlTransform } from '../config/stationRainfallOffsets';
import { rainfallSqlCoalesce } from '../config/rainfallFields';

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

function buildRainfallExpr(sourceField?: string): string {
  if (sourceField) {
    return `(data->>'${sourceField.replace(/'/g, "''")}')::numeric`;
  }
  // Shared alias list, so this query cannot recognise a different set of field
  // names than the ingest and record-read paths. See server/config/rainfallFields.ts.
  return `${rainfallSqlCoalesce()}::numeric`;
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
 * station, honoring per-station config when available.
 */
export async function getRainfallTotals(
  stationId: number,
  bucket: Bucket,
  options: { months?: number; years?: number } = {}
): Promise<RainfallTotalRow[]> {
  const cfg = getRainfallConfig(stationId);
  const tzOffset = cfg?.timezoneOffsetHours ?? DEFAULT_TIMEZONE_OFFSET_HOURS;
  const tipFactor = cfg?.tipFactor ?? DEFAULT_TIP_FACTOR;

  const rainExprRaw = buildRainfallExpr(cfg?.sourceField);
  // Calibrate every reading with the SAME transform the per-record mapper uses
  // (scaling multiplier and offset, clamped at 0). Previously this applied the
  // offset only and ignored scaling_multiplier, so a station with a multiplier
  // reported one total here and a different one on the dashboard. tipFactor is
  // still applied AFTER aggregation, since it is only a unit multiplier.
  const rainExpr = rainfallSqlTransform(stationId, rainExprRaw);

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

/** Rainfall totals for the standard dashboard reporting periods, in mm. */
export interface RainfallPeriodTotals {
  last24h: number;
  yesterday: number;
  thisWeek: number;
  thisMonth: number;
  /** How the readings were interpreted, for display and debugging. */
  mode: RainfallType | 'auto-incremental' | 'auto-cumulative';
  /** Readings considered across the widest (30 day) window. */
  readings: number;
  /** Timestamp the windows were measured back from (ISO 8601). */
  reference: string;
  /** Station-local offset used to place the "yesterday" midnight boundary. */
  timezoneOffsetHours: number;
}

/**
 * Rainfall totals for the dashboard period cards, aggregated IN THE DATABASE.
 *
 * Why this exists: the dashboard used to sum the `rainfall` field of the records
 * returned by `GET /api/stations/:id/data`, but that endpoint decimates its
 * response to keep chart payloads small, and it decimates by DROPPING records.
 * Dropping a record is harmless for an instantaneous field like temperature,
 * where the neighbouring sample still describes the same state, but rainfall is
 * an accumulating quantity: the rain recorded in a dropped record existed
 * nowhere else, so it silently vanished from the total. A station logging at one
 * minute over a 30 day request was thinned by a factor of two, and reported
 * exactly half its rain.
 *
 * Totals must therefore never be derived from decimated data. Every reading is
 * summed here instead, with no row cap and no sampling.
 *
 * Window definitions match the cards they feed: last 24 hours, the previous
 * station-local calendar day, the last 7 days and the last 30 days. `reference`
 * defaults to the station's most recent reading rather than wall-clock now, so
 * the totals stay meaningful for a station that has stopped reporting.
 */
export async function getRainfallPeriodTotals(
  stationId: number,
  options: { reference?: Date } = {}
): Promise<RainfallPeriodTotals> {
  const cfg = getRainfallConfig(stationId);
  const tzOffset = cfg?.timezoneOffsetHours ?? DEFAULT_TIMEZONE_OFFSET_HOURS;
  const tipFactor = cfg?.tipFactor ?? DEFAULT_TIP_FACTOR;

  const rainExprRaw = buildRainfallExpr(cfg?.sourceField);
  const rainExpr = rainfallSqlTransform(stationId, rainExprRaw);

  const params: any[] = [stationId];
  let tableFilter = '';
  if (cfg?.sourceTable) {
    params.push(cfg.sourceTable);
    tableFilter = `AND table_name = $${params.length}`;
  }

  // Anchor the windows on the latest reading unless the caller pins a time.
  let reference = options.reference ?? null;
  if (!reference) {
    const latest = await postgres.query(
      `SELECT MAX(timestamp) AS ts FROM weather_data WHERE station_id = $1`,
      [stationId]
    );
    const ts = latest.rows[0]?.ts;
    reference = ts ? new Date(ts) : new Date();
  }

  const refMs = reference.getTime();
  const monthStart = new Date(refMs - 30 * 24 * 60 * 60 * 1000);
  const weekStart = new Date(refMs - 7 * 24 * 60 * 60 * 1000);
  const dayStart = new Date(refMs - 24 * 60 * 60 * 1000);

  // "Yesterday" is the previous complete calendar day in STATION-LOCAL time.
  // Shift into local time, truncate to midnight, then shift back to UTC.
  const localRef = new Date(refMs + tzOffset * 60 * 60 * 1000);
  const localMidnight = Date.UTC(
    localRef.getUTCFullYear(),
    localRef.getUTCMonth(),
    localRef.getUTCDate()
  );
  const todayStart = new Date(localMidnight - tzOffset * 60 * 60 * 1000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

  // The widest window bounds the scan; every other window is a FILTER on it.
  const scanStart = new Date(Math.min(monthStart.getTime(), yesterdayStart.getTime()));

  const pRef = params.push(reference);
  const pScan = params.push(scanStart);
  const pDay = params.push(dayStart);
  const pYestStart = params.push(yesterdayStart);
  const pYestEnd = params.push(todayStart);
  const pWeek = params.push(weekStart);
  const pMonth = params.push(monthStart);

  // Incremental readings sum directly. Cumulative counters are summed as
  // positive deltas, so LAG is taken across the whole scan and then filtered.
  const sql = `
    WITH readings AS (
      SELECT timestamp,
             ${rainExpr} AS v,
             LAG(${rainExpr}) OVER (ORDER BY timestamp) AS pv
      FROM weather_data
      WHERE station_id = $1
        AND timestamp > $${pScan}
        AND timestamp <= $${pRef}
        AND ${rainExprRaw} IS NOT NULL
        ${tableFilter}
    ), stepped AS (
      SELECT timestamp,
             CASE WHEN v >= 0 AND v < 100 THEN v ELSE 0 END AS inc,
             CASE WHEN pv IS NOT NULL AND v >= pv AND (v - pv) < 100
                  THEN v - pv ELSE 0 END AS delta
      FROM readings
    )
    SELECT
      COUNT(*)::int AS n,
      (SELECT MAX(v) FROM readings) AS mx,
      COALESCE(SUM(inc)   FILTER (WHERE timestamp > $${pDay}), 0)   AS inc_24h,
      COALESCE(SUM(delta) FILTER (WHERE timestamp > $${pDay}), 0)   AS del_24h,
      COALESCE(SUM(inc)   FILTER (WHERE timestamp > $${pYestStart} AND timestamp <= $${pYestEnd}), 0) AS inc_yest,
      COALESCE(SUM(delta) FILTER (WHERE timestamp > $${pYestStart} AND timestamp <= $${pYestEnd}), 0) AS del_yest,
      COALESCE(SUM(inc)   FILTER (WHERE timestamp > $${pWeek}), 0)  AS inc_week,
      COALESCE(SUM(delta) FILTER (WHERE timestamp > $${pWeek}), 0)  AS del_week,
      COALESCE(SUM(inc)   FILTER (WHERE timestamp > $${pMonth}), 0) AS inc_month,
      COALESCE(SUM(delta) FILTER (WHERE timestamp > $${pMonth}), 0) AS del_month
    FROM stepped
  `;

  const result = await postgres.query(sql, params);
  const row = result.rows[0] || {};
  const readings = Number(row.n) || 0;
  const maxVal = Number(row.mx) || 0;

  // Choose incremental vs cumulative once, then use it for every window so the
  // cards cannot disagree with each other.
  let cumulative: boolean;
  let mode: RainfallPeriodTotals['mode'];
  if (cfg) {
    cumulative = cfg.type === 'cumulative_yearly' || cfg.type === 'cumulative_lifetime';
    mode = cfg.type;
  } else {
    // No explicit configuration: a running counter is large, an incremental
    // series is small. Same threshold the client heuristic used.
    cumulative = maxVal > 50;
    mode = cumulative ? 'auto-cumulative' : 'auto-incremental';
  }

  const unit = cfg?.type === 'tip_count' ? (tipFactor > 0 ? tipFactor : DEFAULT_TIP_FACTOR) : 1;
  const pick = (inc: any, del: any) => {
    const raw = cumulative ? Number(del) : Number(inc);
    const total = (Number.isFinite(raw) ? Math.max(0, raw) : 0) * unit;
    return Math.round(total * 100) / 100;
  };

  return {
    last24h: pick(row.inc_24h, row.del_24h),
    yesterday: pick(row.inc_yest, row.del_yest),
    thisWeek: pick(row.inc_week, row.del_week),
    thisMonth: pick(row.inc_month, row.del_month),
    mode,
    readings,
    reference: reference.toISOString(),
    timezoneOffsetHours: tzOffset,
  };
}
