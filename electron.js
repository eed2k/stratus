/**
 * Stratus Desktop - Electron Main Process
 * 
 * This is the entry point for the Stratus desktop application.
 * It wraps the web server and adds desktop-only features:
 * - Serial port / RS232 connection for data loggers
 * - Password protection
 * - Setup wizard with EULA
 */
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Desktop-only config file path
const CONFIG_DIR = path.join(app.getPath('userData'), 'stratus-config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'desktop.json');
const EULA_ACCEPTED_FILE = path.join(CONFIG_DIR, '.eula_accepted');
const PASSWORD_FILE = path.join(CONFIG_DIR, '.password');

// ============================================================
// Configuration Management
// ============================================================
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
  return {
    serverPort: 5000,
    autoStartServer: true,
    serialPort: null,
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    lastConnectedPort: null,
    windowBounds: { width: 1400, height: 900 },
  };
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ============================================================
// License Key System
// ============================================================
const LICENSE_FILE = path.join(CONFIG_DIR, '.license');

// Valid license keys — HMAC-signed with embedded app secret
const LICENSE_SECRET = 'stratus-itronics-2026-license-key';

/**
 * Generate a license key for a given tier.
 * Format: STRATUS-<TIER>-<RANDOM>-<HMAC_SIGNATURE>
 */
function generateLicenseKey(tier = 'ADMIN') {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  const payload = `STRATUS-${tier}-${rand}`;
  const sig = crypto.createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .substring(0, 12)
    .toUpperCase();
  return `${payload}-${sig}`;
}

/**
 * Validate a license key by checking its HMAC signature.
 */
function validateLicenseKey(key) {
  if (!key || typeof key !== 'string') return { valid: false, tier: null };
  const parts = key.trim().toUpperCase().split('-');
  // Expected: STRATUS-<TIER>-<RANDOM>-<SIGNATURE>
  if (parts.length !== 4 || parts[0] !== 'STRATUS') return { valid: false, tier: null };
  const tier = parts[1];
  const payload = `STRATUS-${parts[1]}-${parts[2]}`;
  const expectedSig = crypto.createHmac('sha256', LICENSE_SECRET)
    .update(payload)
    .digest('hex')
    .substring(0, 12)
    .toUpperCase();
  if (parts[3] === expectedSig) {
    return { valid: true, tier };
  }
  return { valid: false, tier: null };
}

/**
 * Check if a valid license is stored locally.
 */
function isLicenseValid() {
  ensureConfigDir();
  if (!fs.existsSync(LICENSE_FILE)) return false;
  try {
    const stored = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    const result = validateLicenseKey(stored.key);
    return result.valid;
  } catch {
    return false;
  }
}

/**
 * Get stored license info.
 */
function getLicenseInfo() {
  ensureConfigDir();
  if (!fs.existsSync(LICENSE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Activate a license key — validate and store.
 */
function activateLicense(key) {
  const result = validateLicenseKey(key);
  if (!result.valid) return { success: false, message: 'Invalid license key' };
  ensureConfigDir();
  const info = {
    key: key.trim().toUpperCase(),
    tier: result.tier,
    activatedAt: new Date().toISOString(),
    machine: require('os').hostname(),
  };
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(info, null, 2));
  return { success: true, tier: result.tier };
}

// ============================================================
// EULA Management
// ============================================================
function isEulaAccepted() {
  return fs.existsSync(EULA_ACCEPTED_FILE);
}

function acceptEula() {
  ensureConfigDir();
  fs.writeFileSync(EULA_ACCEPTED_FILE, new Date().toISOString());
}

// ============================================================
// Serial Port Management (loaded dynamically)
// ============================================================
let SerialPort = null;
let activePort = null;
let serialDataBuffer = '';

function loadSerialPort() {
  try {
    SerialPort = require('serialport');
    return true;
  } catch (err) {
    console.warn('serialport module not available:', err.message);
    return false;
  }
}

async function listSerialPorts() {
  if (!SerialPort) {
    if (!loadSerialPort()) return [];
  }
  try {
    const { SerialPort: SP } = SerialPort;
    const ports = await SP.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || 'Unknown',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      serialNumber: p.serialNumber || '',
      pnpId: p.pnpId || '',
    }));
  } catch (err) {
    console.error('Failed to list serial ports:', err);
    return [];
  }
}

