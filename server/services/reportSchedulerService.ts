// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Report Scheduler Service
 *
 * Powers the password-protected /reports portal. Each row in the
 * `report_schedules` table becomes a node-cron task that builds a
 * plain-text + HTML report for one or more stations and sends it via
 * MailerSend (from MAILERSEND_FROM_EMAIL, default noreply@stratusweather.co.za).
 *
 * Frequencies:
 *   daily        - every day at HH:00 SAST
 *   weekly       - every WEEKDAY at HH:00 SAST  (weekday: 0=Sun..6=Sat)
 *   monthly      - on day-of-month at HH:00 SAST
 *
 * Reporting period:
 *   daily        - last 24 hours
 *   weekly       - last 7 days
 *   monthly      - last 30 days
 */

import * as cron from 'node-cron';
import { sendEmail, isEmailConfigured } from './emailService';
import * as pg from '../db-postgres';
import { applyRainfallOffset } from '../config/stationRainfallOffsets';

const REPORTS_TZ = process.env.REPORTS_TZ || 'Africa/Johannesburg';

/** Catalog of selectable fields. label is what the user sees; key is stored. */
export const REPORT_FIELDS = [
  { key: 'temp_min',         label: 'Temperature (minimum)',  unit: 'degC' },
  { key: 'temp_avg',         label: 'Temperature (average)',  unit: 'degC' },
  { key: 'temp_max',         label: 'Temperature (maximum)',  unit: 'degC' },
  { key: 'humidity_avg',     label: 'Humidity (average)',     unit: '%' },
  { key: 'pressure_avg',     label: 'Pressure (average)',     unit: 'mbar' },
  { key: 'wind_avg',         label: 'Wind speed (average)',   unit: 'm/s' },
  { key: 'wind_max',         label: 'Wind speed (maximum)',   unit: 'm/s' },
  { key: 'wind_gust_max',    label: 'Wind gust (maximum)',    unit: 'm/s' },
  { key: 'rainfall_total',   label: 'Rainfall (total)',       unit: 'mm' },
  { key: 'solar_total',      label: 'Solar (total energy)',   unit: 'MJ/m2' },
  { key: 'solar_avg',        label: 'Solar (average)',        unit: 'W/m2' },
  { key: 'eto_total',        label: 'ETo (total)',            unit: 'mm' },
  { key: 'battery_min',      label: 'Battery (minimum)',      unit: 'V' },
  { key: 'battery_avg',      label: 'Battery (average)',      unit: 'V' },
  { key: 'lightning_strikes',label: 'Lightning (total strikes)', unit: '' },
  { key: 'lightning_dist_min', label: 'Lightning (closest distance)', unit: 'km' },
  { key: 'lightning_dist_avg', label: 'Lightning (average distance)', unit: 'km' },
  { key: 'lightning_energy_max', label: 'Lightning (peak intensity)', unit: '' },
  { key: 'lightning_energy_avg', label: 'Lightning (average intensity)', unit: '' },
] as const;

export type ReportFrequency = 'daily' | 'weekly' | 'monthly';

export interface ReportSchedule {
  id: number;
  name: string;
  stationIds: number[];
  fields: string[];
  recipients: string[];
  frequency: ReportFrequency;
  hour: number;          // 0..23 (SAST)
  weekday: number | null;     // 0..6, only for weekly
  dayOfMonth: number | null;  // 1..28, only for monthly
  enabled: boolean;
  lastRunAt: Date | null;
  lastStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Derived, not stored: next fire time for an enabled schedule. */
  nextRunAt?: Date | null;
}

const tasks = new Map<number, cron.ScheduledTask>();
/** Guards against a slow run overlapping its own next tick. */
const running = new Set<number>();

function rowToSchedule(row: any): ReportSchedule {
  return {
    id: row.id,
    name: row.name,
    stationIds: row.station_ids || [],
    fields: row.fields || [],
    recipients: row.recipients || [],
    frequency: row.frequency,
    hour: row.hour,
    weekday: row.weekday,
    dayOfMonth: row.day_of_month,
    enabled: row.enabled,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : null,
    lastStatus: row.last_status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    nextRunAt: row.enabled
      ? computeNextRun({ frequency: row.frequency, hour: row.hour, weekday: row.weekday, dayOfMonth: row.day_of_month })
      : null,
  };
}

/**
 * Offset between UTC and REPORTS_TZ at a given instant, in ms.
 * Africa/Johannesburg has no DST, so this is exact for the default config;
 * for a DST zone the computed next-run can be off by an hour across the
 * transition (display only - node-cron still fires on the correct wall time).
 */
function tzOffsetMs(at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORTS_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const asUTC = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return asUTC - (at.getTime() - at.getMilliseconds());
}

/** Next fire time for a schedule, expressed as a real (UTC) instant. */
export function computeNextRun(
  s: { frequency: ReportFrequency; hour: number; weekday: number | null; dayOfMonth: number | null },
  from: Date = new Date(),
): Date | null {
  const hour = Math.max(0, Math.min(23, Number(s.hour) || 0));
  const offset = tzOffsetMs(from);
  const local = new Date(from.getTime() + offset);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth();
  const day = local.getUTCDate();
  // Date.UTC normalises day/month overflow, so day+1 / month+1 are safe.
  const at = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd, hour, 0, 0) - offset);

  if (s.frequency === 'daily') {
    const today = at(y, mo, day);
    return today > from ? today : at(y, mo, day + 1);
  }
  if (s.frequency === 'weekly') {
    const target = s.weekday == null ? 1 : Math.max(0, Math.min(6, s.weekday));
    const delta = (target - local.getUTCDay() + 7) % 7;
    const candidate = at(y, mo, day + delta);
    return candidate > from ? candidate : at(y, mo, day + delta + 7);
  }
  if (s.frequency === 'monthly') {
    const dom = s.dayOfMonth == null ? 1 : Math.max(1, Math.min(28, s.dayOfMonth));
    const candidate = at(y, mo, dom);
    return candidate > from ? candidate : at(y, mo + 1, dom);
  }
  return null;
}

function cronExprFor(s: ReportSchedule): string | null {
  const h = Math.max(0, Math.min(23, s.hour));
  if (s.frequency === 'daily') return `0 ${h} * * *`;
  if (s.frequency === 'weekly') {
    const wd = s.weekday == null ? 1 : Math.max(0, Math.min(6, s.weekday));
    return `0 ${h} * * ${wd}`;
  }
  if (s.frequency === 'monthly') {
    const dom = s.dayOfMonth == null ? 1 : Math.max(1, Math.min(28, s.dayOfMonth));
    return `0 ${h} ${dom} * *`;
  }
  return null;
}

