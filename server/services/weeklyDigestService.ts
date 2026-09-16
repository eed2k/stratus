// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Stratus Report Service (formerly Weekly Digest)
 *
  * Sends a plain-text OPERATIONS email covering ONLY: which stations are
 * active/inactive (and whether they are sending data), server metrics,
 * database metrics and backup metrics. It contains NO meteorological data.
 *
 * Schedule: Monday to Friday at 08:00 Africa/Johannesburg. Weekends are skipped
 * on purpose - an unread operations report still costs a send and trains the
 * reader to ignore the series.
 *
 * Configuration:
 *   DIGEST_ENABLED=true    (default false)
 *   DIGEST_RECIPIENT=esterhuizen2k@proton.me  (override if needed)
 *   DIGEST_CRON=0 8 * * 1-5                   (override schedule if needed)
 *
 * The weekday rule is enforced twice: in the default cron expression, and again
 * in the scheduled callback. The second check matters because DIGEST_CRON is
 * operator-supplied - setting it back to "0 8 * * *" would otherwise quietly
 * reinstate weekend mail. Manual sends via runDigestNow() are NOT gated, since
 * asking for a report on a Saturday is an explicit act.
 */

import * as cron from 'node-cron';
import * as os from 'os';
import * as fs from 'fs';
import { isEmailConfigured, sendEmail } from './emailService';

const DIGEST_RECIPIENT = process.env.DIGEST_RECIPIENT || 'esterhuizen2k@proton.me';
// Mon-Fri at 08:00. node-cron day-of-week is 0=Sunday..6=Saturday.
const DIGEST_CRON = process.env.DIGEST_CRON || '0 8 * * 1-5';
const DIGEST_TZ = process.env.DIGEST_TZ || 'Africa/Johannesburg';

/**
 * True on Monday to Friday in DIGEST_TZ.
 *
 * Reads the zone-local day rather than the host's. The server runs in UTC, so at
 * 01:00 SAST on a Monday it is still Sunday in UTC and asking the host would
 * give the wrong answer.
 *
 * Intl is used rather than an offset constant so this stays correct if DIGEST_TZ
 * is pointed at a zone that observes DST.
 */
function isDigestWeekday(at: Date = new Date()): boolean {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: DIGEST_TZ, weekday: 'short',
  }).format(at);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day);
}
const STALENESS_THRESHOLD_MS = parseInt(process.env.STALENESS_THRESHOLD || '7200000', 10);

// Directories the backup scripts write to. First existing one wins.
//
// REQUIRES A BIND MOUNT. These are HOST paths, and this code runs inside the
// stratus-app container, so without an explicit mount `fs.existsSync` returns
// false for both and the digest reports "Last backup: none found" while cron has
// been writing every six hours the whole time. That is exactly what happened:
// 429 backup files totalling 3 GB existed on the host and the email said none.
//
// docker-compose.yml mounts /opt/stratus/backups read-only at the same path. If
// that mount is removed, this silently goes blind again rather than failing, so
// treat a "none found" report as a mount problem before a cron problem.
const BACKUP_DIRS = ['/root/stratus/backups', '/opt/stratus/backups'];

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

// Human-friendly label for a station's connection status.
function statusLabel(status: StationStatusRow['status']): string {
  switch (status) {
    case 'OK': return 'ACTIVE - sending data';
    case 'STALE': return 'ACTIVE - NO RECENT DATA';
    case 'NEVER': return 'ACTIVE - never connected';
    case 'INACTIVE': return 'INACTIVE';
    default: return status;
  }
}

interface StationStatusRow {
  id: number;
  name: string;
  isActive: boolean;
  connectionType: string | null;
  lastConnected: Date | null;
  ageMs: number | null;
  status: 'OK' | 'STALE' | 'NEVER' | 'INACTIVE';
  records24h: number;
}

/**
 * Gather ONLY connection/activity status per station. No weather values.
 */
