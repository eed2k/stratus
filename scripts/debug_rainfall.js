const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const stations = await pool.query('SELECT DISTINCT station_id FROM weather_data ORDER BY station_id');
  for (const s of stations.rows) {
    const sid = s.station_id;
    const sample = await pool.query('SELECT data FROM weather_data WHERE station_id = $1 ORDER BY timestamp DESC LIMIT 1', [sid]);
    if (sample.rows.length > 0) {
      const keys = Object.keys(sample.rows[0].data || {}).filter(k => k.toLowerCase().includes('rain') || k.toLowerCase().includes('precip'));
      const count = await pool.query('SELECT COUNT(*) as c FROM weather_data WHERE station_id = $1', [sid]);
      console.log('Station', sid, ':', keys.join(', ') || 'NO RAIN FIELD', '- records:', count.rows[0].c);
    }
  }
  // Now test the actual rainfall yearly query for each station that has rain fields
  console.log('\n--- Yearly rainfall query results ---');
  const rainfallFields = [
    "data->>'Rain_mm_Tot'", "data->>'Rain_Tot'", "data->>'Precip'",
    "data->>'Rain_mm'", "data->>'Precip_Tot'", "data->>'Rain_1_Tot'",
    "data->>'Rain_Tot_1'", "data->>'rainfall'", "data->>'Rain'", "data->>'Rainfall'"
  ];
  const coalesce = rainfallFields.join(', ');
  for (const s of stations.rows) {
    const sid = s.station_id;
    const result = await pool.query(`
      WITH rainfall_readings AS (
        SELECT EXTRACT(YEAR FROM timestamp) AS year,
          COALESCE(${coalesce})::numeric AS rainfall_val
        FROM weather_data WHERE station_id = $1
          AND COALESCE(${coalesce}) IS NOT NULL
      )
      SELECT year, COUNT(*) AS readings,
        COUNT(CASE WHEN rainfall_val > 0 THEN 1 END) AS nonzero_count,
        MAX(rainfall_val) - MIN(rainfall_val) AS range_total,
        SUM(rainfall_val) AS sum_total
      FROM rainfall_readings GROUP BY year
      HAVING COUNT(*) >= 2 ORDER BY year DESC LIMIT 6
    `, [sid]);
    if (result.rows.length > 0) {
      console.log('Station', sid, ':');
      for (const r of result.rows) {
        const nzr = parseInt(r.nonzero_count) / parseInt(r.readings);
        const method = nzr > 0.5 ? 'RANGE' : 'SUM';
        const total = method === 'RANGE' ? parseFloat(r.range_total) : parseFloat(r.sum_total);
        console.log(`  ${r.year}: range=${parseFloat(r.range_total).toFixed(1)} sum=${parseFloat(r.sum_total).toFixed(1)} nzRatio=${nzr.toFixed(2)} -> ${method}: ${total.toFixed(1)}mm (${r.readings} readings)`);
      }
    }
  }
  pool.end();
})();
