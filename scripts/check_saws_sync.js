const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
p.query(`SELECT id,name,last_sync_at,last_sync_status,last_sync_records FROM dropbox_configs WHERE id IN (41,42) ORDER BY id`)
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); p.end(); })
  .catch(e => console.error(e.message));
