/**
 * Add Kwaggasklip Station
 * Run this on the server to add the second station
 * Usage: node scripts/add_kwaggasklip_station.js
 */

const API_BASE = process.env.API_URL || 'http://localhost:5000';

async function addKwaggasklipStation() {
  console.log('Adding Kwaggasklip station...\n');
  
  // Step 1: Create the station
  const stationPayload = {
    name: 'Kwaggasklip',
    location: 'Kwaggasklip, South Africa',
    stationType: 'campbell_scientific',
    connectionType: 'dropbox',
    protocol: 'pakbus',
    pakbusAddress: 1,
    securityCode: 0,
    dataTable: 'Table1',
    pollInterval: 60,
    isActive: true
  };
  
  console.log('Creating station with payload:', JSON.stringify(stationPayload, null, 2));
  
  const stationRes = await fetch(`${API_BASE}/api/stations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stationPayload)
  });
  
  if (!stationRes.ok) {
    const error = await stationRes.text();
    console.error('Failed to create station:', error);
    return;
  }
  
  const station = await stationRes.json();
  console.log('Station created with ID:', station.id);
  
  // Step 2: Create Dropbox sync config
  const syncPayload = {
    stationId: station.id,
    syncType: 'dropbox',
    dropboxPath: '/HOPEFIELD_CR300/Kwaggasklip_Table1.dat',
    filePattern: 'Kwaggasklip_Table1.dat',
    syncInterval: 60,
    enabled: true
  };
  
  console.log('\nCreating sync config:', JSON.stringify(syncPayload, null, 2));
  
  const syncRes = await fetch(`${API_BASE}/api/sync-configs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(syncPayload)
  });
  
  if (!syncRes.ok) {
    const error = await syncRes.text();
    console.error('Failed to create sync config:', error);
    return;
  }
  
  const syncConfig = await syncRes.json();
  console.log('Sync config created:', syncConfig);
  
  // Step 3: Trigger initial sync
  console.log('\nTriggering initial sync...');
  
  const triggerRes = await fetch(`${API_BASE}/api/sync-configs/${syncConfig.id}/sync`, {
    method: 'POST'
  });
  
  if (triggerRes.ok) {
    const result = await triggerRes.json();
    console.log('Sync triggered:', result);
  } else {
    console.log('Sync trigger response:', triggerRes.status);
  }
  
  console.log('\n✅ Kwaggasklip station setup complete!');
  console.log('   Station ID:', station.id);
  console.log('   Sync Config ID:', syncConfig.id);
  console.log('   Dropbox Path:', syncPayload.dropboxPath);
}

addKwaggasklipStation().catch(console.error);
