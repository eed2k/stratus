/**
 * Update Hopefield station with correct coordinates and Dropbox configuration
 * Hopefield, Western Cape, South Africa
 * 
 * Run this script on the server with:
 * node scripts/update_hopefield_station.js
 */

const Database = require('sql.js');
const fs = require('fs');
const path = require('path');

// Hopefield, Western Cape, South Africa coordinates
const HOPEFIELD_COORDS = {
  latitude: -33.0743,
  longitude: 18.3458,
  altitude: 90, // meters - relatively flat farmland area
  location: 'Hopefield, Western Cape, South Africa',
  timezone: 'Africa/Johannesburg'
};

async function updateStation() {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/stratus.db');
  
  console.log('Loading database from:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    console.error('Database not found at:', dbPath);
    process.exit(1);
  }
  
  const buffer = fs.readFileSync(dbPath);
  const SQL = await Database();
  const db = new SQL.Database(buffer);
  
  // Find the station
  const stations = db.exec('SELECT * FROM weather_stations');
  console.log('Stations found:', stations.length > 0 ? stations[0].values.length : 0);
  
  if (stations.length > 0 && stations[0].values.length > 0) {
    stations[0].values.forEach((row, idx) => {
      const cols = stations[0].columns;
      const station = {};
      cols.forEach((col, i) => station[col] = row[i]);
      console.log(`Station ${idx + 1}:`, JSON.stringify(station, null, 2));
    });
  }
  
  // Update the station with Hopefield coordinates and Dropbox config
  const connectionConfig = JSON.stringify({
    folderPath: '/HOPEFIELD_CR300',
    filePattern: 'HOPEFIELD_CR300*.dat',
    syncInterval: 3600000, // 1 hour
    host: null,
    port: null
  });
  
  const updateQuery = `
    UPDATE weather_stations 
    SET 
      latitude = ?,
      longitude = ?,
      altitude = ?,
      location = ?,
      timezone = ?,
      connection_type = 'http',
      connection_config = ?
    WHERE name = 'HOPEFIELD_CR300' OR name LIKE '%hopefield%' OR name LIKE '%HOPEFIELD%' OR id = 1
  `;
  
  try {
    db.run(updateQuery, [
      HOPEFIELD_COORDS.latitude,
      HOPEFIELD_COORDS.longitude,
      HOPEFIELD_COORDS.altitude,
      HOPEFIELD_COORDS.location,
      HOPEFIELD_COORDS.timezone,
      connectionConfig
    ]);
    
    console.log('Station updated successfully!');
    
    // Verify the update
    const updated = db.exec('SELECT * FROM weather_stations WHERE id = 1');
    if (updated.length > 0 && updated[0].values.length > 0) {
      const cols = updated[0].columns;
      const station = {};
      cols.forEach((col, i) => station[col] = updated[0].values[0][i]);
      console.log('Updated station:', JSON.stringify(station, null, 2));
    }
    
    // Save the database
    const data = db.export();
    const outputBuffer = Buffer.from(data);
    fs.writeFileSync(dbPath, outputBuffer);
    console.log('Database saved to:', dbPath);
    
  } catch (err) {
    console.error('Error updating station:', err);
  }
  
  db.close();
}

updateStation().catch(console.error);
