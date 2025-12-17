// Simple script to initialize demo station
// Run with: node scripts/init-demo.js

const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/demo/initialize',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
};

console.log('Initializing demo station...');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response status:', res.statusCode);
    if (res.statusCode === 200) {
      console.log('✅ Demo station created successfully!');
      console.log('Response:', data);
      console.log('\nYou can now view the demo station in your dashboard.');
    } else {
      console.log('❌ Error creating demo station');
      console.log('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Error:', error.message);
  console.log('\nMake sure the server is running with: npm run dev');
});

req.end();