function periodFor(freq: ReportFrequency): { startMs: number; endMs: number; label: string } {
  const now = Date.now();
  if (freq === 'daily')   return { startMs: now - 24 * 3600000,      endMs: now, label: 'last 24 hours' };
  if (freq === 'weekly')  return { startMs: now - 7 * 24 * 3600000,  endMs: now, label: 'last 7 days' };
  return                       { startMs: now - 30 * 24 * 3600000, endMs: now, label: 'last 30 days' };
}

/** Exposed for the PDF report service so it shares the exact period rules. */
export function getReportPeriod(freq: ReportFrequency) { return periodFor(freq); }

export interface FieldStat { value: number | null; readings: number; }

const RAIN_COALESCE = `COALESCE(
  data->>'Rain_mm_Tot', data->>'Rain_Tot', data->>'Precip_Tot',
  data->>'Rain_1_Tot', data->>'Rain_Tot_1',
  data->>'rainfall', data->>'Rain_mm', data->>'Precip',
  data->>'Rain', data->>'Rainfall'
)::numeric`;

const TEMP_COALESCE = `COALESCE(data->>'temperature', data->>'AirTC_Avg', data->>'AirTemp', data->>'Temp_Avg', data->>'AirTemp_Avg', data->>'AirTC', data->>'Temp_C', data->>'Temperature')::numeric`;
const HUMIDITY_COALESCE = `COALESCE(data->>'humidity', data->>'RH_Avg', data->>'RH', data->>'RelHumidity_Avg', data->>'RelHumidity', data->>'Humidity')::numeric`;
const PRESSURE_COALESCE = `COALESCE(data->>'pressure', data->>'BP_mbar', data->>'Pressure', data->>'Pressure_Avg', data->>'BaroPressure_Avg', data->>'BP_Avg', data->>'BaroPres', data->>'BP_mbar_Avg', data->>'BPress_Avg', data->>'BPress')::numeric`;
const WIND_COALESCE = `COALESCE(data->>'windSpeed', data->>'WS_ms_Avg', data->>'WindSpeed', data->>'Wind_Spd_S_WVT', data->>'WindSpeed_Avg', data->>'WS_ms', data->>'WS_Avg', data->>'WS_ms_S_WVT', data->>'WSpd_1_Avg', data->>'WSpd_Avg', data->>'WSpd_1_S_WVT')::numeric`;
const GUST_COALESCE = `COALESCE(data->>'windGust', data->>'WS_ms_Max', data->>'Wind_Spd_Max', data->>'WindSpeed_Max', data->>'WS_Max', data->>'Wind_Gust', data->>'WSpd_1_Max', data->>'WSpd_Max')::numeric`;
const SOLAR_COALESCE = `COALESCE(data->>'solarRadiation', data->>'SlrW', data->>'Solar', data->>'Solar_Rad_Avg', data->>'SolarRad_Avg', data->>'SlrW_Avg', data->>'SR_Avg')::numeric`;
const SOLAR_MJ_COALESCE = `COALESCE(data->>'solarMJTotal', data->>'SlrMJ_Tot', data->>'SlrMJ', data->>'Solar_MJ_Tot')::numeric`;
const BATTERY_COALESCE = `COALESCE(data->>'batteryVoltage', data->>'BattV', data->>'BattV_Min', data->>'Batt_volt_Min', data->>'BattV_Avg', data->>'Batt_V', data->>'LoggerBattery_Avg', data->>'LoggerBattery')::numeric`;
const LIGHTNING_COALESCE = `COALESCE(data->>'lightning', data->>'Lightning_Tot', data->>'Lightning_Count', data->>'Lightning')::numeric`;
const LIGHTNING_DIST_COALESCE = `COALESCE(data->>'lightningDistance', data->>'LightningDist', data->>'Lightning_Dist')::numeric`;
const LIGHTNING_ENERGY_COALESCE = `COALESCE(data->>'lightningEnergy', data->>'LightningEnergy', data->>'Lightning_Energy')::numeric`;

/**
 * FAO-56 Penman-Monteith reference evapotranspiration (mm/day).
 * Mirrors calculateETo in shared/utils/calc.ts - the server build has
 * rootDir=./server and excludes shared/, so it is duplicated deliberately.
 */
function fao56Eto(
  tMean: number, rh: number, u2: number, rsMJ: number,
  altitude: number, latitude: number, dayOfYear: number,
): number {
  const P = 101.3 * Math.pow((293 - 0.0065 * altitude) / 293, 5.26);
  const gamma = 0.665e-3 * P;
  const es = 0.6108 * Math.exp((17.27 * tMean) / (tMean + 237.3));
  const delta = (4098 * es) / Math.pow(tMean + 237.3, 2);
  const ea = (es * rh) / 100;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365);
  const decl = 0.409 * Math.sin((2 * Math.PI * dayOfYear) / 365 - 1.39);
  const phi = (latitude * Math.PI) / 180;
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(decl))));
  const Ra = ((24 * 60) / Math.PI) * 0.082 * dr *
    (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
  const Rso = (0.75 + 2e-5 * altitude) * Ra;
  const Rns = 0.77 * rsMJ;
  const Tk = tMean + 273.16;
  const clearness = Rso > 0 ? Math.max(0, Math.min(1, rsMJ / Rso)) : 0.5;
  const Rnl = 4.903e-9 * Math.pow(Tk, 4) * (0.34 - 0.14 * Math.sqrt(Math.max(ea, 0))) * (1.35 * clearness - 0.35);
  const Rn = Rns - Rnl;
  const eto = (0.408 * delta * Rn + gamma * (900 / (tMean + 273)) * u2 * (es - ea)) /
    (delta + gamma * (1 + 0.34 * u2));
  return Math.max(0, eto);
}

/**
 * Sum daily FAO-56 ETo across the reporting period.
 *
 * Daily means are aggregated in SQL (grouped by local calendar day) so a
 * 30-day report stays a single round trip. Falls back to the old
 * solar-energy approximation if the station has no latitude on file or the
 * timezone-aware grouping is unavailable.
 */
