const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Check if stations 18, 19 are visible to users (active/enabled)
  const s = await pool.query(`SELECT * FROM stations WHERE id IN (1, 18, 19) ORDER BY id`);
  for (const r of s.rows) {
    console.log(`\n--- Station ${r.id}: ${r.name} ---`);
    for (const k of Object.keys(r)) {
      if (r[k] !== null && r[k] !== undefined && k !== 'image_data' && k !== 'image' && k !== 'station_image') {
        const v = typeof r[k] === 'string' && r[k].length > 100 ? r[k].slice(0, 100) + '...' : r[k];
        console.log(`  ${k}:`, v);
      }
    }
  }
  await pool.end();
})();
