const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  const configs = await p.query('SELECT id, station_id, name, last_sync_at, last_sync_status, last_sync_records FROM dropbox_configs ORDER BY id');
  configs.rows.forEach(row => console.log('CONFIG:', JSON.stringify(row)));
  const swakop = await p.query("SELECT COUNT(*) as total, MIN(timestamp) as oldest, MAX(timestamp) as newest FROM weather_data WHERE station_id = 15");
  console.log('SWAKOP_DATA:', JSON.stringify(swakop.rows[0]));
  const shares = await p.query("SELECT token, slug, station_id, expires_at, password_hash IS NOT NULL as has_pw FROM shares ORDER BY created_at DESC LIMIT 5");
  shares.rows.forEach(row => console.log('SHARE:', JSON.stringify(row)));
  if (shares.rows.length === 0) console.log('SHARE: none');
  await p.end();
}
main().catch(e => { console.error(e.message); p.end(); });
