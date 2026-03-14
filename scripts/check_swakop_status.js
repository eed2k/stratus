// Quick check of Swakop station data and sync status
const pg = require('pg');
const client = new pg.Client(process.env.DATABASE_URL);
client.connect().then(async () => {
  const count = await client.query('SELECT count(*) FROM weather_data WHERE station_id=13');
  console.log('Total records:', count.rows[0].count);

  const withTemp = await client.query("SELECT count(*) FROM weather_data WHERE station_id=13 AND (data->>'temperature') IS NOT NULL AND data->>'temperature' != 'null'");
  console.log('With temperature:', withTemp.rows[0].count);

  const latest = await client.query("SELECT timestamp, data->>'temperature' as temp, data->>'humidity' as hum, data->>'pressure' as press, data->>'solarRadiation' as solar, data->>'batteryVoltage' as batt FROM weather_data WHERE station_id=13 ORDER BY timestamp DESC LIMIT 1");
  console.log('Latest:', latest.rows[0]);

  const station = await client.query('SELECT id, name, is_active, last_connected, altitude, latitude, longitude FROM stations WHERE id=13');
  console.log('Station:', station.rows[0]);

  const configs = await client.query('SELECT id, name, station_id, sync_interval, last_sync_at, last_sync_status, enabled FROM dropbox_configs WHERE station_id=13');
  console.log('Dropbox configs:', configs.rows);

  const allStations = await client.query('SELECT id, name, is_active, last_connected FROM stations ORDER BY id');
  console.log('\nAll stations:');
  allStations.rows.forEach(s => console.log(s.id, s.name, 'active:', s.is_active, 'lastConn:', s.last_connected));

  await client.end();
}).catch(e => console.error(e));
