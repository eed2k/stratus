/**
 * Post-Build Verification Script for Stratus Weather Station
 * Developer: Lukas Esterhuizen (esterhuizen2k@proton.me)
 * 
 * This script verifies the build output and ensures:
 * 1. NSIS installer was created successfully
 * 2. No standalone portable EXE exists
 * 3. All required files are present
 */

const fs = require('fs');
const path = require('path');

console.log('\n========================================');
console.log('  STRATUS WEATHER STATION');
console.log('  Post-Build Verification');
console.log('  Developer: Lukas Esterhuizen');
console.log('========================================\n');

const outputPath = path.join(__dirname, '..', 'output');

// Check if output directory exists
if (!fs.existsSync(outputPath)) {
  console.error('❌ ERROR: Output directory not found!');
  console.error('   Path:', outputPath);
  process.exit(1);
}

const files = fs.readdirSync(outputPath);
console.log('📁 Files in output directory:\n');

let setupFile = null;
let portableFile = null;
let hasBlockmap = false;
let hasLatestYml = false;

files.forEach(file => {
  const filePath = path.join(outputPath, file);
  const stats = fs.statSync(filePath);
  const isDir = stats.isDirectory();
  const size = isDir ? '[DIR]' : `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
  
  console.log(`   ${isDir ? '📂' : '📄'} ${file} (${size})`);
  
  // Identify file types
  if (file.includes('Setup') && file.endsWith('.exe')) {
    setupFile = { name: file, size: stats.size };
  }
  if (file.endsWith('.7z') || (file.endsWith('.exe') && !file.includes('Setup') && !file.includes('Uninstall'))) {
    portableFile = file;
  }
  if (file.endsWith('.blockmap')) {
    hasBlockmap = true;
  }
  if (file === 'latest.yml') {
    hasLatestYml = true;
  }
});

console.log('\n========================================');
console.log('  VERIFICATION RESULTS');
console.log('========================================\n');

let allPassed = true;

// Check 1: Setup installer exists
if (setupFile) {
  const sizeMB = (setupFile.size / 1024 / 1024).toFixed(2);
  console.log(`✅ NSIS Installer created successfully`);
  console.log(`   File: ${setupFile.name}`);
  console.log(`   Size: ${sizeMB} MB`);
  
  // Warn if size seems wrong
  if (setupFile.size < 10 * 1024 * 1024) {
    console.log(`   ⚠️  Warning: File seems small. Verify contents.`);
  } else if (setupFile.size > 500 * 1024 * 1024) {
    console.log(`   ⚠️  Warning: File seems large. Consider optimization.`);
  }
} else {
  console.log(`❌ NSIS Installer NOT FOUND!`);
  allPassed = false;
}

// Check 2: No portable/standalone EXE
if (portableFile) {
  console.log(`\n⚠️  Portable/Standalone build detected: ${portableFile}`);
  console.log(`   This should be removed per requirements.`);
  console.log(`   Update package.json to remove portable target.`);
} else {
  console.log(`\n✅ No portable/standalone EXE found (correct)`);
}

// Check 3: Blockmap for delta updates
if (hasBlockmap) {
  console.log(`\n✅ Blockmap file present (enables delta updates)`);
} else {
  console.log(`\n⚠️  Blockmap file missing (delta updates won't work)`);
}

// Check 4: Auto-update manifest
if (hasLatestYml) {
  console.log(`\n✅ Auto-update manifest (latest.yml) present`);
} else {
  console.log(`\n⚠️  Auto-update manifest missing`);
}

// Check 5: Verify LICENSE.txt exists
const licensePath = path.join(__dirname, '..', 'LICENSE.txt');
if (fs.existsSync(licensePath)) {
  const licenseContent = fs.readFileSync(licensePath, 'utf8');
  if (licenseContent.includes('Lukas Esterhuizen') && licenseContent.includes('esterhuizen2k@proton.me')) {
    console.log(`\n✅ LICENSE.txt contains developer information`);
  } else {
    console.log(`\n⚠️  LICENSE.txt missing developer attribution`);
  }
} else {
  console.log(`\n❌ LICENSE.txt not found!`);
  allPassed = false;
}

// Check 6: Verify icon exists
const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
if (fs.existsSync(iconPath)) {
  console.log(`\n✅ Application icon (icon.ico) present`);
} else {
  console.log(`\n❌ Application icon not found in build/`);
  allPassed = false;
}

console.log('\n========================================');
if (allPassed) {
  console.log('  ✅ BUILD VERIFICATION PASSED');
  console.log('========================================');
  console.log('\n📦 Installer ready for distribution:');
  console.log(`   ${path.join(outputPath, setupFile?.name || 'Stratus-Weather-Station-Setup.exe')}`);
  console.log('\n👤 Developer: Lukas Esterhuizen');
  console.log('📧 Contact: esterhuizen2k@proton.me\n');
} else {
  console.log('  ❌ BUILD VERIFICATION FAILED');
  console.log('========================================');
  console.log('\nPlease fix the issues above and rebuild.\n');
  process.exit(1);
}
