const { Pool } = require('pg');
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function main() {
  try {
    // Check if shares table exists
    const cols = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'shares' ORDER BY ordinal_position"
    );
    console.log('Shares table columns:', JSON.stringify(cols.rows));
    
    // Check existing shares
    const shares = await pool.query('SELECT * FROM shares LIMIT 5');
    console.log('Existing shares:', JSON.stringify(shares.rows));
    
    // Try to insert a test share
    const token = 'test_' + Date.now();
    await pool.query(
      `INSERT INTO shares (station_id, share_token, name, access_level, is_active, access_count, created_by) 
       VALUES (15, $1, 'Test Share', 'viewer', true, 0, 'admin')`,
      [token]
    );
    console.log('Test share created with token:', token);
    
    // Verify it was inserted
    const verify = await pool.query('SELECT * FROM shares WHERE share_token = $1', [token]);
    console.log('Verified:', JSON.stringify(verify.rows));
    
    // Clean up test
    await pool.query('DELETE FROM shares WHERE share_token = $1', [token]);
    console.log('Test share cleaned up');
    
  } catch (err) {
    console.log('ERROR:', err.message);
    console.log('STACK:', err.stack);
  } finally {
    await pool.end();
  }
}

main();
