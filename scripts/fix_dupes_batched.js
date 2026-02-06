// Batch-delete duplicates from weather_data, one day at a time
// This avoids exceeding Neon's 512MB limit during the transaction
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // Get days sorted by most duplicates first
    const days = await client.query(`
      SELECT DATE(timestamp) as day, COUNT(*) as cnt
      FROM weather_data
      GROUP BY DATE(timestamp)
      ORDER BY cnt DESC
    `);
    console.log('Days in database:');
    days.rows.forEach(r => console.log('  ' + r.day.toISOString().split('T')[0] + ': ' + r.cnt + ' records'));

    let totalDeleted = 0;

    // Process each day individually
    for (const row of days.rows) {
      const day = row.day.toISOString().split('T')[0];
      const count = parseInt(row.cnt);
      
      // Delete duplicates for this day only (keep smallest id per station_id + timestamp)
      const result = await client.query(`
        DELETE FROM weather_data
        WHERE id IN (
          SELECT id FROM weather_data w
          WHERE DATE(timestamp) = $1
            AND id != (
              SELECT MIN(w2.id) FROM weather_data w2
              WHERE w2.station_id = w.station_id
                AND w2.timestamp = w.timestamp
            )
        )
      `, [day]);

      const deleted = result.rowCount;
      totalDeleted += deleted;
      const remaining = count - deleted;
      console.log('Day ' + day + ': deleted ' + deleted + ' dupes, kept ' + remaining + ' records');
    }

    console.log('\nTotal deleted: ' + totalDeleted);

    // Check remaining count
    const remaining = await client.query('SELECT COUNT(*) as cnt FROM weather_data');
    console.log('Total records remaining: ' + remaining.rows[0].cnt);

    // Now update table_name
    console.log('\nUpdating null table_name to Table1...');
    const updateResult = await client.query(
      "UPDATE weather_data SET table_name = 'Table1' WHERE table_name IS NULL"
    );
    console.log('Updated ' + updateResult.rowCount + ' records');

    // Verify table_name
    const verify = await client.query(
      'SELECT DISTINCT table_name, COUNT(*) as cnt FROM weather_data GROUP BY table_name'
    );
    console.log('\nTable names after fix:');
    verify.rows.forEach(r => console.log('  ' + r.table_name + ': ' + r.cnt + ' records'));

    // Release client for VACUUM (can't run in transaction)
    client.release();

    // VACUUM to reclaim disk space
    const client2 = await pool.connect();
    console.log('\nRunning VACUUM FULL to reclaim space...');
    await client2.query('VACUUM FULL weather_data');
    console.log('VACUUM FULL complete');

    const size = await client2.query("SELECT pg_size_pretty(pg_database_size(current_database())) as db_size");
    console.log('Final database size: ' + size.rows[0].db_size);

    const tblSize = await client2.query("SELECT pg_size_pretty(pg_total_relation_size('weather_data')) as tbl_size");
    console.log('Final weather_data size: ' + tblSize.rows[0].tbl_size);

    // Quick API test - what getLatestWeatherData would find
    const latest = await client2.query(
      "SELECT id, timestamp, table_name FROM weather_data WHERE station_id = 1 AND table_name = 'Table1' ORDER BY timestamp DESC LIMIT 1"
    );
    console.log('\nAPI test - latest record for station 1 (Table1):');
    if (latest.rows.length > 0) {
      console.log('  id=' + latest.rows[0].id + ' ts=' + latest.rows[0].timestamp + ' table=' + latest.rows[0].table_name);
      console.log('  SUCCESS - getLatestWeatherData will now return data!');
    } else {
      console.log('  STILL EMPTY - something wrong');
    }

    client2.release();
  } catch (e) {
    console.error('Error:', e.message);
    console.error('Stack:', e.stack);
  } finally {
    await pool.end();
  }
}

main();
