const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(async () => {
  const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'weather_data' ORDER BY ordinal_position");
  console.log('Columns:', cols.rows.map(r => r.column_name).join(', '));
  const sample = await c.query('SELECT * FROM weather_data WHERE station_id = 13 ORDER BY timestamp DESC LIMIT 1');
  console.log('Sample row keys:', Object.keys(sample.rows[0]).join(', '));
  console.log('Sample row:', JSON.stringify(sample.rows[0], null, 2));
  const count = await c.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = 13');
  console.log('Total records:', count.rows[0].cnt);
  const range = await c.query('SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM weather_data WHERE station_id = 13');
  console.log('Date range:', range.rows[0].earliest, 'to', range.rows[0].latest);
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
