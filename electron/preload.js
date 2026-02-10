/**
 * Stratus Desktop - Preload Script
 * 
 * Exposes safe APIs to the renderer process via contextBridge.
 * This enables the React app to access serial port, password,
 * and desktop-specific features securely.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stratusDesktop', {
  // Check if running in desktop mode
  isDesktop: true,

  // Desktop info
  getInfo: () => ipcRenderer.invoke('desktop:info'),
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('desktop:save-config', config),

  // Serial port operations
  serial: {
    listPorts: () => ipcRenderer.invoke('serial:list-ports'),
    connect: (portPath, options) => ipcRenderer.invoke('serial:connect', portPath, options),
    disconnect: () => ipcRenderer.invoke('serial:disconnect'),
    send: (data) => ipcRenderer.invoke('serial:send', data),
    isConnected: () => ipcRenderer.invoke('serial:is-connected'),

    // Event listeners
    onData: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('serial:data', handler);
      return () => ipcRenderer.removeListener('serial:data', handler);
    },
    onError: (callback) => {
      const handler = (_event, error) => callback(error);
      ipcRenderer.on('serial:error', handler);
      return () => ipcRenderer.removeListener('serial:error', handler);
    },
    onDisconnected: (callback) => {
      const handler = (_event, info) => callback(info);
      ipcRenderer.on('serial:disconnected', handler);
      return () => ipcRenderer.removeListener('serial:disconnected', handler);
    },
    onPortsUpdated: (callback) => {
      const handler = (_event, ports) => callback(ports);
      ipcRenderer.on('serial:ports-updated', handler);
      return () => ipcRenderer.removeListener('serial:ports-updated', handler);
    },
  },

  // License
  license: {
    isValid: () => ipcRenderer.invoke('license:is-valid'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    getInfo: () => ipcRenderer.invoke('license:info'),
  },

  // EULA
  eula: {
    isAccepted: () => ipcRenderer.invoke('eula:is-accepted'),
    accept: () => ipcRenderer.invoke('eula:accept'),
  },

  // Navigation events from menu
  onNavigate: (callback) => {
    const handler = (_event, path) => callback(path);
    ipcRenderer.on('navigate', handler);
    return () => ipcRenderer.removeListener('navigate', handler);
  },

  onShowChangePassword: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('show-change-password', handler);
    return () => ipcRenderer.removeListener('show-change-password', handler);
  },

  // Launch app (used by license.html after activation to avoid file:// CORS issues)
  launchApp: () => ipcRenderer.invoke('desktop:launch-app'),

  // External links
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});
