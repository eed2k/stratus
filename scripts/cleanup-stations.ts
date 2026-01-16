/**
 * Database cleanup script - removes duplicate stations and sets up Hopefield properly
 */

import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DB_FILE = 'stratus.db';

function getDbPath(): string {
  const platform = process.platform;
  let appDataPath: string;
  
  if (platform === 'win32') {
    appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    appDataPath = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }
  
  return path.join(appDataPath, 'Stratus Weather Server', DB_FILE);
}

async function cleanupDatabase() {
  const SQL = await initSqlJs();
  const dbPath = getDbPath();
  
  console.log('Database path:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    console.log('Database does not exist, nothing to clean');
    return;
  }
  
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);
  
  // List current stations
  console.log('\n=== Current Stations ===');
  const stations = db.exec('SELECT id, name, connection_type FROM stations ORDER BY id');
  if (stations.length > 0) {
    stations[0].values.forEach((row: any) => {
      console.log(`  ID ${row[0]}: ${row[1]} (${row[2]})`);
    });
  }
  
  // Delete duplicate Hopefield stations (keep lowest ID if any)
  console.log('\n=== Deleting Duplicate Hopefield Stations ===');
  const hopefieldStations = db.exec("SELECT id FROM stations WHERE name LIKE '%Hopefield%' OR name LIKE '%Quaggasklip%' ORDER BY id");
  
  if (hopefieldStations.length > 0 && hopefieldStations[0].values.length > 0) {
    const ids = hopefieldStations[0].values.map((row: any) => row[0]);
    console.log('Found Hopefield station IDs:', ids);
    
    // Delete ALL Hopefield stations (we'll create a fresh one)
    ids.forEach((id: number) => {
      console.log(`Deleting station ID ${id}...`);
      db.run('DELETE FROM weather_data WHERE station_id = ?', [id]);
      db.run('DELETE FROM stations WHERE id = ?', [id]);
    });
  }
  
  // Create new Hopefield station properly configured
  console.log('\n=== Creating Hopefield Station ===');
  
  // Check if exists
  const existing = db.exec("SELECT id FROM stations WHERE name = 'Hopefield Quaggasklip'");
  if (existing.length === 0 || existing[0].values.length === 0) {
    db.run(`
      INSERT INTO stations (
        name, pakbus_address, connection_type, connection_config, 
        is_active, latitude, longitude, altitude, location,
        created_at, updated_at
      ) VALUES (
        'Hopefield Quaggasklip', 990, 'http', '{"importMode": "file"}',
        1, -33.0761, 18.5664, 150, 'Hopefield, Western Cape, South Africa',
        datetime('now'), datetime('now')
      )
    `);
    console.log('Created Hopefield Quaggasklip station');
  } else {
    console.log('Hopefield station already exists');
  }
  
  // List final state
  console.log('\n=== Final Stations ===');
  const finalStations = db.exec('SELECT id, name, connection_type, latitude, longitude FROM stations ORDER BY id');
  if (finalStations.length > 0) {
    finalStations[0].values.forEach((row: any) => {
      console.log(`  ID ${row[0]}: ${row[1]} (${row[2]}) - Lat: ${row[3]}, Lon: ${row[4]}`);
    });
  }
  
  // Save changes
  const data = db.export();
  const dataBuffer = Buffer.from(data);
  fs.writeFileSync(dbPath, dataBuffer);
  
  console.log('\nDatabase updated successfully!');
  db.close();
}

cleanupDatabase().catch(console.error);
