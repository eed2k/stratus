/**
 * Generate a realistic TOA5 demo .dat file for Stratus import demo.
 * 31 days of 30-minute data with realistic SA weather patterns.
 */
const fs = require('fs');
const path = require('path');

// Helpers
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (v, d = 1) => v.toFixed(d);

// 31 days ending today
const startDate = new Date();
startDate.setDate(startDate.getDate() - 31);
startDate.setHours(0, 0, 0, 0);
const INTERVAL_MIN = 30;
const ROWS = (31 * 24 * 60) / INTERVAL_MIN; // 1488 rows

// TOA5 header
const header1 = '"TOA5","Demo_Station","CR1000X","12345","CR1000X.Std.06.02","CPU:Demo_AWS.CR1X","54321","OneMin"';
const columns = [
  'TIMESTAMP', 'RECORD',
  'AirTC_Avg', 'RH_Avg', 'BP_mbar_Avg',
  'WS_ms_Avg', 'WD_Deg_Avg', 'WS_ms_Max',
  'SlrW_Avg', 'Rain_mm_Tot',
  'DewPt_Avg',
  'SoilTC_Avg', 'VWC_Avg',
  'BattV_Avg', 'PTemp_C_Avg',
];
const units = [
  'TS', 'RN',
  'Deg C', '%', 'mbar',
  'm/s', 'degrees', 'm/s',
  'W/m^2', 'mm',
  'Deg C',
  'Deg C', 'm^3/m^3',
  'V', 'Deg C',
];
const procs = [
  '', '',
  'Avg', 'Avg', 'Avg',
  'Avg', 'Avg', 'Max',
  'Avg', 'Tot',
  'Avg',
  'Avg', 'Avg',
  'Avg', 'Avg',
];

const header2 = columns.map(c => `"${c}"`).join(',');
const header3 = units.map(u => `"${u}"`).join(',');
const header4 = procs.map(p => `"${p}"`).join(',');

const rows = [];
let prevTemp = 18;
let prevRH = 60;
let prevWS = 2;
let prevWD = 200;
let prevPressure = 1015;
let prevSoilTemp = 20;
let prevVWC = 0.22;

