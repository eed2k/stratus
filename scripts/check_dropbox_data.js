const fs = require('fs');
const path = require('path');

// List files in data dir
const dataDir = '/app/data';
try {
  const files = fs.readdirSync(dataDir);
  console.log('Files in data dir:', files);
  
  for (const file of files) {
    if (file.endsWith('.dat') || file.endsWith('.csv') || file.endsWith('.txt')) {
      const content = fs.readFileSync(path.join(dataDir, file), 'utf8');
      const lines = content.trim().split('\n');
      console.log('\n' + file + ': ' + lines.length + ' lines');
      // Show last 3 lines
      for (let i = Math.max(0, lines.length - 3); i < lines.length; i++) {
        console.log('  Last line ' + (lines.length - i) + ': ' + lines[i].substring(0, 120));
      }
    }
  }
} catch(e) {
  console.log('Error reading data dir:', e.message);
}

// Also check the cutoff time
const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
console.log('\nCurrent time:', new Date().toISOString());
console.log('48h cutoff:', cutoff.toISOString());
