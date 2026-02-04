const { Pool } = require('pg');
const p = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function check() {
  try {
    // Check all tables
    const tables = await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tables:', tables.rows.map(r => r.table_name));
    
    // Check if password_reset_tokens table exists
    const prt = tables.rows.find(r => r.table_name === 'password_reset_tokens');
    console.log('password_reset_tokens exists:', !!prt);
    
    // Check if user_invitation_tokens table exists
    const uit = tables.rows.find(r => r.table_name === 'user_invitation_tokens');
    console.log('user_invitation_tokens exists:', !!uit);
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await p.end();
  }
}

check();
