const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const stations = await p.query('SELECT id, name, connection_type FROM stations ORDER BY id');
    console.log('=== All Stations ===');
    stations.rows.forEach(s => console.log(`  ID ${s.id}: ${s.name} (${s.connection_type})`));
    
    // Check if station 8 (HOPEFIELD CR300) exists and has any data
    const check8 = await p.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = 8');
    console.log('\nStation 8 data count:', check8.rows[0].cnt);
    
    // Delete station 8 if it exists and has no important data
    if (stations.rows.some(s => s.id === 8)) {
      const count = parseInt(check8.rows[0].cnt);
      if (count === 0) {
        await p.query('DELETE FROM weather_data WHERE station_id = 8');
        await p.query('DELETE FROM dropbox_configs WHERE station_id = 8');
        await p.query('DELETE FROM stations WHERE id = 8');
        console.log('Deleted duplicate station 8 (HOPEFIELD CR300)');
      } else {
        console.log(`Station 8 has ${count} records - NOT deleting automatically`);
      }
    }
    
    // Verify final state
    const final = await p.query('SELECT id, name FROM stations ORDER BY id');
    console.log('\n=== Final Stations ===');
    final.rows.forEach(s => console.log(`  ID ${s.id}: ${s.name}`));
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    p.end();
  }
}
main();
