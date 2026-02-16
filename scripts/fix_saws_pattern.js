const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Update the file pattern to use wildcard matching
    const result = await p.query(
      "UPDATE dropbox_configs SET file_pattern = 'Inteltronics_SAWS_TestBed_5263_*' WHERE station_id = 7 RETURNING id, name, file_pattern"
    );
    console.log('Updated:', JSON.stringify(result.rows));
    
    // Verify all configs
    const configs = await p.query('SELECT id, name, folder_path, file_pattern, station_id, enabled FROM dropbox_configs ORDER BY id');
    console.log('\n=== ALL DROPBOX CONFIGS ===');
    configs.rows.forEach(c => {
      console.log(`  ID:${c.id} Name:"${c.name}" Folder:"${c.folder_path}" Pattern:"${c.file_pattern}" StationID:${c.station_id} Enabled:${c.enabled}`);
    });
  } catch (e) {
    console.error('Error:', e.message);
  }
  await p.end();
}
main();
