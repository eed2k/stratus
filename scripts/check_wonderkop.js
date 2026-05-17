const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query("select max(timestamp) as last_ts, count(*) as n from weather_data where station_id=13 and timestamp > now() - interval '24 hours'");
  console.log('recent24h', JSON.stringify(r.rows));
  const r2 = await p.query('select id,name,last_connected,updated_at from stations where id=13');
  console.log('station', JSON.stringify(r2.rows));
  const r3 = await p.query('select timestamp from weather_data where station_id=13 order by timestamp desc limit 5');
  console.log('last5', JSON.stringify(r3.rows));
  await p.end();
})().catch(e => { console.error(e); process.exit(1); });