async function computeEtoTotal(
  stationId: number,
  start: Date,
  end: Date,
  latitude: number | null,
  altitude: number,
): Promise<FieldStat> {
  const approximate = async (): Promise<FieldStat> => {
    const r = await pg.query(
      `SELECT SUM(${SOLAR_MJ_COALESCE}) AS s, COUNT(*) AS n FROM weather_data
        WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3`,
      [stationId, start, end],
    );
    const mjSum = r.rows[0].s != null ? Number(r.rows[0].s) : 0;
    return { value: mjSum > 0 ? Math.round(mjSum * 0.5 * 100) / 100 : 0, readings: Number(r.rows[0].n) };
  };

  if (latitude == null) return approximate();

  try {
    const r = await pg.query(`
      SELECT (timestamp AT TIME ZONE 'UTC' AT TIME ZONE $4)::date AS day,
             AVG(${TEMP_COALESCE})     AS t_avg,
             AVG(${HUMIDITY_COALESCE}) AS rh_avg,
             AVG(${WIND_COALESCE})     AS u_avg,
             AVG(${SOLAR_COALESCE})    AS solar_w_avg,
             SUM(${SOLAR_MJ_COALESCE}) AS solar_mj,
             COUNT(*)                  AS n
        FROM weather_data
       WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3
       GROUP BY day
       ORDER BY day
    `, [stationId, start, end, REPORTS_TZ]);

    let total = 0;
    let days = 0;
    for (const row of r.rows) {
      const t = row.t_avg != null ? Number(row.t_avg) : null;
      const rh = row.rh_avg != null ? Number(row.rh_avg) : null;
      const u = row.u_avg != null ? Number(row.u_avg) : 1;
      const solarMJ = row.solar_mj != null ? Number(row.solar_mj) : 0;
      const solarW = row.solar_w_avg != null ? Number(row.solar_w_avg) : null;
      // Prefer the logger's MJ total; otherwise integrate the mean W/m2.
      const rsMJ = solarMJ > 0 ? solarMJ : (solarW != null ? (solarW * 86400) / 1e6 : null);
      if (t == null || rh == null || rsMJ == null) continue;
      const day = new Date(`${new Date(row.day).toISOString().slice(0, 10)}T12:00:00Z`);
      const doy = Math.floor((day.getTime() - Date.UTC(day.getUTCFullYear(), 0, 0)) / 86400000);
      total += fao56Eto(t, rh, u, rsMJ, altitude, latitude, doy);
      days++;
    }
    if (days === 0) return approximate();
    return { value: Math.round(total * 100) / 100, readings: days };
  } catch (err: any) {
    console.warn(`[Reports] FAO-56 ETo aggregation failed for station ${stationId}, using approximation:`, err?.message || err);
    return approximate();
  }
}

