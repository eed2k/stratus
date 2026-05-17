const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query("SELECT id,name,folder_path,file_pattern,station_id FROM dropbox_configs WHERE name ILIKE '%SAWS%' OR name ILIKE '%TESTBED%' ORDER BY id")
  .then(r => { console.table(r.rows); return p.end(); });
