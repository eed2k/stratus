// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Stratus Report Service (formerly Weekly Digest)
 *
 * Sends a plain-text email summary of station performance, server health,
 * and database metrics to a single hardcoded recipient (Lukas).
 *
 * Schedule: Every Monday and Friday at 08:00 Africa/Johannesburg.
 *
 * Configuration:
 *   DIGEST_ENABLED=true    (default false)
 *   DIGEST_RECIPIENT=esterhuizen2k@proton.me  (override if needed)
 *   DIGEST_CRON=0 8 * * 1,5                  (override schedule if needed)
 */

import * as cron from 'node-cron';
import * as os from 'os';
import { isEmailConfigured, sendEmail } from './emailService';

const DIGEST_RECIPIENT = process.env.DIGEST_RECIPIENT || 'esterhuizen2k@proton.me';
const DIGEST_CRON = process.env.DIGEST_CRON || '0 8 * * 1,5'; // Mon & Fri 08:00
const STALENESS_THRESHOLD_MS = parseInt(process.env.STALENESS_THRESHOLD || '7200000', 10);

let scheduledTask: cron.ScheduledTask | null = null;
let usePostgres = false;
let pgQuery: ((text: string, params?: any[]) => Promise<any>) | null = null;
let getAllStationsFn: (() => Promise<any[]>) | null = null;

const APP_START_TIME = Date.now();

function fmtBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

function fmtDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pad(s: string | number, width: number): string {
  const str = String(s);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

interface StationDigest {
  id: number;
  name: string;
  isActive: boolean;
  lastConnected: Date | null;
  ageMs: number | null;
  status: 'OK' | 'STALE' | 'NEVER' | 'INACTIVE';
  records7d: number;
  records24h: number;
  recordsTotal: number;
  oldestTs: Date | null;
  newestTs: Date | null;
  expectedRecords7d: number | null;
  uptimePct: number | null;
  rainfall7dMm: number | null;
  avgTempC: number | null;
  minTempC: number | null;
  maxTempC: number | null;
  avgWindMs: number | null;
  maxWindMs: number | null;
  maxGustMs: number | null;
  batteryMinV: number | null;
  batteryAvgV: number | null;
  alarmsTriggered7d: number;
  // Lifetime fallback (used when 7d window has 0 records)
  lifetimeAvgTempC: number | null;
  lifetimeMinTempC: number | null;
  lifetimeMaxTempC: number | null;
  lifetimeAvgWindMs: number | null;
  lifetimeMaxWindMs: number | null;
  lifetimeMaxGustMs: number | null;
  lifetimeBatteryMinV: number | null;
  lifetimeBatteryAvgV: number | null;
}

async function gatherStationMetrics(): Promise<StationDigest[]> {
  if (!getAllStationsFn) return [];
  const stations = await getAllStationsFn();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
  const twentyFourHoursAgo = new Date(now - 86400000).toISOString();
  const out: StationDigest[] = [];

  for (const s of stations) {
    const id = s.id;
    const name = s.name || `Station ${id}`;
    const isActive = s.isActive !== false && s.is_active !== false;
    const lc = s.lastConnected || s.last_connected;
    const lastConnected = lc ? new Date(lc) : null;
    const ageMs = lastConnected ? now - lastConnected.getTime() : null;
    let status: StationDigest['status'] = 'OK';
    if (!isActive) status = 'INACTIVE';
    else if (!lastConnected) status = 'NEVER';
    else if (ageMs !== null && ageMs > STALENESS_THRESHOLD_MS) status = 'STALE';

    let records7d = 0;
    let records24h = 0;
    let recordsTotal = 0;
    let oldestTs: Date | null = null;
    let newestTs: Date | null = null;
    let rainfall7dMm: number | null = null;
    let avgTempC: number | null = null;
    let minTempC: number | null = null;
    let maxTempC: number | null = null;
    let avgWindMs: number | null = null;
    let maxWindMs: number | null = null;
    let maxGustMs: number | null = null;
    let batteryMinV: number | null = null;
    let batteryAvgV: number | null = null;
    let alarmsTriggered7d = 0;
    let expectedRecords7d: number | null = null;
    let uptimePct: number | null = null;
    let lifetimeAvgTempC: number | null = null;
    let lifetimeMinTempC: number | null = null;
    let lifetimeMaxTempC: number | null = null;
    let lifetimeAvgWindMs: number | null = null;
    let lifetimeMaxWindMs: number | null = null;
    let lifetimeMaxGustMs: number | null = null;
    let lifetimeBatteryMinV: number | null = null;
    let lifetimeBatteryAvgV: number | null = null;

    if (usePostgres && pgQuery) {
      try {
        // Weather data is stored in a JSONB `data` column, not typed columns.
        // Cast jsonb fields to numeric for aggregation. Use camelCase keys
        // (temperature, humidity, windSpeed, windGust, rainfall, batteryVoltage).
        const r = await pgQuery(
          `SELECT
              COUNT(*) FILTER (WHERE timestamp >= $2) AS records_7d,
              COUNT(*) FILTER (WHERE timestamp >= $3) AS records_24h,
              COUNT(*)                                AS records_total,
              MIN(timestamp)                          AS oldest_ts,
              MAX(timestamp)                          AS newest_ts,
              AVG(NULLIF((data->>'temperature')::numeric, 'NaN')) FILTER (WHERE timestamp >= $2) AS avg_temp,
              MIN(NULLIF((data->>'temperature')::numeric, 'NaN')) FILTER (WHERE timestamp >= $2) AS min_temp,
              MAX(NULLIF((data->>'temperature')::numeric, 'NaN')) FILTER (WHERE timestamp >= $2) AS max_temp,
              AVG(NULLIF((data->>'windSpeed')::numeric, 'NaN'))   FILTER (WHERE timestamp >= $2) AS avg_wind,
              MAX(NULLIF((data->>'windSpeed')::numeric, 'NaN'))   FILTER (WHERE timestamp >= $2) AS max_wind,
              MAX(NULLIF((data->>'windGust')::numeric, 'NaN'))    FILTER (WHERE timestamp >= $2) AS max_gust,
              MIN(NULLIF((data->>'batteryVoltage')::numeric, 'NaN')) FILTER (WHERE timestamp >= $2 AND (data->>'batteryVoltage')::numeric > 0) AS min_batt,
              AVG(NULLIF((data->>'batteryVoltage')::numeric, 'NaN')) FILTER (WHERE timestamp >= $2 AND (data->>'batteryVoltage')::numeric > 0) AS avg_batt,
              MIN(NULLIF((data->>'rainfall')::numeric, 'NaN')) FILTER (WHERE timestamp >= $2) AS min_rain,
              MAX(NULLIF((data->>'rainfall')::numeric, 'NaN')) FILTER (WHERE timestamp >= $2) AS max_rain,
              SUM(GREATEST(NULLIF((data->>'Rain_mm_Tot')::numeric, 'NaN'), 0)) FILTER (WHERE timestamp >= $2) AS sum_rain_inc
            FROM weather_data
            WHERE station_id = $1`,
          [id, sevenDaysAgo, twentyFourHoursAgo]
        );
        const row = r.rows?.[0];
        if (row) {
          records7d = Number(row.records_7d || 0);
          records24h = Number(row.records_24h || 0);
          recordsTotal = Number(row.records_total || 0);
          oldestTs = row.oldest_ts ? new Date(row.oldest_ts) : null;
          newestTs = row.newest_ts ? new Date(row.newest_ts) : null;
          avgTempC = row.avg_temp != null ? Number(row.avg_temp) : null;
          minTempC = row.min_temp != null ? Number(row.min_temp) : null;
          maxTempC = row.max_temp != null ? Number(row.max_temp) : null;
          avgWindMs = row.avg_wind != null ? Number(row.avg_wind) : null;
          maxWindMs = row.max_wind != null ? Number(row.max_wind) : null;
          maxGustMs = row.max_gust != null ? Number(row.max_gust) : null;
          batteryMinV = row.min_batt != null ? Number(row.min_batt) : null;
          batteryAvgV = row.avg_batt != null ? Number(row.avg_batt) : null;
          if (row.max_rain != null && row.min_rain != null) {
            const range = Number(row.max_rain) - Number(row.min_rain);
            const sumInc = Number(row.sum_rain_inc || 0);
            rainfall7dMm = range > 0.05 && range < 2000 ? range : (sumInc > 0 && sumInc < 2000 ? sumInc : 0);
          }
        }

        // If 7-day window is empty but the station has historical data,
        // also gather a lifetime snapshot so the report is still useful.
        if (records7d === 0 && recordsTotal > 0) {
          const life = await pgQuery(
            `SELECT
                AVG(NULLIF((data->>'temperature')::numeric, 'NaN')) AS avg_temp,
                MIN(NULLIF((data->>'temperature')::numeric, 'NaN')) AS min_temp,
                MAX(NULLIF((data->>'temperature')::numeric, 'NaN')) AS max_temp,
                AVG(NULLIF((data->>'windSpeed')::numeric, 'NaN'))   AS avg_wind,
                MAX(NULLIF((data->>'windSpeed')::numeric, 'NaN'))   AS max_wind,
                MAX(NULLIF((data->>'windGust')::numeric, 'NaN'))    AS max_gust,
                MIN(NULLIF((data->>'batteryVoltage')::numeric, 'NaN')) FILTER (WHERE (data->>'batteryVoltage')::numeric > 0) AS min_batt,
                AVG(NULLIF((data->>'batteryVoltage')::numeric, 'NaN')) FILTER (WHERE (data->>'batteryVoltage')::numeric > 0) AS avg_batt
              FROM weather_data
              WHERE station_id = $1`,
            [id]
          ).catch(() => null);
          const lr = life?.rows?.[0];
          if (lr) {
            lifetimeAvgTempC = lr.avg_temp != null ? Number(lr.avg_temp) : null;
            lifetimeMinTempC = lr.min_temp != null ? Number(lr.min_temp) : null;
            lifetimeMaxTempC = lr.max_temp != null ? Number(lr.max_temp) : null;
            lifetimeAvgWindMs = lr.avg_wind != null ? Number(lr.avg_wind) : null;
            lifetimeMaxWindMs = lr.max_wind != null ? Number(lr.max_wind) : null;
            lifetimeMaxGustMs = lr.max_gust != null ? Number(lr.max_gust) : null;
            lifetimeBatteryMinV = lr.min_batt != null ? Number(lr.min_batt) : null;
            lifetimeBatteryAvgV = lr.avg_batt != null ? Number(lr.avg_batt) : null;
          }
        }

        // Estimate expected records & uptime from interval inference
        if (records7d > 0) {
          const intv = await pgQuery(
            `SELECT EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) AS span_s
              FROM (
                SELECT timestamp FROM weather_data
                WHERE station_id = $1 AND timestamp >= $2
                ORDER BY timestamp ASC LIMIT 50
              ) t`,
            [id, sevenDaysAgo]
          );
          const spanS = Number(intv.rows?.[0]?.span_s || 0);
          // Avg interval (s) over first 50 records, fallback to 600s
          const avgIntervalS = spanS > 0 ? spanS / 49 : 600;
          expectedRecords7d = Math.round((7 * 86400) / Math.max(avgIntervalS, 60));
          uptimePct = Math.min(100, (records7d / Math.max(expectedRecords7d, 1)) * 100);
        }

        const al = await pgQuery(
          `SELECT COUNT(*) AS c FROM alarm_events
            WHERE station_id = $1 AND triggered_at >= $2`,
          [id, sevenDaysAgo]
        ).catch(() => ({ rows: [{ c: 0 }] }));
        alarmsTriggered7d = Number(al.rows?.[0]?.c || 0);
      } catch (err: any) {
        console.error(`[StratusReport] Failed to gather metrics for station ${id}:`, err.message);
      }
    }

    out.push({
      id, name, isActive, lastConnected, ageMs, status,
      records7d, records24h, recordsTotal, oldestTs, newestTs,
      expectedRecords7d, uptimePct,
      rainfall7dMm, avgTempC, minTempC, maxTempC,
      avgWindMs, maxWindMs, maxGustMs, batteryMinV, batteryAvgV, alarmsTriggered7d,
      lifetimeAvgTempC, lifetimeMinTempC, lifetimeMaxTempC,
      lifetimeAvgWindMs, lifetimeMaxWindMs, lifetimeMaxGustMs,
      lifetimeBatteryMinV, lifetimeBatteryAvgV,
    });
  }

  return out;
}

interface ServerMetrics {
  hostname: string;
  platform: string;
  nodeVersion: string;
  uptimeProcessMs: number;
  uptimeOsMs: number;
  cpuCount: number;
  loadAvg: number[];
  totalMemBytes: number;
  freeMemBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  rssBytes: number;
}

function gatherServerMetrics(): ServerMetrics {
  const mem = process.memoryUsage();
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    uptimeProcessMs: Date.now() - APP_START_TIME,
    uptimeOsMs: os.uptime() * 1000,
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg(),
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
    rssBytes: mem.rss,
  };
}

