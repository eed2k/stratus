const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_Td6bZPiln4SI@ep-delicate-surf-aguhl3up.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require' });

(async () => {
  const stations = await pool.query('SELECT id, name, is_active, last_connected FROM stations WHERE id = 15');
  console.log('=== Station 15 ===');
  console.log(JSON.stringify(stations.rows[0], null, 2));
  
  const stats = await pool.query('SELECT COUNT(*) as count, MIN(timestamp) as earliest, MAX(timestamp) as latest FROM weather_data WHERE station_id = 15');
  console.log('\n=== Data Stats ===');
  console.log('Count:', stats.rows[0].count, '| Earliest:', stats.rows[0].earliest, '| Latest:', stats.rows[0].latest);
  
  const latest = await pool.query('SELECT timestamp, data FROM weather_data WHERE station_id = 15 ORDER BY timestamp DESC LIMIT 3');
  console.log('\n=== Latest Records ===');
  latest.rows.forEach(r => {
    const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    console.log('Time:', r.timestamp);
    console.log('  temp:', d.temperature, '| humidity:', d.humidity, '| pressure:', d.pressure);
    console.log('  wind:', d.windSpeed, '| dir:', d.windDirection, '| gust:', d.windGust);
    console.log('  keys:', Object.keys(d).slice(0, 15).join(', '));
  });
  
  const dc = await pool.query('SELECT id, name, folder_path, file_pattern, station_id, enabled, last_sync_at, last_sync_status, last_sync_records, sync_interval FROM dropbox_configs WHERE station_id = 15');
  console.log('\n=== Dropbox Config ===');
  if (dc.rows[0]) console.log(JSON.stringify(dc.rows[0], null, 2));
  else console.log('No config found!');
  
  pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
