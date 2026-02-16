const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect()
  .then(() => c.query('SELECT id, name, connection_type, connection_config, station_type FROM stations ORDER BY id'))
  .then(r => {
    console.log(JSON.stringify(r.rows, null, 2));
    return c.query('SELECT id, name, folder_path, file_pattern, station_id, enabled FROM dropbox_configs ORDER BY id');
  })
  .then(r => {
    console.log('--- DROPBOX CONFIGS ---');
    console.log(JSON.stringify(r.rows, null, 2));
    c.end();
  })
  .catch(e => { console.error(e.message); c.end(); });
