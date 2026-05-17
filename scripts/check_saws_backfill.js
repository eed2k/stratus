const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  for (const sid of [18, 19]) {
    const r = await p.query(
      `SELECT COUNT(*)::int AS cnt,
              MIN(timestamp) AS oldest,
              MAX(timestamp) AS newest
       FROM weather_data WHERE station_id = $1`, [sid]);
    console.log(`station ${sid}:`, r.rows[0]);
  }
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
