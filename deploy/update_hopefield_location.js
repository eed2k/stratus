/**
 * Update Hopefield station with coordinates
 * Uses sql.js like the main application
 * Run from /app directory: node /tmp/update_hopefield_location.js
 */
const initSqlJs = require('/app/node_modules/sql.js');
const fs = require('fs');

const DB_PATH = '/app/data/stratus.db';

async function updateStation() {
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  // Update station with coordinates
  db.run(`
    UPDATE stations 
    SET latitude = -33.0743, 
        longitude = 18.3458, 
        altitude = 90, 
        location = 'Hopefield, Western Cape, South Africa'
    WHERE id = 1
  `);

  // Verify the update
  const result = db.exec('SELECT id, name, latitude, longitude, altitude, location FROM stations WHERE id = 1');
  console.log('Station data:', JSON.stringify(result, null, 2));

  // Save the database
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  console.log('Database saved successfully');
  
  db.close();
}

updateStation().catch(console.error);
