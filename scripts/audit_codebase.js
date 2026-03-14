/**
 * Codebase Audit Script
 * Adds file headers, cleans JSDoc tags, and removes long dashes in comments.
 * Created by Lukas Esterhuizen
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// File categorization
const LIBRARY_PATTERNS = [
  'client/src/components/ui/',
  'client/src/components/examples/',
];

const CREATED_DIRS = [
  'server/',
  'shared/',
  'client/src/pages/',
  'client/src/components/AppSidebar.tsx',
  'client/src/components/CloudAnimation.tsx',
  'client/src/components/ErrorBoundary.tsx',
  'client/src/components/StationImageUpload.tsx',
  'client/src/components/StratusWeatherWidget.tsx',
  'client/src/components/ThemeProvider.tsx',
  'client/src/components/ThemeToggle.tsx',
  'client/src/components/auth/',
  'client/src/components/campbell/',
  'client/src/components/charts/',
  'client/src/components/dashboard/',
  'client/src/components/reports/',
  'client/src/components/station/',
  'client/src/hooks/',
  'client/src/lib/',
  'client/src/App.tsx',
  'client/src/index.tsx',
  'client/src/main.tsx',
];

function isLibrary(relPath) {
  return LIBRARY_PATTERNS.some(p => relPath.startsWith(p));
}

function isCreated(relPath) {
  return CREATED_DIRS.some(p => relPath.startsWith(p));
}

function getHeader(relPath) {
  if (isLibrary(relPath)) {
    if (relPath.includes('/examples/')) {
      return `// Stratus Weather System - Example/Template Component\n// Source: Library (shadcn/ui example)\n`;
    }
    return `// Stratus Weather System - UI Component\n// Source: Library (shadcn/ui)\n`;
  }
  if (isCreated(relPath)) {
    return `// Stratus Weather System\n// Created by Lukas Esterhuizen\n`;
  }
  return null;
}

function hasHeader(content) {
  const first200 = content.slice(0, 200);
  return first200.includes('// Stratus Weather System') ||
         first200.includes('// Source: Library');
}

// Clean JSDoc: replace @param/@returns/@throws with plain comments
function cleanJSDoc(content) {
  let result = content;

  // Replace @param name description -> name: description
  result = result.replace(/^\s*\*\s*@param\s+(\w+)\s+(.+)$/gm, (match, name, desc) => {
    return match.replace(/@param\s+\w+\s+/, `${name}: `);
  });

  // Replace @returns description -> Returns: description
  result = result.replace(/^\s*\*\s*@returns?\s+(.+)$/gm, (match, desc) => {
    return match.replace(/@returns?\s+/, 'Returns ');
  });

  // Replace @throws description -> Throws: description
  result = result.replace(/^\s*\*\s*@throws\s+(.+)$/gm, (match, desc) => {
    return match.replace(/@throws\s+/, 'Throws ');
  });

  // Replace @deprecated description -> DEPRECATED: description
  result = result.replace(/^\s*\*\s*@deprecated\s+(.+)$/gm, (match, desc) => {
    return match.replace(/@deprecated\s+/, 'DEPRECATED: ');
  });

  // Replace @example -> Example:
  result = result.replace(/^\s*\*\s*@example\s*$/gm, (match) => {
    return match.replace(/@example/, 'Example:');
  });

  // Replace @see -> See:
  result = result.replace(/^\s*\*\s*@see\s+(.+)$/gm, (match) => {
    return match.replace(/@see\s+/, 'See ');
  });

  // Clean long dashes in comments (---- or more)
  result = result.replace(/^(\s*(?:\/\/|\*)\s*)----+(.*)$/gm, '$1$2');

  // Clean // ---- text ---- pattern
  result = result.replace(/^(\s*\/\/\s*)----+\s*(.+?)\s*----+\s*$/gm, '$1$2');

  // Clean double dashes in comments (but not HTML comments <!-- or --> or TypeScript --)
  // Only in comment lines: replace "text -- text" with "text, text" or "text. text"
  result = result.replace(/^(\s*(?:\/\/|\*).+?)\s+--\s+/gm, '$1. ');

  return result;
}

// Collect all .ts/.tsx files (excluding node_modules, dist, release)
function collectFiles(dir, base = '') {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (['node_modules', 'dist', 'release', '.git', 'logs', 'demo_data', 'assets'].includes(entry.name)) continue;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), rel));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(rel);
    }
  }
  return files;
}

// Main
const files = collectFiles(ROOT);
let headerCount = 0;
let cleanCount = 0;

for (const relPath of files) {
  const fullPath = path.join(ROOT, relPath);
  let content = fs.readFileSync(fullPath, 'utf8');
  let changed = false;

  // Add header if missing and file is categorized
  const header = getHeader(relPath);
  if (header && !hasHeader(content)) {
    content = header + '\n' + content;
    changed = true;
    headerCount++;
  }

  // Clean JSDoc tags
  const cleaned = cleanJSDoc(content);
  if (cleaned !== content) {
    content = cleaned;
    changed = true;
    cleanCount++;
  }

  if (changed) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Updated: ${relPath}`);
  }
}

console.log(`\nDone. Headers added: ${headerCount}, Comments cleaned: ${cleanCount}`);
