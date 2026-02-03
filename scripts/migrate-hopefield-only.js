const initSqlJs = require("sql.js");
const fs = require("fs");
const { Pool } = require("pg");

const NEON_URL = "postgresql://neondb_owner:REDACTED_DB_PASSWORD@ep-delicate-surf-aguhl3up-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const BATCH_SIZE = 5000;

(async () => {
  console.log("=== FRESH START: HOPEFIELD ONLY ===");
  const pool = new Pool({ connectionString: NEON_URL });
  
  console.log("Clearing Neon database...");
  await pool.query("DELETE FROM weather_data").catch(() => {});
  await pool.query("DELETE FROM dropbox_configs").catch(() => {});
  await pool.query("DELETE FROM stations").catch(() => {});
  await pool.query("DELETE FROM users").catch(() => {});
  console.log("Database cleared.");
  
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync("/app/data/stratus.db"));
  
  // Migrate local users
  console.log("Migrating users...");
  const users = db.exec("SELECT id, email, first_name, last_name, password_hash, role, assigned_stations, is_active, last_login_at, created_at, updated_at FROM users");
  if (users[0]) {
    for (const row of users[0].values) {
      await pool.query(
        "INSERT INTO users (id, email, first_name, last_name, password_hash, role, assigned_stations, is_active, last_login_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING",
        row
      ).catch(e => console.log("User insert error:", e.message));
    }
    console.log("Users migrated:", users[0].values.length);
  }
  
  // Migrate HOPEFIELD station - columns match SQLite exactly
  console.log("Migrating HOPEFIELD station...");
  const st = db.exec("SELECT id, name, pakbus_address, connection_type, connection_config, security_code, created_at, updated_at, last_connected, is_active, latitude, longitude, altitude, location, datalogger_model, datalogger_serial_number, program_name, modem_model, modem_serial_number, site_description, notes, station_image FROM stations WHERE id = 1");
  if (st[0] && st[0].values.length > 0) {
    const row = st[0].values[0];
    await pool.query(
      "INSERT INTO stations (id, name, pakbus_address, connection_type, connection_config, security_code, created_at, updated_at, last_connected, is_active, latitude, longitude, altitude, location, datalogger_model, datalogger_serial_number, program_name, modem_model, modem_serial_number, site_description, notes, station_image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) ON CONFLICT (id) DO NOTHING",
      row
    ).catch(e => console.log("Station insert error:", e.message));
    console.log("HOPEFIELD station migrated.");
  }
  
  // Migrate dropbox config
  console.log("Migrating dropbox config...");
  const dc = db.exec("SELECT id, name, folder_path, file_pattern, station_id, sync_interval, enabled, last_sync_at, last_sync_status, last_sync_records, created_at, updated_at FROM dropbox_configs WHERE station_id = 1");
  if (dc[0]) {
    for (const row of dc[0].values) {
      await pool.query(
        "INSERT INTO dropbox_configs (id, name, folder_path, file_pattern, station_id, sync_interval, enabled, last_sync_at, last_sync_status, last_sync_records, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING",
        row
      ).catch(e => console.log("Dropbox config insert error:", e.message));
    }
    console.log("Dropbox config migrated:", dc[0].values.length);
  } else {
    console.log("No dropbox config found for HOPEFIELD");
  }
  
  const countRes = db.exec("SELECT COUNT(*) FROM weather_data WHERE station_id = 1");
  const totalRecords = countRes[0].values[0][0];
  console.log("HOPEFIELD weather records to migrate:", totalRecords);
  
  let offset = 0, migrated = 0;
  const startTime = Date.now();
  
  while (offset < totalRecords) {
    const batch = db.exec("SELECT id, station_id, timestamp, data FROM weather_data WHERE station_id = 1 ORDER BY id LIMIT " + BATCH_SIZE + " OFFSET " + offset);
    if (!batch[0] || batch[0].values.length === 0) break;
    
    const values = [];
    const params = [];
    let pi = 1;
    for (const row of batch[0].values) {
      values.push("($" + pi + ", $" + (pi+1) + ", $" + (pi+2) + ", $" + (pi+3) + ")");
      params.push(row[0], row[1], row[2], row[3]);
      pi += 4;
    }
    
    await pool.query("INSERT INTO weather_data (id, station_id, timestamp, data) VALUES " + values.join(", ") + " ON CONFLICT (id) DO NOTHING", params);
    
    migrated += batch[0].values.length;
    offset += BATCH_SIZE;
    
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = migrated / elapsed;
    const remaining = (totalRecords - migrated) / rate;
    console.log("Progress:", migrated, "/", totalRecords, "(" + Math.round(migrated/totalRecords*100) + "%) - ETA:", Math.round(remaining), "sec");
  }
  
  console.log("");
  console.log("=== MIGRATION COMPLETE ===");
  console.log("Total records migrated:", migrated);
  console.log("Time:", Math.round((Date.now() - startTime) / 1000), "seconds");
  
  db.close();
  await pool.end();
})();
