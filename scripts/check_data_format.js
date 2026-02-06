const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // Check a few records to see if data is double-stringified
    const result = await client.query(
      "SELECT id, timestamp, data, pg_typeof(data) as dtype FROM weather_data WHERE station_id = 1 ORDER BY timestamp DESC LIMIT 3"
    );
    console.log('Checking data format in weather_data:');
    result.rows.forEach(r => {
      const dataStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      const first100 = dataStr.substring(0, 150);
      console.log('  id=' + r.id + ' type=' + r.dtype + ' typeof=' + (typeof r.data));
      console.log('  data preview: ' + first100);
      
      // Check if it's double-stringified
      if (typeof r.data === 'string') {
        try {
          const parsed = JSON.parse(r.data);
          if (typeof parsed === 'string') {
            console.log('  WARNING: DOUBLE-STRINGIFIED! Inner parse:');
            console.log('    ' + JSON.parse(parsed).toString().substring(0, 100));
          } else {
            console.log('  OK: Single string, parses to object with keys: ' + Object.keys(parsed).slice(0, 5).join(', '));
          }
        } catch(e) {
          console.log('  WARNING: Not valid JSON string');
        }
      } else if (typeof r.data === 'object') {
        console.log('  OK: Already an object with keys: ' + Object.keys(r.data).slice(0, 5).join(', '));
      }
      console.log('');
    });

    // Check if any records have the data stored as double-stringified
    const doubleCheck = await client.query(
      "SELECT COUNT(*) as cnt FROM weather_data WHERE data::text LIKE '\"%'"
    );
    console.log('Records starting with quote (possible double-stringify): ' + doubleCheck.rows[0].cnt);
    
    const normalCheck = await client.query(
      "SELECT COUNT(*) as cnt FROM weather_data WHERE data::text LIKE '{%'"
    );
    console.log('Records starting with brace (normal JSON): ' + normalCheck.rows[0].cnt);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error('Error:', e.message));
