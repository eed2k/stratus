import { useEffect } from 'react';
import { useLocation } from 'wouter';

// Type definition for the electron API exposed via preload
declare global {
  interface Window {
    electron?: {
      onMenuAction: (callback: (action: string) => void) => void;
      onNavigate: (callback: (path: string) => void) => void;
      onImportConfig: (callback: (filePath: string) => void) => void;
      getSerialPorts: () => Promise<any[]>;
      getAppPath: () => Promise<string>;
      showSaveDialog: (options: any) => Promise<any>;
      showOpenDialog: (options: any) => Promise<any>;
      platform: string;
      versions: {
        node: string;
        electron: string;
        chrome: string;
      };
    };
  }
}

export function useElectronMenu() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Only set up listeners if running in Electron
    if (!window.electron) {
      return;
    }

    // Handle menu actions
    window.electron.onMenuAction((action: string) => {
      switch (action) {
        case 'new-station':
          setLocation('/stations');
          // Dispatch custom event to open new station dialog
          window.dispatchEvent(new CustomEvent('open-new-station-dialog'));
          break;
        case 'discover-stations':
          setLocation('/stations');
          window.dispatchEvent(new CustomEvent('discover-stations'));
          break;
        case 'test-connection':
          window.dispatchEvent(new CustomEvent('test-connection'));
          break;
        case 'upload-program':
        case 'download-program':
        case 'sync-clock':
          // These are station-specific actions
          window.dispatchEvent(new CustomEvent('station-action', { detail: { action } }));
          break;
        case 'collect-now':
          window.dispatchEvent(new CustomEvent('collect-data'));
          break;
        case 'view-tables':
          setLocation('/history');
          break;
        case 'export-csv':
        case 'export-toa5':
        case 'export-json':
          window.dispatchEvent(new CustomEvent('export-data', { detail: { format: action.replace('export-', '') } }));
          break;
        case 'backup-db':
          window.dispatchEvent(new CustomEvent('backup-database'));
          break;
        // Serial monitor removed - not available in cloud deployment
        case 'serial-monitor':
        case 'pakbus-terminal':
        case 'comm-log':
          // Redirect to stations page instead since serial monitor is not available
          setLocation('/stations');
          break;
        case 'connection-health':
          setLocation('/stations');
          break;
        case 'export-config':
          window.dispatchEvent(new CustomEvent('export-config'));
          break;
        default:
          // Unknown menu action
          break;
      }
    });

    // Handle navigation from menu
    window.electron.onNavigate((path: string) => {
      // Map menu paths to actual routes
      const routeMap: Record<string, string> = {
        '/dashboard': '/',
        '/stations': '/stations',
        '/data': '/history',
        '/editor': '/settings',
      };
      const targetPath = routeMap[path] || path;
      setLocation(targetPath);
    });

    // Handle config import
    window.electron.onImportConfig((filePath: string) => {
      window.dispatchEvent(new CustomEvent('import-config', { detail: { filePath } }));
    });

  }, [setLocation]);
}
