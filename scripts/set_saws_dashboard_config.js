// Set sane defaults for SAWS Testbed (18) hourly + SAWS Testbed Solar (19) 10-min
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ALL_PARAMS = [
  'pressure','pressureSeaLevel','temperature','temperatureMin','temperatureMax','dewPoint','humidity','airDensity','temperature8m','deltaTemperature',
  'windSpeed','windGust','windGust10min','windDirection','windPower',
  'rainfall','rainfall10min','rainfall24h','rainfall7d','rainfall30d','rainfallYearly',
  'solarRadiation','solarRadiationMax','uvIndex','sunAzimuth','sunElevation','eto','eto24h','eto7d','eto30d',
  'soilTemperature','soilMoisture','leafWetness','pm25','pm10','pm1','aqi','co2','tvoc',
  'visibility','atmosphericVisibility','cloudBase','cloudCover',
  'batteryVoltage','panelTemperature','temperatureSwitch','temperatureSwitchOutlet','levelSwitchStatus',
  'lightning','lightningDistance','lightningEnergy','chargerVoltage',
  'mpptSolarVoltage','mpptSolarCurrent','mpptSolarPower','mpptLoadVoltage','mpptLoadCurrent','mpptBatteryVoltage','mpptChargerState','mpptAbsiAvg','mpptBoardTemp','mpptMode',
  'mppt2SolarVoltage','mppt2SolarCurrent','mppt2SolarPower','mppt2LoadVoltage','mppt2LoadCurrent','mppt2BatteryVoltage','mppt2ChargerState','mppt2BoardTemp','mppt2Mode',
];

const SECTIONS = {
  aviation:true, rainfall:true, lightning:true, airQuality:true, fireDanger:true, windEnergy:true,
  mpptCharger:true, solarEtCards:true, waterSensors:true, windAnalysis:true, loggerBattery:true,
  solarPosition:true, primaryMetrics:true, solarRadiation:true, soilEnvironment:true,
  historicalCharts:true, visibilityClouds:true, barometricPressure:true, atmosphericStability:true,
};

function cfg(updateSecs) {
  return {
    compactMode:false, showWindRose:true,
    updatePeriod: updateSecs,
    chartTimeRange: 24,
    showTrendCharts:true,
    enabledParameters: ALL_PARAMS,
    sectionVisibility: SECTIONS,
  };
}

(async () => {
  const r1 = await pool.query(
    `UPDATE stations SET dashboard_config=$1, updated_at=NOW() WHERE id=18 RETURNING id, name`,
    [JSON.stringify(cfg(3600))]
  );
  console.log('Station 18:', r1.rows[0]);
  const r2 = await pool.query(
    `UPDATE stations SET dashboard_config=$1, updated_at=NOW() WHERE id=19 RETURNING id, name`,
    [JSON.stringify(cfg(600))]
  );
  console.log('Station 19:', r2.rows[0]);
  await pool.end();
})();
