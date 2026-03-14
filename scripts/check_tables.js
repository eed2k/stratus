const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(async () => {
  // Find all tables
  const tables = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('=== TABLES ===');
  tables.rows.forEach(t => console.log('  ' + t.table_name));
  
  // Check data counts per station
  const counts = await c.query('SELECT station_id, COUNT(*) as cnt, MIN(timestamp) as earliest, MAX(timestamp) as latest FROM weather_data GROUP BY station_id ORDER BY station_id');
  console.log('\n=== DATA COUNTS ===');
  counts.rows.forEach(r => console.log(`  Station ${r.station_id}: ${r.cnt} records | ${r.earliest} to ${r.latest}`));
  
  // Try dropbox tables
  const dropboxTables = tables.rows.filter(t => t.table_name.includes('dropbox') || t.table_name.includes('sync'));
  console.log('\n=== DROPBOX/SYNC TABLES ===');
  dropboxTables.forEach(t => console.log('  ' + t.table_name));
  
  for (const t of dropboxTables) {
    const rows = await c.query(`SELECT * FROM "${t.table_name}" LIMIT 5`);
    console.log(`\n--- ${t.table_name} (${rows.rowCount} rows shown) ---`);
    rows.rows.forEach(r => console.log('  ' + JSON.stringify(r)));
  }
  
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
