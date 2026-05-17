// Trigger immediate sync for configs 41 + 42 and report fresh status
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Force next-cycle pickup by clearing last_sync_at
  await pool.query(`UPDATE dropbox_configs SET last_sync_at = NULL WHERE id IN (41, 42)`);
  console.log('Reset last_sync_at for configs 41, 42');
  const r = await pool.query(`
    SELECT id, name, station_id, file_pattern, sync_interval, enabled,
           last_sync_at, last_sync_status, last_sync_records
    FROM dropbox_configs WHERE id IN (41, 42) ORDER BY id`);
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
})();
