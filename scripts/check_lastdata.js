const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query("SELECT station_id, MAX(timestamp) AS last_data_at FROM weather_data WHERE station_id IN (1,3,4,5,6,13) GROUP BY station_id ORDER BY station_id")
  .then(r => { console.table(r.rows); return p.end(); });
