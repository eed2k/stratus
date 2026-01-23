const db = require('./dist/server/db.js');

// Initialize the database first (async)
async function main() {
  await db.initDatabase();
  
  // Update the station name and connection config
  db.updateStation(1, { 
    name: 'HOPEFIELD_CR300', 
    connection_config: JSON.stringify({
      type: 'import-only',
      importSource: 'dropbox',
      folderPath: '/HOPEFIELD_CR300'
    }) 
  });
  
  // Verify
  const station = db.getStationById(1);
  console.log('Updated station:', JSON.stringify(station, null, 2));
  
  // Save the changes
  db.saveDatabase();
  console.log('Database saved');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
