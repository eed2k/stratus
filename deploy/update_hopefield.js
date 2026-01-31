const initSqlJs = require('/app/node_modules/sql.js');
const fs = require('fs');
const path = '/app/data/stratus.db';

async function updateHopefield() {
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(path);
  const db = new SQL.Database(fileBuffer);
  
  // Update Hopefield station with coordinates
  db.run('UPDATE stations SET latitude = -33.0743, longitude = 18.3458, altitude = 90 WHERE name LIKE ?', ['%Hopefield%']);
  
  // Verify the update
  const result = db.exec("SELECT id, name, latitude, longitude, altitude FROM stations WHERE name LIKE '%Hopefield%'");
  console.log('Updated Hopefield station:', JSON.stringify(result, null, 2));
  
  // Save the database
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(path, buffer);
  console.log('Database saved successfully');
  
  db.close();
}

updateHopefield().catch(console.error);
