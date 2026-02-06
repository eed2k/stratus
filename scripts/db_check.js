const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // List all tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('=== TABLES ===');
    console.log(tables.rows.map(r => r.table_name).join(', '));
    
    // Check users
    const users = await pool.query('SELECT id, email, first_name, last_name FROM users');
    console.log('\n=== USERS ===');
    console.log(JSON.stringify(users.rows, null, 2));
    
    // Check stations
    const stations = await pool.query('SELECT id, name, location FROM stations');
    console.log('\n=== STATIONS ===');
    console.log(JSON.stringify(stations.rows, null, 2));
    
    // Check weather data count
    const count = await pool.query('SELECT COUNT(*) as count FROM weather_data');
    console.log('\n=== WEATHER DATA COUNT ===');
    console.log(count.rows[0].count);
    
    // Check settings
    const settings = await pool.query('SELECT * FROM settings');
    console.log('\n=== SETTINGS ===');
    console.log(JSON.stringify(settings.rows, null, 2));
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

main();
