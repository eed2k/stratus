const { Pool } = require('pg');
const https = require('https');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

// Get Dropbox access token using refresh token
async function getAccessToken() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  
  return new Promise((resolve, reject) => {
    const postData = `grant_type=refresh_token&refresh_token=${refreshToken}`;
    const options = {
      hostname: 'api.dropboxapi.com',
      path: '/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${appKey}:${appSecret}`).toString('base64'),
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.access_token);
        } catch (e) {
          reject(new Error('Failed to parse token response: ' + data));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// List Dropbox folder contents
async function listFolder(accessToken, path) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ path: path || '', recursive: false });
    const options = {
      hostname: 'api.dropboxapi.com',
      path: '/2/files/list_folder',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('Failed to parse: ' + data));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  try {
    console.log('Getting Dropbox access token...');
    const token = await getAccessToken();
    console.log('Token obtained. Listing root folder...');
    
    const root = await listFolder(token, '');
    console.log('\n=== DROPBOX ROOT FOLDERS ===');
    if (root.entries) {
      root.entries.forEach(e => {
        console.log(`  [${e['.tag']}] ${e.name} - ${e.path_display}`);
      });
    } else {
      console.log('Error:', JSON.stringify(root));
    }
    
    // Check for SAWS-related folders
    if (root.entries) {
      const sawsFolders = root.entries.filter(e => 
        e.name.toLowerCase().includes('saws') || 
        e.name.toLowerCase().includes('testbed') ||
        e.name.toLowerCase().includes('5263')
      );
      
      for (const folder of sawsFolders) {
        if (folder['.tag'] === 'folder') {
          console.log(`\n=== Contents of ${folder.path_display} ===`);
          const contents = await listFolder(token, folder.path_display);
          if (contents.entries) {
            contents.entries.forEach(e => {
              console.log(`  [${e['.tag']}] ${e.name} (modified: ${e.server_modified || 'N/A'})`);
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
  await p.end();
}
main();
