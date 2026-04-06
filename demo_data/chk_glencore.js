const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
async function main(){
  const total=await p.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id=13');
  console.log('Total records:', total.rows[0].cnt);
  
  const range=await p.query('SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest FROM weather_data WHERE station_id=13');
  console.log('Earliest:', range.rows[0].earliest);
  console.log('Latest:', range.rows[0].latest);
  
  const daily=await p.query("SELECT DATE(timestamp) as day, COUNT(*) as cnt FROM weather_data WHERE station_id=13 AND timestamp > NOW() - INTERVAL '31 days' GROUP BY DATE(timestamp) ORDER BY day");
  console.log('\n=== Records per day (last 31 days) ===');
  daily.rows.forEach(r=>console.log(r.day?.toISOString().slice(0,10), r.cnt));
  
  const sync=await p.query('SELECT last_sync_at, last_sync_status, last_sync_records FROM dropbox_configs WHERE station_id=13');
  console.log('\n=== Sync status ===');
  console.log(JSON.stringify(sync.rows[0]));
  
  const sample=await p.query('SELECT timestamp, temperature, humidity, pressure, wind_speed, rainfall, battery_voltage FROM weather_data WHERE station_id=13 ORDER BY timestamp DESC LIMIT 3');
  console.log('\n=== Latest 3 records ===');
  sample.rows.forEach(r=>console.log(JSON.stringify(r)));
  
  await p.end();
}
main().catch(e=>{console.error(e.message);process.exit(1)});
