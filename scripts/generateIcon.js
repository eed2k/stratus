const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const size = 256;
const centerX = size / 2;
const centerY = size / 2;
const outerRadius = 120;
const innerRadius = 32;

// Colors
const darkBlue = { r: 0x1e, g: 0x3a, b: 0x5f };
const white = { r: 0xff, g: 0xff, b: 0xff };

// Generate raw RGBA pixel data
const pixels = Buffer.alloc(size * size * 4);

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    const idx = (y * size + x) * 4;
    let r, g, b, a;
    
    if (distance <= innerRadius) {
      r = white.r; g = white.g; b = white.b; a = 255;
    } else if (distance <= outerRadius) {
      r = darkBlue.r; g = darkBlue.g; b = darkBlue.b; a = 255;
    } else {
      r = 0; g = 0; b = 0; a = 0;
    }
    
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = a;
  }
}

async function generateIcons() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const iconsDir = path.join(assetsDir, 'icons');
  
  // Create icons directory if it doesn't exist
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }
  
  // Create base PNG from raw pixel data
  const png256 = await sharp(pixels, {
    raw: {
      width: size,
      height: size,
      channels: 4
    }
  }).png().toBuffer();
  
  // Save 256x256 PNG
  await fs.promises.writeFile(path.join(assetsDir, 'icon.png'), png256);
  console.log('Created icon.png (256x256)');
  
  // Generate various sizes for ICO
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngBuffers = [];
  
  for (const s of sizes) {
    const resized = await sharp(png256).resize(s, s).png().toBuffer();
    await fs.promises.writeFile(path.join(iconsDir, `icon-${s}.png`), resized);
    pngBuffers.push({ size: s, buffer: resized });
    console.log(`Created icon-${s}.png`);
  }
  
  // Create ICO file manually
  // ICO header: 6 bytes
  // ICO directory entries: 16 bytes each
  // PNG data follows
  
  const iconCount = sizes.length;
  const headerSize = 6 + (16 * iconCount);
  
  // Calculate offsets
  let offset = headerSize;
  const entries = pngBuffers.map(({ size: s, buffer }) => {
    const entry = {
      width: s === 256 ? 0 : s,
      height: s === 256 ? 0 : s,
      colors: 0,
      reserved: 0,
      planes: 1,
      bpp: 32,
      size: buffer.length,
      offset: offset
    };
    offset += buffer.length;
    return { ...entry, buffer };
  });
  
  // Build ICO file
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);      // Reserved
  icoHeader.writeUInt16LE(1, 2);      // Type (1 = ICO)
  icoHeader.writeUInt16LE(iconCount, 4); // Number of images
  
  const icoEntries = Buffer.alloc(16 * iconCount);
  entries.forEach((entry, i) => {
    const pos = i * 16;
    icoEntries.writeUInt8(entry.width, pos);
    icoEntries.writeUInt8(entry.height, pos + 1);
    icoEntries.writeUInt8(entry.colors, pos + 2);
    icoEntries.writeUInt8(entry.reserved, pos + 3);
    icoEntries.writeUInt16LE(entry.planes, pos + 4);
    icoEntries.writeUInt16LE(entry.bpp, pos + 6);
    icoEntries.writeUInt32LE(entry.size, pos + 8);
    icoEntries.writeUInt32LE(entry.offset, pos + 12);
  });
  
  const icoData = Buffer.concat([
    icoHeader,
    icoEntries,
    ...entries.map(e => e.buffer)
  ]);
  
  await fs.promises.writeFile(path.join(assetsDir, 'icon.ico'), icoData);
  console.log('Created icon.ico');
  
  console.log('\\nAll icons generated successfully!');
}

generateIcons().catch(console.error);
