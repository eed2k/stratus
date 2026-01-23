const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  const SQL = await initSqlJs();
  const dbPath = '/home/stratus/.local/share/Stratus Weather Server/stratus.db';
  
  if (!fs.existsSync(dbPath)) {
    console.log('Database not found at:', dbPath);
    process.exit(1);
  }
  
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  // Update station name and connection config
  const connectionConfig = JSON.stringify({
    type: 'import-only',
    importSource: 'dropbox',
    folderPath: '/HOPEFIELD_CR300'
  });
  
  db.run('UPDATE weather_stations SET name = ?, connection_config = ? WHERE id = 1', 
    ['HOPEFIELD_CR300', connectionConfig]);
  
  // Verify
  const result = db.exec('SELECT * FROM weather_stations WHERE id = 1');
  console.log('Updated station:', JSON.stringify(result, null, 2));
  
  // Save
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  console.log('Database saved successfully');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
