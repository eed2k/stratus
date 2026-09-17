// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Server-side PDF report builder.
 *
 * Used by two callers:
 *   1. GET /api/reports/pdf?stationId=&from=&to=&fields=&format=...
 *      - admin-only on-demand download (also reused by the new
 *        Report Generation page when "PDF" is preferred over the
 *        client-side jsPDF render).
 *   2. The scheduler (server/services/reportSchedulerService.ts) attaches
 *      this PDF to every scheduled email send so recipients always get a
 *      PDF copy of the charts, wind roses and summary tables.
 *
 * Implementation notes:
 *   - We use `pdfkit` + `svg-to-pdfkit` so no headless browser is needed
 *     (keeps the Docker image small).
 *   - The wind rose SVG is a server-side port of the one in
 *     client/src/components/reports/ReportGenerator.tsx.
 *   - Charts are simple SVG line plots - good enough for an attached
 *     PDF; the dashboard remains the rich interactive view.
 */

import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import * as pg from "../db-postgres";
// gatherStationData and REPORT_FIELDS live in reportSchedulerService, which this
// module already depends on; the reverse direction is only ever a lazy dynamic
// import, so declaring them here and importing them back would turn that into a
// static circular dependency.
//
// formatSiteLine used to be imported here too, to word the site geometry the same
// way as the email body. The PDF header now lists location, coordinates,
// elevation and dates on separate lines instead of running them together, so it
// no longer shares that wording. It is still exported for the email body.
import { gatherStationData, REPORT_FIELDS, type FieldStat } from "./reportSchedulerService";
// Rainfall shape (counter vs per-interval) for the readings table, read from the
// same calibration source the yearly/monthly aggregation endpoints use so the
// table can never disagree with the totals elsewhere in the report.
import { getRainfallConfig, DEFAULT_TIP_FACTOR } from "../config/stationRainfallConfig";
import { ensureCalibrationCache } from "./calibrationCache";
import { RAINFALL_FIELD_ALIASES } from "../config/rainfallFields";

const REPORTS_TZ = process.env.REPORTS_TZ || "Africa/Johannesburg";

/** Stratus brand navy, matching the dashboard and email templates. */
const NAVY = "#1e3a5f";

// ─────────────────────────────────────────────────────────────────────
// Typography
//
// One font family and one small type scale for the whole document. Every
// doc.fontSize() call in this file uses a constant from TYPE so sizes stay
// in step with each other and with the client-side (jsPDF) report. Mixing
// families or ad-hoc sizes is what makes PDF -> DOCX conversion messy.
// ─────────────────────────────────────────────────────────────────────

const FONT_REGULAR = "Helvetica";
// Retained for callers that may need emphasis later. The report itself is
// deliberately all-regular weight: the operator asked for plain Arial text
// with no bold anywhere.
const FONT_BOLD = "Helvetica-Bold";
const FONT_OBLIQUE = "Helvetica-Oblique";

const TYPE = {
  title: 18,
  heading: 13,
  subheading: 11,
  body: 10,
  caption: 8.5,
} as const;

/** Single table row height, used by the summary table. */
const TABLE_ROW_H = 14;

function usableWidth(doc: any): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function bottomLimit(doc: any): number {
  return doc.page.height - doc.page.margins.bottom;
}

// ─────────────────────────────────────────────────────────────────────
// Wind direction / speed class constants - keep these in lock-step with
// client/src/components/reports/ReportGenerator.tsx so the PDF matches
// what the dashboard / browser-side PDF show.
// ─────────────────────────────────────────────────────────────────────

const WIND_DIRECTIONS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

const SPEED_CLASSES = [
  { label: "Calm (<0.5)",        max: 0.5,  color: "#cccccc" },
  { label: "Light (0.5-2)",      max: 2,    color: "#3b82f6" },
  { label: "Moderate (2-4)",     max: 4,    color: "#22c55e" },
  { label: "Strong (4-6)",       max: 6,    color: "#eab308" },
  { label: "Gale (6-9)",         max: 9,    color: "#f97316" },
  { label: "Storm+ (>9)",        max: Infinity, color: "#dc2626" },
];

function speedClass(s: number): number {
  for (let i = 0; i < SPEED_CLASSES.length; i++) {
    if (s < SPEED_CLASSES[i].max) return i;
  }
  return SPEED_CLASSES.length - 1;
}

function dirBin(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const n = ((deg % 360) + 360) % 360;
  return Math.round(n / 22.5) % 16;
}

// ─────────────────────────────────────────────────────────────────────
// Field aliases - match the catalogs used by reportSchedulerService
// so the PDF can pull a couple of raw series (temperature, rainfall,
// wind) for the line charts.
// ─────────────────────────────────────────────────────────────────────

const ALIASES = {
  temp:  ["temperature", "AirTC_Avg", "AirTemp", "Temp_Avg", "AirTemp_Avg", "AirTC", "Temp_C", "Temperature"],
  // Shared list, so a PDF cannot recognise a different set of rainfall field
  // names than the dashboard does. See server/config/rainfallFields.ts.
  rain:  [...RAINFALL_FIELD_ALIASES],
  wind:  ["windSpeed", "WS_ms_Avg", "WindSpeed", "Wind_Spd_S_WVT", "WindSpeed_Avg", "WS_ms", "WS_Avg", "WS_ms_S_WVT", "WSpd_1_Avg", "WSpd_Avg"],
  gust:  ["windGust", "WS_ms_Max", "Wind_Spd_Max", "WindSpeed_Max", "WS_Max", "Wind_Gust", "WSpd_1_Max", "WSpd_Max"],
  windDir: ["windDirection", "WindDir", "WindDir_D1_WVT", "WindDir_Avg", "WindDirection"],
  humidity: ["humidity", "RH_Avg", "RH", "RelHumidity_Avg", "RelHumidity", "Humidity"],
  pressure: ["pressure", "BP_mbar", "Pressure", "Pressure_Avg", "BaroPressure_Avg", "BP_Avg", "BaroPres", "BP_mbar_Avg", "BPress_Avg", "BPress"],
  solar: ["solarRadiation", "SlrW", "Solar", "Solar_Rad_Avg", "SolarRad_Avg", "SlrW_Avg", "SR_Avg"],
  solarMJ: ["solarMJTotal", "SlrMJ_Tot", "SlrMJ", "Solar_MJ_Tot"],
  battery: ["batteryVoltage", "BattV", "BattV_Min", "Batt_volt_Min", "BattV_Avg", "Batt_V", "LoggerBattery_Avg", "LoggerBattery"],
  dew: ["dewPoint", "DewPt", "DewPoint", "DewPt_Avg", "DewPoint_Avg", "Dew_Point"],
} as const;

/**
 * Dew point from temperature and relative humidity, Magnus formula.
 *
 * Used only when the logger does not report dew point itself, which matches how
 * the dashboard derives it. Returns null rather than a nonsense figure when
 * either input is missing or the humidity is outside a physical range.
 */
function magnusDewPoint(tempC: number | null, rh: number | null): number | null {
  if (tempC == null || rh == null) return null;
  if (!Number.isFinite(tempC) || !Number.isFinite(rh)) return null;
  if (rh <= 0 || rh > 100) return null;
  const A = 17.62;
  const B = 243.12;
  const gamma = Math.log(rh / 100) + (A * tempC) / (B + tempC);
  const dew = (B * gamma) / (A - gamma);
  return Number.isFinite(dew) ? dew : null;
}

