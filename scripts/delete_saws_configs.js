const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await p.query("DELETE FROM dropbox_configs WHERE id IN (39, 40) RETURNING id, name");
  console.log('Deleted:', r.rows);
  await p.end();
})();
