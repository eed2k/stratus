const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(async () => {
  // List all stations
  const stations = await c.query('SELECT id, name, is_active, last_connected, altitude FROM stations ORDER BY id');
  console.log('=== ALL STATIONS ===');
  stations.rows.forEach(s => console.log(`  ID ${s.id}: ${s.name} | active=${s.is_active} | lastConn=${s.last_connected} | alt=${s.altitude}`));

  // Check SWAKOP data across all possible IDs
  for (const sid of [13, 14, 15]) {
    const cnt = await c.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = $1', [sid]);
    if (parseInt(cnt.rows[0].cnt) > 0) {
      const range = await c.query('SELECT MIN(timestamp) as mn, MAX(timestamp) as mx FROM weather_data WHERE station_id = $1', [sid]);
      console.log(`\nStation ${sid} data: ${cnt.rows[0].cnt} records, ${range.rows[0].mn} to ${range.rows[0].mx}`);
    } else {
      console.log(`\nStation ${sid} data: 0 records`);
    }
  }

  // Check dropbox sync configs
  const configs = await c.query('SELECT id, station_id, dropbox_folder, file_pattern, enabled, last_sync_at, last_sync_status FROM dropbox_sync_configs ORDER BY id');
  console.log('\n=== DROPBOX SYNC CONFIGS ===');
  configs.rows.forEach(cfg => console.log(`  Config ${cfg.id}: station=${cfg.station_id} | folder=${cfg.dropbox_folder} | file=${cfg.file_pattern} | enabled=${cfg.enabled} | lastSync=${cfg.last_sync_at} | status=${cfg.last_sync_status}`));

  // Check if backup cron exists
  console.log('\n=== DONE ===');
  await c.end();
}).catch(e => { console.error('DB Error:', e.message); process.exit(1); });
