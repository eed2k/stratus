// Check SAWS TestBed station records
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  try {
    // Total records
    const total = await pool.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = 7');
    console.log('Total SAWS records:', total.rows[0].cnt);

    // Records by table
    const byTable = await pool.query(
      "SELECT table_name, COUNT(*) as cnt FROM weather_data WHERE station_id = 7 GROUP BY table_name ORDER BY cnt DESC"
    );
    console.log('\nRecords by table:');
    byTable.rows.forEach(r => console.log(`  ${r.table_name}: ${r.cnt}`));

    // Date range
    const range = await pool.query(
      'SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM weather_data WHERE station_id = 7'
    );
    console.log('\nDate range:', range.rows[0].earliest, 'to', range.rows[0].latest);

    // Station info
    const station = await pool.query('SELECT id, name, connection_type, is_active FROM stations WHERE id = 7');
    console.log('\nStation:', JSON.stringify(station.rows[0]));

    // Dropbox config
    const config = await pool.query('SELECT * FROM dropbox_configs WHERE station_id = 7');
    console.log('Dropbox config:', JSON.stringify(config.rows[0]));

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
}
check();
