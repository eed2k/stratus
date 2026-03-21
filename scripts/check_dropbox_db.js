const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Check settings table for dropbox credentials
    const settings = await p.query("SELECT key, value FROM settings WHERE key LIKE '%dropbox%'");
    console.log('=== Dropbox Settings ===');
    if (settings.rows.length === 0) {
      console.log('No dropbox settings found in DB');
    } else {
      settings.rows.forEach(x => {
        const v = x.value ? x.value.substring(0, 50) + '...' : '(empty)';
        console.log(x.key, '=', v);
      });
    }

    // Check dropbox_configs table
    const configs = await p.query("SELECT * FROM dropbox_configs");
    console.log('\n=== Dropbox Configs ===');
    if (configs.rows.length === 0) {
      console.log('No dropbox configs found');
    } else {
      configs.rows.forEach(c => {
        console.log(JSON.stringify(c, null, 2));
      });
    }

    // Check station connection types
    const stations = await p.query("SELECT id, name, connection_type FROM stations");
    console.log('\n=== Stations ===');
    stations.rows.forEach(s => console.log(`Station ${s.id}: ${s.name} (${s.connection_type})`));
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    p.end();
  }
}
main();
