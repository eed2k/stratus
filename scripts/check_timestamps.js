/**
 * Check Database Timestamps
 * Run this on the server to debug "Last sync: 1d ago" issue
 * Usage: node scripts/check_timestamps.js
 */

require('dotenv').config();
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

function getDbPath() {
  const platform = process.platform;
  let appDataPath;
  
  if (platform === 'win32') {
    appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    appDataPath = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }
  
  return path.join(appDataPath, 'Stratus Weather Server', 'stratus.db');
}

async function checkTimestamps() {
  const dbPath = getDbPath();
  console.log('Database path:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    console.error('Database file not found!');
    return;
  }
  
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);
  
  console.log('\n=== STATIONS ===');
  const stations = db.exec('SELECT id, name, is_active, updated_at FROM stations');
  if (stations.length > 0) {
    console.table(stations[0].values.map(row => ({
      id: row[0],
      name: row[1],
      is_active: row[2],
      updated_at: row[3]
    })));
  }
  
  console.log('\n=== SYNC CONFIGS ===');
  const syncConfigs = db.exec('SELECT station_id, sync_type, last_sync, sync_status FROM sync_configs');
  if (syncConfigs.length > 0) {
    console.table(syncConfigs[0].values.map(row => ({
      station_id: row[0],
      sync_type: row[1],
      last_sync: row[2],
      sync_status: row[3]
    })));
  }
  
  console.log('\n=== WEATHER DATA (Latest 10 records) ===');
  const weatherData = db.exec(`
    SELECT station_id, timestamp, temperature, humidity, wind_speed 
    FROM weather_data 
    ORDER BY timestamp DESC 
    LIMIT 10
  `);
  if (weatherData.length > 0) {
    console.table(weatherData[0].values.map(row => ({
      station_id: row[0],
      timestamp: row[1],
      temperature: row[2],
      humidity: row[3],
      wind_speed: row[4]
    })));
  } else {
    console.log('No weather data found!');
  }
  
  console.log('\n=== WEATHER DATA COUNT BY STATION ===');
  const counts = db.exec(`
    SELECT station_id, COUNT(*) as count, MIN(timestamp) as oldest, MAX(timestamp) as newest
    FROM weather_data
    GROUP BY station_id
  `);
  if (counts.length > 0) {
    console.table(counts[0].values.map(row => ({
      station_id: row[0],
      count: row[1],
      oldest: row[2],
      newest: row[3]
    })));
  }
  
  console.log('\n=== TIME ANALYSIS ===');
  const now = new Date();
  console.log('Current time:', now.toISOString());
  
  if (weatherData.length > 0 && weatherData[0].values.length > 0) {
    const latestTimestamp = new Date(weatherData[0].values[0][1]);
    const diffMinutes = Math.floor((now.getTime() - latestTimestamp.getTime()) / (1000 * 60));
    console.log('Latest data timestamp:', latestTimestamp.toISOString());
    console.log('Time difference:', diffMinutes, 'minutes');
    if (diffMinutes >= 1440) {
      console.log('  -> This explains "1d ago" display!');
    }
  }
  
  db.close();
}

checkTimestamps().catch(console.error);
