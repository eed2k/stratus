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

function downloadFileHead(token, path, bytes) {
  return new Promise((resolve, reject) => {
    const apiArg = JSON.stringify({ path: path });
    const opts = {
      hostname: 'content.dropboxapi.com',
      path: '/2/files/download',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Dropbox-API-Arg': apiArg,
        'Range': 'bytes=0-' + bytes
      }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write('');
    req.end();
  });
}

function downloadFileTail(token, path, fileSize, bytes) {
  return new Promise((resolve, reject) => {
    const apiArg = JSON.stringify({ path: path });
    const start = Math.max(0, fileSize - bytes);
    const opts = {
      hostname: 'content.dropboxapi.com',
      path: '/2/files/download',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Dropbox-API-Arg': apiArg,
        'Range': 'bytes=' + start + '-' + fileSize
      }
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write('');
    req.end();
  });
}

async function main() {
  const token = await getAccessToken();
  
  const files = [
    { path: '/HOPEFIELD_CR300/HOPEFIELD_CR300_Table1.dat', size: 5049249 },
    { path: '/HOPEFIELD_CR300/Inteltronics_Skaapdam_Table1.dat', size: 41140642 },
    { path: '/HOPEFIELD_CR300/Inteltronics_Quaggasklip_Test.dat', size: 58603431 },
  ];
  
  for (const f of files) {
    console.log('========================================');
    console.log('FILE: ' + f.path);
    console.log('========================================');
    
    // Get first 2KB (headers)
    const head = await downloadFileHead(token, f.path, 2048);
    const headLines = head.split('\n').slice(0, 5);
    console.log('HEADER (first 5 lines):');
    headLines.forEach(l => console.log('  ' + l.trim()));
    
    // Get last 1KB (most recent data)
    const tail = await downloadFileTail(token, f.path, f.size, 1024);
    const tailLines = tail.split('\n').filter(l => l.trim());
    console.log('\nLAST 3 DATA LINES:');
    tailLines.slice(-3).forEach(l => console.log('  ' + l.trim()));
    console.log('');
  }
}

main().catch(e => console.log('Error:', e.message));
