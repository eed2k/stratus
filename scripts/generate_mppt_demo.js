/**
 * Generate realistic MPPT demo data for Station 12 (MPPT TEST SOLAR)
 * 
 * Setup: 5A Solar Charge Controller, 30W 18V (22V Voc) Solar Panel, 12V 18Ah Battery
 * Location: Potchefstroom (-26.7150, 27.1031) — Southern Hemisphere
 * 
 * Realistic daily pattern:
 * - Night (18:00-05:30): Panel 0V/0A, battery slowly discharging from load
 * - Dawn (05:30-07:00): Gradual ramp, charger wakes, state 3 (Bulk)
 * - Morning (07:00-10:00): Increasing power, Bulk charging
 * - Midday (10:00-14:00): Peak power ~25-30W, transitions to Absorption (state 4)
 * - Afternoon (14:00-16:30): Absorption/Float (state 5), declining power
 * - Evening (16:30-18:00): Low power, charger goes to Float then Off
 * 
 * Charger states: 0=Off, 3=Bulk, 4=Absorption, 5=Float
 * Battery: 11.8V (deeply discharged) to 14.4V (absorption), float at 13.8V
 * Panel Voc: ~22V, Vmpp: ~18V, Impp: ~1.67A at full sun
 */

// Generate 577 data points, 5-min intervals, ending now
const COUNT = 577;
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const endTime = new Date('2026-02-18T12:14:04.278Z');
const startTime = new Date(endTime.getTime() - (COUNT - 1) * INTERVAL_MS);

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// Solar irradiance model for Potchefstroom in February (summer)
// Sunrise ~05:40, Sunset ~18:40 SAST (UTC+2)
function getSolarFraction(date) {
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60; // UTC
  const localHour = hours + 2; // SAST = UTC+2
  
  // Sunrise ~5:40, sunset ~18:40
  const sunrise = 5.67;
  const sunset = 18.67;
  const solarNoon = (sunrise + sunset) / 2; // ~12.17
  
  if (localHour < sunrise || localHour > sunset) return 0;
  
  // Sinusoidal model
  const dayLength = sunset - sunrise;
  const progress = (localHour - sunrise) / dayLength;
  return Math.sin(progress * Math.PI);
}

// Simulate cloud cover with some randomness per day
function getCloudFactor(date) {
  // Use day number as seed for cloud pattern
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const hourFrac = (date.getUTCHours() + 2 + date.getUTCMinutes() / 60) % 24;
  
  // Afternoon clouds more likely (convective)
  const afternoonCloud = hourFrac > 13 && hourFrac < 17 ? 0.15 : 0;
  
  // Base clear sky factor
  const baseClear = 0.85 + Math.sin(dayOfYear * 0.7) * 0.1;
  
  // Random variation
  const variation = (Math.sin(date.getTime() / 1800000 * 2.3 + dayOfYear * 17) * 0.5 + 0.5) * 0.15;
  
  return clamp(baseClear - afternoonCloud - variation, 0.4, 1.0);
}

let batteryVoltage = 12.8; // Starting battery voltage
let batteryCharge = 0.6; // 60% SOC (state of charge) — 0 to 1
const BATTERY_CAPACITY_AH = 18;
const LOAD_CURRENT_BASE = 0.065; // ~65mA typical CR1000XE logger + sensors (60mA quiescent + sensors)

const rows = [];

