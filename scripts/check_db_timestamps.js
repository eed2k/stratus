require('dotenv').config({path: require('path').join(__dirname, '..', '.env')});
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'stratus.db');
console.log('Database path:', dbPath);

async function main() {
  try {
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);
    
    // Check latest timestamps
    console.log('\n=== Latest 5 timestamps ===');
    const rows = db.exec('SELECT timestamp FROM weather_data ORDER BY timestamp DESC LIMIT 5');
    if (rows.length > 0) {
      rows[0].values.forEach(r => console.log(r[0]));
    }
    
    // Check total count
    const count = db.exec('SELECT COUNT(*) as cnt FROM weather_data');
    console.log('\nTotal records:', count[0].values[0][0]);
    
    // Check station ID
    const stations = db.exec('SELECT DISTINCT station_id FROM weather_data');
    console.log('\nStation IDs in data:', stations[0]?.values.map(s => s[0]) || []);
    
    db.close();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
