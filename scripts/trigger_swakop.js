// Trigger Dropbox sync via API and monitor progress
// Run on VPS: docker exec -w /app stratus-app node trigger_swakop.js

const http = require('http');
const pg = require('pg');

function apiCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: 5000,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const c = new pg.Client(process.env.DATABASE_URL);
  await c.connect();
  
  const before = await c.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = 15');
  console.log('Station 15 records before sync:', before.rows[0].cnt);
  
  console.log('Triggering Dropbox sync...');
  try {
    const result = await apiCall('POST', '/api/dropbox-sync/trigger', {});
    console.log('Sync trigger result:', typeof result === 'string' ? result : JSON.stringify(result));
  } catch(e) {
    console.log('Trigger error:', e.message);
  }
  
  // Monitor progress every 30s for up to 30 minutes
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 30000));
    const count = await c.query('SELECT COUNT(*) as cnt FROM weather_data WHERE station_id = 15');
    const syncCfg = await c.query('SELECT last_sync_at, last_sync_status, last_sync_records FROM dropbox_configs WHERE station_id = 15');
    const cfg = syncCfg.rows[0] || {};
    console.log('[' + new Date().toISOString() + '] Records: ' + count.rows[0].cnt + ' | lastSync: ' + cfg.last_sync_at + ' | status: ' + cfg.last_sync_status);
    if (cfg.last_sync_at) {
      console.log('Sync completed!');
      break;
    }
  }
  
  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
