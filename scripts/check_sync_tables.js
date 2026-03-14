const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(async () => {
  const tables = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('=== ALL TABLES ===');
  tables.rows.forEach(t => console.log('  ' + t.table_name));
  const dropbox = tables.rows.filter(t => t.table_name.includes('dropbox') || t.table_name.includes('sync'));
  console.log('\n=== DROPBOX/SYNC TABLES ===');
  for (const tbl of dropbox) {
    try {
      const rows = await c.query('SELECT * FROM ' + tbl.table_name + ' ORDER BY id');
      console.log('\n' + tbl.table_name + ' (' + rows.rows.length + ' rows):');
      rows.rows.forEach(r => console.log('  ', JSON.stringify(r)));
    } catch(e) { console.log('  Error:', e.message); }
  }
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
