// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * The one list of field names a logger might use for rainfall.
 *
 * WHY THIS EXISTS
 *
 * There were six of these lists and they disagreed with each other:
 *
 *   server/parsers/campbellScientific.ts   knew Rain_2_Tot and Rain_Tot_Tot
 *   server/services/rainfallAggregation.ts did not
 *   server/services/reportSchedulerService.ts did not
 *   server/services/pdfReportService.ts    did not
 *   server/localStorage.ts (SQLite read)   knew three names in total
 *   server/localStorage.ts (Postgres read) knew eight
 *
 * A station logging into a name that the ingest path recognised but the
 * aggregation path did not would be stored correctly and then report zero
 * rainfall, with no error raised anywhere, because a missing key and a dry month
 * look identical to a COALESCE. The SAWS Testbed writes Rain_2_Tot and only
 * escapes this because it happens to also write Rain_1_Tot.
 *
 * Adding a name here now extends every path at once.
 *
 * MIRRORED IN shared/utils/rainfall.ts (RAINFALL_FIELD_ALIASES). The server build
 * sets rootDir=./server and excludes shared/, so this cannot be imported across
 * that boundary; the duplication is deliberate and follows the same convention as
 * chartColors and the ETo formula. Change both together.
 *
 * ORDER MATTERS. `rainfall` leads because it is the normalised value written at
 * ingest, which is what the per-record Postgres read path has always preferred.
 * Changing the order changes which value wins for a station that writes several
 * of these keys, and every station currently writes at least two.
 */
export const RAINFALL_FIELD_ALIASES = [
  "rainfall",
  "Rain_mm_Tot",
  "Rain_Tot",
  "Rain_1_Tot",
  "Rain_2_Tot",
  "Rain_Tot_1",
  "Rain_Tot_Tot",
  "Precip_Tot",
  "Rain_mm",
  "Precip",
  "Rain",
  "Rainfall",
] as const;

/**
 * Read rainfall out of a raw logger record, honouring alias order.
 * Returns null when no alias carries a finite number.
 */
export function pickRainfall(data: Record<string, any> | null | undefined): number | null {
  if (!data) return null;
  for (const key of RAINFALL_FIELD_ALIASES) {
    const v = data[key];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "string" ? parseFloat(v) : v;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * SQL expression yielding the rainfall value from a JSONB column, in the same
 * alias order as `pickRainfall`, so a query and a record read never disagree
 * about which field is authoritative.
 *
 * The alias names are compile-time constants from this module, so nothing
 * caller-supplied reaches the SQL string.
 */
export function rainfallSqlCoalesce(column = "data"): string {
  return `COALESCE(${RAINFALL_FIELD_ALIASES.map((f) => `${column}->>'${f}'`).join(", ")})`;
}
