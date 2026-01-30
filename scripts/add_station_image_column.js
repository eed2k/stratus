const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function addStationImageColumn() {
  try {
    const dbPath = process.env.DATABASE_PATH || '/app/data/stratus.db';
    console.log('Database path:', dbPath);
    
    const SQL = await initSqlJs();
    
    if (!fs.existsSync(dbPath)) {
      console.log('Database file not found at', dbPath);
      return;
    }
    
    const data = fs.readFileSync(dbPath);
    const db = new SQL.Database(data);
    
    // Check if column exists
    const tableInfo = db.exec("PRAGMA table_info(stations)");
    const columns = tableInfo[0]?.values.map(row => row[1]) || [];
    
    if (columns.includes('station_image')) {
      console.log('station_image column already exists');
    } else {
      console.log('Adding station_image column...');
      db.run('ALTER TABLE stations ADD COLUMN station_image TEXT');
      const newData = db.export();
      fs.writeFileSync(dbPath, Buffer.from(newData));
      console.log('station_image column added successfully!');
    }
    
    db.close();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

addStationImageColumn();
