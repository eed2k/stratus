/**
 * Validate the generated demo .dat files against the real Stratus parser.
 *
 * Imports ONLY the parser module. It never touches server/index.ts, the report
 * scheduler or the email service, so running this cannot register a cron task
 * or send anything.
 *
 *   npx tsx demo_data/verify_demo.ts
 */
import { readFileSync } from "node:fs";
import { parseDataFile, mapToWeatherData } from "../server/parsers/campbellScientific";

const FILES = [
  "demo_data/potchefstroom_full_demo.dat",
  "demo_data/as3935_lightning_demo.dat",
];

/** Fields the dashboard cares about, so we can prove each one arrives mapped. */
const EXPECTED_FULL = [
  "temperature", "humidity", "dewPoint", "pressure",
  "windSpeed", "windGust", "windSpeedMin", "windDirection", "windDirStdDev",
  "solarRadiation", "solarMJTotal", "uvIndex", "rainfall",
  "soilTemperature", "soilMoisture",
  "visibility", "pm25", "pm10",
  "lightning", "lightningDistance", "lightningEnergy",
  "batteryVoltage", "panelTemperature",
  "mpptSolarVoltage", "mpptSolarCurrent", "mpptSolarPower",
  "mpptBatteryVoltage", "mpptLoadVoltage", "mpptLoadCurrent", "mpptBoardTemp",
];

let failures = 0;

