const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const fields = ['Rain_mm','Rain_Tot','Precip','Rain_mm_Tot','Rain_Tot_Tot','Rainfall','Precip_Tot','Rain_1_Tot','Rain_Tot_1','Rain_2_Tot'];
  const coalesce = fields.map(f => `(data->>'${f}')::numeric`).join(', ');
  const r = await pool.query(`
    WITH vals AS (
      SELECT timestamp, COALESCE(${coalesce}) AS v
      FROM weather_data WHERE station_id = 1
    )
    SELECT date_trunc('year', timestamp AT TIME ZONE 'Africa/Johannesburg') AS yr,
           COUNT(*) AS n,
           SUM(CASE WHEN v IS NOT NULL THEN v END) AS sum_all,
           SUM(CASE WHEN v > 0 AND v < 100 THEN v END) AS sum_clamped,
           MIN(v) AS minv, MAX(v) AS maxv
    FROM vals GROUP BY 1 ORDER BY 1 DESC LIMIT 4`);
  console.log('Quaggasklip station 1 yearly rainfall:');
  for (const row of r.rows) {
    console.log('  ' + row.yr.toISOString().slice(0,10) + '  n=' + row.n + '  sum_all=' + row.sum_all + '  sum_clamped=' + row.sum_clamped + '  min=' + row.minv + '  max=' + row.maxv);
  }
  const neg = await pool.query(`
    WITH vals AS (
      SELECT station_id, timestamp, COALESCE(${coalesce}) AS v FROM weather_data
    )
    SELECT station_id, COUNT(*) AS bad
    FROM vals WHERE v < 0 GROUP BY station_id ORDER BY 1`);
  console.log('\nRemaining negative rainfall rows by station:');
  if (neg.rows.length === 0) console.log('  NONE ✓');
  else for (const row of neg.rows) console.log('  station=' + row.station_id + '  bad=' + row.bad);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
