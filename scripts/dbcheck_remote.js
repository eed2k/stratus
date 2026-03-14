const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const cols = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'weather_data' ORDER BY ordinal_position"
    );
    console.log('Columns:', cols.rows.map(r => r.column_name).join(', '));

    const stations = await pool.query('SELECT id, name FROM stations');
    const endTime = new Date();
    const start31d = new Date(endTime.getTime() - 31 * 24 * 60 * 60 * 1000);
    const start7d = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);

    for (const s of stations.rows) {
      const r31 = await pool.query(
        "SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp <= $3",
        [s.id, start31d, endTime]
      );
      const r7 = await pool.query(
        "SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp <= $3",
        [s.id, start7d, endTime]
      );
      console.log(s.name, '(id=' + s.id + '): 31d=' + r31.rows[0].cnt + ', 7d=' + r7.rows[0].cnt);
    }

    // Also test what the getWeatherData function would return for station 1, 31d
    const stationId = stations.rows[0].id;
    console.log('\nTesting full query for station', stationId, 'over 31d...');
    const fullData = await pool.query(
      "SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp ASC",
      [stationId, start31d, endTime]
    );
    console.log('Full query returns:', fullData.rows[0].cnt, 'records');

    await pool.end();
  } catch(e) { 
    console.error('Error:', e.message); 
    process.exit(1); 
  }
})();
