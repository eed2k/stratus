// List all Dropbox folders visible to the app
const { Pool } = require("pg");
const https = require("https");

const p = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // Get Dropbox credentials from settings
  const { rows } = await p.query("SELECT key, value FROM settings WHERE key IN ('dropbox_app_key','dropbox_app_secret','dropbox_refresh_token')");
  const creds = {};
  rows.forEach(r => creds[r.key] = r.value);
  
  if (!creds.dropbox_refresh_token) {
    // Try env vars
    console.log("No DB creds, checking env...");
    console.log("DROPBOX_APP_KEY:", process.env.DROPBOX_APP_KEY ? "set" : "not set");
    console.log("DROPBOX_REFRESH_TOKEN:", process.env.DROPBOX_REFRESH_TOKEN ? "set" : "not set");
  }
  
  // Get access token from refresh token
  const appKey = creds.dropbox_app_key || process.env.DROPBOX_APP_KEY;
  const appSecret = creds.dropbox_app_secret || process.env.DROPBOX_APP_SECRET;
  const refreshToken = creds.dropbox_refresh_token || process.env.DROPBOX_REFRESH_TOKEN;
  
  if (!appKey || !refreshToken) {
    console.error("No Dropbox credentials found");
    process.exit(1);
  }
  
  // Refresh the access token
  const tokenData = await new Promise((resolve, reject) => {
    const postData = `grant_type=refresh_token&refresh_token=${refreshToken}&client_id=${appKey}&client_secret=${appSecret}`;
    const req = https.request({
      hostname: "api.dropboxapi.com",
      path: "/oauth2/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": postData.length }
    }, res => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(JSON.parse(d)));
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
  
  if (!tokenData.access_token) {
    console.error("Token refresh failed:", JSON.stringify(tokenData));
    process.exit(1);
  }
  
  // List all folders recursively
  const listFolder = async (path, accessToken) => {
    const body = JSON.stringify({ path: path || "", recursive: true, limit: 2000 });
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.dropboxapi.com",
        path: "/2/files/list_folder",
        method: "POST",
        headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
      }, res => {
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => resolve(JSON.parse(d)));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  };
  
  const result = await listFolder("", tokenData.access_token);
  
  if (result.error) {
    console.error("Dropbox API error:", JSON.stringify(result));
    process.exit(1);
  }
  
  // Show folders and .dat files
  const entries = result.entries || [];
  const folders = entries.filter(e => e[".tag"] === "folder").map(e => e.path_display).sort();
  const datFiles = entries.filter(e => e[".tag"] === "file" && e.name.endsWith(".dat")).map(e => ({
    path: e.path_display,
    size: e.size,
    modified: e.server_modified
  })).sort((a, b) => a.path.localeCompare(b.path));
  
  console.log("=== FOLDERS ===");
  folders.forEach(f => console.log(f));
  console.log("\n=== .DAT FILES ===");
  datFiles.forEach(f => console.log(`${f.path}  (${(f.size/1024).toFixed(0)} KB, modified: ${f.modified})`));
  
  await p.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