function pickAlias(data: Record<string, any>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = data?.[k];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

interface RawRecord {
  ts: Date;
  temp: number | null;
  rain: number | null;
  wind: number | null;
  gust: number | null;
  windDir: number | null;
  humidity: number | null;
  pressure: number | null;
  solar: number | null;
  solarMJ: number | null;
  battery: number | null;
  dew: number | null;
}

export interface StationMeta {
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}



/** Station identity + geometry (needed for the FAO-56 ETo chart). */
async function fetchStationMeta(stationId: number): Promise<StationMeta> {
  const fallback: StationMeta = { name: `Station ${stationId}`, location: null, latitude: null, longitude: null, altitude: null };
  try {
    const r = await pg.query(
      `SELECT name, location, latitude, longitude, altitude FROM stations WHERE id = $1`,
      [stationId],
    );
    const row = r.rows[0];
    if (!row) return fallback;
    return {
      name: row.name || fallback.name,
      location: row.location ?? null,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
      altitude: row.altitude != null ? Number(row.altitude) : null,
    };
  } catch (err: any) {
    console.warn("[pdfReport] station meta lookup failed:", err?.message || err);
    return fallback;
  }
}

async function fetchRawSeries(stationId: number, startMs: number, endMs: number): Promise<RawRecord[]> {
  const r = await pg.query(
    `SELECT timestamp, data FROM weather_data
      WHERE station_id = $1 AND timestamp >= $2 AND timestamp < $3
      ORDER BY timestamp ASC`,
    [stationId, new Date(startMs), new Date(endMs)],
  );
  return r.rows.map((row: any) => {
    const data = row.data || {};
    const temp = pickAlias(data, ALIASES.temp);
    const humidity = pickAlias(data, ALIASES.humidity);
    return {
      ts: new Date(row.timestamp),
      temp,
      rain: pickAlias(data, ALIASES.rain),
      wind: pickAlias(data, ALIASES.wind),
      gust: pickAlias(data, ALIASES.gust),
      windDir: pickAlias(data, ALIASES.windDir),
      humidity,
      pressure: pickAlias(data, ALIASES.pressure),
      solar: pickAlias(data, ALIASES.solar),
      solarMJ: pickAlias(data, ALIASES.solarMJ),
      battery: pickAlias(data, ALIASES.battery),
      // Reported value wins; otherwise derive it, so a station that logs
      // temperature and humidity still gets a dew point trace.
      dew: pickAlias(data, ALIASES.dew) ?? magnusDewPoint(temp, humidity),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// SVG builders
// ─────────────────────────────────────────────────────────────────────

/** Fixed chrome (title + stats + legend) added around a `size` x `size` rose. */
const POLAR_CHROME_H = 30 + 22 + 55;

function buildWindRoseSVG(records: RawRecord[], label: string, size = 320): string {
  // bins[16 directions][6 speed classes] = count
  const bins: number[][] = Array.from({ length: 16 }, () => Array(6).fill(0));
  let total = 0;
  let calm = 0;
  for (const r of records) {
    if (r.wind == null) continue;
    if (r.wind < 0.5) { calm++; total++; continue; }
    if (r.windDir == null) continue;
    const di = dirBin(r.windDir);
    const si = speedClass(r.wind);
    bins[di][si]++;
    total++;
  }

  const sz = size;
  const ctr = sz / 2;
  const mxR = sz / 2 - 40;

  let maxValue = 0;
  bins.forEach((b) => {
    const t = b.reduce((a, v) => a + v, 0);
    if (t > maxValue) maxValue = t;
  });
  if (maxValue === 0) maxValue = 1;

  const polar = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: ctr + r * Math.cos(rad), y: ctr + r * Math.sin(rad) };
  };
  const wedgePath = (di: number, ir: number, or2: number) => {
    const a1 = di * 22.5 - 11.25;
    const a2 = di * 22.5 + 11.25;
    const p1 = polar(a1, ir), p2 = polar(a1, or2), p3 = polar(a2, or2), p4 = polar(a2, ir);
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${or2} ${or2} 0 0 1 ${p3.x} ${p3.y} L ${p4.x} ${p4.y} A ${ir} ${ir} 0 0 0 ${p1.x} ${p1.y} Z`;
  };

  // Stats
  let dominantDirIdx = 0;
  let dominantCount = 0;
  bins.forEach((b, i) => {
    const t = b.reduce((a, v) => a + v, 0);
    if (t > dominantCount) { dominantCount = t; dominantDirIdx = i; }
  });
  const dominantDir = WIND_DIRECTIONS[dominantDirIdx];
  const dominantPct = total > 0 ? ((dominantCount / total) * 100).toFixed(1) : "0";
  const calmPct = total > 0 ? ((calm / total) * 100).toFixed(1) : "0";

  const titleH = 30;
  const statsH = 22;
  const legendH = 55;
  const totalH = sz + titleH + statsH + legendH;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${totalH}" viewBox="0 0 ${sz} ${totalH}">`;
  s += `<rect width="${sz}" height="${totalH}" fill="white"/>`;
  s += `<text x="${ctr}" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="#333" font-family="Helvetica">${escapeXml(label)}</text>`;
  s += `<g transform="translate(0,${titleH})">`;

  // Guide circles
  [0.25, 0.5, 0.75, 1].forEach((ratio) => {
    s += `<circle cx="${ctr}" cy="${ctr}" r="${mxR * ratio}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
    s += `<text x="${ctr + 5}" y="${ctr - mxR * ratio + 12}" font-size="10" fill="#000000" font-family="Helvetica">${Math.round(ratio * 100)}%</text>`;
  });

  // Direction labels
  WIND_DIRECTIONS.forEach((d, i) => {
    const p = polar(i * 22.5, mxR + 20);
    s += `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#333" font-family="Helvetica">${d}</text>`;
  });

  // Wedges
  bins.forEach((dirBins, di) => {
    let curR = 0;
    dirBins.forEach((count, si) => {
      if (count === 0) return;
      const inner = curR;
      const height = (count / maxValue) * mxR;
      curR += height;
      s += `<path d="${wedgePath(di, inner, curR)}" fill="${SPEED_CLASSES[si].color}" stroke="white" stroke-width="0.5" opacity="0.85"/>`;
    });
  });

  s += `<circle cx="${ctr}" cy="${ctr}" r="8" fill="#999" opacity="0.3"/>`;
  s += `</g>`;

  // Stats line
  const statsY = titleH + sz + 14;
  s += `<text x="${ctr - 60}" y="${statsY}" text-anchor="middle" font-size="10" fill="#000000" font-family="Helvetica">Dominant: ${dominantDir} (${dominantPct}%)</text>`;
  s += `<text x="${ctr + 60}" y="${statsY}" text-anchor="middle" font-size="10" fill="#000000" font-family="Helvetica">Calm: ${calmPct}%</text>`;

  // Legend
  const legendY = statsY + 16;
  const legendCols = 3;
  const legendColW = sz / legendCols;
  const shortLabels = ["Calm", "Light", "Moderate", "Strong", "Gale", "Storm+"];
  SPEED_CLASSES.forEach((cls, i) => {
    const col = i % legendCols;
    const row = Math.floor(i / legendCols);
    const lx = col * legendColW + 8;
    const ly = legendY + row * 16;
    const shortLabel = shortLabels[i] || cls.label.split("(")[0].trim();
    const range = cls.label.match(/\(([^)]+)\)/)?.[1] || "";
    s += `<rect x="${lx}" y="${ly - 5}" width="10" height="10" rx="2" fill="${cls.color}"/>`;
    // Ranges contain < and >, so they must be escaped before hitting the parser.
    s += `<text x="${lx + 14}" y="${ly + 4}" font-size="8" fill="#000000" font-family="Helvetica">${escapeXml(`${shortLabel} ${range} m/s`)}</text>`;
  });

  s += "</svg>";
  return s;
}

// ─────────────────────────────────────────────────────────────────────
// Wind speed scatter (polar) - direction vs speed, colored by class.
// ─────────────────────────────────────────────────────────────────────

function buildWindScatterSVG(records: RawRecord[], label: string, sz = 320): string {
  const points = records
    .filter((r) => r.wind != null && r.windDir != null)
    .map((r) => ({ speed: r.wind as number, dir: r.windDir as number }));

  const ctr = sz / 2;
  const mxR = sz / 2 - 40;
  const maxSpeed = points.length ? Math.max(...points.map((p) => p.speed), 2) * 1.08 : 10;
  const ringStep = maxSpeed / 4;

  const polar = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: ctr + r * Math.cos(rad), y: ctr + r * Math.sin(rad) };
  };

  const titleH = 30;
  const statsH = 22;
  const legendH = 55;
  const totalH = sz + titleH + statsH + legendH;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${totalH}" viewBox="0 0 ${sz} ${totalH}">`;
  s += `<rect width="${sz}" height="${totalH}" fill="white"/>`;
  s += `<text x="${ctr}" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="#333" font-family="Helvetica">${escapeXml(label)}</text>`;
  s += `<g transform="translate(0,${titleH})">`;

  for (let i = 1; i <= 4; i++) {
    const r = ((ringStep * i) / maxSpeed) * mxR;
    const dash = i === 4 ? "" : ` stroke-dasharray="3 3"`;
    s += `<circle cx="${ctr}" cy="${ctr}" r="${r.toFixed(1)}" fill="none" stroke="#e5e7eb" stroke-width="1"${dash}/>`;
    s += `<text x="${ctr + 5}" y="${(ctr - r + 11).toFixed(1)}" font-size="9" fill="#000000" font-family="Helvetica">${(ringStep * i).toFixed(1)} m/s</text>`;
  }

  WIND_DIRECTIONS.forEach((d, i) => {
    const p = polar(i * 22.5, mxR + 20);
    s += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#333" font-family="Helvetica">${d}</text>`;
  });

  // Cap plotted markers so dense periods stay legible and the SVG stays small.
  const step = Math.max(1, Math.ceil(points.length / 2500));
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    const r = Math.min(mxR, (p.speed / maxSpeed) * mxR);
    const pos = polar(p.dir, r);
    s += `<circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="1.9" fill="${SPEED_CLASSES[speedClass(p.speed)].color}" opacity="0.8"/>`;
  }

  s += `<circle cx="${ctr}" cy="${ctr}" r="4" fill="#999" opacity="0.5"/>`;
  s += `</g>`;

  const speeds = points.map((p) => p.speed);
  const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const statsY = titleH + sz + 14;
  s += `<text x="${ctr}" y="${statsY}" text-anchor="middle" font-size="10" fill="#000000" font-family="Helvetica">Avg ${avg.toFixed(1)} m/s | Max ${(speeds.length ? Math.max(...speeds) : 0).toFixed(1)} m/s | ${points.length} points</text>`;

  const legendY = statsY + 16;
  const legendCols = 3;
  const legendColW = sz / legendCols;
  const shortLabels = ["Calm", "Light", "Moderate", "Strong", "Gale", "Storm+"];
  SPEED_CLASSES.forEach((cls, i) => {
    const col = i % legendCols;
    const row = Math.floor(i / legendCols);
    const lx = col * legendColW + 8;
    const ly = legendY + row * 16;
    const range = cls.label.match(/\(([^)]+)\)/)?.[1] || "";
    s += `<circle cx="${lx + 5}" cy="${ly - 1}" r="4.5" fill="${cls.color}"/>`;
    s += `<text x="${lx + 14}" y="${ly + 4}" font-size="8" fill="#000000" font-family="Helvetica">${escapeXml(`${shortLabels[i]} ${range} m/s`)}</text>`;
  });

  s += "</svg>";
  return s;
}

// ─────────────────────────────────────────────────────────────────────
// Time-series chart engine
//
// One builder for every line / area / bar chart in the report. It draws a
// framed plot area with nice-rounded axis ticks, gridlines, an optional
// secondary (right) axis, a legend and per-series min/avg/max annotations.
// Output is vector SVG, embedded into the PDF as vector artwork, so the
// graphs stay sharp at any zoom level and when printed.
// ─────────────────────────────────────────────────────────────────────

/**
 * Text colours. Both are pure black on purpose.
 *
 * There is no grey text in a Stratus report. A report is read printed, often
 * photocopied, and often by someone checking a number against a logger file, so
 * every character has to carry full contrast. MUTED is kept as a separate name
 * because it still marks the places that are secondary INFORMATION (units, the
 * site geometry caption, the footer) even though they are no longer a lighter
 * colour, and collapsing the two names would lose that distinction.
 *
 * RULE and GRID stay light: they are hairlines and table borders, not text.
 */
const INK = "#000000";
const MUTED = "#000000";
const RULE = "#cbd5e1";
const GRID = "#eef2f7";

/**
 * Chart line colors.
 *
 * These values mirror shared/chartColors.ts (CHART_COLORS) so a series is
 * drawn in the same color here as on the dashboard. They are duplicated
 * rather than imported because tsconfig.server.json sets rootDir ./server and
 * excludes shared/, so this module cannot reach outside server/. If a color
 * changes in shared/chartColors.ts, change it here too.
 *
 * House rules from that file: ETo and battery voltage are always green, and
 * there is no violet/purple and no pale washed-out blue in the palette.
 */
