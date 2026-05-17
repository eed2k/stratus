const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const cfgs = await pool.query(`SELECT * FROM dropbox_configs WHERE id IN (41,42) ORDER BY id`);
  console.log('=== Configs ===');
  for (const r of cfgs.rows) console.log(r);

  const stations = await pool.query(`SELECT id, name, last_connected FROM stations WHERE id IN (18, 19)`);
  console.log('\n=== Stations ===');
  for (const r of stations.rows) console.log(r);

  const data18 = await pool.query(`SELECT COUNT(*) AS cnt, MIN(timestamp) AS earliest, MAX(timestamp) AS latest FROM weather_data WHERE station_id = 18`);
  console.log('\n=== weather_data station 18 ===', data18.rows[0]);
  const data19 = await pool.query(`SELECT COUNT(*) AS cnt, MIN(timestamp) AS earliest, MAX(timestamp) AS latest FROM weather_data WHERE station_id = 19`);
  console.log('=== weather_data station 19 ===', data19.rows[0]);

  // Sample latest rows
  const samp18 = await pool.query(`SELECT * FROM weather_data WHERE station_id = 18 ORDER BY timestamp DESC LIMIT 1`);
  console.log('\n=== latest row station 18 (key fields) ===');
  if (samp18.rows[0]) {
    const r = samp18.rows[0];
    const keys = Object.keys(r).filter(k => r[k] !== null && r[k] !== '');
    console.log('non-null fields:', keys.length);
    console.log(keys.slice(0, 30));
    console.log('timestamp:', r.timestamp, 'temp:', r.temperature, 'rh:', r.humidity, 'pressure:', r.pressure);
  }
  const samp19 = await pool.query(`SELECT * FROM weather_data WHERE station_id = 19 ORDER BY timestamp DESC LIMIT 1`);
  console.log('\n=== latest row station 19 (key fields) ===');
  if (samp19.rows[0]) {
    const r = samp19.rows[0];
    const keys = Object.keys(r).filter(k => r[k] !== null && r[k] !== '');
    console.log('non-null fields:', keys.length);
    console.log(keys.slice(0, 30));
    console.log('timestamp:', r.timestamp, 'mpptSolarVoltage/snake:', r.mppt_solar_voltage, 'mpptBatteryVoltage:', r.mppt_battery_voltage);
  }

  await pool.end();
})();