for (let i = 0; i < ROWS; i++) {
  const ts = new Date(startDate.getTime() + i * INTERVAL_MIN * 60000);
  const hour = ts.getHours() + ts.getMinutes() / 60;
  const dayFrac = (hour - 6) / 12; // 0 at 6am, 1 at 6pm
  const dayNum = Math.floor(i / 48); // 0, 1, 2

  // Diurnal patterns
  const solarAngle = Math.max(0, Math.sin(Math.PI * (hour - 5.5) / 13));
  const isDaytime = hour >= 6 && hour <= 19;

  // Repeating 7-day weather cycle for realistic variation over 31 days
  // 0-1: clear hot, 2: building cloud, 3: cold front + rain, 4: post-front clearing,
  // 5: cool/dry, 6: warming up
  const cycleDay = dayNum % 7;
  // Add slight seasonal drift: days 0-15 warmer (late summer), 16-31 cooler (autumn onset)
  const seasonOffset = dayNum > 15 ? -3 : 0;
  let baseTemp, baseRH, basePressure, rainChance, cloudFactor;
  if (cycleDay <= 1) {
    // Clear hot day
    baseTemp = (18 + seasonOffset) + 14 * solarAngle;
    baseRH = 30 + 25 * (1 - solarAngle);
    basePressure = 1018;
    rainChance = 0;
    cloudFactor = 0.05;
  } else if (cycleDay === 2) {
    // Building cloud, warm but humid
    baseTemp = (16 + seasonOffset) + 12 * solarAngle;
    baseRH = 50 + 20 * solarAngle;
    basePressure = 1014;
    rainChance = hour >= 15 ? 0.15 : 0;
    cloudFactor = 0.2 + 0.3 * (hour / 24);
  } else if (cycleDay === 3) {
    // Cold front: progressive cooling, rain in afternoon/evening
    baseTemp = (12 + seasonOffset) + 8 * solarAngle;
    baseRH = 70 + 20 * (hour > 12 ? 1 : 0.3);
    basePressure = 1006 - (hour > 10 ? 4 : 0);
    rainChance = hour >= 10 && hour <= 21 ? 0.45 : 0.05;
    cloudFactor = 0.6 + (hour > 10 ? 0.3 : 0);
  } else if (cycleDay === 4) {
    // Post-front clearing: cool, scattered showers morning
    baseTemp = (10 + seasonOffset) + 10 * solarAngle;
    baseRH = 60 + 15 * (1 - solarAngle);
    basePressure = 1010 + hour * 0.3;
    rainChance = hour < 9 ? 0.15 : 0;
    cloudFactor = Math.max(0.1, 0.5 - hour * 0.03);
  } else if (cycleDay === 5) {
    // Cool dry day
    baseTemp = (10 + seasonOffset) + 10 * solarAngle;
    baseRH = 40 + 20 * (1 - solarAngle);
    basePressure = 1016;
    rainChance = 0;
    cloudFactor = 0.1;
  } else {
    // Warming up
    baseTemp = (14 + seasonOffset) + 12 * solarAngle;
    baseRH = 35 + 20 * (1 - solarAngle);
    basePressure = 1017;
    rainChance = 0;
    cloudFactor = 0.08;
  }

  // Temperature with smooth transitions
  const tempTarget = baseTemp + rand(-1, 1);
  prevTemp = prevTemp * 0.7 + tempTarget * 0.3;
  const temp = clamp(prevTemp, 5, 40);

  // Humidity
  const rhTarget = baseRH + rand(-3, 3);
  prevRH = prevRH * 0.7 + rhTarget * 0.3;
  const rh = clamp(prevRH, 20, 98);

  // Pressure
  const pressTarget = basePressure + rand(-0.5, 0.5);
  prevPressure = prevPressure * 0.8 + pressTarget * 0.2;
  const pressure = clamp(prevPressure, 995, 1030);

  // Wind - stronger during day, shifts with front
  const baseWS = isDaytime ? 3 + 4 * solarAngle : 1.5;
  const frontWind = dayNum === 1 && hour > 10 ? 3 : 0;
  const wsTarget = baseWS + frontWind + rand(-1, 1);
  prevWS = prevWS * 0.6 + wsTarget * 0.4;
  const ws = clamp(prevWS, 0.2, 15);
  const gust = ws * (1.3 + rand(0, 0.7));

  // Wind direction: day 0 = SE (150), day 1 front = NW (320), day 2 = SW (220)
  let baseWD = dayNum === 0 ? 150 : dayNum === 1 ? (hour > 10 ? 320 : 200) : 220;
  const wdTarget = baseWD + rand(-20, 20);
  prevWD = prevWD * 0.7 + wdTarget * 0.3;
  const wd = ((prevWD % 360) + 360) % 360;

  // Solar radiation
  const clearSky = 1100 * solarAngle;
  const solar = clamp(clearSky * (1 - cloudFactor) + rand(-20, 20), 0, 1300);

  // Rainfall
  const rain = Math.random() < rainChance ? rand(0.2, 4.0) : 0;

  // Dew point (Magnus approximation)
  const a = 17.27, b = 237.7;
  const gamma = (a * temp) / (b + temp) + Math.log(rh / 100);
  const dewPoint = (b * gamma) / (a - gamma);

  // Soil temp (lags air by ~3h, dampened)
  const stTarget = temp * 0.5 + 12;
  prevSoilTemp = prevSoilTemp * 0.9 + stTarget * 0.1;

  // Soil moisture (rises with rain, slowly dries)
  if (rain > 0) prevVWC = clamp(prevVWC + rain * 0.01, 0.1, 0.45);
  else prevVWC = clamp(prevVWC - 0.001 * (isDaytime ? 1.5 : 0.5), 0.12, 0.45);

  // Battery voltage (higher during day from solar charging)
  const battV = isDaytime && solar > 50 ? 13.2 + rand(-0.1, 0.2) : 12.4 + rand(-0.2, 0.1);

  // Panel temperature (tracks solar + air temp)
  const pTemp = temp + solar * 0.015 + rand(-1, 1);

  // Format timestamp as YYYY-MM-DD HH:MM:SS
  const pad = n => String(n).padStart(2, '0');
  const tsStr = `${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:00`;

  rows.push([
    `"${tsStr}"`, i + 1,
    fmt(temp), fmt(rh), fmt(pressure, 1),
    fmt(ws, 2), fmt(wd, 0), fmt(gust, 2),
    fmt(solar, 0), fmt(rain, 1),
    fmt(dewPoint, 1),
    fmt(prevSoilTemp, 1), fmt(prevVWC, 3),
    fmt(battV, 2), fmt(pTemp, 1),
  ].join(','));
}

const output = [header1, header2, header3, header4, ...rows].join('\n') + '\n';
const outPath = path.join(__dirname, 'Demo_Station_OneMin.dat');
fs.writeFileSync(outPath, output);
console.log(`Generated ${ROWS} records -> ${outPath}`);
