// Debug script to check what Dropbox data looks like
const https = require('https');

// Query the database for the current state
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  const client = await pool.connect();
  try {
    // Get the latest 5 records
    const latest = await client.query(
      'SELECT id, station_id, timestamp, table_name FROM weather_data ORDER BY timestamp DESC LIMIT 5'
    );
    console.log('Latest 5 records in DB:');
    latest.rows.forEach(r => console.log(`  id=${r.id} ts=${r.timestamp}`));

    // Count records per day
    const daily = await client.query(`
      SELECT DATE(timestamp) as day, COUNT(*) as cnt 
      FROM weather_data 
      GROUP BY DATE(timestamp) 
      ORDER BY day DESC 
      LIMIT 10
    `);
    console.log('\nRecords per day (last 10 days):');
    daily.rows.forEach(r => console.log(`  ${r.day}: ${r.cnt} records`));

    // Check for any records after Feb 3
    const recent = await client.query(
      "SELECT COUNT(*) as cnt FROM weather_data WHERE timestamp > '2026-02-03T12:41:00Z'"
    );
    console.log('\nRecords after 2026-02-03T12:41: ' + recent.rows[0].cnt);

    // Check current time
    console.log('\nCurrent time: ' + new Date().toISOString());
    console.log('48h cutoff: ' + new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
  } finally {
    client.release();
    await pool.end();
  }
}

check().catch(e => console.error('Error:', e.message));