for (const file of FILES) {
  console.log("=".repeat(70));
  console.log(file);
  console.log("=".repeat(70));

  const parsed = parseDataFile(readFileSync(file, "utf-8"));

  console.log(`format          ${parsed.format}`);
  console.log(`station         ${parsed.stationName}`);
  console.log(`table           ${parsed.tableName}`);
  console.log(`headers         ${parsed.headers.length}`);
  console.log(`records         ${parsed.records.length}`);
  console.log(`parse errors    ${parsed.errors.length}`);

  if (parsed.format !== "TOA5") { console.error("FAIL: not detected as TOA5"); failures++; }
  if (parsed.errors.length) { console.error("FAIL: parse errors", parsed.errors.slice(0, 3)); failures++; }
  if (parsed.records.length === 0) { console.error("FAIL: no records"); failures++; continue; }

  // ── timestamp span and interval ──
  const first = parsed.records[0].timestamp;
  const last = parsed.records[parsed.records.length - 1].timestamp;
  const spanDays = (last.getTime() - first.getTime()) / 86_400_000;
  console.log(`first          ${first.toISOString()}`);
  console.log(`last           ${last.toISOString()}`);
  console.log(`span           ${spanDays.toFixed(2)} days`);
  if (spanDays < 7) { console.error(`FAIL: span ${spanDays.toFixed(2)} days is under the 7-day minimum`); failures++; }
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) {
    console.error("FAIL: unparseable timestamps"); failures++;
  }

  // ── field mapping coverage ──
  const seen = new Set<string>();
  let mappedRows = 0;
  for (const rec of parsed.records) {
    const mapped = mapToWeatherData(rec, parsed.units, parsed.headers);
    const keys = Object.keys(mapped).filter((k) => mapped[k] != null);
    if (keys.length) mappedRows++;
    for (const k of keys) seen.add(k);
  }
  console.log(`rows w/ data   ${mappedRows}`);
  console.log(`mapped fields  ${[...seen].sort().join(", ")}`);

  if (file.includes("full")) {
    const missing = EXPECTED_FULL.filter((f) => !seen.has(f));
    if (missing.length) { console.error("FAIL: unmapped fields:", missing.join(", ")); failures++; }
    else console.log("OK: every expected dashboard field mapped");
  } else {
    for (const f of ["lightning", "lightningDistance", "lightningEnergy"]) {
      if (!seen.has(f)) { console.error(`FAIL: ${f} not mapped`); failures++; }
    }
    if (seen.size > 3) console.error("FAIL: lightning-only file mapped extra fields:", [...seen].join(", ")), failures++;
    else console.log("OK: lightning channels only");
  }

  // ── convention checks ──
  const lightningVals: number[] = [];
  const rainVals: number[] = [];
  const distVals: number[] = [];
  const energyVals: number[] = [];
  for (const rec of parsed.records) {
    const m = mapToWeatherData(rec, parsed.units, parsed.headers);
    if (m.lightning != null) lightningVals.push(m.lightning);
    if (m.rainfall != null) rainVals.push(m.rainfall);
    if (m.lightningDistance != null) distVals.push(m.lightningDistance);
    if (m.lightningEnergy != null) energyVals.push(m.lightningEnergy);
  }

  // Lightning counter must be monotonically non-decreasing (cumulative).
  let monotonic = true;
  for (let i = 1; i < lightningVals.length; i++) {
    if (lightningVals[i] < lightningVals[i - 1]) { monotonic = false; break; }
  }
  const deltaSum = lightningVals.reduce(
    (acc, v, i) => (i > 0 && v > lightningVals[i - 1] ? acc + (v - lightningVals[i - 1]) : acc), 0);
  console.log(`lightning      cumulative=${monotonic} max=${Math.max(...lightningVals)} deltaSum=${deltaSum}`);
  if (!monotonic) { console.error("FAIL: lightning counter is not cumulative"); failures++; }
  if (deltaSum <= 0) { console.error("FAIL: no strikes recorded"); failures++; }

  // AS3935 distances must be one of the 14 discrete steps.
  const STEPS = [1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40];
  const bad = [...new Set(distVals)].filter((d) => !STEPS.includes(d));
  console.log(`distances      ${[...new Set(distVals)].sort((a, b) => a - b).join(", ")} km`);
  if (bad.length) { console.error("FAIL: non-AS3935 distances:", bad.join(", ")); failures++; }
  else console.log("OK: all distances are AS3935 discrete steps");

  // Energy must sit inside the 21-bit range.
  const ENERGY_MAX = 2_097_151;
  const overflow = energyVals.filter((e) => e < 0 || e > ENERGY_MAX);
  console.log(`energy         min=${Math.min(...energyVals).toLocaleString()} max=${Math.max(...energyVals).toLocaleString()} (21-bit cap ${ENERGY_MAX.toLocaleString()})`);
  if (overflow.length) { console.error(`FAIL: ${overflow.length} energy values outside 21-bit range`); failures++; }
  else console.log("OK: energy within 21-bit range");

  if (rainVals.length) {
    const rainMax = Math.max(...rainVals);
    const rainSum = rainVals.reduce((a, b) => a + b, 0);
    console.log(`rainfall       max increment=${rainMax.toFixed(2)} mm  total=${rainSum.toFixed(1)} mm`);
    // The back end sums increments only when the max is <= 50.
    if (rainMax > 50) { console.error("FAIL: rain max > 50, back end would switch to cumulative deltas"); failures++; }
    else console.log("OK: per-interval rainfall (back end will sum increments)");
  }

  // Physical sanity on the full file.
  if (file.includes("full")) {
    const temps: number[] = [], rh: number[] = [], press: number[] = [], solar: number[] = [];
    for (const rec of parsed.records) {
      const m = mapToWeatherData(rec, parsed.units, parsed.headers);
      if (m.temperature != null) temps.push(m.temperature);
      if (m.humidity != null) rh.push(m.humidity);
      if (m.pressure != null) press.push(m.pressure);
      if (m.solarRadiation != null) solar.push(m.solarRadiation);
    }
    console.log(`temperature    ${Math.min(...temps).toFixed(1)} .. ${Math.max(...temps).toFixed(1)} degC`);
    console.log(`humidity       ${Math.min(...rh).toFixed(0)} .. ${Math.max(...rh).toFixed(0)} %`);
    console.log(`pressure       ${Math.min(...press).toFixed(1)} .. ${Math.max(...press).toFixed(1)} mbar`);
    console.log(`solar          ${Math.min(...solar).toFixed(0)} .. ${Math.max(...solar).toFixed(0)} W/m2`);

    if (Math.min(...rh) < 0 || Math.max(...rh) > 100) { console.error("FAIL: humidity out of 0-100"); failures++; }
    if (Math.min(...solar) < 0) { console.error("FAIL: negative irradiance"); failures++; }
    // 1350 m station pressure should sit near 861 hPa, nowhere near sea level.
    const pAvg = press.reduce((a, b) => a + b, 0) / press.length;
    if (pAvg < 830 || pAvg > 890) { console.error(`FAIL: mean pressure ${pAvg.toFixed(1)} is wrong for 1350 m`); failures++; }
    else console.log(`OK: mean pressure ${pAvg.toFixed(1)} mbar matches 1350 m altitude`);
  }
  console.log();
}

console.log("=".repeat(70));
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
