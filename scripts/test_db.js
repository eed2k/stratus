const { Pool } = require('pg');

async function testConnection() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    const result = await pool.query('SELECT 1 as test');
    console.log('Connection successful:', result.rows[0]);
    
    // Check stations
    const stations = await pool.query('SELECT id, name FROM stations LIMIT 5');
    console.log('Stations:', stations.rows);
    
    // Check weather data count
    const count = await pool.query('SELECT COUNT(*) as count FROM weather_data');
    console.log('Weather records:', count.rows[0].count);
    
  } catch (err) {
    console.error('Connection error:', err.message);
  } finally {
    await pool.end();
  }
}

testConnection();
