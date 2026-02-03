const SQL = require("sql.js");
const fs = require("fs");

(async () => {
  const s = await SQL();
  const d = new s.Database(fs.readFileSync("/app/data/stratus.db"));
  
  console.log("=== STATIONS TABLE COLUMNS ===");
  const r = d.exec("SELECT * FROM stations WHERE id = 1");
  if (r[0]) console.log("Columns:", r[0].columns.join(", "));
  
  console.log("\n=== DROPBOX_CONFIGS TABLE COLUMNS ===");
  const dc = d.exec("SELECT * FROM dropbox_configs LIMIT 1");
  if (dc[0]) console.log("Columns:", dc[0].columns.join(", "));
  
  d.close();
})();
