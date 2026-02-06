// Check the latest timestamps in the actual Dropbox file
// Run this inside the container to use the compiled modules
const path = require('path');

// Use the compiled TOA5 parser
async function main() {
  try {
    // Try to import the dropbox sync service to download the file
    const dbSync = require('./dist/server/services/dropboxSyncService');
    console.log('Loaded dropboxSyncService module');
  } catch(e) {
    console.log('Cannot load module directly:', e.message);
  }
  
  // Instead, manually call the Dropbox API
  const { Dropbox } = require('dropbox');
  
  const dbx = new Dropbox({
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
    refreshToken: process.env.DROPBOX_REFRESH_TOKEN
  });
  
  console.log('Downloading HOPEFIELD_CR300_Table1.dat from Dropbox...');
  
  const result = await dbx.filesDownload({ path: '/HOPEFIELD_CR300/HOPEFIELD_CR300_Table1.dat' });
  const content = result.result.fileBinary.toString('utf8');
  
  const lines = content.trim().split('\n');
  console.log('Total lines:', lines.length);
  
  // Show first 4 lines (headers) and last 5 lines (most recent data)
  console.log('\n--- Headers ---');
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    console.log(lines[i].substring(0, 200));
  }
  
  console.log('\n--- Last 5 data lines ---');
  for (let i = Math.max(4, lines.length - 5); i < lines.length; i++) {
    console.log('Line ' + (i+1) + ': ' + lines[i].substring(0, 200));
  }
  
  // Parse timestamps from last 10 data records
  console.log('\n--- Last 10 timestamps ---');
  for (let i = Math.max(4, lines.length - 10); i < lines.length; i++) {
    const fields = lines[i].split(',');
    if (fields.length > 0) {
      console.log('Line ' + (i+1) + ': timestamp=' + fields[0]);
    }
  }
  
  // Current time and cutoff
  console.log('\nCurrent time:', new Date().toISOString());
  console.log('48h cutoff:', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
}

main().catch(e => console.error('Error:', e.message, e.stack));
