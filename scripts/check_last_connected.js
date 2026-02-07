const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const res = await p.query('SELECT id, name, last_connected, station_type, connection_type FROM stations');
  console.log('=== STATIONS last_connected ===');
  for (const row of res.rows) {
    console.log(`Station ${row.id}: ${row.name}`);
    console.log(`  last_connected: ${row.last_connected}`);
    console.log(`  station_type: ${row.station_type}, connection_type: ${row.connection_type}`);
  }

  // Also check the latest collectedAt from weather_data
  const dataRes = await p.query('SELECT station_id, MAX(collected_at) as max_collected, MAX(timestamp) as max_timestamp FROM weather_data GROUP BY station_id');
  console.log('\n=== Latest data times ===');
  for (const row of dataRes.rows) {
    console.log(`Station ${row.station_id}: max_collected=${row.max_collected}, max_timestamp=${row.max_timestamp}`);
  }

  await p.end();
}

main().catch(e => { console.error(e); process.exit(1); });
