const{Pool}=require('pg');
const p=new Pool({connectionString:process.env.DATABASE_URL});

async function main() {
  // Create the station
  const stationResult = await p.query(
    `INSERT INTO stations (name, location, latitude, longitude, altitude, station_type, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    ['Glencore Wonderkop', 'Wonderkop, North West, South Africa', '-25.5833', '27.3167', '1200', 'campbell', true]
  );
  const stationId = stationResult.rows[0].id;
  console.log('Created station id:', stationId);

  // Create the Dropbox sync config
  const configResult = await p.query(
    `INSERT INTO dropbox_configs (name, folder_path, file_pattern, station_id, sync_interval, enabled)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    ['Glencore Wonderkop', '/CAMPBELLSCI/Environgaka/GLENCORE WONDERKOP', 'IT_Environgaka_Glencore_Wonderkop_Table1.dat', stationId, 3600000, true]
  );
  console.log('Created dropbox_config id:', configResult.rows[0].id);

  await p.end();
}
main().catch(e => { console.error(e.message); p.end(); });
