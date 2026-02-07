const pg = require('pg');
const client = new pg.Client(process.env.DATABASE_URL);

async function main() {
  await client.connect();
  
  // Check raw DB value
  const res = await client.query('SELECT id, name, last_connected, station_type, connection_type FROM stations');
  console.log('=== RAW DB stations ===');
  for (const row of res.rows) {
    console.log(`Station ${row.id}: ${row.name}`);
    console.log(`  last_connected: ${row.last_connected}`);
    console.log(`  type: ${row.station_type}, connection: ${row.connection_type}`);
  }
  
  // Check latest collectedAt
  const dataRes = await client.query(`
    SELECT station_id, MAX(collected_at) as max_collected, MAX(timestamp) as max_ts
    FROM weather_data
    GROUP BY station_id
  `);
  console.log('\n=== Latest data times ===');
  for (const row of dataRes.rows) {
    console.log(`Station ${row.station_id}: max_collected=${row.max_collected}, max_ts=${row.max_ts}`);
  }
  
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