function openSerialPort(portPath, options = {}) {
  if (!SerialPort) {
    if (!loadSerialPort()) {
      throw new Error('Serial port module not available');
    }
  }
  
  if (activePort?.isOpen) {
    activePort.close();
  }

  const { SerialPort: SP } = SerialPort;
  const { ReadlineParser } = require('@serialport/parser-readline');

  const config = {
    path: portPath,
    baudRate: options.baudRate || 9600,
    dataBits: options.dataBits || 8,
    stopBits: options.stopBits || 1,
    parity: options.parity || 'none',
    autoOpen: false,
  };

  activePort = new SP(config);
  const parser = activePort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  return new Promise((resolve, reject) => {
    activePort.open((err) => {
      if (err) {
        reject(new Error(`Failed to open ${portPath}: ${err.message}`));
        return;
      }

      parser.on('data', (line) => {
        // Send serial data to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial:data', {
            timestamp: new Date().toISOString(),
            data: line,
            port: portPath,
          });
        }
      });

      activePort.on('error', (err) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial:error', {
            message: err.message,
            port: portPath,
          });
        }
      });

      activePort.on('close', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('serial:disconnected', {
            port: portPath,
          });
        }
      });

      resolve({ success: true, port: portPath, config });
    });
  });
}

function closeSerialPort() {
  return new Promise((resolve) => {
    if (activePort?.isOpen) {
      activePort.close(() => resolve(true));
    } else {
      resolve(false);
    }
  });
}

