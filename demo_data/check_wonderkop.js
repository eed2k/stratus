const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
async function main() {
  // Check the sync config status
  const configs = await p.query("SELECT id, name, last_sync_at, last_sync_status, last_sync_records FROM dropbox_configs WHERE station_id=13");
  console.log('Sync config:', JSON.stringify(configs.rows, null, 2));
  
  // Check if any weather data was imported
  const data = await p.query("SELECT COUNT(*) as count, MIN(timestamp) as first_ts, MAX(timestamp) as last_ts FROM weather_data WHERE station_id=13");
  console.log('Weather data:', JSON.stringify(data.rows[0]));
  
  await p.end();
}
main().catch(e => { console.error(e.message); p.end(); });
