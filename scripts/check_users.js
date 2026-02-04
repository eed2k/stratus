const { Pool } = require('pg');
const p = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function checkUsers() {
  try {
    const result = await p.query('SELECT id, email, first_name, role FROM users LIMIT 10');
    console.log('Users in database:');
    result.rows.forEach(u => {
      console.log(`  - ${u.email} (${u.first_name}, ${u.role})`);
    });
    if (result.rows.length === 0) {
      console.log('No users found!');
    }
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await p.end();
  }
}

checkUsers();
