const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // Check database size
    const size = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) as db_size");
    console.log('Database size: ' + size.rows[0].db_size);

    // Check weather_data table size
    const tableSize = await client.query("SELECT pg_size_pretty(pg_total_relation_size('weather_data')) as tbl_size");
    console.log('weather_data table size: ' + tableSize.rows[0].tbl_size);

    // Check record count per day (to find what to trim)
    const daily = await client.query(
      "SELECT DATE(timestamp) as day, COUNT(*) as cnt FROM weather_data GROUP BY DATE(timestamp) ORDER BY day ASC LIMIT 20"
    );
    console.log('\nOldest 20 days:');
    daily.rows.forEach(r => console.log('  ' + r.day.toISOString().split('T')[0] + ': ' + r.cnt + ' records'));

    // Count total
    const total = await client.query('SELECT COUNT(*) as cnt FROM weather_data');
    console.log('\nTotal records: ' + total.rows[0].cnt);

    // Check for duplicates (same station_id + timestamp)
    const dupes = await client.query(
      "SELECT station_id, timestamp, COUNT(*) as cnt FROM weather_data GROUP BY station_id, timestamp HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 10"
    );
    console.log('\nTop duplicates (same station+timestamp):');
    if (dupes.rows.length === 0) {
      console.log('  No duplicates found');
    } else {
      dupes.rows.forEach(r => console.log('  station=' + r.station_id + ' ts=' + r.timestamp + ' count=' + r.cnt));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error('Error:', e.message));
