const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  try {
    // Create settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Settings table created');

    // Create user_preferences table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        temperature_unit TEXT DEFAULT 'celsius',
        wind_speed_unit TEXT DEFAULT 'ms',
        pressure_unit TEXT DEFAULT 'hpa',
        precipitation_unit TEXT DEFAULT 'mm',
        theme TEXT DEFAULT 'system',
        email_notifications BOOLEAN DEFAULT true,
        push_notifications BOOLEAN DEFAULT false,
        temp_high_alert REAL DEFAULT 35,
        wind_high_alert REAL DEFAULT 50,
        units TEXT DEFAULT 'metric',
        timezone TEXT DEFAULT 'auto',
        server_address TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('User preferences table created');

    // Set server address
    await pool.query(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES ('serverAddress', 'https://stratusweather.co.za', CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = 'https://stratusweather.co.za', updated_at = CURRENT_TIMESTAMP
    `);
    console.log('Server address set to https://stratusweather.co.za');

    // Check tables
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('\n=== TABLES ===');
    console.log(tables.rows.map(r => r.table_name).join(', '));

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
