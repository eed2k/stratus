// Check if dropbox_credentials exist in DB settings, and check current sync service state
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    // Check ALL settings
    const allSettings = await p.query("SELECT key FROM settings");
    console.log('=== All Settings Keys ===');
    allSettings.rows.forEach(r => console.log(' -', r.key));
    
    // Check for dropbox credentials specifically  
    const creds = await p.query("SELECT key, value FROM settings WHERE key = 'dropbox_credentials'");
    console.log('\n=== dropbox_credentials ===');
    if (creds.rows.length === 0) {
      console.log('NOT FOUND - This is the problem!');
    } else {
      const val = creds.rows[0].value;
      const parsed = JSON.parse(val);
      console.log('appKey:', parsed.appKey ? parsed.appKey.substring(0,5)+'...' : 'MISSING');
      console.log('appSecret:', parsed.appSecret ? 'SET' : 'MISSING');
      console.log('refreshToken:', parsed.refreshToken ? parsed.refreshToken.substring(0,10)+'...' : 'MISSING');
    }
    
    // Check env vars
    console.log('\n=== Environment Variables ===');
    console.log('DROPBOX_APP_KEY:', process.env.DROPBOX_APP_KEY || '(empty)');
    console.log('DROPBOX_APP_SECRET:', process.env.DROPBOX_APP_SECRET ? 'SET' : '(empty)');
    console.log('DROPBOX_REFRESH_TOKEN:', process.env.DROPBOX_REFRESH_TOKEN || '(empty)');
    console.log('DROPBOX_FOLDER_PATH:', process.env.DROPBOX_FOLDER_PATH || '(empty)');
    console.log('DROPBOX_STATION_ID:', process.env.DROPBOX_STATION_ID || '(empty)');
    
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    p.end();
  }
}
main();