async function gatherStationStatuses(): Promise<StationStatusRow[]> {
  if (!getAllStationsFn) return [];
  const stations = await getAllStationsFn();
  const now = Date.now();
  const twentyFourHoursAgo = new Date(now - 86400000).toISOString();
  const out: StationStatusRow[] = [];

  for (const s of stations) {
    const id = s.id;
    const name = s.name || `Station ${id}`;
    const isActive = s.isActive !== false && s.is_active !== false;
    const connectionType = s.connectionType || s.connection_type || null;
    const lc = s.lastConnected || s.last_connected;
    let lastConnected = lc ? new Date(lc) : null;
    let ageMs = lastConnected ? now - lastConnected.getTime() : null;
    let status: StationStatusRow['status'] = 'OK';
    if (!isActive) status = 'INACTIVE';
    else if (!lastConnected) status = 'NEVER';
    else if (ageMs !== null && ageMs > STALENESS_THRESHOLD_MS) status = 'STALE';

    let records24h = 0;

    if (usePostgres && pgQuery) {
      try {
        // Lightweight recency check + 24h row count only (NO data values).
        const r = await pgQuery(
          `SELECT
              COUNT(*) FILTER (WHERE timestamp >= $2) AS records_24h,
              MAX(timestamp)                          AS newest_ts
            FROM weather_data
            WHERE station_id = $1`,
          [id, twentyFourHoursAgo]
        );
        const row = r.rows?.[0];
        if (row) {
          records24h = Number(row.records_24h || 0);
          const newestTs = row.newest_ts ? new Date(row.newest_ts) : null;
          // Fallback connection signal: protocols that write weather_data but
          // don't update stations.last_connected (Rika HTTP API, HTTP-POST).
          if (isActive && newestTs) {
            const newestMs = newestTs.getTime();
            if (!lastConnected || newestMs > lastConnected.getTime()) {
              lastConnected = newestTs;
              ageMs = now - newestMs;
              status = ageMs > STALENESS_THRESHOLD_MS ? 'STALE' : 'OK';
            }
          }
        }
      } catch (err: any) {
        console.error(`[StratusReport] Failed to gather status for station ${id}:`, err.message);
      }
    }

    out.push({ id, name, isActive, connectionType, lastConnected, ageMs, status, records24h });
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
  const twentyFourHoursAgo = new Date(now - 86400000).toISOString();
  const m: DbMetrics = {
    totalWeatherRecords: 0,
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
        (SELECT COUNT(*) FROM weather_data WHERE timestamp >= $1) AS w24h,
        (SELECT COUNT(*) FROM stations) AS total_s,
        (SELECT COUNT(*) FROM stations WHERE is_active IS NOT FALSE) AS active_s,
        (SELECT COUNT(*) FROM users) AS total_u,
        (SELECT MIN(timestamp) FROM weather_data) AS oldest,
        (SELECT MAX(timestamp) FROM weather_data) AS newest
    `, [twentyFourHoursAgo]);
    const r = counts.rows?.[0];
    if (r) {
      m.totalWeatherRecords = Number(r.total_w || 0);
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

interface BackupCategory {
  count: number;
  sizeBytes: number;
  latestDate: Date | null;
  latestAgeMs: number | null;
}

interface BackupMetrics {
  dir: string | null;
  totalBackups: number;
  totalSizeBytes: number;
  latestBackup: string | null;
  latestDate: Date | null;
  latestAgeMs: number | null;
  /** Breakdown by what each backup covers, so the report shows that the main
   *  app AND each subdomain (panel logins/recipients, forecast setup, configs)
   *  are being captured, not just a single lumped count. */
  categories: Record<string, BackupCategory>;
}

/** Map a backup filename to the estate component it covers. Mirrors the file
 *  prefixes written by deploy/backup.sh. */
function backupCategory(file: string): string {
  if (file.startsWith('stratus_backup_')) return 'Main database (full)';
  if (file.startsWith('stratus_config_')) return 'Main database (config + accounts)';
  if (file.startsWith('panel_')) return 'Admin panel (logins, recipients)';
  if (file.startsWith('forecast_')) return 'Forecast (station + feed setup)';
  if (file.startsWith('config_')) return 'Service configs (.env, compose)';
  return 'Other';
}

// Categories expected to refresh on every 6-hourly run. If the newest file in
// one of these is older than this, the cron has likely stopped.
const BACKUP_STALE_MS = 8 * 3600000;

/**
 * Scan the on-disk backup directory (written by deploy/backup*.sh).
 * Looks in the root and category sub-folders (daily/weekly/monthly/pre-deploy).
 */
function gatherBackupMetrics(): BackupMetrics {
  const m: BackupMetrics = {
    dir: null,
    totalBackups: 0,
    totalSizeBytes: 0,
    latestBackup: null,
    latestDate: null,
    latestAgeMs: null,
    categories: {},
  };

  const baseDir = BACKUP_DIRS.find(d => {
    try { return fs.existsSync(d); } catch { return false; }
  });
  if (!baseDir) return m;
  m.dir = baseDir;

  const scanDir = (dir: string, prefix: string) => {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.sql.gz') || f.endsWith('.sql') || f.endsWith('.tar.gz'));
    } catch { return; }
    for (const file of files) {
      try {
        const stats = fs.statSync(`${dir}/${file}`);
        if (!stats.isFile()) continue;
        m.totalBackups += 1;
        m.totalSizeBytes += stats.size;
        if (!m.latestDate || stats.mtime > m.latestDate) {
          m.latestDate = stats.mtime;
          m.latestBackup = prefix ? `${prefix}/${file}` : file;
        }
        const cat = backupCategory(file);
        const c = m.categories[cat] || (m.categories[cat] = {
          count: 0, sizeBytes: 0, latestDate: null, latestAgeMs: null,
        });
        c.count += 1;
        c.sizeBytes += stats.size;
        if (!c.latestDate || stats.mtime > c.latestDate) c.latestDate = stats.mtime;
      } catch { /* ignore unreadable entry */ }
    }
  };

  scanDir(baseDir, '');
  for (const cat of ['daily', 'weekly', 'monthly', 'pre-deploy']) {
    const sub = `${baseDir}/${cat}`;
    try { if (fs.existsSync(sub)) scanDir(sub, cat); } catch { /* ignore */ }
  }

  if (m.latestDate) m.latestAgeMs = Date.now() - m.latestDate.getTime();
  for (const c of Object.values(m.categories)) {
    if (c.latestDate) c.latestAgeMs = Date.now() - c.latestDate.getTime();
  }
  return m;
}

function formatDigest(
  stations: StationStatusRow[],
  server: ServerMetrics,
  db: DbMetrics,
  backup: BackupMetrics,
): { subject: string; text: string } {
    const now = new Date();
  const dayName = now.toLocaleDateString('en-ZA', { weekday: 'long' });
  const dateStr = now.toISOString().slice(0, 10);
  const subject = `Stratus System Report - ${dayName} ${dateStr}`;

  const lines: string[] = [];
  lines.push('STRATUS SYSTEM REPORT');
  lines.push(`Generated: ${now.toUTCString()}`);
  lines.push('System health only - server, database, backups and station status.');
  lines.push('');

  // ---- SUMMARY ----
  lines.push('================================================================');
  lines.push('  SUMMARY');
  lines.push('================================================================');
  const okCount = stations.filter(s => s.status === 'OK').length;
  const staleCount = stations.filter(s => s.status === 'STALE').length;
  const neverCount = stations.filter(s => s.status === 'NEVER').length;
  const inactiveCount = stations.filter(s => s.status === 'INACTIVE').length;
  const activeCount = stations.filter(s => s.isActive).length;
  lines.push(`Stations:           ${stations.length} total (${activeCount} active, ${inactiveCount} inactive)`);
  lines.push(`Active health:      ${okCount} sending data, ${staleCount} no recent data, ${neverCount} never connected`);
  lines.push(`Records (last 24h): ${db.weatherRecords24h.toLocaleString()}`);
  if (backup.latestDate) {
    lines.push(`Last backup:        ${backup.latestDate.toUTCString()} (${backup.latestAgeMs != null ? fmtDuration(backup.latestAgeMs) + ' ago' : 'n/a'})`);
  } else {
    lines.push(`Last backup:        none found`);
  }
  lines.push('');

  // ---- STATION STATUS (no weather data) ----
  lines.push('================================================================');
  lines.push('  STATION STATUS');
  lines.push('================================================================');
  if (stations.length === 0) {
    lines.push('No stations configured.');
  } else {
    const ordered = [...stations].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.id - b.id;
    });
    for (const s of ordered) {
      lines.push('');
      lines.push(`-- ${s.name} (ID ${s.id}) [${statusLabel(s.status)}]`);
      if (s.connectionType) lines.push(`   Connection type:  ${s.connectionType}`);
      const lc = s.lastConnected ? s.lastConnected.toUTCString() : 'never';
      const age = s.ageMs != null ? fmtDuration(s.ageMs) + ' ago' : 'n/a';
      lines.push(`   Last data:        ${lc} (${age})`);
      lines.push(`   Records last 24h: ${s.records24h.toLocaleString()}`);
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
  lines.push(`Records last 24h:   ${db.weatherRecords24h.toLocaleString()}`);
  if (db.oldestRecord) lines.push(`Oldest record:      ${db.oldestRecord}`);
  if (db.newestRecord) lines.push(`Newest record:      ${db.newestRecord}`);
  if (db.databaseSizeBytes != null) lines.push(`Database size:      ${fmtBytes(db.databaseSizeBytes)}`);
  if (db.weatherTableSizeBytes != null) lines.push(`weather_data size:  ${fmtBytes(db.weatherTableSizeBytes)}`);
  lines.push('');

  // ---- BACKUPS ----
  lines.push('================================================================');
  lines.push('  BACKUPS');
  lines.push('================================================================');
  if (!backup.dir) {
    lines.push('No backup directory found on this host.');
  } else {
    lines.push(`Backup directory:   ${backup.dir}`);
    lines.push(`Backup files:       ${backup.totalBackups}`);
    lines.push(`Total backup size:  ${fmtBytes(backup.totalSizeBytes)}`);
    lines.push(`Schedule:           every 6 hours (cron)`);
    if (backup.latestBackup) {
      lines.push(`Latest backup:      ${backup.latestBackup}`);
      lines.push(`Latest backup at:   ${backup.latestDate ? backup.latestDate.toUTCString() : 'n/a'} (${backup.latestAgeMs != null ? fmtDuration(backup.latestAgeMs) + ' ago' : 'n/a'})`);
      if (backup.latestAgeMs != null && backup.latestAgeMs > 36 * 3600000) {
        lines.push(`   WARNING: newest backup is older than 36 hours - check the backup cron.`);
      }
    } else {
      lines.push('No backup files found - check the backup cron.');
    }

    // Per-component coverage, so it is visible at a glance that the main app
    // AND each subdomain (panel logins/recipients, forecast setup, configs) are
    // being captured - not just a single lumped count.
    const cats = Object.keys(backup.categories).sort();
    if (cats.length) {
      lines.push('');
      lines.push('Coverage by component (newest of each):');
      for (const name of cats) {
        const c = backup.categories[name];
        const age = c.latestAgeMs != null ? fmtDuration(c.latestAgeMs) + ' ago' : 'n/a';
        const stale = c.latestAgeMs != null && c.latestAgeMs > BACKUP_STALE_MS
          && name !== 'Main database (full)';
        lines.push(`   ${(name + ':').padEnd(38)} ${String(c.count).padStart(3)} file(s), newest ${age}${stale ? '  <-- STALE, check cron' : ''}`);
      }
    }
  }
  lines.push('');

  lines.push('================================================================');
  lines.push('Stratus Weather Server - Automated System Report (no weather data)');
  lines.push(`Recipient: ${DIGEST_RECIPIENT}`);
  lines.push(`Schedule:  ${DIGEST_CRON} (cron, ${DIGEST_TZ}) - weekdays only, no Sat/Sun`);
  lines.push(`To disable: set DIGEST_ENABLED=false and restart the server.`);

  return { subject, text: lines.join('\n') };
}

async function ensureDbWired(): Promise<void> {
  if (getAllStationsFn && (usePostgres ? pgQuery : true)) {
    // Functions are wired, but the pool may have been re-initialized in another
    // process - quickly probe and re-init if needed.
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
    const [stations, dbm] = await Promise.all([gatherStationStatuses(), gatherDbMetrics()]);
    const server = gatherServerMetrics();
    const backup = gatherBackupMetrics();
    const { subject, text } = formatDigest(stations, server, dbm, backup);
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
    console.log('[StratusReport] Disabled. Set DIGEST_ENABLED=true to enable daily Stratus Report emails.');
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
    // Second line of defence on the weekday rule: DIGEST_CRON is
    // operator-supplied, so a value of "0 8 * * *" would otherwise quietly
    // reinstate Saturday and Sunday mail.
    if (!isDigestWeekday()) {
      console.log(`[StratusReport] Weekend in ${DIGEST_TZ}, skipping the scheduled report.`);
      return;
    }
    runDigestNow().catch(err => console.error('[StratusReport] Scheduled run failed:', err));
  }, { timezone: DIGEST_TZ });

  console.log(`[StratusReport] Started. Recipient=${DIGEST_RECIPIENT}, cron='${DIGEST_CRON}', tz='${DIGEST_TZ}', weekdays only (Mon-Fri)`);
}

export function stopWeeklyDigest(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[StratusReport] Stopped');
  }
}
