const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    // List users
    const users = await client.query('SELECT id, email, first_name, last_name, role, is_active FROM users');
    console.log('Users in database:');
    users.rows.forEach(r => console.log('  id=' + r.id + ' email=' + r.email + ' first=' + r.first_name + ' last=' + r.last_name + ' role=' + r.role + ' active=' + r.is_active));

    // List stations
    const stations = await client.query('SELECT id, name, slug, is_active FROM stations');
    console.log('\nStations in database:');
    stations.rows.forEach(r => console.log('  id=' + r.id + ' name=' + r.name + ' slug=' + r.slug + ' active=' + r.is_active));

    // Quick data check
    const latest = await client.query("SELECT id, timestamp, table_name FROM weather_data WHERE station_id = 1 AND table_name = 'Table1' ORDER BY timestamp DESC LIMIT 3");
    console.log('\nLatest 3 records (station 1, Table1):');
    latest.rows.forEach(r => console.log('  id=' + r.id + ' ts=' + r.timestamp + ' table=' + r.table_name));

    // DB size
    const size = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
    console.log('\nDB size: ' + size.rows[0].size);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error('Error:', e.message));