export const CHART_COLORS = {
  temperature: "#ef4444",     // CHART_COLORS.temperature
  humidity: "#2563eb",        // CHART_COLORS.humidity
  wind: "#0891b2",            // CHART_COLORS.windSpeed
  gust: "#f59e0b",            // CHART_COLORS.windGust
  solar: "#f59e0b",           // CHART_COLORS.solarRadiation
  battery: "#16a34a",         // CHART_COLORS.batteryVoltage - always green
  battery2: "#15803d",        // CHART_COLORS.batteryVoltage2 - second green
  pressure: "#0f766e",        // CHART_COLORS.pressure - teal, was violet
  eto: "#16a34a",             // CHART_COLORS.eto - always green
  dewPoint: "#0e7490",        // CHART_COLORS.dewPoint - deeper cyan than humidity
};

interface ChartSeries { ts: Date; value: number }

interface ChartSeriesSpec {
  name: string;
  unit: string;
  color: string;
  points: ChartSeries[];
  axis?: "left" | "right";
  type?: "line" | "area" | "bar";
}

/** Figure markup plus its natural size, so pages can be laid out exactly. */
export interface SvgFigure { markup: string; width: number; height: number }

/** Pick "nice" axis bounds and tick values. */
function niceScale(min: number, max: number, ticks = 5): { min: number; max: number; vals: number[] } {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { lo -= 1; hi += 1; }
  const rawStep = (hi - lo) / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  step *= mag;
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const vals: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 1000; v += step) {
    vals.push(Math.round(v * 1e6) / 1e6);
  }
  return { min: niceMin, max: niceMax, vals };
}

/**
 * Reduce a long series to at most `maxPoints` buckets. Keeps the PDF small
 * and the plotted line legible without losing the shape of the data.
 */
function downsample(points: ChartSeries[], maxPoints: number, mode: "avg" | "last" | "max" = "avg"): ChartSeries[] {
  if (points.length <= maxPoints) return points;
  const bucketSize = Math.ceil(points.length / maxPoints);
  const out: ChartSeries[] = [];
  for (let i = 0; i < points.length; i += bucketSize) {
    const slice = points.slice(i, i + bucketSize);
    const ts = slice[Math.floor(slice.length / 2)].ts;
    let value: number;
    if (mode === "last") value = slice[slice.length - 1].value;
    else if (mode === "max") value = Math.max(...slice.map((p) => p.value));
    else value = slice.reduce((s, p) => s + p.value, 0) / slice.length;
    out.push({ ts, value });
  }
  return out;
}

