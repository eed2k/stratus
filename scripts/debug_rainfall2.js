const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  // Station 3: check raw rainfall field values
  const s3 = await pool.query(`SELECT data->>'rainfall' as rain, data->>'Rain_mm_Tot' as rmtot, data->>'Rain_Tot' as rtot FROM weather_data WHERE station_id = 3 ORDER BY timestamp DESC LIMIT 10`);
  console.log('Station 3 sample (desc):', s3.rows);
  
  const s3nonnull = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN (data->>'rainfall')::numeric > 0 THEN 1 END) as rain_gt0, COUNT(CASE WHEN data->>'rainfall' IS NOT NULL THEN 1 END) as rain_notnull FROM weather_data WHERE station_id = 3`);
  console.log('Station 3 rainfall stats:', s3nonnull.rows[0]);

  // Check ALL jsonb keys that contain 'rain' for station 3
  const s3keys = await pool.query(`SELECT DISTINCT jsonb_object_keys(data) AS key FROM weather_data WHERE station_id = 3 LIMIT 100`);
  const rainKeys = s3keys.rows.map(r => r.key).filter(k => k.toLowerCase().includes('rain') || k.toLowerCase().includes('precip'));
  console.log('Station 3 rain-like keys:', rainKeys);
  
  // Station 15: check Rain_Tot values pattern  
  const s15 = await pool.query(`SELECT timestamp, (data->>'Rain_Tot')::numeric as rtot, (data->>'rainfall')::numeric as rain FROM weather_data WHERE station_id = 15 AND data->>'Rain_Tot' IS NOT NULL ORDER BY timestamp DESC LIMIT 5`);
  console.log('\nStation 15 recent Rain_Tot:', s15.rows);
  
  const s15old = await pool.query(`SELECT timestamp, (data->>'Rain_Tot')::numeric as rtot, (data->>'rainfall')::numeric as rain FROM weather_data WHERE station_id = 15 AND data->>'Rain_Tot' IS NOT NULL AND EXTRACT(YEAR FROM timestamp) = 2023 ORDER BY timestamp LIMIT 5`);
  console.log('Station 15 first 2023 Rain_Tot:', s15old.rows);
  
  const s15end = await pool.query(`SELECT timestamp, (data->>'Rain_Tot')::numeric as rtot, (data->>'rainfall')::numeric as rain FROM weather_data WHERE station_id = 15 AND data->>'Rain_Tot' IS NOT NULL AND EXTRACT(YEAR FROM timestamp) = 2023 ORDER BY timestamp DESC LIMIT 5`);
  console.log('Station 15 last 2023 Rain_Tot:', s15end.rows);

  // Station 4: check Rain_mm_Tot values pattern
  const s4first = await pool.query(`SELECT timestamp, (data->>'Rain_mm_Tot')::numeric as rmtot, (data->>'rainfall')::numeric as rain FROM weather_data WHERE station_id = 4 AND EXTRACT(YEAR FROM timestamp) = 2026 ORDER BY timestamp LIMIT 5`);
  console.log('\nStation 4 first 2026:', s4first.rows);
  const s4last = await pool.query(`SELECT timestamp, (data->>'Rain_mm_Tot')::numeric as rmtot, (data->>'rainfall')::numeric as rain FROM weather_data WHERE station_id = 4 AND EXTRACT(YEAR FROM timestamp) = 2026 ORDER BY timestamp DESC LIMIT 5`);
  console.log('Station 4 last 2026:', s4last.rows);

  pool.end();
})();
