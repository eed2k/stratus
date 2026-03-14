const pg = require("pg");
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
p.query("SELECT data->>'rainfall' as rainfall, timestamp FROM weather_data WHERE station_id = 2 ORDER BY timestamp DESC LIMIT 5")
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); p.end(); })
  .catch(e => { console.error(e.message); p.end(); });
