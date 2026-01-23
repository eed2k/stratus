const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function checkDb() {
  const SQL = await initSqlJs();
  const dbPath = '/home/ubuntu/.local/share/Stratus Weather Server/stratus.db';
  
  if (!fs.existsSync(dbPath)) {
    console.log('Database file not found at:', dbPath);
    return;
  }
  
  const db = new SQL.Database(fs.readFileSync(dbPath));
  
  // List all tables
  console.log('=== ALL TABLES ===');
  const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  if (tablesResult.length > 0) {
    console.log('Tables:', tablesResult[0].values.map(v => v[0]).join(', '));
  }
  
  // Check weather data count
  console.log('\n=== WEATHER DATA ===');
  const countResult = db.exec('SELECT COUNT(*) FROM weather_data');
  console.log('Weather data records:', countResult[0]?.values[0][0] || 0);
  
  // Check latest weather data timestamp
  console.log('\n=== LATEST 5 TIMESTAMPS ===');
  const latestResult = db.exec('SELECT timestamp, station_id FROM weather_data ORDER BY timestamp DESC LIMIT 5');
  if (latestResult[0]?.values) {
    latestResult[0].values.forEach((row, i) => console.log(`${i+1}. ${row[0]} (station ${row[1]})`));
  }
  
  // Check oldest timestamps
  console.log('\n=== OLDEST 5 TIMESTAMPS ===');
  const oldestResult = db.exec('SELECT timestamp, station_id FROM weather_data ORDER BY timestamp ASC LIMIT 5');
  if (oldestResult[0]?.values) {
    oldestResult[0].values.forEach((row, i) => console.log(`${i+1}. ${row[0]} (station ${row[1]})`));
  }
  
  // Check station IDs in weather_data
  console.log('\n=== STATION IDs IN WEATHER DATA ===');
  const stationIdsResult = db.exec('SELECT DISTINCT station_id FROM weather_data');
  if (stationIdsResult[0]?.values) {
    console.log('Station IDs:', stationIdsResult[0].values.map(v => v[0]).join(', '));
  }
  
  // Check dropbox configs (correct table name)
  console.log('\n=== DROPBOX CONFIGS ===');
  try {
    const syncResult = db.exec('SELECT * FROM dropbox_configs');
    if (syncResult[0]?.values) {
      console.log('Columns:', syncResult[0].columns.join(', '));
      syncResult[0].values.forEach((row) => console.log('Row:', row));
    } else {
      console.log('No dropbox configs found');
    }
  } catch (e) {
    console.log('Error reading dropbox_configs:', e.message);
  }
  
  // Check stations table
  console.log('\n=== STATIONS TABLE ===');
  try {
    const stationsResult = db.exec('SELECT * FROM stations');
    if (stationsResult[0]?.values) {
      console.log('Columns:', stationsResult[0].columns.join(', '));
      stationsResult[0].values.forEach((row) => console.log('Station:', row));
    }
  } catch (e) {
    console.log('Error reading stations:', e.message);
  }
  
  db.close();
}

checkDb().catch(console.error);
