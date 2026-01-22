const https = require('https');

const appKey = process.env.DROPBOX_APP_KEY;
const appSecret = process.env.DROPBOX_APP_SECRET;
const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

const auth = Buffer.from(appKey + ':' + appSecret).toString('base64');

console.log('Testing Dropbox connection...');
console.log('App Key:', appKey ? appKey.substring(0, 5) + '...' : 'NOT SET');

const tokenReq = https.request({
  hostname: 'api.dropboxapi.com',
  path: '/oauth2/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': 'Basic ' + auth
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      if (!parsed.access_token) {
        console.log('Failed to get token:', data);
        return;
      }
      console.log('Token obtained successfully');
      
      // Get account info
      const accReq = https.request({
        hostname: 'api.dropboxapi.com',
        path: '/2/users/get_current_account',
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + parsed.access_token
        }
      }, (accRes) => {
        let accData = '';
        accRes.on('data', chunk => accData += chunk);
        accRes.on('end', () => {
          try {
            const acc = JSON.parse(accData);
            console.log('\nConnected Dropbox Account:');
            console.log('  Name:', acc.name?.display_name);
            console.log('  Email:', acc.email);
            console.log('  Account ID:', acc.account_id);
          } catch (e) {
            console.log('Account info:', accData);
          }
          
          // Then list root folder
          listFolder(parsed.access_token, '');
        });
      });
      accReq.end();
    } catch (e) {
      console.log('Error parsing token response:', data);
    }
  });
});

function listFolder(token, path) {
  const listReq = https.request({
    hostname: 'api.dropboxapi.com',
    path: '/2/files/list_folder',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    }
  }, (listRes) => {
    let listData = '';
    listRes.on('data', chunk => listData += chunk);
    listRes.on('end', () => {
      try {
        const folders = JSON.parse(listData);
        if (folders.entries) {
          console.log('\nDropbox root contents:');
          folders.entries.forEach(e => {
            console.log('  [' + e['.tag'] + '] ' + e.path_display);
          });
          if (folders.entries.length === 0) {
            console.log('  (empty - no files or folders)');
          }
        } else {
          console.log('List response:', listData);
        }
      } catch (e) {
        console.log('Raw list response:', listData);
      }
    });
  });
  listReq.write(JSON.stringify({ path: path }));
  listReq.end();
}

tokenReq.on('error', (e) => console.log('Request error:', e.message));
tokenReq.write('grant_type=refresh_token&refresh_token=' + refreshToken);
tokenReq.end();
