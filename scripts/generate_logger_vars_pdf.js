/**
 * Stratus Recognised Labels & Variables PDF Generator
 * Comprehensive label & variable mapping reference
 * ASCII-only text for jsPDF compatibility
 */
const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable');

const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
const pageW = 210;
const pageH = 297;
const margin = 22;
const contentW = pageW - margin * 2;
let y = 0;
const BLACK = [0, 0, 0];

function setBlack() { doc.setTextColor(0, 0, 0); }

function checkPage(needed) {
  if (y + needed > pageH - 20) {
    doc.addPage();
    y = 25;
    return true;
  }
  return false;
}

function sectionTitle(text) {
  checkPage(30);
  y += 6;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  setBlack();
  doc.text(text.toUpperCase(), margin, y);
  y += 1;
  doc.setLineWidth(0.4);
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, y, margin + contentW, y);
  y += 5;
}

function subHeading(text) {
  checkPage(25);
  y += 2;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  setBlack();
  doc.text(text, margin, y);
  y += 4.5;
}

function bodyText(text, indent) {
  const x = margin + (indent || 0);
  const w = contentW - (indent || 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setBlack();
  const lines = doc.splitTextToSize(text, w);
  lines.forEach(line => {
    checkPage(4.5);
    doc.text(line, x, y);
    y += 4;
  });
}

function bulletList(items, indent) {
  const x = margin + (indent || 4);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  setBlack();
  items.forEach(item => {
    checkPage(5);
    doc.text('-', x - 4, y);
    const lines = doc.splitTextToSize(item, contentW - (indent || 4) - 2);
    lines.forEach(line => {
      doc.text(line, x, y);
      y += 3.8;
    });
  });
}

function addTable(headers, rows, colWidths) {
  checkPage(15);
  autoTable(doc, {
    startY: y,
    head: [headers],
    body: rows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7.5, cellPadding: 1.5, font: 'helvetica', textColor: BLACK, lineColor: [160, 160, 160], lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: [240, 240, 240], textColor: BLACK, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: colWidths ? Object.fromEntries(colWidths.map((w, i) => [i, { cellWidth: w }])) : {},
    theme: 'grid',
  });
  y = doc.lastAutoTable.finalY + 4;
}

// ====== COVER ======
y = 65;
doc.setFontSize(28);
doc.setFont('helvetica', 'bold');
setBlack();
doc.text('STRATUS', pageW / 2, y, { align: 'center' });
y += 10;
doc.setFontSize(14);
doc.setFont('helvetica', 'normal');
doc.text('Recognised Labels & Variables', pageW / 2, y, { align: 'center' });
y += 8;
doc.setFontSize(10);
doc.text('Comprehensive Label & Variable Mapping Reference', pageW / 2, y, { align: 'center' });
y += 5;
doc.setLineWidth(0.5);
doc.line(pageW / 2 - 40, y, pageW / 2 + 40, y);
y += 15;

doc.setFontSize(9.5);
doc.setFont('helvetica', 'normal');
const intro = 'This document lists every label and variable that Stratus recognises when importing data from Campbell Scientific TOA5 files, HTTP POST payloads, Arduino IoT Cloud, and RIKA Cloud stations. Variable names are matched case-insensitively unless noted otherwise.';
doc.splitTextToSize(intro, contentW).forEach(l => { doc.text(l, margin, y); y += 4.5; });
y += 3;
const intro2 = 'When a station sends data, Stratus maps each column header (label) to an internal weather parameter. The tables below show every recognised label, its mapped parameter, and typical units.';
doc.splitTextToSize(intro2, contentW).forEach(l => { doc.text(l, margin, y); y += 4.5; });

// ====== CORE TOA5 VARIABLE MAPPING ======
doc.addPage();
y = 25;

sectionTitle('1. Recognised Label Mapping');

bodyText('Stratus recognises the following column headers and maps them to internal weather parameters. These labels are commonly found in Campbell Scientific TOA5 CSV files and other data sources. Matching is case-insensitive.');

subHeading('Temperature');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['AirTC, AirTC_Avg, AirT_C, Temp_C, Air_Temp', 'temperature', 'C'],
    ['AirTC_Max, Temp_C_Max', 'temperatureMax', 'C'],
    ['AirTC_Min, Temp_C_Min', 'temperatureMin', 'C'],
    ['AirTC2, InsideTemp, T_inside', 'insideTemperature', 'C'],
    ['DewPt, DewPoint, DewPt_C', 'dewPoint', 'C'],
    ['HeatIndex, Heat_Index', 'heatIndex', 'C'],
    ['WindChill, Wind_Chill', 'windChill', 'C'],
    ['WetBulb, WetBulb_C', 'wetBulbTemperature', 'C'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Humidity');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['RH, RH_Avg, RelHumid, Humidity', 'humidity', '%'],
    ['RH_Max', 'humidityMax', '%'],
    ['RH_Min', 'humidityMin', '%'],
    ['RH_inside, InsideHumidity', 'insideHumidity', '%'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Wind');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['WS_ms, WS_ms_Avg, WindSpd, Wind_Speed', 'windSpeed', 'm/s'],
    ['WS_ms_Max, WindSpd_Max, Wind_Gust', 'windGust', 'm/s'],
    ['WS_ms_S, WS_Std', 'windSpeedStdDev', 'm/s'],
    ['WindDir, Wind_Dir, WD_Avg', 'windDirection', 'degrees'],
    ['WindDir_SD, WD_StdDev', 'windDirectionStdDev', 'degrees'],
    ['WS_10min_Max, Gust10min', 'windGust10Min', 'm/s'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Precipitation');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['Rain_mm, Rain_mm_Tot, Rainfall', 'rainfall', 'mm'],
    ['Rain_24h, DailyRain', 'dailyRainfall', 'mm'],
    ['StormRain', 'stormRain', 'mm'],
    ['MonthRain', 'monthRain', 'mm'],
    ['YearRain', 'yearRain', 'mm'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Solar & Radiation');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['SlrW, Solar_W, SlrW_Avg, Solar_Rad', 'solarRadiation', 'W/m2'],
    ['SlrW_Max, Solar_Max', 'solarRadiationMax', 'W/m2'],
    ['UV_Index, UVIndex', 'uvIndex', 'index'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Pressure');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['BP_mbar, Pressure, Baro_hPa', 'pressure', 'hPa'],
    ['SeaLevel_mbar, QNH, SLP', 'seaLevelPressure', 'hPa'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Soil & Environment');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['SoilTC, Soil_Temp', 'soilTemperature', 'C'],
    ['SoilVWC, Soil_Moist, VWC', 'soilMoisture', '%'],
    ['LeafWet, Leaf_Wetness', 'leafWetness', '%'],
    ['WaterLevel, Water_Lvl', 'waterLevel', 'm'],
    ['Lightning, LightningDist', 'lightning', 'km'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Derived & Calculated');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['VPD, Vapour_Deficit', 'vpd', 'kPa'],
    ['ETo, RefET', 'eto', 'mm'],
    ['AirDensity, Air_Density', 'airDensity', 'kg/m3'],
    ['GDD, GrowingDD', 'growingDegreeDays', 'C-day'],
    ['ChillHours, Chill_Hrs', 'chillHours', 'hours'],
  ],
  [55, 50, contentW - 105]
);

subHeading('System & Power');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['BattV, Batt_V, BattVolt', 'batteryVoltage', 'V'],
    ['PTemp_C, PanelTemp', 'panelTemperature', 'C'],
    ['ConsoleBatt', 'consoleBatteryVoltage', 'V'],
    ['TxBatt, TransBatt', 'transmitterBattery', 'V'],
  ],
  [55, 50, contentW - 105]
);

subHeading('MPPT Charger');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['mppt_solarV, MPPT_SolarV', 'mpptSolarVoltage', 'V'],
    ['mppt_solarI, MPPT_SolarI', 'mpptSolarCurrent', 'A'],
    ['mppt_solarP, MPPT_SolarP', 'mpptSolarPower', 'W'],
    ['mppt_battV, MPPT_BattV', 'mpptBatteryVoltage', 'V'],
    ['mppt_loadI, MPPT_LoadI', 'mpptLoadCurrent', 'A'],
    ['mppt_loadV, MPPT_LoadV', 'mpptLoadVoltage', 'V'],
    ['mppt_state, MPPT_State', 'mpptChargerState', 'state'],
    ['mppt_boardTemp', 'mpptBoardTemperature', 'C'],
    ['mppt2_solarV', 'mppt2SolarVoltage', 'V'],
    ['mppt2_solarI', 'mppt2SolarCurrent', 'A'],
    ['mppt2_battV', 'mppt2BatteryVoltage', 'V'],
    ['mppt2_state', 'mppt2ChargerState', 'state'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Air Quality');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['PM1, PM1_0', 'pm1', 'ug/m3'],
    ['PM2_5, PM25', 'pm25', 'ug/m3'],
    ['PM10', 'pm10', 'ug/m3'],
    ['AQI, AirQuality', 'aqi', 'index'],
    ['CO2, co2', 'co2', 'ppm'],
    ['TVOC, tvoc', 'tvoc', 'ppb'],
  ],
  [55, 50, contentW - 105]
);

subHeading('Water & Lightning');
addTable(
  ['Recognised Label', 'Stratus Parameter', 'Unit'],
  [
    ['WaterLevel, Water_Lvl', 'waterLevel', 'm'],
    ['LightningCount', 'lightningCount', 'count'],
    ['LightningDist', 'lightningDistance', 'km'],
    ['Visibility', 'visibility', 'km'],
    ['CloudBase', 'cloudBase', 'm'],
    ['CloudCover', 'cloudCover', 'oktas'],
  ],
  [55, 50, contentW - 105]
);

// ====== PROTOCOL-SPECIFIC ======
sectionTitle('2. Protocol-Specific Field Mapping');

subHeading('Dropbox Sync (TOA5 Files)');
bodyText('Dropbox sync imports Campbell Scientific TOA5 CSV files from a cloud-synced folder. OAuth 2.0 authentication with automatic token renewal. All column headers are matched against the recognised label mapping above. Historical records are backfilled on first sync.');

subHeading('HTTP POST (/api/ingest/:stationId)');
bodyText('Stations push JSON to the ingest endpoint. Rate limited to 60 requests per minute. The JSON body uses Stratus parameter names directly:');
bulletList([
  'temperature, humidity, pressure, windSpeed, windDirection, windGust',
  'rainfall, solarRadiation, uvIndex, dewPoint, batteryVoltage',
  'Any parameter from the recognised label mapping (camelCase field name)',
]);

subHeading('Arduino IoT Cloud');
bodyText('Arduino IoT Cloud API integration for Arduino-based sensor platforms. Variables are mapped by their Arduino Cloud property name to the matching Stratus parameter. The variable name in Arduino Cloud should match a recognised label or use the exact Stratus parameter name.');

subHeading('RIKA Cloud (v2 API)');
bodyText('RIKA Cloud integration polls the /rika/api/v2/farm/{farm_pk}/device/ endpoint every 30 minutes. Each device is identified by its type code (the_type) and mapped to a Stratus parameter:');

addTable(
  ['RIKA Type Code', 'Stratus Parameter', 'Unit', 'Description'],
  [
    ['2001', 'temperature', 'C', 'Air temperature sensor'],
    ['2002', 'humidity', '%RH', 'Relative humidity sensor'],
    ['2006', 'windSpeed', 'm/s', 'Wind speed (anemometer)'],
    ['2007', 'windDirection', 'degrees', 'Wind direction (vane)'],
    ['2008', 'rainfall', 'mm', 'Precipitation (rain gauge)'],
    ['2014', 'solarRadiation', 'W/m2', 'Solar radiation (pyranometer)'],
    ['3003', 'pressure (SLP)', 'hPa', 'Barometric pressure (sea-level corrected)'],
    ['2081', 'pm10', 'ug/m3', 'PM10 particulate matter'],
  ],
  [28, 38, 22, contentW - 88]
);

bodyText('Note: RIKA type 3003 reports sea-level pressure (SLP) directly, not station-level pressure. Stratus derives station pressure from the SLP using the station altitude and temperature. GPS coordinates (types 3331, 3332) are read but stored as metadata rather than weather data.');

// ====== SERVER-COMPUTED ======
sectionTitle('3. Server-Computed Fields');

bodyText('These parameters are calculated server-side from ingested raw data and do not require matching labels:');

addTable(
  ['Computed Field', 'Method', 'Inputs'],
  [
    ['dewPoint', 'Magnus-Tetens formula', 'temperature + humidity'],
    ['seaLevelPressure (QNH)', 'Hypsometric equation', 'station pressure + altitude'],
    ['airDensity', 'Ideal gas law + humidity', 'temperature + pressure + humidity'],
    ['eto (Reference ET)', 'FAO-56 Penman-Monteith', 'temperature, humidity, wind, solar, altitude'],
    ['windPowerDensity', 'P = 0.5 x p x v^3', 'windSpeed + airDensity'],
    ['heatIndex', 'Rothfusz regression (NWS)', 'temperature + humidity'],
    ['windChill', 'Environment Canada formula', 'temperature + windSpeed'],
    ['fireDangerIndex (SA FDI)', 'SA additive table method', 'temperature, humidity, wind, rain history'],
    ['grasslandFDI', 'Grassland fire model', 'temperature, humidity, wind, curing factor'],
    ['fuelMoisture', 'Temperature + humidity model', 'temperature + humidity'],
    ['vpd', 'Saturation deficit', 'temperature + humidity'],
    ['wetBulbTemperature', 'Stull 2011 formula', 'temperature + humidity'],
    ['growingDegreeDays', 'Configurable base (10C)', 'temperature min/max'],
    ['chillHours', 'Utah model simplified', 'hourly temperature'],
    ['solarPosition', 'NOAA algorithm', 'latitude, longitude, timestamp'],
  ],
  [38, 40, contentW - 78]
);

// ====== LABEL MATCHING ======
sectionTitle('4. Label Matching Algorithm');

bodyText('When Stratus receives data via any protocol, it applies the following steps to match each column header or field name to a parameter:');

addTable(
  ['Step', 'Rule', 'Example'],
  [
    ['1. Exact Match', 'Column header matches a known label exactly (case-insensitive)', 'AirTC -> temperature'],
    ['2. Suffix Stripping', 'Common suffixes removed: _Avg, _Tot, _Max, _Min, _Std', 'AirTC_Avg -> AirTC -> temperature'],
    ['3. Substring Match', 'Header contains a known keyword anywhere in the string', 'CR1000_AirTC_TMx -> temperature'],
    ['4. Unit Extraction', 'Parenthesised units stripped before matching: (mm), (C), (hPa)', 'Rain(mm) -> Rain -> rainfall'],
  ],
  [28, 50, contentW - 78]
);

bodyText('Labels that do not match any known parameter are stored in a JSON overflow column and remain available for export. Administrators can review unmatched labels in the station configuration panel.');

// Page numbers
const totalPages = doc.internal.getNumberOfPages();
for (let i = 1; i <= totalPages; i++) {
  doc.setPage(i);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  setBlack();
  doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 10, { align: 'right' });
}

const fs = require('fs');
const outPath = require('path').join(__dirname, '..', 'docs', 'Stratus-Logger-Variables-Reference.pdf');
fs.mkdirSync(require('path').dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(doc.output('arraybuffer')));
console.log('Saved:', outPath);
