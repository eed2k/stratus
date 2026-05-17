const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  // Most-recent rows for station 18 across all table_names
  const r = await pool.query(
    `SELECT id, table_name, timestamp, collected_at,
            jsonb_object_keys(data) AS k
       FROM weather_data WHERE station_id=18
       ORDER BY timestamp DESC LIMIT 1`);
  console.log('Sample keys in latest row:', r.rows.map(x => x.k).slice(0, 30));

  const r2 = await pool.query(
    `SELECT timestamp, table_name, collected_at,
            data->>'AirTemp_Avg' AS temp,
            data->>'BattVolt_Avg' AS bv,
            data->>'WS_ms_S_WVT' AS wind,
            data
       FROM weather_data WHERE station_id=18
       ORDER BY timestamp DESC LIMIT 6`);
  console.log('\nLatest 6 rows for station 18:');
  for (const row of r2.rows) {
    console.log(`  ts=${row.timestamp.toISOString()} table=${row.table_name} collected=${row.collected_at.toISOString()}`);
    console.log(`    temp=${row.temp} batt=${row.bv} wind=${row.wind}`);
  }

  // What does getLatestWeatherData return? Mimic with simple ORDER BY DESC LIMIT 1
  const r3 = await pool.query(
    `SELECT timestamp, table_name FROM weather_data
       WHERE station_id=18 ORDER BY timestamp DESC, id DESC LIMIT 1`);
  console.log('\nORDER BY timestamp DESC LIMIT 1 ->', r3.rows[0]);

  // Distinct table_names with their max timestamps
  const r4 = await pool.query(
    `SELECT table_name, COUNT(*) n, MAX(timestamp) latest
       FROM weather_data WHERE station_id=18
       GROUP BY table_name ORDER BY latest DESC`);
  console.log('\nPer-table summary station 18:');
  for (const row of r4.rows) console.log(`  table=${row.table_name} n=${row.n} latest=${row.latest.toISOString()}`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
