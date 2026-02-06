const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // Step 1: Fix double-stringified data records
    console.log('Step 1: Fixing double-stringified data...');
    const doubleStringified = await client.query(
      "SELECT id, data::text FROM weather_data WHERE data::text LIKE '\"%'"
    );
    console.log('Found ' + doubleStringified.rows.length + ' double-stringified records');
    
    let fixed = 0;
    for (const row of doubleStringified.rows) {
      try {
        const inner = JSON.parse(row.data);
        if (typeof inner === 'string') {
          const parsed = JSON.parse(inner);
          await client.query(
            'UPDATE weather_data SET data = $1::jsonb WHERE id = $2',
            [JSON.stringify(parsed), row.id]
          );
          fixed++;
        }
      } catch(e) {
        console.log('  Could not fix id=' + row.id + ': ' + e.message);
      }
    }
    console.log('Fixed ' + fixed + ' records');

    // Step 2: Add unique constraint
    console.log('\nStep 2: Adding unique constraint on (station_id, timestamp)...');
    try {
      await client.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_weather_data_unique_station_time ON weather_data(station_id, timestamp)'
      );
      console.log('Unique constraint added successfully');
    } catch(e) {
      console.log('Constraint error: ' + e.message);
    }

    // Step 3: Set default for table_name
    console.log('\nStep 3: Setting default for table_name column...');
    try {
      await client.query("ALTER TABLE weather_data ALTER COLUMN table_name SET DEFAULT 'Table1'");
      console.log('Default set successfully');
    } catch(e) {
      console.log('Default error: ' + e.message);
    }

    // Final status
    const count = await client.query('SELECT COUNT(*) as cnt FROM weather_data');
    const size = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
    const tables = await client.query('SELECT DISTINCT table_name, COUNT(*) as cnt FROM weather_data GROUP BY table_name');
    const latest = await client.query("SELECT timestamp FROM weather_data ORDER BY timestamp DESC LIMIT 1");
    
    console.log('\n=== Final Status ===');
    console.log('DB size: ' + size.rows[0].size);
    console.log('Total records: ' + count.rows[0].cnt);
    console.log('Latest: ' + (latest.rows[0] ? latest.rows[0].timestamp : 'none'));
    console.log('Table names:');
    tables.rows.forEach(r => console.log('  ' + r.table_name + ': ' + r.cnt));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error('Error:', e.message));
