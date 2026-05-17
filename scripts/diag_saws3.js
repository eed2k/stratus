const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Show all columns of station 1 latest vs station 18 latest
  for (const sid of [1, 18, 19]) {
    const r = await pool.query(`SELECT * FROM weather_data WHERE station_id = $1 ORDER BY timestamp DESC LIMIT 1`, [sid]);
    if (!r.rows[0]) { console.log(`station ${sid}: no rows`); continue; }
    const row = r.rows[0];
    const nonNull = Object.keys(row).filter(k => row[k] !== null && row[k] !== undefined && k !== 'data');
    console.log(`\n=== station ${sid} non-null top-level cols (${nonNull.length}) ===`);
    console.log(nonNull.join(', '));
  }
  await pool.end();
})();
