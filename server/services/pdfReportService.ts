// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Server-side PDF report builder.
 *
 * Used by two callers:
 *   1. GET /api/reports/pdf?stationId=&from=&to=&fields=&format=...
 *      — admin-only on-demand download (also reused by the new
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
 *   - Charts are simple SVG line plots — good enough for an attached
 *     PDF; the dashboard remains the rich interactive view.
 */

import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import * as pg from "../db-postgres";
import { gatherStationData, REPORT_FIELDS, type FieldStat } from "./reportSchedulerService";
import { applyRainfallOffset } from "../config/stationRainfallOffsets";

const REPORTS_TZ = process.env.REPORTS_TZ || "Africa/Johannesburg";

// ─────────────────────────────────────────────────────────────────────
// Wind direction / speed class constants — keep these in lock-step with
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
// Field aliases — match the catalogues used by reportSchedulerService
// so the PDF can pull a couple of raw series (temperature, rainfall,
// wind) for the line charts.
// ─────────────────────────────────────────────────────────────────────

const ALIASES = {
  temp:  ["temperature", "AirTC_Avg", "AirTemp", "Temp_Avg", "AirTemp_Avg", "AirTC", "Temp_C", "Temperature"],
  rain:  ["Rain_mm_Tot", "Rain_Tot", "Precip_Tot", "Rain_1_Tot", "Rain_Tot_1", "rainfall", "Rain_mm", "Precip", "Rain", "Rainfall"],
  wind:  ["windSpeed", "WS_ms_Avg", "WindSpeed", "Wind_Spd_S_WVT", "WindSpeed_Avg", "WS_ms", "WS_Avg", "WS_ms_S_WVT"],
  windDir: ["windDirection", "WindDir", "WindDir_D1_WVT", "WindDir_Avg", "WindDirection"],
  humidity: ["humidity", "RH_Avg", "RH", "RelHumidity_Avg", "RelHumidity", "Humidity"],
} as const;

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
  windDir: number | null;
  humidity: number | null;
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
    return {
      ts: new Date(row.timestamp),
      temp: pickAlias(data, ALIASES.temp),
      rain: pickAlias(data, ALIASES.rain),
      wind: pickAlias(data, ALIASES.wind),
      windDir: pickAlias(data, ALIASES.windDir),
      humidity: pickAlias(data, ALIASES.humidity),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// SVG builders
// ─────────────────────────────────────────────────────────────────────

function buildWindRoseSVG(records: RawRecord[], label: string): string {
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

  const sz = 320;
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

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${totalH}">`;
  s += `<rect width="${sz}" height="${totalH}" fill="white"/>`;
  s += `<text x="${ctr}" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="#333" font-family="Helvetica">${escapeXml(label)}</text>`;
  s += `<g transform="translate(0,${titleH})">`;

  // Guide circles
  [0.25, 0.5, 0.75, 1].forEach((ratio) => {
    s += `<circle cx="${ctr}" cy="${ctr}" r="${mxR * ratio}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
    s += `<text x="${ctr + 5}" y="${ctr - mxR * ratio + 12}" font-size="10" fill="#999" font-family="Helvetica">${Math.round(ratio * 100)}%</text>`;
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
  s += `<text x="${ctr - 60}" y="${statsY}" text-anchor="middle" font-size="10" fill="#666" font-family="Helvetica">Dominant: ${dominantDir} (${dominantPct}%)</text>`;
  s += `<text x="${ctr + 60}" y="${statsY}" text-anchor="middle" font-size="10" fill="#666" font-family="Helvetica">Calm: ${calmPct}%</text>`;

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
    s += `<text x="${lx + 14}" y="${ly + 4}" font-size="8" fill="#666" font-family="Helvetica">${shortLabel} ${range}</text>`;
  });

  s += "</svg>";
  return s;
}

interface ChartSeries { ts: Date; value: number }

function buildLineChartSVG(opts: {
  series: ChartSeries[];
  label: string;
  unit: string;
  color: string;
  width: number;
  height: number;
}): string {
  const { series, label, unit, color, width, height } = opts;
  const padL = 50, padR = 12, padT = 30, padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  s += `<rect width="${width}" height="${height}" fill="white"/>`;
  s += `<text x="${width / 2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="#333" font-family="Helvetica">${escapeXml(label)}</text>`;

  if (series.length === 0) {
    s += `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="11" fill="#999" font-family="Helvetica">No data</text>`;
    s += `</svg>`;
    return s;
  }

  const vals = series.map((p) => p.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const rng = maxV - minV || 1;
  const minTs = series[0].ts.getTime();
  const maxTs = series[series.length - 1].ts.getTime();
  const tsRng = Math.max(1, maxTs - minTs);

  // Y-axis grid (5 lines)
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i) / 4;
    const v = maxV - (rng * i) / 4;
    s += `<line x1="${padL}" y1="${y}" x2="${padL + innerW}" y2="${y}" stroke="#eee" stroke-width="1"/>`;
    s += `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="#666" font-family="Helvetica">${v.toFixed(1)}</text>`;
  }

  // X-axis tick labels (start, mid, end)
  const fmtTs = (ms: number) =>
    new Date(ms).toLocaleString("en-ZA", { timeZone: REPORTS_TZ, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  [0, 0.5, 1].forEach((r) => {
    const x = padL + innerW * r;
    const ts = minTs + tsRng * r;
    s += `<text x="${x}" y="${height - padB / 2 + 4}" text-anchor="middle" font-size="9" fill="#666" font-family="Helvetica">${escapeXml(fmtTs(ts))}</text>`;
  });

  // Polyline
  const pts = series.map((p) => {
    const x = padL + ((p.ts.getTime() - minTs) / tsRng) * innerW;
    const y = padT + (1 - (p.value - minV) / rng) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.3"/>`;

  // Unit label
  if (unit) {
    s += `<text x="${padL}" y="${padT - 4}" font-size="9" fill="#666" font-family="Helvetica">${escapeXml(unit)}</text>`;
  }

  s += `</svg>`;
  return s;
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─────────────────────────────────────────────────────────────────────
// Narrative
// ─────────────────────────────────────────────────────────────────────

function buildNarrative(stationName: string, stats: Record<string, FieldStat>, periodLabel: string): string[] {
  const paragraphs: string[] = [];

  const t = stats["temp_avg"]?.value;
  const tMin = stats["temp_min"]?.value;
  const tMax = stats["temp_max"]?.value;
  if (t != null || tMin != null || tMax != null) {
    const parts: string[] = [];
    if (t != null) parts.push(`averaged ${t.toFixed(1)} degC`);
    if (tMin != null) parts.push(`with a low of ${tMin.toFixed(1)} degC`);
    if (tMax != null) parts.push(`and a high of ${tMax.toFixed(1)} degC`);
    paragraphs.push(`Over the ${periodLabel.toLowerCase()}, temperatures at ${stationName} ${parts.join(", ")}.`);
  }

  const rh = stats["humidity_avg"]?.value;
  const pr = stats["pressure_avg"]?.value;
  if (rh != null || pr != null) {
    const parts: string[] = [];
    if (rh != null) parts.push(`relative humidity averaged ${rh.toFixed(0)}%`);
    if (pr != null) parts.push(`barometric pressure averaged ${pr.toFixed(1)} mbar`);
    paragraphs.push(`${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);
  }

  const ws = stats["wind_avg"]?.value;
  const wsMax = stats["wind_max"]?.value;
  const gust = stats["wind_gust_max"]?.value;
  if (ws != null || wsMax != null || gust != null) {
    const parts: string[] = [];
    if (ws != null) parts.push(`wind speeds averaged ${ws.toFixed(1)} m/s`);
    if (wsMax != null) parts.push(`peaking at ${wsMax.toFixed(1)} m/s`);
    if (gust != null) parts.push(`with a maximum gust of ${gust.toFixed(1)} m/s`);
    paragraphs.push(`${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);
  }

  const rain = stats["rainfall_total"]?.value;
  if (rain != null) {
    if (rain <= 0.05) {
      paragraphs.push(`No measurable rainfall was recorded during the ${periodLabel.toLowerCase()}.`);
    } else {
      paragraphs.push(`Rainfall totalled ${rain.toFixed(1)} mm over the ${periodLabel.toLowerCase()}.`);
    }
  }

  const solar = stats["solar_total"]?.value;
  const eto = stats["eto_total"]?.value;
  if (solar != null || eto != null) {
    const parts: string[] = [];
    if (solar != null) parts.push(`total solar energy was ${solar.toFixed(1)} MJ/m2`);
    if (eto != null) parts.push(`reference evapotranspiration (ETo) totalled approximately ${eto.toFixed(1)} mm`);
    paragraphs.push(`${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);
  }

  const strikes = stats["lightning_strikes"]?.value;
  if (strikes != null && strikes > 0) {
    const closest = stats["lightning_dist_min"]?.value;
    let line = `${Math.round(strikes)} lightning strike(s) were detected`;
    if (closest != null) line += ` with the closest at ${closest.toFixed(1)} km`;
    paragraphs.push(line + ".");
  }

  if (paragraphs.length === 0) {
    paragraphs.push(`No sensor data was recorded for ${stationName} during the ${periodLabel.toLowerCase()}.`);
  }

  return paragraphs;
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
 * Build the PDF and return it as a Buffer. Never throws — on failure
 * returns a 1-page PDF that explains the error so scheduled emails
 * still go out with *some* attachment.
 */
export async function buildSchedulePdfBuffer(input: BuildPdfInput): Promise<Buffer> {
  try {
    return await renderPdf(input);
  } catch (err: any) {
    console.error("[pdfReport] render failed:", err);
    return await renderErrorPdf(input, err?.message || String(err));
  }
}

function renderPdf(input: BuildPdfInput): Promise<Buffer> {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: 50, right: 50 } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const fieldSet = input.fields && input.fields.length > 0
        ? new Set(input.fields)
        : new Set(REPORT_FIELDS.map((f) => f.key));

      const title = input.title || "Stratus Weather Report";
      const periodLabel = input.periodLabel || formatPeriod(input.startMs, input.endMs);
      const fromLabel = new Date(input.startMs).toLocaleString("en-ZA", { timeZone: REPORTS_TZ });
      const toLabel = new Date(input.endMs).toLocaleString("en-ZA", { timeZone: REPORTS_TZ });

      // ── Cover page ──
      doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(26).text("Stratus Weather", { align: "center" });
      doc.moveDown(0.3);
      doc.fillColor("#334155").font("Helvetica-Bold").fontSize(18).text(title, { align: "center" });
      doc.moveDown(2);

      doc.fillColor("#0f172a").font("Helvetica").fontSize(11);
      doc.text(`Period:  ${periodLabel}`, { align: "center" });
      doc.text(`From:    ${fromLabel} SAST`, { align: "center" });
      doc.text(`To:      ${toLabel} SAST`, { align: "center" });
      doc.moveDown(2);

      doc.fillColor("#64748b").fontSize(10).text(
        `Generated ${new Date().toLocaleString("en-ZA", { timeZone: REPORTS_TZ })} SAST`,
        { align: "center" },
      );

      // Per-station sections
      for (let i = 0; i < input.stationIds.length; i++) {
        const stationId = input.stationIds[i];
        doc.addPage();
        await renderStationSection(doc, stationId, input.startMs, input.endMs, fieldSet, periodLabel);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function renderStationSection(
  doc: any,
  stationId: number,
  startMs: number,
  endMs: number,
  fieldSet: Set<string>,
  periodLabel: string,
): Promise<void> {
  // Gather stats + raw series in parallel
  const [stationInfo, raw] = await Promise.all([
    gatherStationData(stationId, startMs, endMs, fieldSet),
    fetchRawSeries(stationId, startMs, endMs),
  ]);
  const stationName = stationInfo.name;
  const stats = stationInfo.stats;

  doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(20).text(stationName);
  doc.fillColor("#64748b").font("Helvetica").fontSize(10).text(`Station #${stationId} | ${periodLabel}`);
  doc.moveDown(1);

  // ── Narrative paragraphs ──
  const narrative = buildNarrative(stationName, stats, periodLabel);
  doc.fillColor("#0f172a").font("Helvetica").fontSize(11);
  for (const p of narrative) {
    doc.text(p, { align: "justify" });
    doc.moveDown(0.5);
  }
  doc.moveDown(0.5);

  // ── Summary table ──
  doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(13).text("Summary");
  doc.moveDown(0.3);
  renderSummaryTable(doc, stats, fieldSet);
  doc.moveDown(1);

  // ── Wind rose ──
  doc.addPage();
  doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(16).text(`${stationName} - Wind Rose`);
  doc.moveDown(0.5);
  const roseSvg = buildWindRoseSVG(raw, `${periodLabel} Wind Rose`);
  embedSvg(doc, roseSvg, { x: doc.page.margins.left, y: doc.y, width: 320 });

  // ── Line charts ──
  doc.addPage();
  doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(16).text(`${stationName} - Charts`);
  doc.moveDown(0.5);
  const chartW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const chartH = 160;

  const tempSeries = raw.filter((r) => r.temp != null).map((r) => ({ ts: r.ts, value: r.temp as number }));
  const rainSeries = buildRainSeries(stationId, raw);
  const windSeries = raw.filter((r) => r.wind != null).map((r) => ({ ts: r.ts, value: r.wind as number }));

  embedSvg(doc, buildLineChartSVG({
    series: tempSeries, label: "Temperature", unit: "degC", color: "#ef4444",
    width: chartW, height: chartH,
  }), { x: doc.page.margins.left, y: doc.y, width: chartW });
  doc.moveDown(0.4);

  embedSvg(doc, buildLineChartSVG({
    series: rainSeries, label: "Rainfall (cumulative)", unit: "mm", color: "#3b82f6",
    width: chartW, height: chartH,
  }), { x: doc.page.margins.left, y: doc.y, width: chartW });
  doc.moveDown(0.4);

  embedSvg(doc, buildLineChartSVG({
    series: windSeries, label: "Wind speed", unit: "m/s", color: "#10b981",
    width: chartW, height: chartH,
  }), { x: doc.page.margins.left, y: doc.y, width: chartW });
}

function buildRainSeries(stationId: number, raw: RawRecord[]): ChartSeries[] {
  // Show cumulative rainfall (delta-sum) over the period so the chart
  // is meaningful regardless of whether the source is incremental or
  // cumulative. Apply per-station offset/scale via applyRainfallOffset.
  const series: ChartSeries[] = [];
  let cum = 0;
  let prev: number | null = null;
  for (const r of raw) {
    if (r.rain == null) continue;
    const v = r.rain;
    if (prev != null) {
      const delta = v - prev;
      // Sanity-clamp deltas so a counter reset / glitch can't blow up the chart
      if (delta > 0 && delta < 100) cum += delta;
      else if (delta <= 0 && v < 100) {
        // Likely incremental — add the value itself
        if (v > 0 && v < 100) cum += v;
      }
    } else if (v > 0 && v < 100) {
      cum += v;
    }
    prev = v;
    const adjusted = applyRainfallOffset(stationId, cum);
    series.push({ ts: r.ts, value: adjusted ?? cum });
  }
  return series;
}

function renderSummaryTable(doc: any, stats: Record<string, FieldStat>, fieldSet: Set<string>): void {
  const rows: Array<{ label: string; value: string; unit: string; n: number }> = [];
  for (const f of REPORT_FIELDS) {
    if (!fieldSet.has(f.key)) continue;
    const stat = stats[f.key];
    rows.push({
      label: f.label,
      value: stat ? fmtVal(stat.value, decimalsFor(f.key, f.unit)) : "n/a",
      unit: f.unit,
      n: stat?.readings ?? 0,
    });
  }
  if (rows.length === 0) {
    doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(10).text("No fields selected.");
    return;
  }

  const startX = doc.page.margins.left;
  const usableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const col1 = Math.floor(usableW * 0.55);
  const col2 = Math.floor(usableW * 0.20);
  const col3 = Math.floor(usableW * 0.12);
  const col4 = usableW - col1 - col2 - col3;

  // Header
  doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(10);
  doc.text("Metric", startX, doc.y, { width: col1, continued: true });
  doc.text("Value", { width: col2, continued: true });
  doc.text("Unit", { width: col3, continued: true });
  doc.text("Readings", { width: col4 });
  doc.moveTo(startX, doc.y).lineTo(startX + usableW, doc.y).strokeColor("#cbd5e1").stroke();
  doc.moveDown(0.2);

  // Body
  doc.font("Helvetica").fontSize(10);
  for (const r of rows) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
    doc.fillColor("#0f172a");
    doc.text(r.label, startX, doc.y, { width: col1, continued: true });
    doc.fillColor(r.value === "n/a" ? "#94a3b8" : "#0f172a");
    doc.text(r.value, { width: col2, continued: true });
    doc.fillColor("#64748b");
    doc.text(r.unit, { width: col3, continued: true });
    doc.text(String(r.n), { width: col4 });
  }
}

function embedSvg(doc: any, svg: string, opts: { x: number; y: number; width: number }): void {
  try {
    // svg-to-pdfkit exports a default function. Handle both shapes.
    const fn = (SVGtoPDF as any).default || (SVGtoPDF as any);
    fn(doc, svg, opts.x, opts.y, { width: opts.width, assumePt: true });
    // Advance the cursor below the embedded image. We can't read the
    // SVG height reliably here, so advance by a conservative amount based
    // on the requested width (square aspect for wind roses, ~ 0.4 for charts).
    const widthRatio = svg.includes("Wind Rose") ? 1.3 : 0.4;
    doc.y = opts.y + opts.width * widthRatio;
  } catch (e) {
    console.warn("[pdfReport] embedSvg failed:", (e as Error).message);
    doc.fillColor("#dc2626").fontSize(9).text("(chart render failed)", opts.x, opts.y);
    doc.moveDown(1);
  }
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
      doc.fillColor("#1e3a5f").font("Helvetica-Bold").fontSize(18).text("Stratus Weather Report");
      doc.moveDown(1);
      doc.fillColor("#dc2626").fontSize(12).text("Failed to render PDF report.");
      doc.moveDown(0.5);
      doc.fillColor("#0f172a").font("Helvetica").fontSize(10).text(`Error: ${message}`);
      doc.moveDown(1);
      doc.fillColor("#64748b").fontSize(9).text(`Stations: ${input.stationIds.join(", ")}`);
      doc.text(`Period: ${formatPeriod(input.startMs, input.endMs)}`);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
