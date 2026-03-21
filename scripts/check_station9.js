const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(() => c.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = 9'))
  .then(r => { console.log('Station 9 records:', r.rows[0].cnt); return c.query('SELECT COUNT(*) as cnt FROM dropbox_configs WHERE station_id = 9'); })
  .then(r => { console.log('Station 9 dropbox configs:', r.rows[0].cnt); c.end(); })
  .catch(e => { console.error(e.message); c.end(); });
