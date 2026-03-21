const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(() => c.query('SELECT id, name FROM stations ORDER BY id'))
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); c.end(); })
  .catch(e => { console.error(e.message); c.end(); });
