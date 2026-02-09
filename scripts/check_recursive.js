const https = require('https');

const appKey = process.env.DROPBOX_APP_KEY;
const appSecret = process.env.DROPBOX_APP_SECRET;
const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const postData = `grant_type=refresh_token&refresh_token=${refreshToken}`;
    const auth = Buffer.from(appKey + ':' + appSecret).toString('base64');
    const opts = {
      hostname: 'api.dropboxapi.com',
      path: '/oauth2/token',
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.access_token) resolve(j.access_token);
          else reject(new Error('No access_token: ' + body));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function listFolder(token, path, cursor) {
  return new Promise((resolve, reject) => {
    let apiPath, postData;
    if (cursor) {
      apiPath = '/2/files/list_folder/continue';
      postData = JSON.stringify({ cursor: cursor });
    } else {
      apiPath = '/2/files/list_folder';
      postData = JSON.stringify({ path: path, recursive: true, limit: 2000 });
    }
    const opts = {
      hostname: 'api.dropboxapi.com',
      path: apiPath,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const token = await getAccessToken();
  
  // Recursive listing
  let allEntries = [];
  let result = await listFolder(token, '/HOPEFIELD_CR300');
  allEntries = allEntries.concat(result.entries || []);
  while (result.has_more) {
    result = await listFolder(token, null, result.cursor);
    allEntries = allEntries.concat(result.entries || []);
  }

  const files = allEntries
    .filter(e => e['.tag'] === 'file' && e.name.toLowerCase().endsWith('.dat'))
    .sort((a, b) => new Date(b.server_modified) - new Date(a.server_modified));

  // Show only files modified in last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 3600000;
  const recent = files.filter(f => new Date(f.server_modified).getTime() > thirtyDaysAgo);
  
  console.log('ALL .dat files modified in last 30 days (' + recent.length + ' of ' + files.length + ' total):');
  console.log('');
  recent.forEach(f => {
    const mod = new Date(f.server_modified);
    const sast = new Date(mod.getTime() + 2 * 3600000);
    const ago = Math.round((Date.now() - mod.getTime()) / 3600000);
    const dateStr = sast.toISOString().replace('T', ' ').slice(0, 19);
    const sizeMB = (f.size / 1024 / 1024).toFixed(1);
    console.log(dateStr + ' SAST (' + ago + 'h ago) | ' + sizeMB.padStart(7) + ' MB | ' + f.path_display);
  });

  // Also check 2025 subfolder
  console.log('\n\nFiles in subfolders:');
  const subfolders = allEntries.filter(e => e['.tag'] === 'folder');
  subfolders.forEach(f => console.log('  ' + f.path_display));
}

main().catch(e => console.log('Error:', e.message));
