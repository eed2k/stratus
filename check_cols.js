const { Pool } = require('pg');
const p = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Td6bZPiln4SI@ep-delicate-surf-aguhl3up.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require'
});

p.query("SELECT column_name FROM information_schema.columns WHERE table_name='stations' ORDER BY ordinal_position")
  .then(r => {
    console.log('Columns in stations table:');
    r.rows.forEach(x => console.log('  ' + x.column_name));
    console.log('\nTotal:', r.rows.length);
    return p.end();
  })
  .catch(e => {
    console.error('Error:', e.message);
    p.end();
  });
