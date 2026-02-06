const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // Update all records with null table_name to 'Table1'
    console.log('Updating records with null table_name to Table1...');
    const result = await client.query(
      "UPDATE weather_data SET table_name = 'Table1' WHERE table_name IS NULL"
    );
    console.log('Updated ' + result.rowCount + ' records');

    // Verify
    const verify = await client.query(
      'SELECT DISTINCT table_name, COUNT(*) as cnt FROM weather_data GROUP BY table_name ORDER BY cnt DESC'
    );
    console.log('\nTable names after update:');
    verify.rows.forEach(r => console.log('  ' + r.table_name + ': ' + r.cnt + ' records'));

    // Test the query that getLatestWeatherData would use
    const latest = await client.query(
      "SELECT id, timestamp, table_name FROM weather_data WHERE station_id = 1 AND table_name = 'Table1' ORDER BY timestamp DESC LIMIT 1"
    );
    console.log('\nLatest record for station 1 with table_name=Table1:');
    if (latest.rows.length > 0) {
      console.log('  ts=' + latest.rows[0].timestamp + ' table=' + latest.rows[0].table_name);
    } else {
      console.log('  NONE');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error('Error:', e.message));
