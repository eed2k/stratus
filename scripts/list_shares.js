const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query("SELECT id, station_id, share_token, name, slug, is_active, access_level FROM shares ORDER BY is_active DESC, name")
  .then(r => {
    console.log(JSON.stringify(r.rows, null, 2));
    process.exit(0);
  })
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });
