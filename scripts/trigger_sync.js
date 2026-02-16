const http = require('http');

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('Triggering Dropbox sync...');
  const res = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/dropbox-sync/sync',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': 'esterhuizen2k@proton.me'
    }
  }, '{}');
  
  console.log('Sync status:', res.status);
  console.log('Response:', JSON.stringify(res.data, null, 2));
}

main().catch(e => console.error('Error:', e.message));
