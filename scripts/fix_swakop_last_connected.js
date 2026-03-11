// Fix Swakop station last_connected to use the latest data timestamp
const pg = require('pg');
const client = new pg.Client(process.env.DATABASE_URL);
client.connect().then(async () => {
  // Get latest timestamp for station 13
  const latest = await client.query('SELECT max(timestamp) as latest FROM weather_data WHERE station_id=13');
  const latestTs = latest.rows[0].latest;
  console.log('Latest data timestamp:', latestTs);
  
  if (latestTs) {
    await client.query('UPDATE stations SET last_connected = $1, is_active = true WHERE id = 13', [latestTs]);
    console.log('Updated station 13 last_connected to', latestTs);
  }
  
  // Verify
  const station = await client.query('SELECT id, name, last_connected FROM stations WHERE id=13');
  console.log('Station after update:', station.rows[0]);
  
  await client.end();
}).catch(e => console.error(e));