interface DbMetrics {
  totalWeatherRecords: number;
  weatherRecords7d: number;
  weatherRecords24h: number;
  totalStations: number;
  activeStations: number;
  totalUsers: number;
  databaseSizeBytes: number | null;
  weatherTableSizeBytes: number | null;
  oldestRecord: string | null;
  newestRecord: string | null;
}

async function gatherDbMetrics(): Promise<DbMetrics> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
  const twentyFourHoursAgo = new Date(now - 86400000).toISOString();
  const m: DbMetrics = {
    totalWeatherRecords: 0,
    weatherRecords7d: 0,
    weatherRecords24h: 0,
    totalStations: 0,
    activeStations: 0,
    totalUsers: 0,
    databaseSizeBytes: null,
    weatherTableSizeBytes: null,
    oldestRecord: null,
    newestRecord: null,
  };
  if (!usePostgres || !pgQuery) return m;
  try {
    const counts = await pgQuery(`
      SELECT
        (SELECT COUNT(*) FROM weather_data) AS total_w,
        (SELECT COUNT(*) FROM weather_data WHERE timestamp >= $1) AS w7d,
        (SELECT COUNT(*) FROM weather_data WHERE timestamp >= $2) AS w24h,
        (SELECT COUNT(*) FROM stations) AS total_s,
        (SELECT COUNT(*) FROM stations WHERE is_active IS NOT FALSE) AS active_s,
        (SELECT COUNT(*) FROM users) AS total_u,
        (SELECT MIN(timestamp) FROM weather_data) AS oldest,
        (SELECT MAX(timestamp) FROM weather_data) AS newest
    `, [sevenDaysAgo, twentyFourHoursAgo]);
    const r = counts.rows?.[0];
    if (r) {
      m.totalWeatherRecords = Number(r.total_w || 0);
      m.weatherRecords7d = Number(r.w7d || 0);
      m.weatherRecords24h = Number(r.w24h || 0);
      m.totalStations = Number(r.total_s || 0);
      m.activeStations = Number(r.active_s || 0);
      m.totalUsers = Number(r.total_u || 0);
      m.oldestRecord = r.oldest ? new Date(r.oldest).toISOString() : null;
      m.newestRecord = r.newest ? new Date(r.newest).toISOString() : null;
    }
  } catch (err: any) {
    console.error('[StratusReport] Failed to gather counts:', err.message);
  }
  try {
    const sizes = await pgQuery(`
      SELECT
        pg_database_size(current_database()) AS db_size,
        pg_total_relation_size('weather_data') AS w_size
    `);
    const r = sizes.rows?.[0];
    if (r) {
      m.databaseSizeBytes = Number(r.db_size || 0);
      m.weatherTableSizeBytes = Number(r.w_size || 0);
    }
  } catch {
    // Permissions may block these queries on managed DBs - safe to ignore
  }
  return m;
}

