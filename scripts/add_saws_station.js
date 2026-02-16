const http = require('http');

// Login and create station
async function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      const rawHeaders = res.rawHeaders;
      const cookies = [];
      for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i].toLowerCase() === 'set-cookie') {
          cookies.push(rawHeaders[i + 1]);
        }
      }
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), cookies });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, cookies });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  // Step 1: Login
  console.log('Step 1: Logging in...');
  const loginData = JSON.stringify({
    email: 'esterhuizen2k@proton.me',
    password: 'M9dwfgRXQka8tdpPEbEr6rZU8#5y6K'
  });
  
  const loginRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData) }
  }, loginData);
  
  console.log('Login status:', loginRes.status);
  if (loginRes.status !== 200) {
    console.log('Login response:', loginRes.data);
    return;
  }
  
  // Auth uses x-user-email header after login succeeds
  console.log('Login succeeded, using x-user-email header for auth');
  
  // Step 2: Create SAWS TestBed station
  console.log('\nStep 2: Creating SAWS TestBed station...');
  const stationData = JSON.stringify({
    name: 'SAWS TESTBED 5263',
    location: 'Pretoria, South Africa',
    latitude: -25.7479,
    longitude: 28.2293,
    altitude: 1330,
    stationType: 'campbell_scientific',
    connectionType: 'dropbox',
    dataloggerModel: 'CR1000X',
    dataloggerSerialNumber: '5263',
    dataloggerProgramName: 'Inteltronics_SAWS_TestBed_5263_V1R0',
    dataTable: 'TableSolarCharger10m',
    pollInterval: 3600,
    protocol: 'pakbus',
    pakbusAddress: 1,
    securityCode: 0,
    connectionConfig: JSON.stringify({
      type: 'dropbox',
      folderPath: '/SAWS TESTBED',
      filePattern: 'Inteltronics_SAWS_TestBed_5263',
      syncInterval: 3600
    }),
    notes: 'SAWS TestBed weather station at Irene, Pretoria. Syncs via Dropbox. Primary data file: Inteltronics_SAWS_TestBed_5263_TableSolarCharger10m.dat'
  });
  
  const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(stationData),
      'x-user-email': 'esterhuizen2k@proton.me'
    };
    
    const createRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/stations',
    method: 'POST',
    headers
  }, stationData);
  
  console.log('Create station status:', createRes.status);
  console.log('Response:', JSON.stringify(createRes.data, null, 2));
  
  if (createRes.status === 201) {
    console.log('\n=== Station created successfully! ===');
    console.log('Station ID:', createRes.data.id);
    console.log('Name:', createRes.data.name);
    console.log('The Dropbox sync should automatically start picking up data.');
  }
}

main().catch(e => console.error('Error:', e.message));
