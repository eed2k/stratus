const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // Step 1: Count duplicates
    console.log('Step 1: Counting duplicates...');
    const dupeCount = await client.query(
      "SELECT COUNT(*) as total_dupes FROM (SELECT station_id, timestamp, COUNT(*) as cnt FROM weather_data GROUP BY station_id, timestamp HAVING COUNT(*) > 1) sub"
    );
    console.log('Timestamps with duplicates: ' + dupeCount.rows[0].total_dupes);

    // Step 2: Count how many records to remove
    const toRemove = await client.query(
      "SELECT SUM(cnt - 1) as remove_count FROM (SELECT station_id, timestamp, COUNT(*) as cnt FROM weather_data GROUP BY station_id, timestamp HAVING COUNT(*) > 1) sub"
    );
    console.log('Records to remove: ' + toRemove.rows[0].remove_count);

    // Step 3: Delete duplicates, keeping only the one with the smallest id
    console.log('\nStep 2: Deleting duplicates (keeping smallest id per station_id + timestamp)...');
    const delResult = await client.query(
      "DELETE FROM weather_data WHERE id NOT IN (SELECT MIN(id) FROM weather_data GROUP BY station_id, timestamp)"
    );
    console.log('Deleted ' + delResult.rowCount + ' duplicate records');

    // Step 4: Check remaining count
    const remaining = await client.query('SELECT COUNT(*) as cnt FROM weather_data');
    console.log('Records remaining: ' + remaining.rows[0].cnt);

    // Step 5: Now update table_name
    console.log('\nStep 3: Updating null table_name to Table1...');
    const updateResult = await client.query(
      "UPDATE weather_data SET table_name = 'Table1' WHERE table_name IS NULL"
    );
    console.log('Updated ' + updateResult.rowCount + ' records');

    // Step 6: VACUUM to reclaim space
    // Note: VACUUM can't run inside a transaction
    client.release();
    const client2 = await pool.connect();
    console.log('\nStep 4: Running VACUUM to reclaim space...');
    await client2.query('VACUUM weather_data');
    console.log('VACUUM complete');

    // Step 7: Check final size
    const size = await client2.query("SELECT pg_size_pretty(pg_database_size(current_database())) as db_size");
    console.log('\nFinal database size: ' + size.rows[0].db_size);

    const tableSize = await client2.query("SELECT pg_size_pretty(pg_total_relation_size('weather_data')) as tbl_size");
    console.log('Final weather_data table size: ' + tableSize.rows[0].tbl_size);

    // Step 8: Verify
    const verify = await client2.query(
      'SELECT DISTINCT table_name, COUNT(*) as cnt FROM weather_data GROUP BY table_name'
    );
    console.log('\nTable names after fix:');
    verify.rows.forEach(r => console.log('  ' + r.table_name + ': ' + r.cnt + ' records'));

    // Check daily distribution after cleanup
    const daily = await client2.query(
      "SELECT DATE(timestamp) as day, COUNT(*) as cnt FROM weather_data GROUP BY DATE(timestamp) ORDER BY day"
    );
    console.log('\nDaily distribution after cleanup:');
    daily.rows.forEach(r => console.log('  ' + r.day.toISOString().split('T')[0] + ': ' + r.cnt + ' records'));

    client2.release();
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}

main().catch(e => console.error('Fatal error:', e.message));
