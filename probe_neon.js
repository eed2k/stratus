const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const t0 = Date.now();
  try {
    console.log('connecting...');
    const r1 = await p.query("SELECT current_database(), current_user");
    console.log('whoami:', r1.rows[0], 'ms=' + (Date.now() - t0));
    const t1 = Date.now();
    const r2 = await p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    console.log('tables:', r2.rows.map(r => r.tablename).join(','), 'ms=' + (Date.now() - t1));
    const t2 = Date.now();
    await p.query(`CREATE TABLE IF NOT EXISTS shares (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      share_token TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE,
      name TEXT DEFAULT 'Shared Dashboard',
      email TEXT,
      access_level TEXT DEFAULT 'viewer',
      password TEXT,
      expires_at TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      last_accessed_at TIMESTAMP,
      access_count INTEGER DEFAULT 0,
      created_by TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('shares CREATE OK ms=' + (Date.now() - t2));
    const t3 = Date.now();
    await p.query(`DO $$ BEGIN ALTER TABLE shares ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
    console.log('shares slug migrate OK ms=' + (Date.now() - t3));
    await p.end();
    console.log('done ms=' + (Date.now() - t0));
  } catch (e) {
    console.error('ERR', e.code, e.message);
    process.exit(1);
  }
})();
