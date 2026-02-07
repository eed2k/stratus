// Check what the /api/stations endpoint returns
const http = require('http');
http.get('http://localhost:5000/api/stations', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        parsed.forEach(s => {
          console.log('Station:', s.name);
          console.log('  lastConnected:', s.lastConnected);
          console.log('  lastConnectionTime:', s.lastConnectionTime);
          console.log('  lastDataTime:', s.lastDataTime);
        });
      } else {
        console.log('Response (not array):', JSON.stringify(parsed).substring(0, 500));
      }
    } catch(e) {
      console.log('Raw:', data.substring(0, 500));
    }
  });
}).on('error', e => console.error(e));