function formatDigest(stations: StationDigest[], server: ServerMetrics, db: DbMetrics): { subject: string; text: string } {
  const now = new Date();
  const dayName = now.toLocaleDateString('en-ZA', { weekday: 'long' });
  const dateStr = now.toISOString().slice(0, 10);
  const subject = `Stratus Report - ${dayName} ${dateStr}`;

  const lines: string[] = [];
  lines.push('STRATUS REPORT');
  lines.push(`Generated: ${now.toUTCString()}`);
  lines.push(`Window: last 7 days (24h totals also shown)`);
  lines.push('');
  lines.push('================================================================');
  lines.push('  SUMMARY');
  lines.push('================================================================');
  const okCount = stations.filter(s => s.status === 'OK').length;
  const staleCount = stations.filter(s => s.status === 'STALE').length;
  const neverCount = stations.filter(s => s.status === 'NEVER').length;
  const inactiveCount = stations.filter(s => s.status === 'INACTIVE').length;
  lines.push(`Stations:           ${stations.length} total (${okCount} OK, ${staleCount} stale, ${neverCount} never connected, ${inactiveCount} inactive)`);
  lines.push(`Records (last 7d):  ${db.weatherRecords7d.toLocaleString()}`);
  lines.push(`Records (last 24h): ${db.weatherRecords24h.toLocaleString()}`);
  lines.push(`Total records:      ${db.totalWeatherRecords.toLocaleString()}`);
  lines.push(`Users:              ${db.totalUsers}`);
  if (db.databaseSizeBytes != null) lines.push(`Database size:      ${fmtBytes(db.databaseSizeBytes)}`);
  if (db.weatherTableSizeBytes != null) lines.push(`weather_data size:  ${fmtBytes(db.weatherTableSizeBytes)}`);
  lines.push('');

  lines.push('================================================================');
  lines.push('  STATION PERFORMANCE (last 7 days)');
  lines.push('================================================================');
  if (stations.length === 0) {
    lines.push('No stations configured.');
  } else {
    for (const s of stations) {
      lines.push('');
      lines.push(`-- ${s.name} (ID ${s.id}) [${s.status}]`);
      const lc = s.lastConnected ? s.lastConnected.toUTCString() : 'never';
      const age = s.ageMs != null ? fmtDuration(s.ageMs) + ' ago' : 'n/a';
      lines.push(`   Last connected:   ${lc} (${age})`);
      lines.push(`   Records 7d/24h:   ${s.records7d.toLocaleString()} / ${s.records24h.toLocaleString()}`);
      lines.push(`   Records lifetime: ${s.recordsTotal.toLocaleString()}`);
      if (s.oldestTs) lines.push(`   Data range:       ${s.oldestTs.toISOString().slice(0,16).replace('T',' ')} → ${s.newestTs ? s.newestTs.toISOString().slice(0,16).replace('T',' ') : '?'} UTC`);
      if (s.uptimePct != null && s.expectedRecords7d != null) {
        lines.push(`   Coverage 7d:      ${s.uptimePct.toFixed(1)}% (~${s.expectedRecords7d.toLocaleString()} expected)`);
      }
      if (s.records7d > 0) {
        if (s.avgTempC != null) {
          lines.push(`   Temperature 7d:   avg ${s.avgTempC.toFixed(1)}C, min ${s.minTempC?.toFixed(1)}C, max ${s.maxTempC?.toFixed(1)}C`);
        }
        if (s.avgWindMs != null) {
          lines.push(`   Wind 7d:          avg ${s.avgWindMs.toFixed(2)} m/s, max ${s.maxWindMs?.toFixed(2)} m/s${s.maxGustMs != null ? `, gust ${s.maxGustMs.toFixed(2)} m/s` : ''}`);
        }
        if (s.rainfall7dMm != null) {
          lines.push(`   Rainfall 7d:      ${s.rainfall7dMm.toFixed(1)} mm`);
        }
        if (s.batteryAvgV != null) {
          lines.push(`   Battery 7d:       avg ${s.batteryAvgV.toFixed(2)}V, min ${s.batteryMinV?.toFixed(2)}V`);
        }
      } else if (s.recordsTotal > 0) {
        lines.push(`   (No data in last 7 days - showing lifetime snapshot)`);
        if (s.lifetimeAvgTempC != null) {
          lines.push(`   Temperature life: avg ${s.lifetimeAvgTempC.toFixed(1)}C, min ${s.lifetimeMinTempC?.toFixed(1)}C, max ${s.lifetimeMaxTempC?.toFixed(1)}C`);
        }
        if (s.lifetimeAvgWindMs != null) {
          lines.push(`   Wind lifetime:    avg ${s.lifetimeAvgWindMs.toFixed(2)} m/s, max ${s.lifetimeMaxWindMs?.toFixed(2)} m/s${s.lifetimeMaxGustMs != null ? `, gust ${s.lifetimeMaxGustMs.toFixed(2)} m/s` : ''}`);
        }
        if (s.lifetimeBatteryAvgV != null) {
          lines.push(`   Battery lifetime: avg ${s.lifetimeBatteryAvgV.toFixed(2)}V, min ${s.lifetimeBatteryMinV?.toFixed(2)}V`);
        }
      }
      if (s.alarmsTriggered7d > 0) {
        lines.push(`   Alarms triggered: ${s.alarmsTriggered7d}`);
      }
    }
  }
  lines.push('');

  lines.push('================================================================');
  lines.push('  SERVER METRICS');
  lines.push('================================================================');
  lines.push(`Host:               ${server.hostname}`);
  lines.push(`Platform:           ${server.platform}`);
  lines.push(`Node:               ${server.nodeVersion}`);
  lines.push(`Process uptime:     ${fmtDuration(server.uptimeProcessMs)}`);
  lines.push(`OS uptime:          ${fmtDuration(server.uptimeOsMs)}`);
  lines.push(`CPUs:               ${server.cpuCount}`);
  lines.push(`Load avg (1/5/15):  ${server.loadAvg.map(l => l.toFixed(2)).join(' / ')}`);
  const memUsedPct = ((server.totalMemBytes - server.freeMemBytes) / server.totalMemBytes) * 100;
  lines.push(`Memory:             ${fmtBytes(server.totalMemBytes - server.freeMemBytes)} / ${fmtBytes(server.totalMemBytes)} (${memUsedPct.toFixed(1)}% used)`);
  lines.push(`Heap:               ${fmtBytes(server.heapUsedBytes)} / ${fmtBytes(server.heapTotalBytes)}`);
  lines.push(`RSS:                ${fmtBytes(server.rssBytes)}`);
  lines.push('');

  lines.push('================================================================');
  lines.push('  DATABASE');
  lines.push('================================================================');
  lines.push(`Backend:            ${usePostgres ? 'PostgreSQL' : 'SQLite'}`);
  lines.push(`Total stations:     ${db.totalStations} (${db.activeStations} active)`);
  lines.push(`Total users:        ${db.totalUsers}`);
  lines.push(`Total records:      ${db.totalWeatherRecords.toLocaleString()}`);
  if (db.oldestRecord) lines.push(`Oldest record:      ${db.oldestRecord}`);
  if (db.newestRecord) lines.push(`Newest record:      ${db.newestRecord}`);
  if (db.databaseSizeBytes != null) lines.push(`Database size:      ${fmtBytes(db.databaseSizeBytes)}`);
  if (db.weatherTableSizeBytes != null) lines.push(`weather_data size:  ${fmtBytes(db.weatherTableSizeBytes)}`);
  lines.push('');
  lines.push('================================================================');
  lines.push('Stratus Weather Server - Automated Stratus Report');
  lines.push(`Recipient: ${DIGEST_RECIPIENT}`);
  lines.push(`Schedule:  ${DIGEST_CRON} (cron, Africa/Johannesburg)`);
  lines.push(`To disable: set DIGEST_ENABLED=false and restart the server.`);

  // Suppress unused-var warning for `pad` (kept in case future tabular formatting needed)
  void pad;

  return { subject, text: lines.join('\n') };
}