for (let i = 0; i < COUNT; i++) {
  const ts = new Date(startTime.getTime() + i * INTERVAL_MS);
  const solarFrac = getSolarFraction(ts);
  const cloudFactor = getCloudFactor(ts);
  const effectiveSolar = solarFrac * cloudFactor;
  
  // Ambient temperature model (for board temp)
  const localHour = (ts.getUTCHours() + 2 + ts.getUTCMinutes() / 60) % 24;
  const ambientTemp = 22 + 8 * Math.sin((localHour - 6) / 24 * 2 * Math.PI) + rand(-1, 1);
  
  let solarVoltage, solarCurrent, solarPower, loadVoltage, loadCurrent;
  let chargerState, boardTemp;
  
  if (effectiveSolar < 0.02) {
    // Night — no solar
    solarVoltage = 0;
    solarCurrent = 0;
    solarPower = 0;
    chargerState = 0; // Off
    
    // Battery discharging from load
    loadCurrent = LOAD_CURRENT_BASE + rand(-0.01, 0.01);
    batteryCharge -= (loadCurrent * 5 / 60) / BATTERY_CAPACITY_AH;
    batteryCharge = clamp(batteryCharge, 0.15, 1.0);
    
    // Battery voltage based on SOC (12V lead-acid curve)
    batteryVoltage = 11.5 + batteryCharge * 2.0 + rand(-0.02, 0.02);
    batteryVoltage = clamp(batteryVoltage, 11.5, 13.0);
    
    loadVoltage = batteryVoltage;
    boardTemp = ambientTemp + rand(-0.5, 0.5);
  } else {
    // Daytime — solar producing
    
    // Panel voltage (open circuit ~22V, at load point 15-19V depending on conditions)
    const panelVocBase = 22.0;
    // Panel voltage drops under load, and varies with temperature
    const tempCoeff = -0.003; // -0.3%/°C panel voltage temp coefficient
    const tempDelta = ambientTemp - 25;
    const vocAdj = panelVocBase * (1 + tempCoeff * tempDelta);
    
    // At MPP, voltage is roughly 18V
    solarVoltage = clamp(
      vocAdj * (0.75 + effectiveSolar * 0.07) + rand(-0.3, 0.3),
      0, 22.5
    );
    
    // Panel current — 30W panel at 18V gives ~1.67A max
    // Current scales with irradiance
    const maxCurrent = 1.67; // Impp
    solarCurrent = clamp(
      maxCurrent * effectiveSolar + rand(-0.03, 0.03),
      0, 5.0 // 5A controller limit
    );
    
    solarPower = solarVoltage * solarCurrent;
    // Cap at panel rating
    solarPower = clamp(solarPower + rand(-0.2, 0.2), 0, 32);
    
    // Load current
    loadCurrent = LOAD_CURRENT_BASE + rand(-0.01, 0.01);
    
    // Net charging current
    const chargeCurrent = solarCurrent - loadCurrent * (batteryVoltage / solarVoltage || 0);
    
    // Update battery
    if (chargeCurrent > 0) {
      batteryCharge += (chargeCurrent * 5 / 60) / BATTERY_CAPACITY_AH;
    } else {
      batteryCharge += (chargeCurrent * 5 / 60) / BATTERY_CAPACITY_AH;
    }
    batteryCharge = clamp(batteryCharge, 0.15, 1.0);
    
    // Determine charger state based on battery SOC and solar availability
    if (batteryCharge < 0.85) {
      chargerState = 3; // Bulk
      // During bulk, battery voltage rises gradually
      batteryVoltage = 12.0 + batteryCharge * 2.8 + rand(-0.05, 0.05);
      batteryVoltage = clamp(batteryVoltage, 12.0, 14.4);
    } else if (batteryCharge < 0.95) {
      chargerState = 4; // Absorption
      // During absorption, voltage held at ~14.4V
      batteryVoltage = 14.2 + rand(-0.1, 0.2);
      batteryVoltage = clamp(batteryVoltage, 14.1, 14.5);
    } else {
      chargerState = 5; // Float
      // During float, voltage ~13.8V
      batteryVoltage = 13.7 + rand(-0.1, 0.2);
      batteryVoltage = clamp(batteryVoltage, 13.5, 14.0);
    }
    
    loadVoltage = batteryVoltage;
    
    // Board temp — controller heats up under load
    boardTemp = ambientTemp + solarPower * 0.15 + rand(-0.5, 0.5);
  }
  
  // Round values realistically
  solarVoltage = Math.round(solarVoltage * 100) / 100;
  solarCurrent = Math.round(solarCurrent * 1000) / 1000;
  solarPower = Math.round(solarPower * 100) / 100;
  loadVoltage = Math.round(loadVoltage * 100) / 100;
  loadCurrent = Math.round(loadCurrent * 1000) / 1000;
  batteryVoltage = Math.round(batteryVoltage * 100) / 100;
  boardTemp = Math.round(boardTemp * 10) / 10;
  
  rows.push({
    ts: ts.toISOString(),
    solarVoltage,
    solarCurrent,
    solarPower,
    loadVoltage,
    loadCurrent,
    batteryVoltage: Math.round(batteryVoltage * 100) / 100,
    chargerState,
    boardTemp,
  });
}

// Output SQL
console.log('-- Realistic MPPT Demo Data for Station 12');
console.log('-- 5A Solar Charge Controller, 30W 18V Panel, 12V 18Ah Battery');
console.log('-- ' + COUNT + ' records at 5-min intervals');
console.log('');
console.log('BEGIN;');
console.log('');
console.log('-- Delete existing demo data');
console.log("DELETE FROM weather_data WHERE station_id = 4;");
console.log('');

for (const row of rows) {
  console.log(`INSERT INTO weather_data (station_id, table_name, timestamp, collected_at, mppt_solar_voltage, mppt_solar_current, mppt_solar_power, mppt_load_voltage, mppt_load_current, mppt_battery_voltage, mppt_charger_state, mppt_board_temp, data) VALUES (4, 'MPPT', '${row.ts}', '${row.ts}', ${row.solarVoltage}, ${row.solarCurrent}, ${row.solarPower}, ${row.loadVoltage}, ${row.loadCurrent}, ${row.batteryVoltage}, ${row.chargerState}, ${row.boardTemp}, '{}');`);
}

console.log('');
console.log('COMMIT;');
console.log('');
console.log('-- Verify');
console.log("SELECT count(*), min(mppt_solar_voltage), max(mppt_solar_voltage), min(mppt_solar_current), max(mppt_solar_current), min(mppt_solar_power), max(mppt_solar_power), min(mppt_battery_voltage), max(mppt_battery_voltage), min(mppt_load_current), max(mppt_load_current), min(mppt_board_temp), max(mppt_board_temp) FROM weather_data WHERE station_id = 4;");
