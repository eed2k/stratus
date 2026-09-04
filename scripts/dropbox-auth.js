#!/usr/bin/env node
/**
 * Dropbox OAuth 2.0 Authorization Script
 * 
 * This script helps you get a refresh token for 24/7 Dropbox sync.
 * Run once: npm run dropbox:auth
 * 
 * Prerequisites:
 * 1. Go to https://www.dropbox.com/developers/apps
 * 2. Select your app (STRATUS2K)
 * 3. Copy the App Key and App Secret from Settings
 */

const readline = require('readline');
const https = require('https');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n=== Dropbox OAuth 2.0 Authorization ===\n');
  console.log('This script will help you get a refresh token for 24/7 Dropbox sync.\n');
  
  // Step 1: Get App credentials
  console.log('Step 1: Get your app credentials from https://www.dropbox.com/developers/apps');
  console.log('        Select your app > Settings tab\n');
  
  const appKey = await question('Enter your Dropbox App Key: ');
  const appSecret = await question('Enter your Dropbox App Secret: ');
  
  if (!appKey || !appSecret) {
    console.error('\nError: App Key and App Secret are required.');
    rl.close();
    process.exit(1);
  }
  
  // Step 2: Generate authorization URL
  console.log('\n--- Step 2: Authorize the app ---\n');
  
  const authUrl = `https://www.dropbox.com/oauth2/authorize?` +
    `client_id=${appKey}&` +
    `response_type=code&` +
    `token_access_type=offline`;
  
  console.log('Open this URL in your browser to authorize the app:\n');
  console.log(`  ${authUrl}\n`);
  console.log('After authorizing, you will see an authorization code.\n');
  
  const authCode = await question('Paste the authorization code here: ');
  
  if (!authCode) {
    console.error('\nError: Authorization code is required.');
    rl.close();
    process.exit(1);
  }
  
  // Step 3: Exchange authorization code for tokens
  console.log('\n--- Step 3: Exchanging code for tokens ---\n');
  
  const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
  const postData = `code=${authCode}&grant_type=authorization_code`;
  
  const options = {
    hostname: 'api.dropboxapi.com',
    path: '/oauth2/token',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  const tokenResponse = await new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
  
  console.log('\n=== SUCCESS! ===\n');
  console.log('Add these values to your .env file:\n');
  console.log(`DROPBOX_APP_KEY=${appKey}`);
  console.log(`DROPBOX_APP_SECRET=${appSecret}`);
  console.log(`DROPBOX_REFRESH_TOKEN=${tokenResponse.refresh_token}`);
  console.log(`DROPBOX_ACCESS_TOKEN=${tokenResponse.access_token}`);
  
  console.log('\n--- Token Info ---');
  console.log(`Access Token expires in: ${tokenResponse.expires_in} seconds (~${Math.round(tokenResponse.expires_in / 3600)} hours)`);
  console.log(`Token type: ${tokenResponse.token_type}`);
  console.log(`Account ID: ${tokenResponse.account_id}`);
  
  console.log('\n✓ The refresh token NEVER expires and will automatically renew access tokens.');
  console.log('✓ Your Dropbox sync will now work 24/7!\n');
  
  rl.close();
}

main().catch((err) => {
  console.error('\nError:', err.message);
  rl.close();
  process.exit(1);
});
