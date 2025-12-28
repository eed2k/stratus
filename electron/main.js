const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Keep a global reference of the window object
let mainWindow = null;
let serverProcess = null;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const SERVER_PORT = 5000;

/**
 * Get the correct icon path based on platform and whether app is packaged
 * In development: assets are relative to project root
 * In production: assets are in resources/assets (extraResources)
 */
function getIconPath() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  
  if (isDev) {
    // Development: assets folder is relative to electron folder
    return path.join(__dirname, '..', 'assets', iconFile);
  } else {
    // Production: assets are copied to resources/assets by extraResources
    return path.join(process.resourcesPath, 'assets', iconFile);
  }
}

function createWindow() {
  // Get the correct icon path
  const iconPath = getIconPath();
  console.log('Using icon path:', iconPath);

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: iconPath,
    title: 'Stratus Weather Server',
    show: false,
    backgroundColor: '#ffffff'
  });

  // Create application menu
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Station',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu-action', 'new-station')
        },
        { type: 'separator' },
        {
          label: 'Import Configuration',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'Configuration', extensions: ['json', 'xml'] }]
            });
            if (!result.canceled) {
              mainWindow.webContents.send('import-config', result.filePaths[0]);
            }
          }
        },
        {
          label: 'Export Configuration',
          click: () => mainWindow.webContents.send('menu-action', 'export-config')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Station',
      submenu: [
        {
          label: 'Discover Stations',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow.webContents.send('menu-action', 'discover-stations')
        },
        {
          label: 'Test Connection',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow.webContents.send('menu-action', 'test-connection')
        },
        { type: 'separator' },
        {
          label: 'Upload Program',
          click: () => mainWindow.webContents.send('menu-action', 'upload-program')
        },
        {
          label: 'Download Program',
          click: () => mainWindow.webContents.send('menu-action', 'download-program')
        },
        { type: 'separator' },
        {
          label: 'Sync Clock',
          click: () => mainWindow.webContents.send('menu-action', 'sync-clock')
        }
      ]
    },
    {
      label: 'Data',
      submenu: [
        {
          label: 'Collect Now',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('menu-action', 'collect-now')
        },
        {
          label: 'View Data Tables',
          click: () => mainWindow.webContents.send('menu-action', 'view-tables')
        },
        { type: 'separator' },
        {
          label: 'Export Data',
          submenu: [
            {
              label: 'Export as CSV',
              click: () => mainWindow.webContents.send('menu-action', 'export-csv')
            },
            {
              label: 'Export as TOA5',
              click: () => mainWindow.webContents.send('menu-action', 'export-toa5')
            },
            {
              label: 'Export as JSON',
              click: () => mainWindow.webContents.send('menu-action', 'export-json')
            }
          ]
        },
        { type: 'separator' },
        {
          label: 'Backup Database',
          click: () => mainWindow.webContents.send('menu-action', 'backup-db')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow.webContents.send('navigate', '/dashboard')
        },
        {
          label: 'Stations',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow.webContents.send('navigate', '/stations')
        },
        {
          label: 'Data Collection',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow.webContents.send('navigate', '/data')
        },
        {
          label: 'Program Editor',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow.webContents.send('navigate', '/editor')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Serial Monitor',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => mainWindow.webContents.send('menu-action', 'serial-monitor')
        },
        {
          label: 'PakBus Terminal',
          click: () => mainWindow.webContents.send('menu-action', 'pakbus-terminal')
        },
        { type: 'separator' },
        {
          label: 'Connection Health',
          click: () => mainWindow.webContents.send('menu-action', 'connection-health')
        },
        {
          label: 'Communication Log',
          click: () => mainWindow.webContents.send('menu-action', 'comm-log')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Campbell Scientific Support',
          click: () => shell.openExternal('https://www.campbellsci.com/support')
        },
        { type: 'separator' },
        {
          label: 'Contact Developer',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Contact Developer',
              message: 'Contact Developer',
              detail: 'For any queries, contact:\n\nLukas Esterhuizen\nesterhuizen2k@proton.me'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Stratus Weather Server',
              message: 'Stratus Weather Server',
              detail: `Version: ${app.getVersion()}\n\nCampbell Scientific Weather Station Management\nPakBus Protocol Support\n\nDeveloped by Lukas Esterhuizen\nesterhuizen2k@proton.me\n\n© 2024-2025 Lukas Esterhuizen`
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load the app - always load from server (API calls need the server running)
  if (isDev) {
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from the server too so API calls work
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  if (isDev) {
    console.log('Development mode - server should be started separately');
    return;
  }

  const fs = require('fs');
  let serverPath;
  let cwd;
  
  if (app.isPackaged) {
    // Packaged app - files are in resources/app folder (asar disabled)
    const resourcesPath = process.resourcesPath;
    serverPath = path.join(resourcesPath, 'app', 'dist', 'server', 'index.js');
    cwd = path.join(resourcesPath, 'app');
    
    console.log('Packaged app detected');
    console.log('Resources path:', resourcesPath);
  } else {
    // Development - use relative path from electron folder
    serverPath = path.join(__dirname, '..', 'dist', 'server', 'index.js');
    cwd = path.join(__dirname, '..');
  }
  
  console.log('Starting server from:', serverPath);
  console.log('Working directory:', cwd);
  console.log('Server exists:', fs.existsSync(serverPath));
  
  if (!fs.existsSync(serverPath)) {
    dialog.showErrorBox('Server Error', `Server file not found at: ${serverPath}`);
    return;
  }
  
  serverProcess = spawn('node', [serverPath], {
    env: { 
      ...process.env, 
      PORT: SERVER_PORT.toString(),
      NODE_ENV: 'production'
    },
    stdio: 'pipe',
    cwd: cwd
  });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data}`);
  });

  serverProcess.on('error', (error) => {
    console.error('Failed to start server:', error);
    dialog.showErrorBox('Server Error', `Failed to start server: ${error.message}\n\nPath: ${serverPath}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
    if (code !== 0 && code !== null) {
      dialog.showErrorBox('Server Error', `Server exited with code ${code}`);
    }
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// IPC Handlers
ipcMain.handle('get-serial-ports', async () => {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    return ports;
  } catch (error) {
    console.error('Error listing serial ports:', error);
    return [];
  }
});

ipcMain.handle('get-app-path', () => {
  return app.getPath('userData');
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('show-open-dialog', async (event, options) => {
  return dialog.showOpenDialog(mainWindow, options);
});

// App lifecycle
app.whenReady().then(() => {
  startServer();
  
  // Wait for server to start
  setTimeout(createWindow, isDev ? 0 : 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopServer();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Error', `An unexpected error occurred: ${error.message}`);
});
