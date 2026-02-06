const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    const users = await client.query('SELECT id, email, name, role FROM users');
    console.log('Users in database:');
    users.rows.forEach(r => console.log('  id=' + r.id + ' email=' + r.email + ' name=' + r.name + ' role=' + r.role));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => console.error(e.message));
