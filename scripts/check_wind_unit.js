const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query('SELECT id, name, wind_speed_unit FROM stations')
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); p.end(); })
  .catch(e => { console.log('ERROR:', e.message); p.end(); });
