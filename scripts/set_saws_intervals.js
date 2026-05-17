const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Config 41: SAWS Testbed - hourly with TableHour file
  const r1 = await pool.query(
    `UPDATE dropbox_configs SET sync_interval = 3600000, file_pattern = 'Inteltronics_SAWS_TestBed_5263_TableHour.dat'
     WHERE id = 41 RETURNING id, name, file_pattern, sync_interval`
  );
  console.log('Updated 41:', r1.rows);

  // Config 42: SAWS Testbed Solar - every 10 minutes with TableSolarCharger10m file
  const r2 = await pool.query(
    `UPDATE dropbox_configs SET sync_interval = 600000, file_pattern = 'Inteltronics_SAWS_TestBed_5263_TableSolarCharger10m.dat'
     WHERE id = 42 RETURNING id, name, file_pattern, sync_interval`
  );
  console.log('Updated 42:', r2.rows);

  await pool.end();
})();
