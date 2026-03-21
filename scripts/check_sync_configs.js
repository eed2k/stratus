const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query('SELECT id, station_id, folder_path, enabled, name FROM dropbox_configs')
  .then(r => {
    console.log(JSON.stringify(r.rows, null, 2));
    p.end();
  })
  .catch(e => {
    console.error(e.message);
    p.end();
  });
