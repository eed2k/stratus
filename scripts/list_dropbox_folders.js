const https = require('https');
const querystring = require('querystring');

const APP_KEY = process.env.DROPBOX_APP_KEY;
const APP_SECRET = process.env.DROPBOX_APP_SECRET;
const REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({ grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN });
    const options = {
      hostname: 'api.dropboxapi.com', path: '/oauth2/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(APP_KEY + ':' + APP_SECRET).toString('base64'), 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try { resolve(JSON.parse(d).access_token); } catch(e) { reject(d); } }); });
    req.write(postData); req.end();
  });
}

function listFolder(token, path) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ path: path });
    const options = {
      hostname: 'api.dropboxapi.com', path: '/2/files/list_folder', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try { resolve(JSON.parse(d)); } catch(e) { reject(d); } }); });
    req.write(postData); req.end();
  });
}

function downloadFile(token, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'content.dropboxapi.com', path: '/2/files/download', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Dropbox-API-Arg': JSON.stringify({ path: path }) }
    };
    const req = https.request(options, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
    req.end();
  });
}

async function main() {
  const token = await getAccessToken();
  console.log('=== ROOT FOLDERS ===');
  const root = await listFolder(token, '');
  if (root.entries) {
    root.entries.forEach(e => console.log(e['.tag'].padEnd(8), e.name));
    
    // Check all folders for data files
    for (const entry of root.entries) {
      if (entry['.tag'] === 'folder') {
        const sub = await listFolder(token, entry.path_lower);
        if (sub.entries && sub.entries.length > 0) {
          const datFiles = sub.entries.filter(e => e.name.endsWith('.dat') || e.name.endsWith('.csv'));
          console.log('\n' + entry.name + '/ -> ' + sub.entries.length + ' items, ' + datFiles.length + ' data files');
          datFiles.slice(0,3).forEach(f => console.log('  ' + f.name + ' (' + f.size + ' bytes, modified: ' + f.server_modified + ')'));
          
          // Download first few lines of first dat file to show headers
          if (datFiles.length > 0) {
            const content = await downloadFile(token, datFiles[0].path_lower);
            const lines = content.split('\n').slice(0, 5);
            console.log('  --- First 5 lines of ' + datFiles[0].name + ' ---');
            lines.forEach(l => console.log('  ' + l.substring(0, 200)));
          }
        }
      }
    }
  } else {
    console.log('Error:', JSON.stringify(root));
  }
}
main().catch(e => console.error('Error:', e));
