const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query("SELECT * FROM alarms ORDER BY id DESC LIMIT 5")
  .then(r => { r.rows.forEach(a => console.log(JSON.stringify(a))); p.end(); })
  .catch(e => { console.error(e); p.end(); });
