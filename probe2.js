const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  try {
    const r1 = await p.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='shares'");
    console.log('cols:', r1.rows.map(r => r.column_name).join(','));
    const r2 = await p.query("SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.shares'::regclass");
    console.log('constraints:', JSON.stringify(r2.rows));
    const r3 = await p.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='shares'");
    console.log('indexes:', r3.rows.map(r => r.indexname).join(','));

    console.log('--- now testing slug migration ---');
    const t = Date.now();
    await p.query(`DO $$ BEGIN ALTER TABLE shares ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`);
    console.log('slug DO block ms=' + (Date.now() - t));

    console.log('--- now testing alarms CREATE ---');
    const t2 = Date.now();
    await p.query(`CREATE TABLE IF NOT EXISTS alarms (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      name TEXT,
      parameter TEXT NOT NULL,
      condition TEXT NOT NULL,
      threshold REAL NOT NULL,
      stale_minutes INTEGER,
      unit VARCHAR(20) DEFAULT '',
      severity TEXT DEFAULT 'warning',
      enabled BOOLEAN DEFAULT true,
      email_notifications BOOLEAN DEFAULT false,
      email_recipients TEXT,
      last_triggered_at TIMESTAMP,
      trigger_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log('alarms CREATE ms=' + (Date.now() - t2));

    await p.end();
  } catch (e) {
    console.error('ERR', e.code, e.message);
    process.exit(1);
  }
})();
