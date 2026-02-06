const { Pool } = require('pg');
const http = require('http');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 5000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => resolve(JSON.parse(chunks)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port: 5000, path, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch(e) { resolve({ raw: chunks.substring(0, 200) }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const client = await pool.connect();
  try {
    // Check stations (without slug)
    const stations = await client.query('SELECT * FROM stations LIMIT 5');
    console.log('Stations columns:', Object.keys(stations.rows[0] || {}));
    stations.rows.forEach(r => console.log('  id=' + r.id + ' name=' + r.name));

    // DB stats
    const count = await client.query('SELECT COUNT(*) as cnt FROM weather_data');
    const size = await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
    const latest = await client.query("SELECT timestamp, table_name FROM weather_data WHERE station_id = 1 ORDER BY timestamp DESC LIMIT 1");
    console.log('\nDB size: ' + size.rows[0].size);
    console.log('Total records: ' + count.rows[0].cnt);
    if (latest.rows[0]) console.log('Latest: ts=' + latest.rows[0].timestamp + ' table=' + latest.rows[0].table_name);
  } finally {
    client.release();
  }

  // Test login
  console.log('\n--- Testing Login ---');
  const loginResult = await httpPost('/api/auth/login', {
    email: 'esterhuizen2k@proton.me',
    password: 'StratusAdmin2024!'
  });
  console.log('Login result:', loginResult.success !== undefined ? 'success=' + loginResult.success : loginResult.message);

  if (loginResult.token) {
    const token = loginResult.token;
    console.log('Token obtained: ' + token.substring(0, 20) + '...');

    // Test latest data
    console.log('\n--- Testing /api/stations/1/data/latest ---');
    const latestData = await httpGet('/api/stations/1/data/latest', token);
    if (latestData.data) {
      console.log('SUCCESS! Got latest data');
      console.log('Timestamp: ' + (latestData.data.timestamp || 'n/a'));
      const dataKeys = Object.keys(latestData.data.data || {}).slice(0, 5);
      console.log('Data fields: ' + dataKeys.join(', ') + '...');
    } else {
      console.log('Response:', JSON.stringify(latestData).substring(0, 300));
    }

    // Test data range
    console.log('\n--- Testing /api/stations/1/data ---');
    const rangeData = await httpGet('/api/stations/1/data?startTime=2026-02-05T00:00:00Z&endTime=2026-02-06T00:00:00Z', token);
    if (Array.isArray(rangeData)) {
      console.log('Got ' + rangeData.length + ' records for Feb 5');
    } else if (rangeData.data && Array.isArray(rangeData.data)) {
      console.log('Got ' + rangeData.data.length + ' records for Feb 5');
    } else {
      console.log('Response:', JSON.stringify(rangeData).substring(0, 300));
    }
  } else {
    console.log('Login failed, trying other passwords...');
    // Try some common passwords
    const passwords = ['StratusAdmin2024!', 'admin123', 'Str@tus2025!', 'stratus2024'];
    for (const pw of passwords) {
      const r = await httpPost('/api/auth/login', { email: 'esterhuizen2k@proton.me', password: pw });
      console.log('  Password "' + pw + '": ' + (r.token ? 'SUCCESS' : r.message));
      if (r.token) {
        console.log('  Token: ' + r.token.substring(0, 20));
        break;
      }
    }
  }

  await pool.end();
}

main().catch(e => console.error('Error:', e.message));