function tickFormatter(spanMs: number): (ms: number) => string {
  if (spanMs <= 36 * 3600 * 1000) {
    return (ms) => new Date(ms).toLocaleTimeString("en-ZA", { timeZone: REPORTS_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (spanMs <= 40 * 24 * 3600 * 1000) {
    return (ms) => new Date(ms).toLocaleDateString("en-ZA", { timeZone: REPORTS_TZ, day: "2-digit", month: "short" });
  }
  return (ms) => new Date(ms).toLocaleDateString("en-ZA", { timeZone: REPORTS_TZ, month: "short", year: "2-digit" });
}

function fmtAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(abs === 0 ? 0 : 2);
}

function buildChartSVG(o: {
  title: string;
  series: ChartSeriesSpec[];
  width: number;
  /** Height of the plot box itself, excluding title / legend / annotations. */
  plotHeight?: number;
}): SvgFigure {
  const width = o.width;
  const plotH = o.plotHeight ?? 150;
  const active = o.series.filter((s) => s.points.length > 0);

  const titleH = 20;
  const legendH = active.length ? 15 : 0;
  const annoH = active.length ? active.length * 12 + 4 : 0;
  const xAxisH = 20;
  const height = titleH + legendH + plotH + xAxisH + annoH + 8;

  const hasRight = active.some((s) => s.axis === "right");
  const padL = 46;
  const padR = hasRight ? 46 : 16;
  const plotTop = titleH + legendH + 4;
  const innerW = width - padL - padR;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  s += `<rect width="${width}" height="${height}" fill="#ffffff"/>`;
  s += `<text x="${width / 2}" y="14" text-anchor="middle" font-size="12" font-weight="bold" fill="${INK}" font-family="Helvetica">${escapeXml(o.title)}</text>`;

  if (active.length === 0) {
    s += `<rect x="${padL}" y="${plotTop}" width="${innerW}" height="${plotH}" fill="#fbfcfd" stroke="${GRID}"/>`;
    s += `<text x="${width / 2}" y="${plotTop + plotH / 2}" text-anchor="middle" font-size="10" fill="${MUTED}" font-family="Helvetica">No data recorded for this period</text>`;
    s += `</svg>`;
    return { markup: s, width, height };
  }

  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const ser of active) {
    for (const p of ser.points) {
      const t = p.ts.getTime();
      if (t < minTs) minTs = t;
      if (t > maxTs) maxTs = t;
    }
  }
  const tsRange = Math.max(1, maxTs - minTs);

  const scaleFor = (side: "left" | "right") => {
    const group = active.filter((ser) => (ser.axis ?? "left") === side);
    if (!group.length) return null;
    const vals = group.flatMap((ser) => ser.points.map((p) => p.value));
    const zeroBased = group.some((ser) => ser.type === "bar" || ser.type === "area");
    const lo = zeroBased ? Math.min(0, Math.min(...vals)) : Math.min(...vals);
    return niceScale(lo, Math.max(...vals), 5);
  };
  const leftScale = scaleFor("left");
  const rightScale = scaleFor("right");

  const xOf = (ts: number) => padL + ((ts - minTs) / tsRange) * innerW;

  /**
   * Bar series are laid out on ordinal bands, not on the continuous time axis.
   *
   * Plotting a column at its exact timestamp puts the first column's center
   * on padL, i.e. straight on top of the y-axis, so half of it renders outside
   * the plot box, and puts the last column's center on the right frame. The x
   * tick labels were separately placed at evenly spaced pixel ratios with their
   * dates interpolated from the time domain, so on a month of daily ETo values
   * the printed date almost never fell under the column for that date. Giving
   * each point an equal band and centering both the column and its tick label in
   * that band makes the two align by construction.
   *
   * Line and area series keep the continuous time scale: they have no per-
   * category block to line up with, and banding them would distort gaps.
   */
  const barSeries = active.filter((ser) => (ser.type ?? "line") === "bar");
  const bandCount = barSeries.length
    ? Math.max(...barSeries.map((ser) => ser.points.length))
    : 0;
  const bandW = bandCount > 0 ? innerW / bandCount : 0;
  /** Center of the i-th ordinal band. */
  const xBand = (i: number) => padL + (i + 0.5) * bandW;

  const yOf = (value: number, side: "left" | "right") => {
    const sc = side === "right" ? rightScale : leftScale;
    if (!sc) return plotTop + plotH;
    const span = sc.max - sc.min || 1;
    return plotTop + plotH - ((value - sc.min) / span) * plotH;
  };

  // Legend
  if (legendH) {
    const entries = active.map((ser) => `${ser.name}${ser.unit ? ` (${ser.unit})` : ""}`);
    const widths = entries.map((e) => 12 + 3 + e.length * 4.9 + 12);
    const totalW = widths.reduce((a, b) => a + b, 0);
    let lx = Math.max(padL, (width - totalW) / 2);
    active.forEach((ser, i) => {
      const ly = titleH + 6;
      s += `<rect x="${lx.toFixed(1)}" y="${ly - 4}" width="10" height="6" rx="1.5" fill="${ser.color}"/>`;
      s += `<text x="${(lx + 14).toFixed(1)}" y="${ly + 2}" font-size="8.5" fill="${MUTED}" font-family="Helvetica">${escapeXml(entries[i])}</text>`;
      lx += widths[i];
    });
  }

  // Gridlines + left axis ticks
  if (leftScale) {
    for (const v of leftScale.vals) {
      const y = yOf(v, "left");
      s += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + innerW}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="0.8"/>`;
      s += `<text x="${padL - 4}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="${MUTED}" font-family="Helvetica">${fmtAxis(v)}</text>`;
    }
  }
  if (rightScale) {
    for (const v of rightScale.vals) {
      const y = yOf(v, "right");
      s += `<text x="${padL + innerW + 4}" y="${(y + 3).toFixed(1)}" font-size="8" fill="${MUTED}" font-family="Helvetica">${fmtAxis(v)}</text>`;
    }
  }

  // Axis frame
  s += `<line x1="${padL}" y1="${plotTop}" x2="${padL}" y2="${plotTop + plotH}" stroke="${RULE}" stroke-width="0.8"/>`;
  s += `<line x1="${padL}" y1="${plotTop + plotH}" x2="${padL + innerW}" y2="${plotTop + plotH}" stroke="${RULE}" stroke-width="0.8"/>`;
  if (hasRight) {
    s += `<line x1="${padL + innerW}" y1="${plotTop}" x2="${padL + innerW}" y2="${plotTop + plotH}" stroke="${RULE}" stroke-width="0.8"/>`;
  }

  // X ticks
  const fmtTs = tickFormatter(tsRange);
  const tickCount = width > 380 ? 6 : 4;

  if (bandCount > 0) {
    /**
     * Banded axis: label the actual data points, centered in their own band, so
     * every label sits under the column it describes. Subsampled to roughly
     * tickCount labels so a month of daily values does not collide.
     */
    const widest = barSeries.reduce(
      (acc, ser) => (ser.points.length > acc.points.length ? ser : acc), barSeries[0]);
    const step = Math.max(1, Math.ceil(bandCount / tickCount));
    for (let i = 0; i < bandCount; i += step) {
      const p = widest.points[i];
      if (!p) continue;
      const x = xBand(i);
      s += `<line x1="${x.toFixed(1)}" y1="${plotTop + plotH}" x2="${x.toFixed(1)}" y2="${plotTop + plotH + 3}" stroke="${RULE}" stroke-width="0.8"/>`;
      // Center every label: a banded label belongs to its band, so clamping the
      // first and last to the frame edge would pull them off their own column.
      s += `<text x="${x.toFixed(1)}" y="${plotTop + plotH + 13}" text-anchor="middle" font-size="8" fill="${MUTED}" font-family="Helvetica">${escapeXml(fmtTs(p.ts.getTime()))}</text>`;
    }
  } else {
    for (let i = 0; i <= tickCount; i++) {
      const ratio = i / tickCount;
      const ts = minTs + tsRange * ratio;
      const x = padL + innerW * ratio;
      s += `<line x1="${x.toFixed(1)}" y1="${plotTop + plotH}" x2="${x.toFixed(1)}" y2="${plotTop + plotH + 3}" stroke="${RULE}" stroke-width="0.8"/>`;
      const anchor = i === 0 ? "start" : i === tickCount ? "end" : "middle";
      s += `<text x="${x.toFixed(1)}" y="${plotTop + plotH + 13}" text-anchor="${anchor}" font-size="8" fill="${MUTED}" font-family="Helvetica">${escapeXml(fmtTs(ts))}</text>`;
    }
  }

  // Series geometry
  for (const ser of active) {
    const side = ser.axis ?? "left";
    const type = ser.type ?? "line";

    if (type === "bar") {
      /**
       * Width comes from the band, not from a raw count against the full plot
       * width, so a short series gets proportionally wide columns and a long one
       * gets narrow ones, both centered in their band. The 0.7 factor leaves a
       * visible gutter between neighboring columns.
       */
      const groupW = Math.max(1.5, bandW * 0.7);
      // Several bar series share a band by splitting it, so they sit side by
      // side instead of hiding one another.
      const slotW = barSeries.length > 1 ? groupW / barSeries.length : groupW;
      const slotIndex = barSeries.indexOf(ser);
      const barW = Math.max(1.0, Math.min(18, slotW));
      const baseY = yOf(Math.max(0, (side === "right" ? rightScale : leftScale)?.min ?? 0), side);
      ser.points.forEach((p, i) => {
        // Offset within the band: centered for a single series, split evenly when
        // more than one bar series is present.
        const center = xBand(i)
          - (barSeries.length > 1 ? groupW / 2 - slotW * (slotIndex + 0.5) : 0);
        const x = center - barW / 2;
        const y = yOf(p.value, side);
        const h = Math.max(0.5, baseY - y);
        s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${ser.color}" fill-opacity="0.85"/>`;
      });
      continue;
    }

    const pts = ser.points.map((p) => `${xOf(p.ts.getTime()).toFixed(1)},${yOf(p.value, side).toFixed(1)}`);
    if (type === "area") {
      const baseY = yOf((side === "right" ? rightScale : leftScale)?.min ?? 0, side);
      const first = xOf(ser.points[0].ts.getTime()).toFixed(1);
      const last = xOf(ser.points[ser.points.length - 1].ts.getTime()).toFixed(1);
      s += `<polygon points="${first},${baseY.toFixed(1)} ${pts.join(" ")} ${last},${baseY.toFixed(1)}" fill="${ser.color}" fill-opacity="0.16"/>`;
    }
    s += `<polyline points="${pts.join(" ")}" fill="none" stroke="${ser.color}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // Min / avg / max annotation rows
  if (annoH) {
    active.forEach((ser, i) => {
      const vals = ser.points.map((p) => p.value);
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      const av = vals.reduce((a, b) => a + b, 0) / vals.length;
      const y = plotTop + plotH + xAxisH + 10 + i * 12;
      s += `<rect x="${padL}" y="${y - 6}" width="8" height="5" rx="1" fill="${ser.color}"/>`;
      const label = `${ser.name}: min ${fmtAxis(mn)} | avg ${fmtAxis(av)} | max ${fmtAxis(mx)}${ser.unit ? ` ${ser.unit}` : ""} (${ser.points.length} pts)`;
      s += `<text x="${padL + 12}" y="${y}" font-size="8" fill="${MUTED}" font-family="Helvetica">${escapeXml(label)}</text>`;
    });
  }

  s += `</svg>`;
  return { markup: s, width, height };
}

/**
 * PDFKit's built-in Helvetica is WinAnsi-encoded, so characters outside that
 * range (subscripts, en-dashes, non-breaking spaces) either throw or render as
 * garbage - which would silently break every scheduled report. Map them to
 * safe equivalents before anything reaches the document.
 */
const CHAR_MAP: Record<string, string> = {
  "\u2080": "o",
  "\u2081": "1", "\u2082": "2", "\u2083": "3",
  "\u2013": "-", "\u2014": "-", "\u2212": "-",
  "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
  "\u00a0": " ", "\u202f": " ", "\u2009": " ",
  "\u2026": "...",
};

export function pdfSafe(input: string): string {
  let out = "";
  for (const ch of String(input)) {
    const mapped = CHAR_MAP[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    out += (ch.codePointAt(0) ?? 63) <= 0xff ? ch : "?";
  }
  return out;
}

function escapeXml(s: string): string {
  return pdfSafe(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─────────────────────────────────────────────────────────────────────
// PDF rendering
// ─────────────────────────────────────────────────────────────────────

export interface BuildPdfInput {
  stationIds: number[];
  startMs: number;
  endMs: number;
  /** Field keys from REPORT_FIELDS. If empty, includes all summary fields. */
  fields?: string[];
  /** Report title shown on the cover page (e.g. schedule name). */
  title?: string;
  /** Friendly period label (e.g. "Last 7 days"). */
  periodLabel?: string;
  /** Set false for a summary-only PDF (no graph pages). Defaults to true. */
  includeCharts?: boolean;
}

function fmtVal(v: number | null, decimals = 1): string {
  if (v == null || isNaN(v)) return "n/a";
  return v.toFixed(decimals);
}

function decimalsFor(key: string, unit: string): number {
  if (key === "lightning_strikes") return 0;
  if (unit === "%" || unit === "mbar") return 1;
  return 2;
}

/**
 * Build the PDF and return it as a Buffer. Never throws - on failure
 * returns a 1-page PDF that explains the error so scheduled emails
 * still go out with *some* attachment.
 */
export async function buildSchedulePdfBuffer(input: BuildPdfInput): Promise<Buffer> {
  try {
    /**
     * Make sure the station calibration snapshot is loaded before any rainfall is
     * totalled.
     *
     * getRainfallConfig reads that snapshot synchronously, and returns null when
     * it is empty. Null does not mean "no calibration": it sends
     * intervalRainSeries down its legacy auto-detect heuristic, which can read a
     * per-interval field as a cumulative counter and report a materially
     * different depth. Measured on Quaggasklip over 30 days: 14.5 mm from the
     * heuristic against 26.3 mm from the configured incremental reading.
     *
     * routes.ts warms the cache at boot, but does so without awaiting it, so a
     * report generated in the first moments after a restart could silently take
     * the fallback. Awaiting here is idempotent (the underlying load runs once)
     * and removes that window entirely.
     */
    await ensureCalibrationCache();
    return await renderPdf(input);
  } catch (err: any) {
    console.error("[pdfReport] render failed:", err);
    return await renderErrorPdf(input, err?.message || String(err));
  }
}

async function renderPdf(input: BuildPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    bufferPages: true,
    info: {
      Title: pdfSafe(input.title || "Stratus Weather Report"),
      Author: "Stratus Weather",
      Creator: "Stratus Weather Server",
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const fieldSet = input.fields && input.fields.length > 0
    ? new Set(input.fields)
    : new Set(REPORT_FIELDS.map((f) => f.key));

  const title = input.title || "Stratus Weather Report";
  const periodLabel = input.periodLabel || formatPeriod(input.startMs, input.endMs);
  const includeCharts = input.includeCharts !== false;

  const metas = await Promise.all(input.stationIds.map((id) => fetchStationMeta(id)));

  /**
   * No cover page.
   *
   * The report opens directly on the first station's graphs. The old opening
   * page repeated the period, from/to timestamps, station count, generation
   * time and a station list - all of which are either on the station heading or
   * in the page footer, so it was a page of restated metadata before any
   * content. Removed at the operator's request.
   */
  for (let i = 0; i < input.stationIds.length; i++) {
    if (i > 0) doc.addPage();
    await renderStationSection(
      doc, input.stationIds[i], metas[i],
      input.startMs, input.endMs, fieldSet, periodLabel, includeCharts,
    );
  }

  renderPageFooters(doc, title);
  doc.end();
  return done;
}

/** Footer with page numbers on every page except the cover. */
function renderPageFooters(doc: any, title: string): void {
  try {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      if (i === range.start) continue; // cover page stays clean
      doc.switchToPage(i);
      const w = usableWidth(doc);
      const x = doc.page.margins.left;
      // The footer is the one place this file positions text absolutely. It sits
      // 14pt BELOW the bottom margin, i.e. outside the band body text can ever
      // occupy (flowed text stops at page.height - margins.bottom), so it cannot
      // collide with anything and no page has two text boxes on the same line.
      const y = doc.page.height - doc.page.margins.bottom + 14;
      // Writing below the bottom margin would make PDFKit append a fresh page,
      // so drop the margin for the duration of the footer write.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(MUTED).font(FONT_REGULAR).fontSize(TYPE.caption);
      doc.text(pdfSafe(`Stratus Weather | ${title}`), x, y, { width: w * 0.7, lineBreak: false });
      doc.text(pdfSafe(`Page ${i - range.start + 1} of ${range.count}`), x + w * 0.7, y, { width: w * 0.3, align: "right", lineBreak: false });
      doc.page.margins.bottom = savedBottom;
    }
  } catch (e) {
    console.warn("[pdfReport] footer pass failed:", (e as Error).message);
  }
}

async function renderStationSection(
  doc: any,
  stationId: number,
  meta: StationMeta,
  startMs: number,
  endMs: number,
  fieldSet: Set<string>,
  periodLabel: string,
  includeCharts: boolean,
): Promise<void> {
  // Gather stats + raw series in parallel
  const [stationInfo, raw] = await Promise.all([
    gatherStationData(stationId, startMs, endMs, fieldSet),
    fetchRawSeries(stationId, startMs, endMs),
  ]);
  const stationName = stationInfo.name || meta.name;
  const stats = stationInfo.stats;

  /**
   * Report title: what this document is, and over what window.
   *
   * "Weather Data Report" names the document rather than just the station, so a
   * filed PDF is identifiable from its first line alone. The period follows it
   * because it is the other half of the document's identity.
   */
  const w = usableWidth(doc);
  doc.fillColor(NAVY).font(FONT_REGULAR).fontSize(TYPE.heading)
    .text(pdfSafe(`${stationName} Weather Data Report | ${periodLabel}`), { width: w });

  /**
   * Site details, one per line, as a plain labelled list.
   *
   * Stacked rather than run together on a single line, and deliberately without
   * bullets: these are four facts about one place, not a sequence of steps, and
   * a reader scanning for the elevation should find it in a fixed position every
   * time. Latitude, longitude and altitude also let a reader reproduce the
   * derived figures further down - reference ETo is a function of site latitude
   * and altitude - so they belong next to the numbers they govern.
   *
   * The period is printed twice on the page by design: the title carries the
   * relative wording ("Last 30 days"), which stops being true once the PDF is
   * filed, and this line carries the absolute dates that keep an archived report
   * self-describing.
   *
   * Rows with nothing recorded are dropped rather than printed as a placeholder.
   */
  const detailRows: Array<[string, string]> = [];
  if (meta.location) detailRows.push(["Location", meta.location]);

  const lat = typeof meta.latitude === "number" ? meta.latitude : null;
  const lon = typeof meta.longitude === "number" ? meta.longitude : null;
  const hasCoords = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
  if (hasCoords) {
    detailRows.push([
      "Coordinates",
      `${Math.abs(lat!).toFixed(5)} ${lat! >= 0 ? "N" : "S"}, ${Math.abs(lon!).toFixed(5)} ${lon! >= 0 ? "E" : "W"}`,
    ]);
  }

  const alt = typeof meta.altitude === "number" ? meta.altitude : null;
  if (alt !== null && Number.isFinite(alt)) {
    detailRows.push(["Elevation", `${Math.round(alt)} m AMSL`]);
  }

  detailRows.push(["Reporting period", formatDateRange(startMs, endMs)]);

  doc.moveDown(0.35);
  doc.fillColor(INK).font(FONT_REGULAR).fontSize(TYPE.body);
  for (const [label, value] of detailRows) {
    // All one weight and all black: the report is deliberately plain regular
    // Arial with no bold and no grey anywhere, so the "Label: value" shape and
    // the fixed line order are what carry the structure.
    doc.text(pdfSafe(`${label}: ${value}`), { width: w });
  }

  doc.moveDown(0.6);

  /**
   * Two views of the site side by side: satellite on the left, street map on the
   * right, each half the text width, both pinned at the station.
   *
   * Two complementary views answer two different questions. The satellite frame
   * shows the immediate surroundings of the mast, which is what governs exposure
   * and therefore how the wind and radiation figures should be read. The street
   * map is drawn further out and shows which roads and settlements the site sits
   * among, which is what someone who has never been there needs for context.
   *
   * Page one therefore reads top to bottom as: what this report is, where the
   * station is, what that place looks like, then the figures. The wind roses and
   * the remaining graphs start on the next page.
   *
   * Skipped silently when the station has no coordinates or when the tiles
   * cannot be fetched, in which case the table simply moves up the page.
   */
  if (hasCoords) {
    await drawSiteMaps(doc, lat!, lon!, w);
  }

  /**
   * Statistics table first, vector artwork after it.
   *
   * The numbers are what a reader checks first, so the min/avg/max table leads
   * and the graphs follow. It also means a reader who only wants the figures
   * never has to page past the artwork to find them.
   */
  renderStatsTable(doc, raw, stationId, meta, stationName, periodLabel, fieldSet);

  if (!includeCharts) return;

  const chartW = usableWidth(doc);

  /**
   * Wind analysis: rose plus scatter, side by side.
   *
   * Both are functions of speed AND direction, so a station with an anemometer
   * but no vane cannot produce either: the rose would be an empty dial and the
   * scatter an empty disc. Skip the whole page in that case rather than printing
   * two blank circles.
   */
  const hasWindPair = raw.some(
    (r) => r.wind != null && Number.isFinite(r.wind)
      && r.windDir != null && Number.isFinite(r.windDir),
  );

  if (hasWindPair) {
    doc.addPage();
    sectionHeading(doc, `${stationName} Wind Analysis`);
    const polarSize = Math.floor((chartW - 14) / 2);
    const polarH = polarSize + POLAR_CHROME_H;
    const polarY = doc.y;
    embedSvg(doc, buildWindRoseSVG(raw, `Wind Rose (${periodLabel})`, polarSize),
      { x: doc.page.margins.left, y: polarY, width: polarSize });
    embedSvg(doc, buildWindScatterSVG(raw, `Wind Speed Scatter (${periodLabel})`, polarSize),
      { x: doc.page.margins.left + polarSize + 14, y: polarY, width: polarSize });
    doc.y = polarY + polarH + 10;

    const dirNote = "Petal length shows how often the wind blew from each direction; colour bands show the speed class. "
      + "The scatter plots every reading as direction (angle) against speed (radius).";
    // Flowed text (no x,y) so it can never land on top of the figures above or
    // run past the bottom margin - overlapping text boxes are what break DOCX
    // conversion. If the polar block used up the page, start a fresh one.
    if (doc.y + 40 > bottomLimit(doc)) doc.addPage();
    doc.fillColor(INK).font(FONT_REGULAR).fontSize(TYPE.caption)
      .text(pdfSafe(dirNote), { width: chartW, align: "justify" });
  }

  // ── Time-series graphs ──
  const maxPoints = 900;
  const tempSeries = downsample(seriesFrom(raw, (r) => r.temp), maxPoints);
  const humSeries = downsample(seriesFrom(raw, (r) => r.humidity), maxPoints);
  const windSeries = downsample(seriesFrom(raw, (r) => r.wind), maxPoints);
  const gustSeries = downsample(seriesFrom(raw, (r) => r.gust), maxPoints, "max");
  const solarSeries = downsample(seriesFrom(raw, (r) => r.solar), maxPoints);
  const batterySeries = downsample(seriesFrom(raw, (r) => r.battery), maxPoints);
  const pressureSeries = downsample(seriesFrom(raw, (r) => r.pressure), maxPoints);
  const dewSeries = downsample(seriesFrom(raw, (r) => r.dew), maxPoints);
  const etoSeries = buildDailyEtoSeries(raw, meta);

  /**
   * Only chart what the station actually measures.
   *
   * A sensor this station does not have used to still get its name in a chart
   * title, its entry in the legend and a flat empty axis, which reads as a broken
   * sensor rather than an absent one. So each series is admitted only if it has
   * at least one real value, and a chart is dropped entirely when none of its
   * series survive. The titles are assembled from the series that remain, so a
   * station with solar but no battery gets "Solar Irradiance" rather than
   * "Solar Irradiance and Battery Voltage".
   */
  const hasData = (pts: ChartSeries[]): boolean =>
    pts.some((p) => p.value != null && Number.isFinite(p.value));

  interface Candidate {
    name: string;
    unit: string;
    color: string;
    points: ChartSeries[];
    axis?: "left" | "right";
    type?: "bar" | "line";
    /** Chart title fragment contributed when this series is present. */
    label: string;
  }

  const addFigure = (
    figures: SvgFigure[],
    candidates: Candidate[],
    joiner = " and ",
  ): void => {
    const present = candidates.filter((c) => hasData(c.points));
    if (present.length === 0) return;
    figures.push(buildChartSVG({
      title: present.map((c) => c.label).join(joiner),
      width: chartW,
      series: present.map(({ name, unit, color, points, axis, type }) => ({
        name, unit, color, points, axis, type,
      })),
    }));
  };

  const figures: SvgFigure[] = [];

  addFigure(figures, [
    { label: "Temperature", name: "Temperature", unit: "degC", color: CHART_COLORS.temperature, points: tempSeries },
    { label: "Relative Humidity", name: "Humidity", unit: "%", color: CHART_COLORS.humidity, points: humSeries, axis: "right" },
  ]);

  addFigure(figures, [
    { label: "Wind Speed", name: "Wind speed", unit: "m/s", color: CHART_COLORS.wind, points: windSeries },
    { label: "Gusts", name: "Gust", unit: "m/s", color: CHART_COLORS.gust, points: gustSeries },
  ]);

  addFigure(figures, [
    { label: "Solar Irradiance", name: "Solar", unit: "W/m2", color: CHART_COLORS.solar, points: solarSeries },
    { label: "Battery Voltage", name: "Battery", unit: "V", color: CHART_COLORS.battery, points: batterySeries, axis: "right" },
  ]);

  addFigure(figures, [
    { label: "Barometric Pressure", name: "Pressure", unit: "mbar", color: CHART_COLORS.pressure, points: pressureSeries },
  ]);

  if (etoSeries.length > 0) {
    figures.push(buildChartSVG({
      title: "Reference Evapotranspiration (ETo, FAO-56 daily)",
      width: chartW,
      series: [
        { name: "ETo", unit: "mm/day", color: CHART_COLORS.eto, points: etoSeries, type: "bar" },
      ],
    }));
  }

  /**
   * Dew point last, after ETo.
   *
   * It sits next to ETo because both answer the same question from opposite
   * sides: ETo is how much water the atmosphere can take, dew point is how much
   * it is already holding. Plotted against temperature, because the gap between
   * the two lines is the reading that matters, and the lines meeting is
   * saturation.
   */
  addFigure(figures, [
    { label: "Dew Point", name: "Dew point", unit: "degC", color: CHART_COLORS.dewPoint, points: dewSeries },
    { label: "Temperature", name: "Temperature", unit: "degC", color: CHART_COLORS.temperature, points: tempSeries },
  ], " and ");

  // No sensors, no graphs page. Adding a page with only a heading on it would be
  // worse than leaving it out.
  if (figures.length === 0) return;

  doc.addPage();
  sectionHeading(doc, `${stationName} Graphs`);
  for (const fig of figures) {
    placeFigure(doc, fig, `${stationName} Graphs continued`);
  }

}

function sectionHeading(doc: any, text: string): void {
  const w = usableWidth(doc);
  doc.fillColor(NAVY).font(FONT_REGULAR).fontSize(TYPE.heading).text(pdfSafe(text), { width: w });
  doc.moveDown(0.3);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + w, doc.y)
    .strokeColor(RULE).lineWidth(0.8).stroke();
  doc.moveDown(0.6);
}

/** Place a figure at the cursor, breaking to a new page when it won't fit. */
function placeFigure(doc: any, fig: SvgFigure, continuationHeading?: string): void {
  if (doc.y + fig.height > bottomLimit(doc)) {
    doc.addPage();
    if (continuationHeading) sectionHeading(doc, continuationHeading);
  }
  const y = doc.y;
  embedSvg(doc, fig.markup, { x: doc.page.margins.left, y, width: fig.width });
  doc.y = y + fig.height + 8;
}

// NOTE: this report deliberately has no rainfall chart. Rainfall is reported
// as a period total in the summary table (the `rainfall_total` field, which
// already has the per-station offset applied by reportSchedulerService), so the
// former cumulative-rainfall figure and its buildRainSeries helper were removed.

/** Pull a single numeric channel out of the raw records as a chart series. */
function seriesFrom(raw: RawRecord[], pick: (r: RawRecord) => number | null): ChartSeries[] {
  const out: ChartSeries[] = [];
  for (const r of raw) {
    const v = pick(r);
    if (v != null && Number.isFinite(v)) out.push({ ts: r.ts, value: v });
  }
  return out;
}

function dayKey(d: Date): string {
  // en-CA gives YYYY-MM-DD, evaluated in the report timezone.
  return d.toLocaleDateString("en-CA", { timeZone: REPORTS_TZ });
}

/**
 * FAO-56 Penman-Monteith reference evapotranspiration (mm/day).
 *
 * Mirrors calculateETo in shared/utils/calc.ts. The server build has
 * rootDir=./server and excludes shared/, so the formula is duplicated here
 * deliberately rather than imported.
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
  // Clamp the clearness ratio - a mis-scaled solar channel would otherwise
  // drive the longwave term (and ETo) to nonsense values.
  const clearness = Rso > 0 ? Math.max(0, Math.min(1, rsMJ / Rso)) : 0.5;
  const Rnl = 4.903e-9 * Math.pow(Tk, 4) * (0.34 - 0.14 * Math.sqrt(Math.max(ea, 0))) * (1.35 * clearness - 0.35);
  const Rn = Rns - Rnl;
  const eto = (0.408 * delta * Rn + gamma * (900 / (tMean + 273)) * u2 * (es - ea)) /
    (delta + gamma * (1 + 0.34 * u2));
  return Math.max(0, eto);
}

/** Daily ETo totals derived from the raw readings + station geometry. */
function buildDailyEtoSeries(raw: RawRecord[], meta: StationMeta): ChartSeries[] {
  if (meta.latitude == null) return [];
  const lat = meta.latitude;
  const alt = meta.altitude ?? 0;

  interface Bucket { t: number[]; rh: number[]; u: number[]; solarW: number[]; solarMJ: number }
  const buckets = new Map<string, Bucket>();
  for (const r of raw) {
    const key = dayKey(r.ts);
    let b = buckets.get(key);
    if (!b) { b = { t: [], rh: [], u: [], solarW: [], solarMJ: 0 }; buckets.set(key, b); }
    if (r.temp != null) b.t.push(r.temp);
    if (r.humidity != null) b.rh.push(r.humidity);
    if (r.wind != null) b.u.push(r.wind);
    if (r.solar != null) b.solarW.push(r.solar);
    if (r.solarMJ != null) b.solarMJ += r.solarMJ;
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const out: ChartSeries[] = [];
  for (const key of Array.from(buckets.keys()).sort()) {
    const b = buckets.get(key)!;
    const tMean = mean(b.t);
    const rhMean = mean(b.rh);
    const uMean = mean(b.u) ?? 1;
    const solarMean = mean(b.solarW);
    // Prefer the logger's MJ total, else integrate the mean W/m2 over the day.
    const rsMJ = b.solarMJ > 0 ? b.solarMJ : (solarMean != null ? (solarMean * 86400) / 1e6 : null);
    if (tMean == null || rhMean == null || rsMJ == null) continue;
    const noon = new Date(`${key}T12:00:00Z`);
    if (isNaN(noon.getTime())) continue;
    const doy = Math.floor((noon.getTime() - Date.UTC(noon.getUTCFullYear(), 0, 0)) / 86400000);
    out.push({ ts: noon, value: Math.round(fao56Eto(tMean, rhMean, uMean, rsMJ, alt, lat, doy) * 100) / 100 });
  }
  return out;
}

/** Mean of the non-null values, or null when the bucket has none. */
function meanOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function maxOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length === 0 ? null : Math.max(...nums);
}

/**
 * Vector (circular) mean of wind directions in degrees.
 *
 * Averaging bearings arithmetically is wrong at the compass rose seam: 350 deg
 * and 10 deg average to 180 (due south) instead of 0 (due north). Summing unit
 * vectors and taking the resultant angle is the meteorological convention.
 */
function meanDirection(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const d of nums) {
    const r = (d * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return null; // fully canceling
  let deg = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Convert the stored rainfall channel into per-reading INTERVAL rainfall.
 *
 * Stations disagree on what the field means. RIKA (and any counter-style gauge)
 * reports millimetres since commissioning, so the raw column climbs forever;
 * summing it would invent meters of rain. Incremental loggers already report
 * per-interval totals. The station's calibration row decides which, and 'auto'
 * falls back to detecting a monotonic series.
 *
 * Returns an array parallel to `raw` holding the rain that fell during each
 * reading's interval (null where unknown, e.g. the first sample of a counter).
 */
function intervalRainSeries(raw: RawRecord[], stationId: number): Array<number | null> {
  const cfg = getRainfallConfig(stationId);
  const values = raw.map((r) => r.rain);

  let cumulative: boolean;
  if (cfg?.type === "cumulative_lifetime" || cfg?.type === "cumulative_yearly") {
    cumulative = true;
  } else if (cfg?.type === "incremental" || cfg?.type === "tip_count") {
    cumulative = false;
  } else {
    // 'auto' / unconfigured: a counter climbs and effectively never falls.
    const nums = values.filter((v): v is number => v != null);
    let rises = 0;
    let falls = 0;
    for (let i = 1; i < nums.length; i++) {
      const d = nums[i] - nums[i - 1];
      if (d > 0.001) rises++;
      else if (d < -0.001) falls++;
    }
    cumulative = nums.length > 2
      && (Math.max(...nums, 0) > 50 || (rises > 0 && falls <= Math.max(1, nums.length * 0.05)));
  }

  const tipFactor = cfg?.type === "tip_count" ? (cfg.tipFactor || DEFAULT_TIP_FACTOR) : 1;

  if (!cumulative) {
    return values.map((v) => (v == null ? null : Math.max(0, v) * tipFactor));
  }

  // Cumulative: emit positive deltas. Rejects counter resets (negative steps)
  // and single-sample glitches larger than any real interval of rain.
  const MAX_STEP_MM = 60;
  const out: Array<number | null> = new Array(values.length).fill(null);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev != null) {
      const step = v - prev;
      out[i] = step > 0 && step <= MAX_STEP_MM ? step : 0;
    }
    prev = v;
  }
  return out;
}
/** One line of the statistics table. */
interface StatRow {
  label: string;
  unit: string;
  min: number | null;
  avg: number | null;
  max: number | null;
  decimals: number;
  /** Accumulations (rain, solar energy, ETo) have a total instead of min/avg/max. */
  total?: number | null;
}

function minOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  return nums.length === 0 ? null : Math.min(...nums);
}

/**
 * Statistics table: minimum, average and maximum per parameter for the report
 * period, placed directly beneath the vector artwork.
 *
 * This replaces both the old prose narrative and the previous four-column
 * "Summary" listing. Every cell is real PDF text (never HTML, never a
 * rasterised screenshot), so the table stays selectable and copy-pasteable.
 *
 * Instantaneous quantities get min/avg/max. Accumulations - rainfall, solar
 * energy and ETo - get a period total instead, because the minimum or average
 * of an accumulating depth is not a meaningful number.
 */
function renderStatsTable(
  doc: any,
  raw: RawRecord[],
  stationId: number,
  meta: StationMeta,
  stationName: string,
  periodLabel: string,
  fieldSet: Set<string>,
): void {
  try {
    renderStatsTableUnsafe(doc, raw, stationId, meta, stationName, periodLabel, fieldSet);
  } catch (e) {
    console.warn("[pdfReport] statistics table failed:", (e as Error).message);
    try {
      doc.fillColor("#b91c1c").font(FONT_REGULAR).fontSize(TYPE.caption)
        .text(pdfSafe("(statistics table could not be rendered)"), { width: usableWidth(doc) });
      doc.fillColor(INK);
    } catch {
      /* document no longer writable */
    }
  }
}

function renderStatsTableUnsafe(
  doc: any,
  raw: RawRecord[],
  stationId: number,
  meta: StationMeta,
  stationName: string,
  periodLabel: string,
  fieldSet: Set<string>,
): void {
  const w = usableWidth(doc);

  // Keep the table with the artwork it describes when there is room; otherwise
  // start a clean page rather than splitting the header off its first rows.
  if (doc.y + 130 > bottomLimit(doc)) doc.addPage();

  /**
   * No heading above this table.
   *
   * It used to print "<Station> Statistics for <period>", which repeated the two
   * facts already in the report title at the top of page one. The table's own
   * column headers say what the columns are, so the heading was pure
   * restatement and the operator asked for it gone.
   */

  if (raw.length === 0) {
    doc.fillColor(MUTED).font(FONT_OBLIQUE).fontSize(TYPE.body)
      .text(pdfSafe("No readings were recorded for this period."), { width: w });
    doc.fillColor(INK);
    return;
  }

  /**
   * Is any aggregate of this parameter selected?
   *
   * The operator's field selection uses the per-aggregate keys from
   * REPORT_FIELDS ("temp_min", "temp_avg", "humidity_avg", "wind_gust_max",
   * "rainfall_total", ...), never a bare parameter name. Gating a row on a bare
   * name such as "temperature" therefore never matched, so every min/avg/max
   * row was silently dropped and the table came out with a single line. Match on
   * the aggregate-key prefix instead.
   */
  const PARAM_KEYS: Record<string, string[]> = {
    temperature: ["temp_min", "temp_avg", "temp_max"],
    humidity: ["humidity_avg"],
    pressure: ["pressure_avg"],
    windSpeed: ["wind_avg", "wind_max", "wind_gust_max"],
    windDirection: ["wind_avg", "wind_max"],
    solarRadiation: ["solar_avg", "solar_total"],
    batteryVoltage: ["battery_min", "battery_avg"],
    rainfall: ["rainfall_total"],
  };
  const wantsAny = (param: string): boolean => {
    if (fieldSet.size === 0) return true;
    const keys = PARAM_KEYS[param] ?? [param];
    return keys.some((k) => fieldSet.has(k));
  };

  const rows: StatRow[] = [];
  const add = (
    key: string,
    label: string,
    unit: string,
    pick: (r: RawRecord) => number | null,
    decimals: number,
  ): void => {
    if (!wantsAny(key)) return;
    const vals = raw.map(pick);
    const mn = minOf(vals);
    const av = meanOf(vals);
    const mx = maxOf(vals);
    if (mn == null && av == null && mx == null) return; // sensor absent
    rows.push({ label, unit, min: mn, avg: av, max: mx, decimals });
  };

  add("temperature", "Temperature", "degC", (r) => r.temp, 1);
  add("humidity", "Relative humidity", "%", (r) => r.humidity, 1);
  add("pressure", "Barometric pressure", "mbar", (r) => r.pressure, 1);
  add("windSpeed", "Wind speed", "m/s", (r) => r.wind, 1);
  add("windSpeed", "Wind gust", "m/s", (r) => r.gust, 1);
  add("solarRadiation", "Solar irradiance", "W/m2", (r) => r.solar, 0);
  add("batteryVoltage", "Battery voltage", "V", (r) => r.battery, 2);

  // ── Accumulations ──
  const accum: StatRow[] = [];

  // Wind direction: a vector mean only (min/max of a bearing is meaningless).
  const dirMean = meanDirection(raw.map((r) => r.windDir));
  if (dirMean != null && wantsAny("windDirection")) {
    // A bearing has no meaningful minimum or maximum (0 and 359 are adjacent),
    // so only the vector mean is reported, in the Average column.
    accum.push({ label: "Wind direction (vector mean)", unit: "deg", min: null, avg: dirMean, max: null, decimals: 0 });
  }

  if (wantsAny("rainfall")) {
    const rainSeries = intervalRainSeries(raw, stationId);
    // Explicit accumulator type: the series is Array<number | null>, so an
    // inferred accumulator would widen to number | null.
    const rainTotal = rainSeries.reduce<number>((s, v) => s + (v ?? 0), 0);
    /**
     * Total only, no min / average / maximum.
     *
     * For an accumulating quantity those three are close to meaningless in a
     * table: the minimum is 0 on any period with a dry interval, and the average
     * is the mean of mostly-zero intervals, so it reads as 0.0 even in a wet
     * month. The depth is the figure that matters here, and the distribution is
     * legible in the rainfall graph further on.
     */
    accum.push({
      label: "Rainfall", unit: "mm", decimals: 1,
      min: null, avg: null, max: null,
      total: rainTotal,
    });
  }

  if (wantsAny("solarRadiation")) {
    const mj = raw.reduce((s, r) => s + (r.solarMJ ?? 0), 0);
    if (mj > 0) {
      // Energy is an accumulation: only a total is meaningful.
      accum.push({ label: "Solar energy", unit: "MJ/m2", min: null, avg: null, max: null, decimals: 1, total: mj });
    }
  }

  try {
    const eto = buildDailyEtoSeries(raw, meta);
    if (eto.length > 0) {
      const etoTotal = eto.reduce((s, p) => s + (p.value ?? 0), 0);
      // Total only, for the same reason as rainfall: ETo is an accumulation, and
      // the daily spread is what the ETo graph is for.
      accum.push({
        label: "Reference ETo (daily)", unit: "mm", decimals: 2,
        min: null, avg: null, max: null,
        total: etoTotal,
      });
    }
  } catch {
    /* ETo needs latitude/altitude; skip when unavailable */
  }

  if (rows.length === 0 && accum.length === 0) {
    doc.fillColor(MUTED).font(FONT_OBLIQUE).fontSize(TYPE.body)
      .text(pdfSafe("No numeric readings available for the selected fields."), { width: w });
    doc.fillColor(INK);
    return;
  }

  // Column grid: parameter name takes the slack, the three numeric columns are
  // fixed width and right-aligned so the digits line up down the page.
  const startX = doc.page.margins.left;
  const unitW = 46;
  const numW = 62;
  const labelW = w - unitW - numW * 4;
  const rowH = 15;
  const headerH = 18;

  const cellX = [startX, startX + labelW, startX + labelW + unitW,
    startX + labelW + unitW + numW, startX + labelW + unitW + numW * 2,
    startX + labelW + unitW + numW * 3];

  const drawHeader = (): void => {
    const y = doc.y;
    doc.save();
    doc.rect(startX, y, w, headerH).fill(NAVY);
    doc.restore();
    doc.fillColor("#ffffff").font(FONT_REGULAR).fontSize(TYPE.caption);
    doc.text(pdfSafe("Parameter"), cellX[0] + 4, y + 5, { width: labelW - 8, lineBreak: false });
    doc.text(pdfSafe("Unit"), cellX[1] + 4, y + 5, { width: unitW - 8, lineBreak: false });
    doc.text(pdfSafe("Minimum"), cellX[2], y + 5, { width: numW - 6, align: "right", lineBreak: false });
    doc.text(pdfSafe("Average"), cellX[3], y + 5, { width: numW - 6, align: "right", lineBreak: false });
    doc.text(pdfSafe("Maximum"), cellX[4], y + 5, { width: numW - 6, align: "right", lineBreak: false });
    doc.text(pdfSafe("Total"), cellX[5], y + 5, { width: numW - 6, align: "right", lineBreak: false });
    doc.fillColor(INK);
    doc.y = y + headerH;
  };

  // Blank rather than a dash: a dash reads as a value, and the operator
  // asked for no dash decoration anywhere in the report.
  const num = (v: number | null, d: number): string => (v == null ? "" : v.toFixed(d));

  const writeRow = (r: StatRow, zebra: boolean): void => {
    if (doc.y + rowH > bottomLimit(doc)) {
      doc.addPage();
      // Kept, unlike the heading that used to sit above the first page of this table:
  // a reader landing mid-table needs to know what they are looking at. The
  // station name and period are dropped from it because the report title on page
  // one already carries both.
  sectionHeading(doc, "Statistics continued");
      drawHeader();
    }
    const y = doc.y;
    if (zebra) {
      doc.save();
      doc.rect(startX, y, w, rowH).fill("#f1f5f9");
      doc.restore();
    }
    doc.fillColor(INK).font(FONT_REGULAR).fontSize(TYPE.body);
    doc.text(pdfSafe(r.label), cellX[0] + 4, y + 3.5, { width: labelW - 8, lineBreak: false });
    doc.fillColor(MUTED);
    doc.text(pdfSafe(r.unit), cellX[1] + 4, y + 3.5, { width: unitW - 8, lineBreak: false });
    doc.fillColor(INK);
    // One uniform path: each column is printed when it applies to the row and
    // left blank when it does not, so nothing is faked and nothing is hidden.
    doc.text(pdfSafe(num(r.min, r.decimals)), cellX[2], y + 3.5, { width: numW - 6, align: "right", lineBreak: false });
    doc.text(pdfSafe(num(r.avg, r.decimals)), cellX[3], y + 3.5, { width: numW - 6, align: "right", lineBreak: false });
    doc.text(pdfSafe(num(r.max, r.decimals)), cellX[4], y + 3.5, { width: numW - 6, align: "right", lineBreak: false });
    if (r.total != null) doc.font(FONT_BOLD);
    doc.text(pdfSafe(num(r.total ?? null, r.decimals)), cellX[5], y + 3.5, { width: numW - 6, align: "right", lineBreak: false });
    doc.font(FONT_REGULAR);
    doc.y = y + rowH;
  };

  drawHeader();
  let zebra = false;
  for (const r of rows) {
    writeRow(r, zebra);
    zebra = !zebra;
  }
  for (const r of accum) {
    writeRow(r, zebra);
    zebra = !zebra;
  }

  doc.moveTo(startX, doc.y).lineTo(startX + w, doc.y)
    .strokeColor(RULE).lineWidth(0.5).stroke();
  doc.fillColor(INK);
}

/**
 * Embed an SVG figure as vector artwork at an exact position.
 *
 * Vector (rather than a rasterised PNG) is deliberate: the graph is stored as
 * real PDF drawing operations, so it stays perfectly sharp at any zoom level
 * and at any print DPI, and the file stays small.
 *
 * The caller owns cursor movement - see placeFigure - because only the caller
 * knows the figure's true height.
 */
function embedSvg(doc: any, svg: string, opts: { x: number; y: number; width: number }): void {
  try {
    // svg-to-pdfkit exports a default function. Handle both shapes.
    const fn = (SVGtoPDF as any).default || (SVGtoPDF as any);
    fn(doc, svg, opts.x, opts.y, { width: opts.width, assumePt: true, preserveAspectRatio: "xMinYMin meet" });
  } catch (e) {
    console.warn("[pdfReport] embedSvg failed:", (e as Error).message);
    doc.fillColor("#b91c1c").font(FONT_REGULAR).fontSize(TYPE.caption).text(pdfSafe("(graph render failed)"), opts.x, opts.y);
  }
}

/**
 * Absolute "from date to date" wording for the report header.
 *
 * formatPeriod gives the relative label ("Last 30 days"), which is what the
 * operator asked for in the title but which stops being true the moment the PDF
 * is filed. This gives the dates that make an archived report self-describing.
 * Evaluated in REPORTS_TZ so these dates agree with the day boundaries used for
 * every daily figure in the report.
 */
function formatDateRange(startMs: number, endMs: number): string {
  const fmt = (ms: number): string =>
    new Date(ms).toLocaleDateString("en-ZA", {
      timeZone: REPORTS_TZ,
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  return `${fmt(startMs)} to ${fmt(endMs)}`;
}

function formatPeriod(startMs: number, endMs: number): string {
  const days = Math.round((endMs - startMs) / (24 * 3600 * 1000));
  if (days <= 1) return "Last 24 hours";
  if (days <= 7) return `Last ${days} day(s)`;
  if (days <= 31) return `Last ${days} days`;
  return `${new Date(startMs).toISOString().slice(0, 10)} - ${new Date(endMs).toISOString().slice(0, 10)}`;
}

function renderErrorPdf(input: BuildPdfInput, message: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: 50, right: 50 } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fillColor(INK).font(FONT_REGULAR).fontSize(TYPE.title).text(pdfSafe("Stratus Weather Report"));
      doc.moveDown(1);
      doc.fillColor("#b91c1c").font(FONT_REGULAR).fontSize(TYPE.subheading).text(pdfSafe("Failed to render PDF report."));
      doc.moveDown(0.5);
      doc.fillColor(INK).font(FONT_REGULAR).fontSize(TYPE.body).text(pdfSafe(`Error: ${message}`));
      doc.moveDown(1);
      doc.fillColor(MUTED).font(FONT_REGULAR).fontSize(TYPE.caption).text(pdfSafe(`Stations: ${input.stationIds.join(", ")}`));
      doc.text(pdfSafe(`Period: ${formatPeriod(input.startMs, input.endMs)}`));
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
//  Satellite imagery for the station location
// ─────────────────────────────────────────────────────────────────────

/**
 * Esri World Imagery, the same basemap the dashboard map uses.
 *
 * Deliberately NOT raw tile.openstreetmap.org: their usage policy forbids
 * production use and returns 403 for flagged referrers. Esri World Imagery
 * permits embedding and is already the default satellite layer in
 * client/src/components/dashboard/StationMap.tsx, so the report and the
 * dashboard show the same picture of a site.
 */
/**
 * Street map tiles from the same Esri host as the imagery.
 *
 * Deliberately the same provider rather than mixing in OpenStreetMap: one host
 * means one egress rule to whitelist, an identical tile scheme, and no usage
 * policy to honour for an automated report.
 */
const STREET_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile";

/** Marker colour, matching CHART_COLORS.temperature so the report stays on palette. */
const MAP_PIN_COLOUR = "#ef4444";

const SAT_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

/**
 * Fractional Web Mercator tile coordinates, NOT rounded to a tile index.
 *
 * The fractional part is what locates the station inside its tile, and that is
 * what the map pin needs. The previous code floored these to a tile index and
 * then drew its crosshair at the dead centre of the fetched block, which is only
 * the station's actual position when the station happens to sit exactly on a
 * tile boundary. Keeping the fraction is what lets the pin land on the mast.
 */
function tileCoordF(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

/** One fetched map tile and where it belongs in the grid. */
interface MapTile { col: number; row: number; buf: Buffer }

/**
 * Fetch a square grid of tiles around a coordinate.
 *
 * Tiles are placed side by side rather than composited, which avoids pulling in
 * an image library on a host that is already tight on memory. pdfkit scales each
 * tile as it is drawn.
 *
 * Returns null when too much of the grid is missing, because a grid with holes
 * in it looks broken. One missing tile is tolerated.
 */
async function fetchMapTiles(
  baseUrl: string,
  lat: number,
  lon: number,
  zoom: number,
  cols: number,
  rows: number,
): Promise<{ tiles: MapTile[]; x0: number; y0: number } | null> {
  // Round rather than floor so the station lands near the middle of the block:
  // flooring with an even tile count pushes it into the far half.
  const f = tileCoordF(lat, lon, zoom);
  const x0 = Math.round(f.x - cols / 2);
  const y0 = Math.round(f.y - rows / 2);

  const tiles: MapTile[] = [];
  try {
    const axios = (await import("axios")).default;
    const jobs: Array<Promise<void>> = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const url = `${baseUrl}/${zoom}/${y0 + r}/${x0 + c}`;
        jobs.push(
          axios
            .get(url, { responseType: "arraybuffer", timeout: 8000 })
            .then((res: any) => {
              tiles.push({ col: c, row: r, buf: Buffer.from(res.data) });
            })
            .catch(() => { /* one missing tile must not fail the report */ }),
        );
      }
    }
    await Promise.all(jobs);
  } catch {
    return null;
  }

  if (tiles.length < cols * rows - 1) return null;
  return { tiles, x0, y0 };
}

/**
 * Draw a map pin whose point sits exactly on (px, py).
 *
 * Filled shape with a white outline and a white centre, so it stays legible over
 * both dark satellite imagery and the pale street map without needing to know
 * which one is underneath.
 */
function drawMapPin(doc: any, px: number, py: number, colour: string): void {
  const r = 4.2;
  const cx = px;
  const cy = py - r * 2;

  doc.save();
  // Stem: a triangle from the head down to the point on the coordinate.
  doc.moveTo(cx - r * 0.62, cy + r * 0.6)
    .lineTo(cx + r * 0.62, cy + r * 0.6)
    .lineTo(cx, py)
    .closePath()
    .fillColor(colour).fill();
  doc.circle(cx, cy, r).fillColor(colour).fill();
  doc.circle(cx, cy, r).lineWidth(1).strokeColor("#ffffff").stroke();
  doc.circle(cx, cy, r * 0.36).fillColor("#ffffff").fill();
  doc.restore();
}

/**
 * Place an already-fetched tile grid into a box and pin the station on it.
 */
function drawTileBlock(
  doc: any,
  fetched: { tiles: MapTile[]; x0: number; y0: number },
  lat: number,
  lon: number,
  zoom: number,
  cols: number,
  rows: number,
  boxX: number,
  boxY: number,
  boxWidth: number,
): number {
  const tileW = boxWidth / cols;
  const tileH = tileW; // tiles are square
  const boxHeight = tileH * rows;

  for (const t of fetched.tiles) {
    doc.image(t.buf, boxX + t.col * tileW, boxY + t.row * tileH, {
      width: tileW,
      height: tileH,
    });
  }

  // Hairline border so the imagery reads as a figure rather than bleeding into
  // the page.
  doc.save();
  doc.rect(boxX, boxY, boxWidth, boxHeight)
    .strokeColor(RULE).lineWidth(0.5).stroke();
  doc.restore();

  // Pin at the true station position within the block, not at the block centre.
  const f = tileCoordF(lat, lon, zoom);
  const px = boxX + (f.x - fetched.x0) * tileW;
  const py = boxY + (f.y - fetched.y0) * tileH;
  drawMapPin(doc, px, py, MAP_PIN_COLOUR);

  return boxHeight;
}

/**
 * Draw the satellite and street views side by side, each half the text width.
 *
 * The two are fetched in parallel and drawn only after both have resolved, so a
 * partial failure cannot leave a half-drawn block of tiles on the page. If only
 * one of the two comes back it is drawn in its own slot at the same half width,
 * which keeps the page geometry stable, and the caption then names only the
 * source that actually rendered.
 *
 * Returns the height consumed, or 0 when nothing could be drawn. Every failure
 * path returns 0 quietly: a report missing its site imagery is still a usable
 * report, whereas one that throws is not. Network egress is not guaranteed from
 * the container, so this must never be load-bearing.
 */
async function drawSiteMaps(
  doc: any,
  lat: number,
  lon: number,
  boxWidth: number,
): Promise<number> {
  const GAP = 12;
  /**
   * The pair is deliberately narrower than the text column.
   *
   * At full width the two frames dominated page one and pushed the statistics
   * table down; at 78% they still read clearly while leaving the table on the
   * same page. The pair stays left-aligned with the text above it.
   */
  const PAIR_SCALE = 0.78;
  const pairWidth = boxWidth * PAIR_SCALE;
  const halfWidth = (pairWidth - GAP) / 2;
  // 2x2 keeps each view square. Satellite is drawn close in to show the mast
  // surroundings; the street map is pulled back to show which roads and
  // settlements the site sits among.
  //
  // One extra zoom level is one doubling of scale, so these are each twice the
  // magnification they were.
  const COLS = 2;
  const ROWS = 2;
  const SAT_ZOOM = 16;
  const STREET_ZOOM = 13;

  let sat: Awaited<ReturnType<typeof fetchMapTiles>> = null;
  let street: Awaited<ReturnType<typeof fetchMapTiles>> = null;
  try {
    [sat, street] = await Promise.all([
      fetchMapTiles(SAT_TILE_URL, lat, lon, SAT_ZOOM, COLS, ROWS),
      fetchMapTiles(STREET_TILE_URL, lat, lon, STREET_ZOOM, COLS, ROWS),
    ]);
  } catch {
    return 0;
  }

  if (!sat && !street) return 0;

  // Keep the pair with the details they illustrate rather than splitting them
  // across a page break.
  const projectedHeight = halfWidth + 22;
  if (doc.y + projectedHeight > bottomLimit(doc)) doc.addPage();

  const leftX = doc.page.margins.left;
  const rightX = leftX + halfWidth + GAP;
  const topY = doc.y;
  let height = 0;

  try {
    if (sat) {
      height = Math.max(
        height,
        drawTileBlock(doc, sat, lat, lon, SAT_ZOOM, COLS, ROWS, leftX, topY, halfWidth),
      );
    }
    if (street) {
      height = Math.max(
        height,
        drawTileBlock(doc, street, lat, lon, STREET_ZOOM, COLS, ROWS, rightX, topY, halfWidth),
      );
    }
  } catch {
    return 0;
  }

  /**
   * Label each view under its own frame so a reader can tell them apart.
   *
   * The zoom level is deliberately not printed. It is an implementation detail of
   * how the tiles were fetched, it means nothing to the person reading the
   * report, and it would go stale the moment the zoom is retuned.
   */
  doc.fillColor(INK).font(FONT_REGULAR).fontSize(TYPE.caption);
  const labelY = topY + height + 3;
  if (sat) {
    doc.text(pdfSafe("Satellite view"), leftX, labelY, { width: halfWidth });
  }
  if (street) {
    doc.text(pdfSafe("Street map"), rightX, labelY, { width: halfWidth });
  }

  doc.y = labelY + 11;
  const sources: string[] = [];
  if (sat) sources.push("Esri World Imagery");
  if (street) sources.push("Esri World Street Map");
  doc.text(
    pdfSafe(`Pin marks the station position. Imagery: ${sources.join(" and ")}.`),
    leftX,
    doc.y,
    { width: boxWidth },
  );
  doc.moveDown(0.6);

  return height;
}
