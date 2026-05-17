const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  for (const sid of [1, 18, 19]) {
    const r = await pool.query(`SELECT timestamp, table_name, data FROM weather_data WHERE station_id = $1 ORDER BY timestamp DESC LIMIT 1`, [sid]);
    console.log(`\n=== station ${sid} latest ===`);
    if (r.rows[0]) {
      console.log('table_name:', r.rows[0].table_name);
      console.log('timestamp:', r.rows[0].timestamp);
      const d = r.rows[0].data;
      console.log('data keys:', Object.keys(d || {}).join(', '));
      console.log('data sample:', JSON.stringify(d).slice(0, 600));
    } else console.log('NO DATA');
  }

  // What does the API return for station 18?
  const cur18 = await pool.query(`
    SELECT data FROM weather_data WHERE station_id = 18 ORDER BY timestamp DESC LIMIT 1
  `);
  if (cur18.rows[0]) {
    const d = cur18.rows[0].data;
    console.log('\n=== station 18 full data ===');
    console.log(JSON.stringify(d, null, 2));
  }

  await pool.end();
})();