function sendSerialData(data) {
  if (!activePort?.isOpen) {
    throw new Error('Serial port not open');
  }
  return new Promise((resolve, reject) => {
    activePort.write(data + '\r\n', (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

// ============================================================
// Main Window
// ============================================================
let mainWindow = null;
let serverProcess = null;

function createMainWindow() {
  const config = loadConfig();
  
  mainWindow = new BrowserWindow({
    width: config.windowBounds?.width || 1400,
    height: config.windowBounds?.height || 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Stratus Weather Station Manager',
    icon: path.join(__dirname, 'assets', 'icons', 'icon-256.png'),
    backgroundColor: '#f8fafc',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Show window once ready to paint — avoids blank white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Save window bounds on resize
  mainWindow.on('resize', () => {
    const bounds = mainWindow.getBounds();
    const cfg = loadConfig();
    cfg.windowBounds = { width: bounds.width, height: bounds.height };
    saveConfig(cfg);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Build menu
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          click: () => mainWindow.webContents.send('navigate', '/settings'),
        },
        { type: 'separator' },
        {
          label: 'Change Password',
          click: () => mainWindow.webContents.send('show-change-password'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Serial Monitor',
      submenu: [
        {
          label: 'Open Serial Monitor',
          click: () => mainWindow.webContents.send('navigate', '/serial-monitor'),
        },
        { type: 'separator' },
        {
          label: 'Refresh Ports',
          click: async () => {
            const ports = await listSerialPorts();
            mainWindow.webContents.send('serial:ports-updated', ports);
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => mainWindow.webContents.send('navigate', '/docs'),
        },
        {
          label: 'About Stratus',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Stratus',
              message: 'Stratus Weather Station Manager',
              detail: `Version 1.1.0\nDesktop Edition\n\n© 2025-2026 Lukas Esterhuizen\nesterhuizen2k@proton.me\n\nCampbell Scientific Weather Station Management`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];
  
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  return mainWindow;
}

// ============================================================
// Wait for server to be ready (health check polling)
// ============================================================
function waitForServer(port, maxAttempts = 30, interval = 500) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://localhost:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else if (attempts < maxAttempts) {
          setTimeout(check, interval);
        } else {
          reject(new Error(`Server not ready after ${maxAttempts} attempts`));
        }
      });
      req.on('error', () => {
        if (attempts < maxAttempts) {
          setTimeout(check, interval);
        } else {
          reject(new Error(`Server not ready after ${maxAttempts} attempts`));
        }
      });
      req.setTimeout(1000, () => {
        req.destroy();
        if (attempts < maxAttempts) {
          setTimeout(check, interval);
        } else {
          reject(new Error(`Server not ready after ${maxAttempts} attempts`));
        }
      });
    };
    check();
  });
}

// ============================================================
// Start embedded server
// ============================================================
async function startServer() {
  try {
    // Set environment for desktop mode
    // IMPORTANT: These must be set BEFORE requiring the server bundle,
    // because dotenv/config (in server/index.ts) does NOT override existing env vars.
    process.env.NODE_ENV = 'production';
    process.env.STRATUS_DESKTOP = 'true';
    process.env.PORT = process.env.PORT || '5000';
    
    // Auto-generate JWT secret for desktop mode so the server doesn't crash
    if (!process.env.CLIENT_JWT_SECRET) {
      // Use a deterministic secret based on machine + config dir so sessions survive restarts
      process.env.CLIENT_JWT_SECRET = crypto
        .createHash('sha256')
        .update('stratus-desktop-jwt-' + CONFIG_DIR + '-' + require('os').hostname())
        .digest('hex');
      console.log('[Desktop] Auto-generated CLIENT_JWT_SECRET for desktop mode');
    }
    
    // Desktop uses local SQLite database (no remote PostgreSQL)
    // Set DATABASE_URL to empty BEFORE requiring server, because dotenv/config
    // loads .env but won't override existing env vars. This prevents
    // a stale .env DATABASE_URL from activating PostgreSQL mode.
    process.env.DATABASE_URL = '';
    console.log('[Desktop] Using local SQLite database');
    
    // Prevent dotenv from loading a stale .env file in the packaged app
    // by setting DOTENV_CONFIG_PATH to a non-existent path
    if (app.isPackaged) {
      process.env.DOTENV_CONFIG_PATH = path.join(app.getPath('userData'), '.env');
    }
    
    // Start the server in-process
    const serverPath = path.join(__dirname, 'dist', 'server', 'index.js');
    if (fs.existsSync(serverPath)) {
      require(serverPath);
      console.log('[Desktop] Server started on port', process.env.PORT);
      console.log('[Desktop] NODE_ENV:', process.env.NODE_ENV);
    } else {
      console.warn('[Desktop] Server bundle not found at', serverPath);
      console.warn('[Desktop] Run "npm run build" first');
    }
  } catch (err) {
    console.error('[Desktop] Failed to start server:', err);
  }
}

// ============================================================
// IPC Handlers
// ============================================================
function setupIpcHandlers() {
  // Serial port handlers
  ipcMain.handle('serial:list-ports', async () => {
    return await listSerialPorts();
  });

  ipcMain.handle('serial:connect', async (_event, portPath, options) => {
    return await openSerialPort(portPath, options);
  });

  ipcMain.handle('serial:disconnect', async () => {
    return await closeSerialPort();
  });

  ipcMain.handle('serial:send', async (_event, data) => {
    return await sendSerialData(data);
  });

  ipcMain.handle('serial:is-connected', () => {
    return activePort?.isOpen || false;
  });

  // License key handlers
  ipcMain.handle('license:is-valid', () => {
    return isLicenseValid();
  });

  ipcMain.handle('license:activate', (_event, key) => {
    return activateLicense(key);
  });

  ipcMain.handle('license:info', () => {
    return getLicenseInfo();
  });

  // EULA handlers
  ipcMain.handle('eula:is-accepted', () => {
    return isEulaAccepted();
  });

  ipcMain.handle('eula:accept', () => {
    acceptEula();
    return true;
  });

  // Desktop info
  ipcMain.handle('desktop:info', () => {
    return {
      isDesktop: true,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      configDir: CONFIG_DIR,
      serialAvailable: !!SerialPort,
    };
  });

  ipcMain.handle('desktop:get-config', () => {
    return loadConfig();
  });

  ipcMain.handle('desktop:save-config', (_event, config) => {
    saveConfig(config);
    return true;
  });

  // Open external links
  ipcMain.handle('shell:open-external', (_event, url) => {
    shell.openExternal(url);
  });
}

// ============================================================
// App Lifecycle
// ============================================================
app.whenReady().then(async () => {
  // Load serial port module
  loadSerialPort();
  
  // Setup IPC handlers
  setupIpcHandlers();

  // Start the embedded web server
  const config = loadConfig();
  if (config.autoStartServer) {
    await startServer();
  }

  // Create the main window
  const win = createMainWindow();

  // Show loading screen immediately while server starts
  win.loadFile(path.join(__dirname, 'electron', 'loading.html'));

  // Handle load failures — retry or show error
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Desktop] Page failed to load: ${errorDescription} (code ${errorCode}) — URL: ${validatedURL}`);
    // If the server URL failed, wait and retry
    if (validatedURL && validatedURL.includes('localhost')) {
      const port = process.env.PORT || '5000';
      console.log('[Desktop] Retrying server connection...');
      waitForServer(port, 60, 1000).then(() => {
        win.loadURL(`http://localhost:${port}`);
      }).catch(() => {
        dialog.showErrorBox('Stratus', 'Failed to connect to the embedded server. Please restart the application.');
      });
    }
  });

  // Determine what to show first
  const eulaAccepted = isEulaAccepted();
  const licenseValid = isLicenseValid();

  if (!eulaAccepted) {
    // Show setup/EULA page
    win.loadFile(path.join(__dirname, 'electron', 'setup.html'));
  } else if (!licenseValid) {
    // Show license activation page
    console.log('[Desktop] No valid license — showing activation page');
    win.loadFile(path.join(__dirname, 'electron', 'license.html'));
  } else {
    // Licensed — wait for server, then load the app
    const port = process.env.PORT || '5000';
    console.log('[Desktop] License valid — waiting for server...');
    waitForServer(port, 60, 500).then(() => {
      console.log('[Desktop] Server ready — loading app');
      win.loadURL(`http://localhost:${port}`);
    }).catch((err) => {
      console.error('[Desktop] Server failed to start:', err);
      dialog.showErrorBox('Stratus', 'Failed to start the embedded server. Please restart the application.');
    });
  }
});

app.on('window-all-closed', () => {
  // Close serial port
  if (activePort?.isOpen) {
    activePort.close();
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
