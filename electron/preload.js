const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electron', {
  // Serial port operations
  getSerialPorts: () => ipcRenderer.invoke('get-serial-ports'),
  
  // App paths
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  
  // Dialog operations
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  
  // Menu actions
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (event, action) => callback(action));
  },
  
  // Navigation
  onNavigate: (callback) => {
    ipcRenderer.on('navigate', (event, path) => callback(path));
  },
  
  // Config import
  onImportConfig: (callback) => {
    ipcRenderer.on('import-config', (event, filePath) => callback(filePath));
  },
  
  // Welcome/First-run functions
  login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
  register: (userData) => ipcRenderer.invoke('auth:register', userData),
  completeWelcome: () => ipcRenderer.send('welcome-complete'),
  skipWelcome: () => ipcRenderer.send('welcome-skip'),
  
  // Platform info
  platform: process.platform,
  
  // Version info
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome
  }
});

// Expose PakBus-specific APIs
contextBridge.exposeInMainWorld('pakbus', {
  // Connection types
  CONNECTION_TYPES: {
    SERIAL: 'serial',
    TCP: 'tcp',
    RF: 'rf',
    GSM: 'gsm',
    LORA: 'lora',
    BLE: 'ble'
  },
  
  // Message types
  MESSAGE_TYPES: {
    HELLO: 0x09,
    GET_SETTINGS: 0x0F,
    SET_SETTINGS: 0x10,
    GET_TABLE_DEF: 0x11,
    COLLECT_DATA: 0x12,
    FILE_SEND: 0x1C,
    FILE_RECEIVE: 0x1D,
    CLOCK_SET: 0x17,
    PLEASE_WAIT: 0xA1
  }
});
