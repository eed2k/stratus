const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='alarms' ORDER BY ordinal_position")
  .then(r => { r.rows.forEach(c => console.log(c.column_name, '-', c.data_type)); p.end(); })
  .catch(e => { console.error(e); p.end(); });
