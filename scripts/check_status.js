const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(async () => {
  // List all stations
  const stations = await c.query('SELECT id, name, is_active, last_connected FROM stations ORDER BY id');
  console.log('=== ALL STATIONS ===');
  stations.rows.forEach(s => console.log(`  ID ${s.id}: ${s.name} | active=${s.is_active} | lastConn=${s.last_connected}`));
  
  // Check dropbox sync configs
  const configs = await c.query('SELECT id, station_id, dropbox_folder, enabled, last_sync_at, last_sync_status FROM dropbox_sync_configs ORDER BY station_id');
  console.log('\n=== DROPBOX SYNC CONFIGS ===');
  configs.rows.forEach(r => console.log(`  Config ${r.id}: station=${r.station_id} folder=${r.dropbox_folder} enabled=${r.enabled} lastSync=${r.last_sync_at} status=${r.last_sync_status}`));
  
  // Count data per station
  const counts = await c.query('SELECT station_id, COUNT(*) as cnt, MIN(timestamp) as earliest, MAX(timestamp) as latest FROM weather_data GROUP BY station_id ORDER BY station_id');
  console.log('\n=== DATA COUNTS ===');
  counts.rows.forEach(r => console.log(`  Station ${r.station_id}: ${r.cnt} records | ${r.earliest} to ${r.latest}`));
  
  // Check backup cron / scheduled tasks
  console.log('\n=== DONE ===');
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
