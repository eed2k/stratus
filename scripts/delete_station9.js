const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect()
  .then(() => c.query('DELETE FROM weather_data WHERE station_id = 9'))
  .then(r => { console.log('Deleted weather_data:', r.rowCount); return c.query('DELETE FROM dropbox_configs WHERE station_id = 9'); })
  .then(r => { console.log('Deleted dropbox_configs:', r.rowCount); return c.query('DELETE FROM stations WHERE id = 9'); })
  .then(r => { console.log('Deleted station:', r.rowCount); return c.query('SELECT id, name FROM stations ORDER BY id'); })
  .then(r => { console.log('Remaining stations:', JSON.stringify(r.rows)); c.end(); })
  .catch(e => { console.error(e.message); c.end(); });
