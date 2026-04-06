const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});
async function main(){
  // Get actual column names
  const cols=await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='weather_data' ORDER BY ordinal_position");
  console.log('=== COLUMNS ===');
  cols.rows.forEach(r=>console.log(r.column_name));
  
  // Sample latest records with all fields
  const sample=await p.query('SELECT * FROM weather_data WHERE station_id=13 ORDER BY timestamp DESC LIMIT 2');
  console.log('\n=== Latest 2 records (all fields) ===');
  sample.rows.forEach(r=>{
    const nonNull = {};
    for(const[k,v] of Object.entries(r)){
      if(v !== null && v !== undefined) nonNull[k]=v;
    }
    console.log(JSON.stringify(nonNull));
  });
  
  await p.end();
}
main().catch(e=>{console.error(e.message);process.exit(1)});
