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
// Password Protection
// ============================================================
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'stratus-desktop-salt').digest('hex');
}

function isPasswordSet() {
  ensureConfigDir();
  return fs.existsSync(PASSWORD_FILE);
}

function verifyPassword(password) {
  if (!isPasswordSet()) return true;
  try {
    const stored = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
    return stored === hashPassword(password);
  } catch {
    return false;
  }
}

function setPassword(password) {
  ensureConfigDir();
  fs.writeFileSync(PASSWORD_FILE, hashPassword(password));
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
    webPreferences: {
      preload: path.join(__dirname, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
// Start embedded server
// ============================================================
async function startServer() {
  try {
    // Set environment for desktop mode
    process.env.STRATUS_DESKTOP = 'true';
    process.env.PORT = process.env.PORT || '5000';
    
    // Start the server in-process
    const serverPath = path.join(__dirname, 'dist', 'server', 'index.js');
    if (fs.existsSync(serverPath)) {
      require(serverPath);
      console.log('[Desktop] Server started on port', process.env.PORT);
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

  // Password handlers
  ipcMain.handle('auth:check-password-set', () => {
    return isPasswordSet();
  });

  ipcMain.handle('auth:verify-password', (_event, password) => {
    return verifyPassword(password);
  });

  ipcMain.handle('auth:set-password', (_event, password) => {
    setPassword(password);
    return true;
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

  // Determine what to show first
  const eulaAccepted = isEulaAccepted();
  const passwordSet = isPasswordSet();

  if (!eulaAccepted) {
    // Show setup/EULA page
    win.loadFile(path.join(__dirname, 'electron', 'setup.html'));
  } else if (passwordSet) {
    // Show password login
    win.loadFile(path.join(__dirname, 'electron', 'login.html'));
  } else {
    // Go straight to the app
    const port = process.env.PORT || '5000';
    // Wait a moment for server to start
    setTimeout(() => {
      win.loadURL(`http://localhost:${port}`);
    }, 2000);
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
