const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  // Link config 41 (SAWS Testbed, station 18) to MAIN file
  // Link config 42 (SAWS Testbed Solar, station 19) to SOLAR file
  const r1 = await p.query(
    "UPDATE dropbox_configs SET folder_path=$1, file_pattern=$2 WHERE id=41 RETURNING id,name,folder_path,file_pattern,station_id",
    ['/CAMPBELLSCI/Inteltronics/SAWS TESTBED', 'Inteltronics_SAWS_TestBed_5263_TableHour.dat']
  );
  const r2 = await p.query(
    "UPDATE dropbox_configs SET folder_path=$1, file_pattern=$2 WHERE id=42 RETURNING id,name,folder_path,file_pattern,station_id",
    ['/CAMPBELLSCI/Inteltronics/SAWS TESTBED', 'Inteltronics_SAWS_TestBed_5263_TableSolarCharger10m.dat']
  );
  console.log('Updated 41:', r1.rows);
  console.log('Updated 42:', r2.rows);
  await p.end();
})();
