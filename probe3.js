const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r = await p.query(`SELECT pid, application_name, state, wait_event_type, wait_event, now()-state_change AS dur, left(query,200) q FROM pg_stat_activity WHERE datname='neondb' AND pid<>pg_backend_pid() ORDER BY state_change DESC`);
    console.log(JSON.stringify(r.rows, null, 2));
    const r2 = await p.query(`SELECT relation::regclass, mode, granted, pid FROM pg_locks WHERE NOT granted`);
    console.log('blocked:', JSON.stringify(r2.rows));
    await p.end();
  } catch (e) { console.error(e.message); process.exit(1); }
})();
