// Trigger an immediate Dropbox sync from inside the container
const path = require('path');
process.chdir('/app');

(async () => {
  try {
    const { dropboxSyncService } = require('/app/dist/server/services/dropboxSyncService.js');
    console.log('Calling syncNow()...');
    const r = await dropboxSyncService.syncNow(false);
    console.log('Result:', JSON.stringify(r, null, 2));
  } catch (err) {
    console.error('Sync error:', err.message);
    console.error(err.stack);
  }
  process.exit(0);
})();
