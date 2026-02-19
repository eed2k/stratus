const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const r = await p.query('SELECT mppt_solar_power, mppt_battery_voltage, mppt_load_voltage, timestamp FROM weather_data WHERE station_id = 17 ORDER BY timestamp DESC LIMIT 5');
  console.log('Latest 5:');
  r.rows.forEach(x => console.log(JSON.stringify(x)));
  const s = await p.query('SELECT MIN(mppt_solar_power) as min_p, MAX(mppt_solar_power) as max_p, COUNT(*) as cnt FROM weather_data WHERE station_id = 17 AND mppt_solar_power IS NOT NULL AND mppt_solar_power > 0');
  console.log('Stats:', JSON.stringify(s.rows[0]));
  await p.end();
})();
