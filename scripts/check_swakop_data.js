/**
 * Debug script to check Swakop Uranium station data parsing
 * Run with: node scripts/check_swakop_data.js
 */

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:5000';

function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': 'esterhuizen2k@proton.me'
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Checking Swakop Uranium Station Setup ===\n');
  
  // 1. Get all stations
  console.log('1. Fetching stations...');
  const stationsRes = await makeRequest('/api/stations');
  if (stationsRes.status !== 200) {
    console.error('Failed to get stations:', stationsRes.data);
    return;
  }
  
  const stations = stationsRes.data;
  console.log(`   Found ${stations.length} stations:`);
  stations.forEach(s => {
    console.log(`   - ID ${s.id}: ${s.name} (active: ${s.isActive})`);
  });
  
  // Find Swakop station
  const swakop = stations.find(s => s.name.toLowerCase().includes('swakop') || s.name.toLowerCase().includes('uranium'));
  if (!swakop) {
    console.log('\n   WARNING: No Swakop/Uranium station found!');
    console.log('   Available stations:', stations.map(s => s.name).join(', '));
    return;
  }
  
  console.log(`\n2. Swakop station details:`);
  console.log(`   ID: ${swakop.id}`);
  console.log(`   Name: ${swakop.name}`);
  console.log(`   Active: ${swakop.isActive}`);
  console.log(`   Location: ${swakop.location || 'Not set'}`);
  console.log(`   Coordinates: ${swakop.latitude}, ${swakop.longitude}`);
  console.log(`   Connection: ${swakop.connectionType}`);
  
  // 3. Check Dropbox configs
  console.log('\n3. Checking Dropbox sync configurations...');
  const configsRes = await makeRequest('/api/dropbox-sync/configs');
  if (configsRes.status === 200) {
    const configs = configsRes.data;
    console.log(`   Found ${configs.length} Dropbox configs:`);
    configs.forEach(c => {
      console.log(`   - "${c.name}" → Station ID ${c.stationId}, Folder: ${c.folderPath}`);
      console.log(`     Pattern: ${c.filePattern || '(all .dat files)'}, Enabled: ${c.enabled}`);
      console.log(`     Last sync: ${c.lastSyncAt || 'Never'}, Status: ${c.lastSyncStatus || 'N/A'}`);
    });
    
    const swakopConfig = configs.find(c => c.stationId === swakop.id);
    if (!swakopConfig) {
      console.log(`\n   WARNING: No Dropbox config linked to Swakop station (ID ${swakop.id})!`);
    }
  }
  
  // 4. Check latest weather data
  console.log(`\n4. Checking latest weather data for station ${swakop.id}...`);
  const dataRes = await makeRequest(`/api/stations/${swakop.id}/data/latest`);
  if (dataRes.status === 200 && dataRes.data) {
    const data = dataRes.data;
    console.log(`   Timestamp: ${data.timestamp}`);
    console.log(`   Record #: ${data.recordNumber}`);
    console.log('   Available fields in raw data:');
    
    // Show all raw data fields
    if (data.data && typeof data.data === 'object') {
      const rawFields = Object.keys(data.data);
      console.log(`   Raw fields (${rawFields.length}): ${rawFields.join(', ')}`);
      
      // Check for temperature-related fields
      const tempFields = rawFields.filter(f => 
        f.toLowerCase().includes('temp') || 
        f.toLowerCase().includes('air') ||
        f.toLowerCase().includes('tc')
      );
      console.log(`\n   Temperature-related fields: ${tempFields.length > 0 ? tempFields.join(', ') : 'NONE FOUND'}`);
      
      // Check for rainfall-related fields
      const rainFields = rawFields.filter(f => 
        f.toLowerCase().includes('rain') || 
        f.toLowerCase().includes('precip') ||
        f.toLowerCase().includes('prcp')
      );
      console.log(`   Rainfall-related fields: ${rainFields.length > 0 ? rainFields.join(', ') : 'NONE FOUND'}`);
      
      // Show values for key fields
      console.log('\n   Key field values:');
      tempFields.forEach(f => console.log(`   - ${f}: ${data.data[f]}`));
      rainFields.forEach(f => console.log(`   - ${f}: ${data.data[f]}`));
    }
    
    // Check mapped fields
    console.log('\n   Mapped standard fields:');
    const standardFields = ['temperature', 'humidity', 'pressure', 'windSpeed', 'windDirection', 
                           'windGust', 'solarRadiation', 'rainfall', 'batteryVoltage'];
    standardFields.forEach(f => {
      const value = data[f];
      console.log(`   - ${f}: ${value !== null && value !== undefined ? value : 'NULL/missing'}`);
    });
  } else {
    console.log('   No weather data found for this station!');
  }
  
  // 5. Check data count
  console.log(`\n5. Checking data record count...`);
  const historyRes = await makeRequest(`/api/stations/${swakop.id}/data?limit=10`);
  if (historyRes.status === 200 && historyRes.data) {
    console.log(`   Found ${historyRes.data.length} records (showing last 10)`);
    if (historyRes.data.length > 0) {
      console.log(`   Oldest shown: ${historyRes.data[historyRes.data.length - 1]?.timestamp}`);
      console.log(`   Newest shown: ${historyRes.data[0]?.timestamp}`);
    }
  }
  
  // 6. Trigger a sync
  console.log('\n6. Triggering Dropbox sync...');
  const syncRes = await makeRequest('/api/dropbox-sync/sync', 'POST', {});
  console.log(`   Sync status: ${syncRes.status}`);
  console.log(`   Response:`, JSON.stringify(syncRes.data, null, 2));
  
  console.log('\n=== Done ===');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
