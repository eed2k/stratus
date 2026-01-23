const http = require('http');

const configs = [
  {
    name: "Hopefield Sync",
    folderPath: "/HOPEFIELD_CR300",
    filePattern: "HOPEFIELD",
    stationId: 1,
    syncInterval: 3600,
    enabled: true
  }
];

configs.forEach((config, i) => {
  const data = JSON.stringify(config);
  
  const req = http.request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/dropbox-sync/configs',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      console.log(`Config ${i + 1} (${config.name}):`, body);
    });
  });
  
  req.on('error', (e) => {
    console.error(`Error creating config ${config.name}:`, e.message);
  });
  
  req.write(data);
  req.end();
});