async function ensureDbWired(): Promise<void> {
  if (getAllStationsFn && (usePostgres ? pgQuery : true)) {
    // Functions are wired, but the pool may have been re-initialized in another
    // process — quickly probe and re-init if needed.
    if (usePostgres && pgQuery) {
      try { await pgQuery('SELECT 1'); return; } catch { /* fallthrough to re-init */ }
    } else {
      return;
    }
  }
  usePostgres = !!process.env.DATABASE_URL;
  if (usePostgres) {
    const pg = await import('../db-postgres');
    if (!pg.getPool()) {
      await pg.initPostgresDatabase();
    }
    pgQuery = pg.query;
    getAllStationsFn = pg.getAllStations;
  } else {
    const sqlite = await import('../db');
    getAllStationsFn = async () => sqlite.getAllStations();
  }
  console.log(`[StratusReport] DB wired: ${usePostgres ? 'PostgreSQL' : 'SQLite'}`);
}

export async function runDigestNow(): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn('[StratusReport] Email not configured, skipping report');
    return false;
  }
  try {
    await ensureDbWired();
    const [stations, dbm] = await Promise.all([gatherStationMetrics(), gatherDbMetrics()]);
    const server = gatherServerMetrics();
    const { subject, text } = formatDigest(stations, server, dbm);
    const ok = await sendEmail({ to: DIGEST_RECIPIENT, subject, text, html: `<pre style="font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; white-space: pre-wrap;">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>` });
    if (ok) console.log(`[StratusReport] Sent to ${DIGEST_RECIPIENT} (${stations.length} stations)`);
    return ok;
  } catch (err: any) {
    console.error('[StratusReport] Failed:', err.message);
    return false;
  }
}

export async function initWeeklyDigest(): Promise<void> {
  const enabled = process.env.DIGEST_ENABLED === 'true';
  if (!enabled) {
    console.log('[StratusReport] Disabled. Set DIGEST_ENABLED=true to enable Mon/Fri Stratus Report emails.');
    return;
  }
  if (!isEmailConfigured()) {
    console.log('[StratusReport] MailerSend not configured - report disabled.');
    return;
  }
  if (!cron.validate(DIGEST_CRON)) {
    console.error(`[StratusReport] Invalid cron expression: ${DIGEST_CRON}`);
    return;
  }

  await ensureDbWired();

  scheduledTask = cron.schedule(DIGEST_CRON, () => {
    runDigestNow().catch(err => console.error('[StratusReport] Scheduled run failed:', err));
  }, { timezone: process.env.DIGEST_TZ || 'Africa/Johannesburg' });

  console.log(`[StratusReport] Started. Recipient=${DIGEST_RECIPIENT}, cron='${DIGEST_CRON}', tz='${process.env.DIGEST_TZ || 'Africa/Johannesburg'}'`);
}

export function stopWeeklyDigest(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[StratusReport] Stopped');
  }
}
