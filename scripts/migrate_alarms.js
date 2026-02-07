const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    // Add name and unit columns if they don't exist
    await p.query(`
      ALTER TABLE alarms ADD COLUMN IF NOT EXISTS name TEXT;
      ALTER TABLE alarms ADD COLUMN IF NOT EXISTS unit VARCHAR(20);
    `);
    console.log('Added name and unit columns');

    // Fix existing data: move alarm name from parameter column to name column
    // For existing records, parameter contains the alarm name, not the actual parameter
    const existing = await p.query('SELECT id, parameter FROM alarms WHERE name IS NULL');
    for (const row of existing.rows) {
      // The parameter column currently stores the alarm name
      await p.query('UPDATE alarms SET name = $1, parameter = $2 WHERE id = $3',
        [row.parameter, 'temperature', row.id]);
      console.log(`Fixed alarm ${row.id}: name="${row.parameter}", parameter=temperature`);
    }

    console.log('Migration complete');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    p.end();
  }
}
migrate();
