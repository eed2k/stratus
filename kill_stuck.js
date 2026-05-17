const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query(`SELECT pg_terminate_backend(pid), pid FROM pg_stat_activity WHERE datname='neondb' AND pid IN (726, 11437, 11946)`);
    console.log('terminated:', JSON.stringify(r.rows));
    await new Promise(r => setTimeout(r, 2000));
    const r2 = await p.query(`SELECT pid, state, wait_event, left(query,80) q FROM pg_stat_activity WHERE datname='neondb' AND pid<>pg_backend_pid()`);
    console.log('remaining:', JSON.stringify(r2.rows, null, 2));
    await p.end();
  } catch (e) { console.error(e.message); process.exit(1); }
})();
