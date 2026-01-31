const initSqlJs = require('/app/node_modules/sql.js');
const fs = require('fs');

async function check() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('/app/data/stratus.db'));
  const result = db.exec("PRAGMA table_info(stations)");
  console.log('Columns:', JSON.stringify(result, null, 2));
  const data = db.exec('SELECT * FROM stations');
  console.log('Data:', JSON.stringify(data, null, 2));
  db.close();
}

check();
