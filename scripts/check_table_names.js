const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // Check distinct table_name values
    const tables = await client.query(
      'SELECT DISTINCT table_name, COUNT(*) as cnt FROM weather_data GROUP BY table_name ORDER BY cnt DESC'
    );
    console.log('Table names in weather_data:');
    tables.rows.forEach(r => console.log('  ' + r.table_name + ': ' + r.cnt + ' records'));

    // Try to get latest data for station 1 with each table name
    const tryNames = ['OneMin', 'Table1', 'FiveMin', 'Hourly', 'Daily', 'HOPEFIELD_CR300_Table1'];
    for (const name of tryNames) {
      const result = await client.query(
        'SELECT id, timestamp FROM weather_data WHERE station_id = 1 AND table_name = $1 ORDER BY timestamp DESC LIMIT 1',
        [name]
      );
      console.log('Latest for "' + name + '": ' + (result.rows.length > 0 ? result.rows[0].timestamp : 'NONE'));
    }

    // Also try without table_name filter
    const anyResult = await client.query(
      'SELECT id, timestamp, table_name FROM weather_data WHERE station_id = 1 ORDER BY timestamp DESC LIMIT 3'
    );
    console.log('\nLatest 3 records for station 1 (any table):');
    anyResult.rows.forEach(r => console.log('  ts=' + r.timestamp + ' table=' + r.table_name));

    // Check station_id values
    const stations = await client.query(
      'SELECT DISTINCT station_id, COUNT(*) as cnt FROM weather_data GROUP BY station_id ORDER BY station_id'
    );
    console.log('\nStation IDs in weather_data:');
    stations.rows.forEach(r => console.log('  station_id=' + r.station_id + ': ' + r.cnt + ' records'));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error('Error:', e.message));
