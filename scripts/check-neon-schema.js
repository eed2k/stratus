const { Pool } = require("pg");

const NEON_URL = "postgresql://neondb_owner:REDACTED_DB_PASSWORD@ep-delicate-surf-aguhl3up-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require";

(async () => {
  const pool = new Pool({ connectionString: NEON_URL });
  
  console.log("=== STATIONS TABLE COLUMNS IN NEON ===");
  const stations = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'stations' ORDER BY ordinal_position");
  console.log("Columns:", stations.rows.map(r => r.column_name).join(", "));
  
  console.log("\n=== DROPBOX_CONFIGS TABLE COLUMNS IN NEON ===");
  const dropbox = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'dropbox_configs' ORDER BY ordinal_position");
  console.log("Columns:", dropbox.rows.map(r => r.column_name).join(", "));
  
  console.log("\n=== USERS TABLE COLUMNS IN NEON ===");
  const users = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position");
  console.log("Columns:", users.rows.map(r => r.column_name).join(", "));
  
  await pool.end();
})();