export async function gatherStationData(
  stationId: number,
  startMs: number,
  endMs: number,
  fields: Set<string>
): Promise<{
  name: string;
  stats: Record<string, FieldStat>;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}> {
  // Longitude is selected alongside latitude and altitude so the email body can
  // print the full site geometry. Latitude and altitude are also used below for
  // the FAO-56 ETo calculation.
  const stationRow = await pg.query(`SELECT name, latitude, longitude, altitude FROM stations WHERE id = $1`, [stationId]);
  const name = stationRow.rows[0]?.name || `Station ${stationId}`;
  const stationLat = stationRow.rows[0]?.latitude != null ? Number(stationRow.rows[0].latitude) : null;
  const stationLon = stationRow.rows[0]?.longitude != null ? Number(stationRow.rows[0].longitude) : null;
  const stationAlt = stationRow.rows[0]?.altitude != null ? Number(stationRow.rows[0].altitude) : 0;
  // ETo needs a number and treats a missing altitude as sea level, but the
  // header must distinguish "0 m" from "not recorded", so keep the raw value.
  const reportedAlt = stationRow.rows[0]?.altitude != null ? Number(stationRow.rows[0].altitude) : null;

  const stats: Record<string, FieldStat> = {};
  const start = new Date(startMs);
  const end = new Date(endMs);

  // ── Temperature / humidity / pressure / wind / battery / solar (avg/min/max) ──
  if (fields.has('temp_min') || fields.has('temp_avg') || fields.has('temp_max')) {
    const r = await pg.query(`
      SELECT MIN(${TEMP_COALESCE}) AS mn, AVG(${TEMP_COALESCE}) AS av, MAX(${TEMP_COALESCE}) AS mx, COUNT(*) AS n
      FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3
        AND ${TEMP_COALESCE} IS NOT NULL
    `, [stationId, start, end]);
    const row = r.rows[0];
    const n = Number(row.n);
    if (fields.has('temp_min')) stats['temp_min'] = { value: row.mn != null ? Number(row.mn) : null, readings: n };
    if (fields.has('temp_avg')) stats['temp_avg'] = { value: row.av != null ? Number(row.av) : null, readings: n };
    if (fields.has('temp_max')) stats['temp_max'] = { value: row.mx != null ? Number(row.mx) : null, readings: n };
  }
  if (fields.has('humidity_avg')) {
    const r = await pg.query(`SELECT AVG(${HUMIDITY_COALESCE}) AS av, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3 AND ${HUMIDITY_COALESCE} IS NOT NULL`, [stationId, start, end]);
    stats['humidity_avg'] = { value: r.rows[0].av != null ? Number(r.rows[0].av) : null, readings: Number(r.rows[0].n) };
  }
  if (fields.has('pressure_avg')) {
    const r = await pg.query(`SELECT AVG(${PRESSURE_COALESCE}) AS av, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3 AND ${PRESSURE_COALESCE} IS NOT NULL`, [stationId, start, end]);
    stats['pressure_avg'] = { value: r.rows[0].av != null ? Number(r.rows[0].av) : null, readings: Number(r.rows[0].n) };
  }
  if (fields.has('wind_avg') || fields.has('wind_max')) {
    const r = await pg.query(`SELECT AVG(${WIND_COALESCE}) AS av, MAX(${WIND_COALESCE}) AS mx, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3 AND ${WIND_COALESCE} IS NOT NULL`, [stationId, start, end]);
    const n = Number(r.rows[0].n);
    if (fields.has('wind_avg')) stats['wind_avg'] = { value: r.rows[0].av != null ? Number(r.rows[0].av) : null, readings: n };
    if (fields.has('wind_max')) stats['wind_max'] = { value: r.rows[0].mx != null ? Number(r.rows[0].mx) : null, readings: n };
  }
  if (fields.has('wind_gust_max')) {
    const r = await pg.query(`SELECT MAX(${GUST_COALESCE}) AS mx, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3 AND ${GUST_COALESCE} IS NOT NULL`, [stationId, start, end]);
    stats['wind_gust_max'] = { value: r.rows[0].mx != null ? Number(r.rows[0].mx) : null, readings: Number(r.rows[0].n) };
  }
  if (fields.has('solar_avg') || fields.has('solar_total')) {
    const r = await pg.query(`SELECT AVG(${SOLAR_COALESCE}) AS av, SUM(${SOLAR_MJ_COALESCE}) AS mj_sum, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3`, [stationId, start, end]);
    if (fields.has('solar_avg')) stats['solar_avg'] = { value: r.rows[0].av != null ? Number(r.rows[0].av) : null, readings: Number(r.rows[0].n) };
    if (fields.has('solar_total')) stats['solar_total'] = { value: r.rows[0].mj_sum != null ? Number(r.rows[0].mj_sum) : null, readings: Number(r.rows[0].n) };
  }
  if (fields.has('battery_min') || fields.has('battery_avg')) {
    const r = await pg.query(`SELECT MIN(${BATTERY_COALESCE}) AS mn, AVG(${BATTERY_COALESCE}) AS av, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3 AND ${BATTERY_COALESCE} IS NOT NULL`, [stationId, start, end]);
    const n = Number(r.rows[0].n);
    if (fields.has('battery_min')) stats['battery_min'] = { value: r.rows[0].mn != null ? Number(r.rows[0].mn) : null, readings: n };
    if (fields.has('battery_avg')) stats['battery_avg'] = { value: r.rows[0].av != null ? Number(r.rows[0].av) : null, readings: n };
  }

  // ── Rainfall total - use cumulative-aware delta sum with per-station offset ──
  if (fields.has('rainfall_total')) {
    const r = await pg.query(`
      WITH r AS (
        SELECT timestamp, ${RAIN_COALESCE} AS v,
               LAG(${RAIN_COALESCE}) OVER (ORDER BY timestamp) AS pv
        FROM weather_data
        WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3
          AND ${RAIN_COALESCE} IS NOT NULL
      )
      SELECT COUNT(*) AS n, MAX(v) AS mx,
             SUM(CASE WHEN v > 0 AND v < 100 THEN v ELSE 0 END) AS sum_inc,
             SUM(CASE WHEN pv IS NOT NULL AND v >= pv AND (v - pv) < 100 THEN v - pv ELSE 0 END) AS delta_sum
      FROM r
    `, [stationId, start, end]);
    const row = r.rows[0];
    const n = Number(row.n);
    if (n === 0) {
      stats['rainfall_total'] = { value: 0, readings: 0 };
    } else {
      const maxV = Number(row.mx);
      // Same heuristic as the dashboard: small max => incremental; large max => cumulative deltas
      let total: number;
      if (maxV <= 50) total = Number(row.sum_inc);
      else total = Number(row.delta_sum);
      // Apply per-station rainfall offset clamp at the boundary (same transform applied
      // to live readings via mapToWeatherData, so totals correlate with dashboard).
      const offsetApplied = applyRainfallOffset(stationId, total);
      stats['rainfall_total'] = { value: offsetApplied != null ? Math.max(0, offsetApplied) : null, readings: n };
    }
  }

  // ── ETo total: proper FAO-56 Penman-Monteith, summed over whole days ──
  if (fields.has('eto_total')) {
    stats['eto_total'] = await computeEtoTotal(stationId, start, end, stationLat, stationAlt);
  }

  // ── Lightning ──
  if (fields.has('lightning_strikes')) {
    // Count strikes = positive deltas in the cumulative counter (same as rainfall pattern)
    const r = await pg.query(`
      WITH r AS (
        SELECT timestamp, ${LIGHTNING_COALESCE} AS v,
               LAG(${LIGHTNING_COALESCE}) OVER (ORDER BY timestamp) AS pv
        FROM weather_data
        WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3
          AND ${LIGHTNING_COALESCE} IS NOT NULL
      )
      SELECT MAX(v) AS mx,
             SUM(CASE WHEN pv IS NOT NULL AND v > pv AND (v - pv) < 1000 THEN v - pv ELSE 0 END) AS delta_sum,
             SUM(CASE WHEN pv IS NOT NULL AND v > pv AND (v - pv) < 1000 THEN v - pv ELSE 0 END) AS strike_count
      FROM r
    `, [stationId, start, end]);
    const row = r.rows[0];
    let total = 0;
    if (row.delta_sum != null) {
      // Lightning is a cumulative counter: total strikes during the period
      // is the sum of positive deltas between consecutive readings.
      total = Number(row.delta_sum);
    }
    // Report "readings" as the number of detected strikes so it matches the
    // event count used by the other lightning metrics (distance / intensity).
    stats['lightning_strikes'] = { value: Math.round(total), readings: Math.round(total) };
  }
  if (fields.has('lightning_dist_min') || fields.has('lightning_dist_avg')) {
    const r = await pg.query(`SELECT MIN(${LIGHTNING_DIST_COALESCE}) AS mn, AVG(${LIGHTNING_DIST_COALESCE}) AS av, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3 AND ${LIGHTNING_DIST_COALESCE} IS NOT NULL AND ${LIGHTNING_DIST_COALESCE} > 0`, [stationId, start, end]);
    const n = Number(r.rows[0].n);
    if (fields.has('lightning_dist_min')) stats['lightning_dist_min'] = { value: r.rows[0].mn != null ? Number(r.rows[0].mn) : null, readings: n };
    if (fields.has('lightning_dist_avg')) stats['lightning_dist_avg'] = { value: r.rows[0].av != null ? Number(r.rows[0].av) : null, readings: n };
  }
  if (fields.has('lightning_energy_max') || fields.has('lightning_energy_avg')) {
    const r = await pg.query(`SELECT MAX(${LIGHTNING_ENERGY_COALESCE}) AS mx, AVG(${LIGHTNING_ENERGY_COALESCE}) AS av, COUNT(*) AS n FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3 AND ${LIGHTNING_ENERGY_COALESCE} IS NOT NULL AND ${LIGHTNING_ENERGY_COALESCE} > 0`, [stationId, start, end]);
    const n = Number(r.rows[0].n);
    if (fields.has('lightning_energy_max')) stats['lightning_energy_max'] = { value: r.rows[0].mx != null ? Number(r.rows[0].mx) : null, readings: n };
    if (fields.has('lightning_energy_avg')) stats['lightning_energy_avg'] = { value: r.rows[0].av != null ? Number(r.rows[0].av) : null, readings: n };
  }

  return {
    name, stats,
    latitude: stationLat,
    longitude: stationLon,
    altitude: reportedAlt,
  };
}

