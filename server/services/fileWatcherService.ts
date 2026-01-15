/**
 * File Watcher Service
 * Watches a local folder (e.g., Dropbox sync folder) for new/updated .dat files
 * and automatically imports them into Stratus
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { storage } from '../localStorage';
import { parseDataFile, mapToWeatherData } from '../parsers/campbellScientific';

export interface WatchedFolder {
  id: string;
  stationId: number;
  folderPath: string;
  filePattern: string;
  enabled: boolean;
  lastScan: Date | null;
  processedFiles: Set<string>;
}

export interface FileWatcherConfig {
  scanInterval: number; // milliseconds
  enableAutoImport: boolean;
}

export class FileWatcherService extends EventEmitter {
  private watchedFolders: Map<string, WatchedFolder> = new Map();
  private scanTimers: Map<string, NodeJS.Timeout> = new Map();
  private config: FileWatcherConfig;
  private initialized: boolean = false;

  constructor() {
    super();
    this.config = {
      scanInterval: 60000, // 1 minute default
      enableAutoImport: true,
    };
  }

  /**
   * Initialize the file watcher service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[FileWatcher] Initializing...');

    // Load watched folders from database/config
    try {
      const folders = await this.loadWatchedFolders();
      for (const folder of folders) {
        await this.addWatchedFolder(folder);
      }
      this.initialized = true;
      console.log(`[FileWatcher] Initialized with ${this.watchedFolders.size} watched folders`);
    } catch (error) {
      console.error('[FileWatcher] Initialization error:', error);
    }
  }

  /**
   * Load watched folders configuration
   */
  private async loadWatchedFolders(): Promise<WatchedFolder[]> {
    // For now, return empty - will be configured via API
    // In future, load from database
    return [];
  }

  /**
   * Add a folder to watch for new data files
   */
  async addWatchedFolder(config: Omit<WatchedFolder, 'lastScan' | 'processedFiles'>): Promise<void> {
    const folder: WatchedFolder = {
      ...config,
      lastScan: null,
      processedFiles: new Set(),
    };

    // Validate folder exists
    if (!fs.existsSync(folder.folderPath)) {
      console.warn(`[FileWatcher] Folder does not exist: ${folder.folderPath}`);
      // Try to create it
      try {
        fs.mkdirSync(folder.folderPath, { recursive: true });
        console.log(`[FileWatcher] Created folder: ${folder.folderPath}`);
      } catch (err) {
        console.error(`[FileWatcher] Cannot create folder: ${folder.folderPath}`);
        throw new Error(`Folder does not exist and cannot be created: ${folder.folderPath}`);
      }
    }

    this.watchedFolders.set(folder.id, folder);

    if (folder.enabled) {
      this.startWatching(folder.id);
    }

    console.log(`[FileWatcher] Added watched folder: ${folder.folderPath} for station ${folder.stationId}`);
  }

  /**
   * Remove a watched folder
   */
  async removeWatchedFolder(folderId: string): Promise<void> {
    this.stopWatching(folderId);
    this.watchedFolders.delete(folderId);
    console.log(`[FileWatcher] Removed watched folder: ${folderId}`);
  }

  /**
   * Start watching a folder
   */
  private startWatching(folderId: string): void {
    const folder = this.watchedFolders.get(folderId);
    if (!folder) return;

    // Initial scan
    this.scanFolder(folderId);

    // Setup periodic scan
    const timer = setInterval(() => {
      this.scanFolder(folderId);
    }, this.config.scanInterval);

    this.scanTimers.set(folderId, timer);
    console.log(`[FileWatcher] Started watching: ${folder.folderPath}`);
  }

  /**
   * Stop watching a folder
   */
  private stopWatching(folderId: string): void {
    const timer = this.scanTimers.get(folderId);
    if (timer) {
      clearInterval(timer);
      this.scanTimers.delete(folderId);
    }
  }

  /**
   * Scan a folder for new files
   */
  private async scanFolder(folderId: string): Promise<void> {
    const folder = this.watchedFolders.get(folderId);
    if (!folder || !folder.enabled) return;

    try {
      const files = fs.readdirSync(folder.folderPath);
      const pattern = new RegExp(folder.filePattern || '\\.dat$', 'i');

      for (const filename of files) {
        if (!pattern.test(filename)) continue;
        if (folder.processedFiles.has(filename)) continue;

        const filePath = path.join(folder.folderPath, filename);
        const stats = fs.statSync(filePath);

        // Only process files, not directories
        if (!stats.isFile()) continue;

        // Check if file was modified since last scan
        if (folder.lastScan && stats.mtime <= folder.lastScan) {
          folder.processedFiles.add(filename);
          continue;
        }

        // Import the file
        await this.importFile(folder.stationId, filePath, filename);
        folder.processedFiles.add(filename);

        this.emit('fileImported', {
          folderId,
          stationId: folder.stationId,
          filename,
          filePath,
        });
      }

      folder.lastScan = new Date();
    } catch (error) {
      console.error(`[FileWatcher] Error scanning folder ${folder.folderPath}:`, error);
      this.emit('error', { folderId, error });
    }
  }

  /**
   * Import a data file into a station
   */
  private async importFile(stationId: number, filePath: string, filename: string): Promise<number> {
    console.log(`[FileWatcher] Importing file: ${filename} to station ${stationId}`);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseDataFile(content);

      if (parsed.errors.length > 0 && parsed.records.length === 0) {
        console.error(`[FileWatcher] Failed to parse ${filename}:`, parsed.errors);
        return 0;
      }

      let importedCount = 0;

      for (const record of parsed.records) {
        try {
          const weatherData = mapToWeatherData(record);

          // Only insert if we have some valid data
          if (Object.values(weatherData).some(v => v !== null)) {
            await storage.insertWeatherData({
              stationId,
              timestamp: record.timestamp,
              tableName: 'import',
              data: {
                temperature: weatherData.temperature ?? undefined,
                humidity: weatherData.humidity ?? undefined,
                pressure: weatherData.pressure ?? undefined,
                windSpeed: weatherData.windSpeed ?? undefined,
                windDirection: weatherData.windDirection ?? undefined,
                windGust: weatherData.windGust ?? undefined,
                solarRadiation: weatherData.solarRadiation ?? undefined,
                rainfall: weatherData.rainfall ?? undefined,
                dewPoint: weatherData.dewPoint ?? undefined,
                soilTemperature: weatherData.soilTemperature ?? undefined,
                soilMoisture: weatherData.soilMoisture ?? undefined,
                batteryVoltage: weatherData.batteryVoltage ?? undefined,
                panelTemperature: weatherData.panelTemperature ?? undefined,
              }
            });
            importedCount++;
          }
        } catch (err: any) {
          console.error(`[FileWatcher] Error importing record from ${filename}:`, err.message);
        }
      }

      console.log(`[FileWatcher] Imported ${importedCount} records from ${filename}`);
      return importedCount;
    } catch (error) {
      console.error(`[FileWatcher] Error reading file ${filePath}:`, error);
      return 0;
    }
  }

  /**
   * Manually trigger a scan of all watched folders
   */
  async scanAll(): Promise<void> {
    for (const folderId of this.watchedFolders.keys()) {
      await this.scanFolder(folderId);
    }
  }

  /**
   * Get all watched folders
   */
  getWatchedFolders(): WatchedFolder[] {
    return Array.from(this.watchedFolders.values());
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<FileWatcherConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Stop all watchers
   */
  async shutdown(): Promise<void> {
    for (const folderId of this.scanTimers.keys()) {
      this.stopWatching(folderId);
    }
    this.watchedFolders.clear();
    console.log('[FileWatcher] Shutdown complete');
  }
}

// Singleton instance
export const fileWatcherService = new FileWatcherService();
