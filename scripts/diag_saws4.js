// Simulate what the dashboard would receive: latest + 24h range
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  for (const sid of [18, 19]) {
    console.log(`\n========== STATION ${sid} ==========`);
    const tn = await pool.query(`SELECT DISTINCT table_name FROM weather_data WHERE station_id=$1`, [sid]);
    console.log('table_names:', tn.rows.map(r => r.table_name));

    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const r = await pool.query(`SELECT timestamp, table_name, data FROM weather_data WHERE station_id=$1 AND timestamp >= $2 ORDER BY timestamp ASC`, [sid, since]);
    console.log(`rows in last 7d: ${r.rows.length}`);
    if (r.rows.length) {
      console.log('first ts:', r.rows[0].timestamp, 'last ts:', r.rows[r.rows.length - 1].timestamp);
      const sample = r.rows[r.rows.length - 1].data;
      const interesting = ['temperature', 'humidity', 'pressure', 'windSpeed', 'rainfall',
        'mpptSolarVoltage', 'mpptBatteryVoltage', 'mpptSolarPower', 'mpptChargerState',
        'mppt2SolarVoltage', 'mppt2BatteryVoltage', 'SolarCharger_PanelVoltage_1_Avg',
        'SolarCharger_BatteryVoltage_1_Avg', 'SolarCharger_PanelVoltage_2_Avg',
        'SolarCharger_BatteryVoltage_2_Avg'];
      for (const k of interesting) {
        if (sample && k in sample) console.log(`  ${k} =`, sample[k]);
      }
    }
  }
  await pool.end();
})();