function fmtVal(v: number | null, decimals = 1): string {
  if (v == null || isNaN(v)) return 'n/a';
  return v.toFixed(decimals);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface RenderRow {
  label: string;
  value: string;
  unit: string;
  readings: number;
  /**
   * What the count represents. Most rows aggregate raw logger readings, but a
   * daily quantity like ETo aggregates one value per calendar day, so its
   * count is a number of days - not readings. Labelling that "31 readings"
   * next to "718 readings" looks like missing data, so ETo says "days".
   */
  countNoun?: string;
}

/**
 * Site geometry as a single plain-text line, shared by the email body and the
 * PDF header so the two can never word it differently.
 *
 * Written in decimal degrees with an explicit hemisphere letter rather than a
 * signed number, because a signed latitude on a printed report is easy to
 * misread. Altitude is metres above mean sea level.
 *
 * ASCII only. In the PDF this string passes through pdfSafe() and PDFKit's
 * built-in Helvetica is WinAnsi-encoded, so the degree sign is deliberately
 * omitted, the same reason the rest of the report writes "degC".
 *
 * Returns null when the station has neither coordinates nor an altitude
 * recorded, so callers can omit the line rather than print "not set".
 */
export function formatSiteLine(meta: {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}): string | null {
  const parts: string[] = [];

  const lat = meta.latitude;
  const lon = meta.longitude;
  if (lat != null && Number.isFinite(lat) && lon != null && Number.isFinite(lon)) {
    parts.push(`Lat ${Math.abs(lat).toFixed(5)} ${lat >= 0 ? 'N' : 'S'}`);
    parts.push(`Lon ${Math.abs(lon).toFixed(5)} ${lon >= 0 ? 'E' : 'W'}`);
  }

  const alt = meta.altitude;
  if (alt != null && Number.isFinite(alt)) {
    parts.push(`Altitude ${Math.round(alt)} m AMSL`);
  }

  return parts.length ? parts.join('  |  ') : null;
}

interface StationSection {
  name: string;
  stationId: number | null;
  rows: RenderRow[];
  emptyMessage?: string;
  /**
   * Site geometry, already formatted for display by formatSiteLine(). Null when
   * the station has no coordinates or altitude recorded, in which case the line
   * is omitted rather than showing a placeholder.
   */
  siteLine?: string | null;
}

function renderEmail(opts: {
  title: string;
  periodLabel: string;
  fromLabel: string;
  toLabel: string;
  sections: StationSection[];
  frequencyLabel: string;
  notes?: string[];
}): { text: string; html: string } {
  const { title, periodLabel, fromLabel, toLabel, sections, frequencyLabel, notes } = opts;

  // ── plain text ──
  const tLines: string[] = [];
  tLines.push(title);
  tLines.push('='.repeat(Math.min(title.length, 60)));
  tLines.push('');
  tLines.push(`Period:    ${periodLabel}`);
  tLines.push(`From:      ${fromLabel}`);
  tLines.push(`To:        ${toLabel}`);
  tLines.push(`Frequency: ${frequencyLabel}`);
  tLines.push('');
  for (const sec of sections) {
    const heading = sec.stationId != null ? `${sec.name} (id ${sec.stationId})` : sec.name;
    tLines.push(heading);
    tLines.push('-'.repeat(Math.min(heading.length, 60)));
    // Site geometry sits directly under the station heading: reference ETo is a
    // function of latitude and altitude, so the reader needs them to reproduce
    // the derived figures below.
    if (sec.siteLine) {
      tLines.push(`  ${sec.siteLine}`);
      tLines.push('');
    }
    if (sec.rows.length === 0) {
      tLines.push(sec.emptyMessage || '  (no data)');
    } else {
      for (const r of sec.rows) {
        const v = r.unit ? `${r.value} ${r.unit}` : r.value;
        const tag = r.readings > 0 ? `(${r.readings} ${r.countNoun || 'readings'})` : '(no data)';
        tLines.push(`  ${r.label.padEnd(40)} ${v.padEnd(14)} ${tag}`);
      }
    }
    tLines.push('');
  }
  if (notes && notes.length) {
    tLines.push('Notes:');
    for (const n of notes) tLines.push(`  - ${n}`);
    tLines.push('');
  }
  tLines.push('Stratus Weather');
  tLines.push('https://stratusweather.co.za/reports');
  const text = tLines.join('\n');

  // ── HTML ──
  const sectionsHtml = sections.map(sec => {
    const heading = sec.stationId != null ? `${escapeHtml(sec.name)} (id ${sec.stationId})` : escapeHtml(sec.name);
    // Site geometry under the station heading. Rendered for the no-data case too,
    // since where the station is remains useful even when it reported nothing.
    const siteHtml = sec.siteLine
      ? `<p style="margin:6px 0 0 0;font-size:12px;color:#64748b;">${escapeHtml(sec.siteLine)}</p>`
      : '';
    if (sec.rows.length === 0) {
      return `<h3 style="margin:24px 0 8px 0;font-size:15px;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">${heading}</h3>
              ${siteHtml}
              <p style="margin:8px 0;color:#64748b;font-size:13px;">${escapeHtml(sec.emptyMessage || 'No data available for this period.')}</p>`;
    }
    const rowsHtml = sec.rows.map(r => {
      const v = r.unit ? `${escapeHtml(r.value)} <span style="color:#64748b;">${escapeHtml(r.unit)}</span>` : escapeHtml(r.value);
      const tag = r.readings > 0 ? `${r.readings} ${escapeHtml(r.countNoun || 'readings')}` : 'no data';
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">${escapeHtml(r.label)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;text-align:right;font-variant-numeric:tabular-nums;">${v}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#94a3b8;text-align:right;">${tag}</td>
      </tr>`;
    }).join('');
    return `<h3 style="margin:24px 0 8px 0;font-size:15px;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">${heading}</h3>
            ${siteHtml}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowsHtml}</table>`;
  }).join('');

  const notesHtml = (notes && notes.length)
    ? `<div style="margin-top:24px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
         <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.5px;">Notes</p>
         <ul style="margin:0;padding-left:20px;color:#475569;font-size:13px;line-height:1.5;">
           ${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}
         </ul>
       </div>` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;letter-spacing:1px;color:#64748b;text-transform:uppercase;">Stratus Weather Report</p>
        <h1 style="margin:6px 0 0 0;font-size:22px;color:#0f172a;font-weight:600;">${escapeHtml(title)}</h1>
      </td></tr>
      <tr><td style="padding:20px 32px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#475569;">
          <tr><td style="padding:2px 0;width:90px;color:#94a3b8;">Period</td><td style="padding:2px 0;color:#0f172a;">${escapeHtml(periodLabel)}</td></tr>
          <tr><td style="padding:2px 0;color:#94a3b8;">From</td><td style="padding:2px 0;color:#0f172a;">${escapeHtml(fromLabel)}</td></tr>
          <tr><td style="padding:2px 0;color:#94a3b8;">To</td><td style="padding:2px 0;color:#0f172a;">${escapeHtml(toLabel)}</td></tr>
          <tr><td style="padding:2px 0;color:#94a3b8;">Frequency</td><td style="padding:2px 0;color:#0f172a;">${escapeHtml(frequencyLabel)}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:8px 32px 24px 32px;">
        ${sectionsHtml}
        ${notesHtml}
      </td></tr>
      <tr><td style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 8px 8px;">
        <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;">
          This report was generated automatically by Stratus Weather. To manage report schedules,
          visit <a href="https://stratusweather.co.za/reports" style="color:#2563eb;text-decoration:none;">stratusweather.co.za/reports</a>.
        </p>
        <p style="margin:8px 0 0 0;font-size:11px;color:#94a3b8;">
          Sent from noreply@stratusweather.co.za. Please do not reply to this address.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { text, html };
}

function periodLabelFromFreq(freq: ReportFrequency): string {
  if (freq === 'daily') return 'Last 24 hours';
  if (freq === 'weekly') return 'Last 7 days';
  return 'Last 30 days';
}

function frequencyLabelFromFreq(freq: ReportFrequency, hour: number, weekday: number | null, dom: number | null): string {
  const hh = String(hour).padStart(2, '0');
  if (freq === 'daily') return `Daily at ${hh}:00 SAST`;
  if (freq === 'weekly') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `Weekly on ${days[weekday ?? 1]} at ${hh}:00 SAST`;
  }
  return `Monthly on day ${dom ?? 1} at ${hh}:00 SAST`;
}

export async function buildReportBody(s: ReportSchedule): Promise<{ subject: string; text: string; html: string; }> {
  const { startMs, endMs } = periodFor(s.frequency);
  const fieldSet = new Set(s.fields);
  const sastNow = new Date(endMs).toLocaleString('en-ZA', { timeZone: REPORTS_TZ });
  const sastStart = new Date(startMs).toLocaleString('en-ZA', { timeZone: REPORTS_TZ });
  const periodLabel = periodLabelFromFreq(s.frequency);
  const freqLabel = frequencyLabelFromFreq(s.frequency, s.hour, s.weekday, s.dayOfMonth);

  const sections: StationSection[] = [];
  for (const stationId of s.stationIds) {
    const { name, stats, latitude, longitude, altitude } =
      await gatherStationData(stationId, startMs, endMs, fieldSet);
    const rows: RenderRow[] = [];
    for (const f of REPORT_FIELDS) {
      if (!fieldSet.has(f.key)) continue;
      const stat = stats[f.key];
      const decimals = f.key === 'lightning_strikes' ? 0 : (f.unit === '%' || f.unit === 'mbar' ? 1 : 2);
      rows.push({
        label: f.label,
        value: stat ? fmtVal(stat.value, decimals) : 'n/a',
        unit: f.unit,
        readings: stat ? stat.readings : 0,
        // ETo is a daily total, so its count is days, not raw readings.
        countNoun: f.key === 'eto_total' ? 'days' : 'readings',
      });
    }
    const anyData = rows.some(r => r.readings > 0);
    sections.push({
      name,
      stationId,
      rows: anyData ? rows : [],
      emptyMessage: 'No readings recorded for this station during the selected period.',
      siteLine: formatSiteLine({ latitude, longitude, altitude }),
    });
  }

  const { text, html } = renderEmail({
    title: s.name,
    periodLabel,
    fromLabel: `${sastStart} SAST`,
    toLabel: `${sastNow} SAST`,
    sections,
    frequencyLabel: freqLabel,
  });

  const subject = `Stratus Weather Report: ${s.name} (${periodLabel})`;
  return { subject, text, html };
}

/**
 * Build a synthetic lightning report (no station, fabricated data) for
 * demonstration purposes. Used by POST /api/reports/send-demo.
 */
export function buildDemoLightningReport(): { subject: string; text: string; html: string } {
  const endMs = Date.now();
  const startMs = endMs - 24 * 3600 * 1000;
  const sastNow = new Date(endMs).toLocaleString('en-ZA', { timeZone: REPORTS_TZ });
  const sastStart = new Date(startMs).toLocaleString('en-ZA', { timeZone: REPORTS_TZ });

  const rows: RenderRow[] = [
    { label: 'Lightning (total strikes)',       value: '47',   unit: '',   readings: 47 },
    { label: 'Lightning (closest distance)',    value: '2.3',  unit: 'km', readings: 47 },
    { label: 'Lightning (average distance)',    value: '11.8', unit: 'km', readings: 47 },
    { label: 'Lightning (peak intensity)',      value: '218',  unit: '',   readings: 47 },
    { label: 'Lightning (average intensity)',   value: '74',   unit: '',   readings: 47 },
  ];

  const sections: StationSection[] = [
    { name: 'Demonstration sensor', stationId: null, rows },
  ];

  const { text, html } = renderEmail({
    title: 'Lightning Activity (Demonstration)',
    periodLabel: 'Last 24 hours',
    fromLabel: `${sastStart} SAST`,
    toLabel: `${sastNow} SAST`,
    sections,
    frequencyLabel: 'On demand (demonstration)',
    notes: [
      'This is a demonstration report. The figures shown are illustrative and do not reflect any real measurements.',
      'When connected to a live station, intensity values are reported in raw sensor units (typically 0-1023).',
      'Closest distance is the minimum range of any detected strike during the reporting period.',
    ],
  });

  return {
    subject: 'Stratus Weather Report: Lightning Activity (Demonstration)',
    text,
    html,
  };
}

async function runSchedule(s: ReportSchedule): Promise<{ ok: boolean; message: string }> {
  if (running.has(s.id)) {
    console.warn(`[Reports] Schedule "${s.name}" (#${s.id}) is still running, skipping this tick.`);
    return { ok: false, message: 'previous run still in progress' };
  }
  running.add(s.id);
  try {
    return await runScheduleInner(s);
  } finally {
    running.delete(s.id);
  }
}

async function runScheduleInner(s: ReportSchedule): Promise<{ ok: boolean; message: string }> {
  if (!isEmailConfigured()) {
    const msg = 'MailerSend not configured';
    await pg.query(`UPDATE report_schedules SET last_run_at = NOW(), last_status = $1 WHERE id = $2`, [`error: ${msg}`, s.id]);
    return { ok: false, message: msg };
  }
  if (!s.recipients?.length) {
    await pg.query(`UPDATE report_schedules SET last_run_at = NOW(), last_status = $1 WHERE id = $2`, ['error: no recipients', s.id]);
    return { ok: false, message: 'no recipients' };
  }
  if (!s.stationIds?.length) {
    await pg.query(`UPDATE report_schedules SET last_run_at = NOW(), last_status = $1 WHERE id = $2`, ['error: no stations', s.id]);
    return { ok: false, message: 'no stations' };
  }
  try {
    const { subject, text, html } = await buildReportBody(s);

    // Build a PDF attachment so recipients also get charts, wind roses
    // and summary tables. Failure here must NOT block the email - the
    // text/html body is still useful on its own.
    let attachments: Array<{ filename: string; content: Buffer; contentType?: string }> | undefined;
    let pdfNote = 'no PDF';
    try {
      const { buildSchedulePdfBuffer } = await import('./pdfReportService');
      const { startMs, endMs } = periodFor(s.frequency);
      const periodLabel = periodLabelFromFreq(s.frequency);
      const pdf = await buildSchedulePdfBuffer({
        stationIds: s.stationIds,
        startMs, endMs,
        fields: s.fields,
        title: s.name,
        periodLabel,
      });
      const dateStr = new Date(endMs).toISOString().slice(0, 10);
      const safeName = s.name.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'report';
      attachments = [{
        filename: `${safeName}-${dateStr}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }];
      pdfNote = `PDF ${Math.round(pdf.length / 1024)} KB`;
    } catch (pdfErr: any) {
      pdfNote = 'PDF failed';
      console.warn(`[Reports] PDF attachment failed for "${s.name}" (#${s.id}):`, pdfErr?.message || pdfErr);
    }

    // One retry: MailerSend occasionally 429s or drops a connection, and a
    // scheduled report only gets one shot per period.
    let sent = await sendEmail({ to: s.recipients, subject, text, html, attachments });
    if (!sent) {
      console.warn(`[Reports] First send attempt failed for "${s.name}" (#${s.id}), retrying in 5s...`);
      await new Promise((r) => setTimeout(r, 5000));
      sent = await sendEmail({ to: s.recipients, subject, text, html, attachments });
    }

    const status = sent
      ? `sent to ${s.recipients.length} recipient(s) (${pdfNote})`
      : `send failed (${pdfNote})`;
    await pg.query(`UPDATE report_schedules SET last_run_at = NOW(), last_status = $1 WHERE id = $2`, [status, s.id]);
    const next = computeNextRun(s);
    console.log(`[Reports] Schedule "${s.name}" (#${s.id}): ${status}${next ? `; next run ${next.toISOString()}` : ''}`);
    return { ok: sent, message: status };
  } catch (err: any) {
    const msg = err.message || String(err);
    await pg.query(`UPDATE report_schedules SET last_run_at = NOW(), last_status = $1 WHERE id = $2`, [`error: ${msg}`, s.id]);
    console.error(`[Reports] Schedule "${s.name}" (#${s.id}) failed:`, msg);
    return { ok: false, message: msg };
  }
}

async function loadAll(): Promise<ReportSchedule[]> {
  const r = await pg.query(`SELECT * FROM report_schedules ORDER BY id`);
  return r.rows.map(rowToSchedule);
}

export async function getAllSchedules(): Promise<ReportSchedule[]> {
  return loadAll();
}

export async function getSchedule(id: number): Promise<ReportSchedule | null> {
  const r = await pg.query(`SELECT * FROM report_schedules WHERE id = $1`, [id]);
  return r.rows[0] ? rowToSchedule(r.rows[0]) : null;
}

export interface CreateScheduleInput {
  name: string;
  stationIds: number[];
  fields: string[];
  recipients: string[];
  frequency: ReportFrequency;
  hour: number;
  weekday?: number | null;
  dayOfMonth?: number | null;
  enabled?: boolean;
}

export async function createSchedule(input: CreateScheduleInput): Promise<ReportSchedule> {
  const r = await pg.query(`
    INSERT INTO report_schedules (name, station_ids, fields, recipients, frequency, hour, weekday, day_of_month, enabled)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    input.name, input.stationIds, input.fields, input.recipients,
    input.frequency, input.hour,
    input.frequency === 'weekly' ? (input.weekday ?? 1) : null,
    input.frequency === 'monthly' ? (input.dayOfMonth ?? 1) : null,
    input.enabled !== false,
  ]);
  const s = rowToSchedule(r.rows[0]);
  registerTask(s);
  return s;
}

export async function updateSchedule(id: number, input: Partial<CreateScheduleInput>): Promise<ReportSchedule | null> {
  const existing = await getSchedule(id);
  if (!existing) return null;
  const merged = {
    name:        input.name        ?? existing.name,
    stationIds:  input.stationIds  ?? existing.stationIds,
    fields:      input.fields      ?? existing.fields,
    recipients:  input.recipients  ?? existing.recipients,
    frequency:   input.frequency   ?? existing.frequency,
    hour:        input.hour        ?? existing.hour,
    weekday:     input.weekday     ?? existing.weekday,
    dayOfMonth:  input.dayOfMonth  ?? existing.dayOfMonth,
    enabled:     input.enabled     ?? existing.enabled,
  };
  const r = await pg.query(`
    UPDATE report_schedules
       SET name = $1, station_ids = $2, fields = $3, recipients = $4,
           frequency = $5, hour = $6, weekday = $7, day_of_month = $8,
           enabled = $9, updated_at = NOW()
     WHERE id = $10 RETURNING *
  `, [
    merged.name, merged.stationIds, merged.fields, merged.recipients,
    merged.frequency, merged.hour,
    merged.frequency === 'weekly' ? (merged.weekday ?? 1) : null,
    merged.frequency === 'monthly' ? (merged.dayOfMonth ?? 1) : null,
    merged.enabled, id,
  ]);
  const s = rowToSchedule(r.rows[0]);
  unregisterTask(id);
  registerTask(s);
  return s;
}

export async function deleteSchedule(id: number): Promise<void> {
  await pg.query(`DELETE FROM report_schedules WHERE id = $1`, [id]);
  unregisterTask(id);
}

export async function runScheduleNow(id: number): Promise<{ ok: boolean; message: string }> {
  const s = await getSchedule(id);
  if (!s) return { ok: false, message: 'schedule not found' };
  return runSchedule(s);
}

function registerTask(s: ReportSchedule): void {
  if (!s.enabled) return;
  const expr = cronExprFor(s);
  if (!expr || !cron.validate(expr)) {
    console.warn(`[Reports] Skipping schedule #${s.id}: invalid cron "${expr}"`);
    return;
  }
  const task = cron.schedule(expr, () => {
    // Re-read the row at fire time so recipients / fields / stations edited
    // since registration are always honoured.
    (async () => {
      const fresh = await getSchedule(s.id);
      if (!fresh) { console.warn(`[Reports] Schedule #${s.id} vanished, unregistering.`); unregisterTask(s.id); return; }
      if (!fresh.enabled) { console.log(`[Reports] Schedule #${s.id} is disabled, skipping.`); return; }
      await runSchedule(fresh);
    })().catch(err => console.error(`[Reports] Scheduled run #${s.id} failed:`, err));
  }, { timezone: REPORTS_TZ });
  tasks.set(s.id, task);
  const next = computeNextRun(s);
  console.log(`[Reports] Registered "${s.name}" (#${s.id}) [${expr} ${REPORTS_TZ}]${next ? ` - next run ${next.toISOString()}` : ''}`);
}

function unregisterTask(id: number): void {
  const t = tasks.get(id);
  if (t) {
    t.stop();
    tasks.delete(id);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Default daily report bootstrap
//
// Guarantees there is always an enabled daily email report going to the
// operations address. Idempotent: it creates the schedule only when no daily
// schedule already targets that address, and otherwise just re-enables an
// existing one that was switched off. Set DEFAULT_DAILY_REPORT=off to skip.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_DAILY_RECIPIENT = (process.env.DEFAULT_DAILY_REPORT_EMAIL || 'esterhuizen2k@proton.me').trim();
const DEFAULT_DAILY_HOUR = (() => {
  const h = Number(process.env.DEFAULT_DAILY_REPORT_HOUR);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 7;
})();
const DEFAULT_DAILY_NAME = process.env.DEFAULT_DAILY_REPORT_NAME || 'Daily Weather Report';

/** Field set for the auto-provisioned daily report. */
const DEFAULT_DAILY_FIELDS = [
  'temp_min', 'temp_avg', 'temp_max',
  'humidity_avg', 'pressure_avg',
  'wind_avg', 'wind_max', 'wind_gust_max',
  'rainfall_total', 'solar_total', 'solar_avg', 'eto_total',
  'battery_min', 'battery_avg',
  'lightning_strikes',
];

export async function ensureDefaultDailyReport(): Promise<void> {
  if ((process.env.DEFAULT_DAILY_REPORT || '').toLowerCase() === 'off') {
    console.log('[Reports] Default daily report bootstrap disabled (DEFAULT_DAILY_REPORT=off).');
    return;
  }
  if (!DEFAULT_DAILY_RECIPIENT) return;

  const target = DEFAULT_DAILY_RECIPIENT.toLowerCase();
  try {
    const all = await loadAll();
    const matching = all.filter(s =>
      s.frequency === 'daily' &&
      (s.recipients || []).some(r => String(r).trim().toLowerCase() === target),
    );

    if (matching.length > 0) {
      for (const s of matching) {
        if (!s.enabled) {
          await updateSchedule(s.id, { enabled: true });
          console.log(`[Reports] Re-enabled daily schedule "${s.name}" (#${s.id}) for ${DEFAULT_DAILY_RECIPIENT}.`);
        }
      }
      console.log(`[Reports] Daily email to ${DEFAULT_DAILY_RECIPIENT} is active (${matching.length} schedule(s)).`);
      return;
    }

    const stationsRes = await pg.query(`SELECT id FROM stations WHERE is_active = true ORDER BY id`);
    const stationIds: number[] = stationsRes.rows.map((r: any) => Number(r.id)).filter((n: number) => Number.isInteger(n));
    if (stationIds.length === 0) {
      console.warn(`[Reports] No active stations, cannot provision the daily report for ${DEFAULT_DAILY_RECIPIENT}.`);
      return;
    }

    const validKeys = new Set(REPORT_FIELDS.map(f => f.key as string));
    const created = await createSchedule({
      name: DEFAULT_DAILY_NAME,
      stationIds,
      fields: DEFAULT_DAILY_FIELDS.filter(k => validKeys.has(k)),
      recipients: [DEFAULT_DAILY_RECIPIENT],
      frequency: 'daily',
      hour: DEFAULT_DAILY_HOUR,
      enabled: true,
    });
    const next = computeNextRun(created);
    console.log(
      `[Reports] Provisioned daily report "${created.name}" (#${created.id}) to ${DEFAULT_DAILY_RECIPIENT} ` +
      `at ${String(DEFAULT_DAILY_HOUR).padStart(2, '0')}:00 ${REPORTS_TZ} across ${stationIds.length} station(s)` +
      `${next ? `; next run ${next.toISOString()}` : ''}.`,
    );
  } catch (err: any) {
    console.error('[Reports] Default daily report bootstrap failed:', err?.message || err);
  }
}

export async function initReportScheduler(): Promise<void> {
  try {
    const all = await loadAll();
    for (const s of all) registerTask(s);
    console.log(`[Reports] Scheduler initialised: ${tasks.size} active task(s) of ${all.length} schedule(s)`);
    // Runs after registration so create/update can (un)register cleanly.
    await ensureDefaultDailyReport();
    if (!isEmailConfigured()) {
      console.warn('[Reports] MailerSend is not configured - scheduled reports will fail until MAILERSEND_API_KEY is set.');
    }
  } catch (err: any) {
    console.error('[Reports] Failed to initialise scheduler:', err.message);
  }
}
