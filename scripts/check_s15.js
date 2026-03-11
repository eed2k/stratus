const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(async () => {
  const r = await c.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = 15');
  console.log('Station 15 records:', r.rows[0].cnt);
  if (parseInt(r.rows[0].cnt) > 0) {
    const range = await c.query('SELECT MIN(timestamp) as mn, MAX(timestamp) as mx FROM weather_data WHERE station_id = 15');
    console.log('Range:', range.rows[0].mn, 'to', range.rows[0].mx);
    const sample = await c.query("SELECT timestamp, data->>'temperature' as temp, data->>'humidity' as hum, data->>'pressure' as press FROM weather_data WHERE station_id = 15 ORDER BY timestamp DESC LIMIT 3");
    console.log('Latest:');
    sample.rows.forEach(r => console.log(' ', r.timestamp, 'temp=' + r.temp, 'hum=' + r.hum, 'press=' + r.press));
  }
  const sync = await c.query('SELECT last_sync_at, last_sync_status, last_sync_records FROM dropbox_configs WHERE station_id = 15');
  console.log('Sync config:', JSON.stringify(sync.rows[0]));
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
