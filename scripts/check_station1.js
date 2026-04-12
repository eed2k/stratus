const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // First find the right table names
    const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    console.log('TABLES:', tables.rows.map(r => r.table_name).join(', '));

    // Try to query stations
    const s = await pool.query('SELECT * FROM stations WHERE id = 1');
    console.log('STATION:', JSON.stringify(s.rows[0], null, 2));
  } catch (e) {
    console.log('Error with stations table:', e.message);
    try {
      // Try weather_stations with search_path
      await pool.query("SET search_path TO public");
      const t = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      console.log('PG_TABLES:', t.rows.map(r => r.tablename).join(', '));
    } catch (e2) {
      console.log('Error2:', e2.message);
    }
  } finally {
    pool.end();
  }
})();
