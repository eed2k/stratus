const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'assets', 'icon.ico');
const destDir = path.resolve(__dirname, '..', 'build');
const dest = path.join(destDir, 'icon.ico');

try {
  if (!fs.existsSync(src)) {
    console.warn('Source icon not found at', src);
    process.exit(0);
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.copyFileSync(src, dest);
  console.log('Copied icon to', dest);
} catch (err) {
  console.error('Failed to copy icon:', err);
  process.exit(1);
}
