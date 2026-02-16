// Delete SAWS TestBed station (ID: 7) and all associated data
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function deleteStation() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Delete weather data
    const data = await client.query('DELETE FROM weather_data WHERE station_id = 7');
    console.log('Deleted weather_data rows:', data.rowCount);
    
    // Delete dropbox configs
    const dbx = await client.query('DELETE FROM dropbox_configs WHERE station_id = 7');
    console.log('Deleted dropbox_configs rows:', dbx.rowCount);
    
    // Delete alarms if any
    try {
      const alarms = await client.query('DELETE FROM alarms WHERE station_id = 7');
      console.log('Deleted alarms rows:', alarms.rowCount);
    } catch(e) { console.log('No alarms table or no rows'); }
    
    // Delete station
    const station = await client.query('DELETE FROM stations WHERE id = 7');
    console.log('Deleted station rows:', station.rowCount);
    
    await client.query('COMMIT');
    console.log('\nSAWS TESTBED 5263 (ID: 7) fully deleted.');
  } catch(e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}
deleteStation();
