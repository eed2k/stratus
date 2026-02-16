const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const stations = await p.query('SELECT id, name, connection_type, connection_config FROM stations ORDER BY id');
    console.log('=== STATIONS ===');
    stations.rows.forEach(s => {
      console.log(`  ID:${s.id} Name:"${s.name}" Type:${s.connection_type} Config:${s.connection_config ? JSON.stringify(s.connection_config).substring(0,120) : 'null'}`);
    });

    const configs = await p.query('SELECT id, name, folder_path, file_pattern, station_id, enabled FROM dropbox_configs ORDER BY id');
    console.log('\n=== DROPBOX CONFIGS ===');
    configs.rows.forEach(c => {
      console.log(`  ID:${c.id} Name:"${c.name}" Folder:"${c.folder_path}" Pattern:"${c.file_pattern || '*'}" StationID:${c.station_id} Enabled:${c.enabled}`);
    });
  } catch (e) {
    console.error(e.message);
  }
  await p.end();
}
main();
