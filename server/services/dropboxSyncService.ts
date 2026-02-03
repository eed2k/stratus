/**
 * Dropbox Sync Service
 * Automatically syncs weather data files from Dropbox App Folder
 * and imports them into Stratus
 * 
 * Supports OAuth 2.0 refresh tokens for 24/7 operation
 * Supports multiple folder configurations from database
 */

import { EventEmitter } from 'events';
import { storage } from '../localStorage';
import { parseDataFile, mapToWeatherData, ParsedRecord } from '../parsers/campbellScientific';

/**
 * Get timezone offset for station (default SAST = UTC+2)
 */
function getStationTimezoneOffset(lat?: number, lon?: number): number {
  if (lat === undefined || lon === undefined) return 2; // Default SAST
  
  // South Africa: SAST (UTC+2)
  if (lat >= -35 && lat <= -22 && lon >= 16 && lon <= 33) return 2;
  // East Africa: EAT (UTC+3)
  if (lat >= -12 && lat <= 5 && lon >= 29 && lon <= 42) return 3;
  // West Africa: WAT (UTC+1)
  if (lat >= -5 && lat <= 13 && lon >= -5 && lon <= 15) return 1;
  // Central Africa: CAT (UTC+2)
  if (lat >= -22 && lat <= -8 && lon >= 12 && lon <= 36) return 2;
  
  return 2; // Default SAST
}

/**
 * Format timestamp in station's local timezone
 */
function formatLocalTime(date: Date, timezoneOffset: number): string {
  const localTime = new Date(date.getTime() + timezoneOffset * 3600000);
  return localTime.toISOString().replace('T', ' ').substring(0, 19);
}

export interface DropboxConfig {
  accessToken: string;
  folderPath: string; // Relative to app folder root (e.g., "" or "/subfolder")
  stationId: number;
  syncInterval: number; // milliseconds
  enabled: boolean;
  // OAuth 2.0 refresh token support for long-running deployments
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
  tokenExpiresAt?: Date;
}

// Database-stored sync configuration
export interface DbDropboxConfig {
  id: number;
  name: string;
  folderPath: string;
  filePattern?: string;
  stationId?: number;
  syncInterval: number;
  enabled: boolean;
  lastSyncAt?: Date;
  lastSyncStatus?: string;
  lastSyncRecords?: number;
}

export interface SyncedFile {
  name: string;
  path: string;
  rev: string; // Dropbox revision ID
  modifiedAt: Date;
  lastSynced: Date;
}

interface DropboxListResponse {
  entries: DropboxEntry[];
  cursor: string;
  has_more: boolean;
}

interface DropboxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_lower: string;
  path_display: string;
  id: string;
  client_modified?: string;
  server_modified?: string;
  rev?: string;
  size?: number;
}

export class DropboxSyncService extends EventEmitter {
  private config: DropboxConfig | null = null;
  private dbConfigs: DbDropboxConfig[] = [];
  private syncedFiles: Map<string, SyncedFile> = new Map();
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private isFullImport: boolean = false;
  private lastSyncTime: Date | null = null;
  private lastError: string | null = null;
  private isRefreshingToken: boolean = false;

  constructor() {
    super();
  }

  /**
   * Refresh the access token using the refresh token
   * Dropbox short-lived tokens expire after 4 hours
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.config?.refreshToken || !this.config?.appKey || !this.config?.appSecret) {
      console.log('[DropboxSync] No refresh token configured, cannot refresh access token');
      return false;
    }

    if (this.isRefreshingToken) {
      console.log('[DropboxSync] Token refresh already in progress');
      return false;
    }

    try {
      this.isRefreshingToken = true;
      console.log('[DropboxSync] Refreshing access token...');

      const credentials = Buffer.from(`${this.config.appKey}:${this.config.appSecret}`).toString('base64');
      
      const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.config.refreshToken,
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[DropboxSync] Token refresh failed:', response.status, errorText);
        this.lastError = `Token refresh failed: ${response.status} - ${errorText}`;
        return false;
      }

      const data = await response.json() as { 
        access_token: string; 
        expires_in: number; 
        token_type: string;
      };

      // Update the access token and expiration time
      this.config.accessToken = data.access_token;
      // Set expiration 5 minutes early to ensure we refresh before actual expiration
      this.config.tokenExpiresAt = new Date(Date.now() + (data.expires_in - 300) * 1000);
      
      console.log(`[DropboxSync] Access token refreshed successfully. Expires at: ${this.config.tokenExpiresAt.toISOString()}`);
      this.lastError = null;
      
      return true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[DropboxSync] Token refresh error:', errMsg);
      this.lastError = `Token refresh error: ${errMsg}`;
      return false;
    } finally {
      this.isRefreshingToken = false;
    }
  }

  /**
   * Ensure we have a valid access token, refreshing if necessary
   */
  private async ensureValidToken(): Promise<boolean> {
    if (!this.config) return false;

    // If we have refresh token support and token is expired or expiring soon
    if (this.config.refreshToken && this.config.appKey && this.config.appSecret) {
      const now = new Date();
      const tokenExpired = this.config.tokenExpiresAt && now >= this.config.tokenExpiresAt;
      const noExpiration = !this.config.tokenExpiresAt; // First time, set expiration

      if (tokenExpired || noExpiration) {
        console.log('[DropboxSync] Token expired or expiration unknown, refreshing...');
        return await this.refreshAccessToken();
      }
    }

    return true;
  }

  /**
   * Check if Dropbox credentials are configured
   */
  hasCredentials(): boolean {
    return !!(this.config?.accessToken || this.config?.refreshToken);
  }

  /**
   * Reinitialize the service with updated configs from database
   */
  async reinitialize(): Promise<void> {
    try {
      this.dbConfigs = await storage.getDropboxConfigs();
      console.log(`[DropboxSync] Reinitialized with ${this.dbConfigs.length} configurations from database`);
    } catch (err) {
      console.error('[DropboxSync] Failed to load configs from database:', err);
    }
  }

  /**
   * Get all database configurations
   */
  getDbConfigs(): DbDropboxConfig[] {
    return this.dbConfigs;
  }

  /**
   * List all .dat files in Dropbox (for UI file browser)
   */
  async listAllFiles(): Promise<{ name: string; path: string; modified: string; size: number }[]> {
    if (!this.config) {
      throw new Error('Dropbox not configured');
    }

    await this.ensureValidToken();

    // List all files recursively from root
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: '',
        recursive: true,
        include_media_info: false,
        include_deleted: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dropbox API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as DropboxListResponse;
    let allEntries = data.entries;

    // Handle pagination
    let cursor = data.cursor;
    while (data.has_more) {
      const continueResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor }),
      });

      if (!continueResponse.ok) break;

      const continueData = await continueResponse.json() as DropboxListResponse;
      allEntries = allEntries.concat(continueData.entries);
      cursor = continueData.cursor;

      if (!continueData.has_more) break;
    }

    // Filter to .dat files only
    return allEntries
      .filter(entry => entry['.tag'] === 'file' && entry.name.toLowerCase().endsWith('.dat'))
      .map(entry => ({
        name: entry.name,
        path: entry.path_display,
        modified: entry.server_modified || '',
        size: entry.size || 0,
      }));
  }

  /**
   * Configure the Dropbox sync service
   */
  configure(config: DropboxConfig): void {
    this.config = config;
    console.log(`[DropboxSync] Configured for station ${config.stationId}, folder: ${config.folderPath || '/'}`);
    
    if (config.enabled) {
      this.startSync();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): DropboxConfig | null {
    return this.config;
  }

  /**
   * Get sync status
   */
  getStatus(): {
    configured: boolean;
    enabled: boolean;
    isSyncing: boolean;
    lastSyncTime: Date | null;
    lastError: string | null;
    syncedFileCount: number;
    dbConfigCount: number;
  } {
    return {
      configured: this.config !== null,
      enabled: this.config?.enabled ?? false,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      syncedFileCount: this.syncedFiles.size,
      dbConfigCount: this.dbConfigs.length,
    };
  }

  /**
   * Start automatic syncing
   */
  startSync(): void {
    if (!this.config) {
      console.warn('[DropboxSync] Cannot start sync - not configured');
      return;
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    console.log(`[DropboxSync] Starting sync every ${this.config.syncInterval / 1000}s`);
    
    // Initial sync
    this.syncNow();

    // Schedule periodic sync
    this.syncTimer = setInterval(() => {
      this.syncNow();
    }, this.config.syncInterval);
  }

  /**
   * Stop automatic syncing
   */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('[DropboxSync] Sync stopped');
    }
  }

  /**
   * Perform a sync now
   * @param fullImport - If true, import all records regardless of timestamp (useful for initial setup)
   */
  async syncNow(fullImport: boolean = false): Promise<{ success: boolean; filesProcessed: number; recordsImported: number; error?: string }> {
    if (!this.config) {
      return { success: false, filesProcessed: 0, recordsImported: 0, error: 'Not configured' };
    }

    if (this.isSyncing) {
      console.log('[DropboxSync] Sync already in progress, skipping');
      return { success: false, filesProcessed: 0, recordsImported: 0, error: 'Sync already in progress' };
    }

    this.isSyncing = true;
    this.isFullImport = fullImport;
    this.lastError = null;
    let filesProcessed = 0;
    let totalRecordsImported = 0;

    try {
      console.log('[DropboxSync] Starting sync...');

      // Extract station name from folder path (e.g., /HOPEFIELD_CR300 -> "Hopefield CR300")
      const folderName = this.config.folderPath.replace(/^\//, '').split('/')[0];
      const stationName = folderName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      // Find or create station
      const stations = await storage.getStations();
      let station: any = null;
      
      // If stationId is provided and > 0, use it
      if (this.config!.stationId > 0) {
        station = stations.find(s => s.id === this.config!.stationId);
      }
      
      // If no station found by ID, try to find by matching name
      if (!station) {
        station = stations.find(s => 
          s.name.toLowerCase() === stationName.toLowerCase() ||
          s.name.toLowerCase().includes(folderName.toLowerCase().replace(/_/g, ' ').split(' ')[0])
        );
        if (station) {
          console.log(`[DropboxSync] Found existing station by name: ${station.name} (ID: ${station.id})`);
          this.config!.stationId = station.id;
        }
      }
      
      // Create station if none found
      if (!station) {
        console.log(`[DropboxSync] Creating new station: ${stationName}`);
        try {
          // Default coordinates for known stations
          const knownStationDefaults: Record<string, { latitude: number; longitude: number; altitude: number; location: string }> = {
            'hopefield': { latitude: -33.0630, longitude: 18.3528, altitude: 95, location: 'Hopefield, Western Cape, South Africa' },
          };
          
          const stationKey = stationName.toLowerCase().split(' ')[0];
          const defaults = knownStationDefaults[stationKey] || {};
          
          station = await storage.createStation({
            name: stationName,
            pakbusAddress: 1,
            connectionType: 'http',
            connectionConfig: { 
              type: 'import-only', 
              importSource: 'dropbox',
              folderPath: this.config.folderPath 
            },
            isActive: true,
            latitude: defaults.latitude,
            longitude: defaults.longitude,
            altitude: defaults.altitude,
            location: defaults.location,
          });
          console.log(`[DropboxSync] Created station: ${station.name} (ID: ${station.id})`);
          this.config!.stationId = station.id;
        } catch (createErr) {
          console.error('[DropboxSync] Failed to create station:', createErr);
          return { success: false, filesProcessed: 0, recordsImported: 0, error: 'Failed to create station' };
        }
      }
      
      // Update existing station with default coordinates if not set
      if (station && (!station.latitude || !station.longitude)) {
        const knownStationDefaults: Record<string, { latitude: number; longitude: number; altitude: number; location: string }> = {
          'hopefield': { latitude: -33.0630, longitude: 18.3528, altitude: 95, location: 'Hopefield, Western Cape, South Africa' },
        };
        const stationKey = station.name.toLowerCase().split(' ')[0];
        const defaults = knownStationDefaults[stationKey];
        if (defaults) {
          try {
            await storage.updateStation(station.id, {
              latitude: defaults.latitude,
              longitude: defaults.longitude,
              altitude: defaults.altitude,
              location: defaults.location,
            });
            console.log(`[DropboxSync] Updated station ${station.name} with default coordinates`);
          } catch (updateErr) {
            console.warn('[DropboxSync] Could not update station coordinates:', updateErr);
          }
        }
      }

      // List files in Dropbox folder
      const files = await this.listFiles(this.config.folderPath);
      console.log(`[DropboxSync] Found ${files.length} files in Dropbox`);

      // Use the same folder name extracted earlier for matching
      const stationPrefix = folderName.split('_')[0].toLowerCase();
      console.log(`[DropboxSync] Looking for files matching station: ${stationPrefix}`);

      // Filter for .dat files only - prioritize files matching station name
      // Skip "conflicted copy" files and old backups
      const datFiles = files.filter(f => {
        if (f['.tag'] !== 'file') return false;
        if (!f.name.toLowerCase().endsWith('.dat')) return false;
        if (f.name.toLowerCase().includes('conflicted copy')) return false;
        if (f.name.toLowerCase().includes('backup')) return false;
        if (f.name.toLowerCase().includes('old')) return false;
        if (f.name.toLowerCase().includes(' - copy')) return false; // Skip manual copies
        if (f.name.toLowerCase().includes('_copy')) return false;
        // Only include files that start with the station prefix
        if (!f.name.toLowerCase().startsWith(stationPrefix)) {
          console.log(`[DropboxSync] Skipping ${f.name} - doesn't match station ${stationPrefix}`);
          return false;
        }
        return true;
      });

      // Sort by modification time descending (newest first)
      datFiles.sort((a, b) => {
        const aTime = a.server_modified ? new Date(a.server_modified).getTime() : 0;
        const bTime = b.server_modified ? new Date(b.server_modified).getTime() : 0;
        return bTime - aTime;
      });

      // Only process the most recently modified .dat file (the one being updated hourly)
      const filesToProcess = datFiles.slice(0, 3); // Process up to 3 most recent files
      console.log(`[DropboxSync] Processing ${filesToProcess.length} matching .dat files`);

      for (const file of filesToProcess) {
        try {
          // Check if file has been updated since last sync
          const existingSynced = this.syncedFiles.get(file.path_lower);
          if (existingSynced && existingSynced.rev === file.rev) {
            console.log(`[DropboxSync] Skipping ${file.name} - no changes`);
            continue;
          }

          console.log(`[DropboxSync] Downloading ${file.name}...`);
          const content = await this.downloadFile(file.path_display);

          // Parse the file
          const parsed = parseDataFile(content);
          if (parsed.errors.length > 0) {
            console.warn(`[DropboxSync] Parse warnings for ${file.name}:`, parsed.errors);
          }

          if (parsed.records.length === 0) {
            console.log(`[DropboxSync] No records in ${file.name}`);
            continue;
          }

          console.log(`[DropboxSync] Parsed ${parsed.records.length} total records from ${file.name}`);

          // Filter records based on import mode
          let recordsToImport: ParsedRecord[];
          if (this.isFullImport) {
            // Full import: import all records (useful for initial setup)
            recordsToImport = parsed.records;
            console.log(`[DropboxSync] Full import: importing all ${recordsToImport.length} records`);
          } else {
            // Normal sync: only import records from the last 48 hours to avoid processing huge historical files
            const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
            recordsToImport = parsed.records.filter(r => r.timestamp > cutoffTime);
            console.log(`[DropboxSync] Importing ${recordsToImport.length} records from last 48 hours`);
          }

          // Import records to database in efficient batches
          let recordsImported = 0;
          const batchSize = 100;
          
          for (let i = 0; i < recordsToImport.length; i += batchSize) {
            const batch = recordsToImport.slice(i, i + batchSize);
            
            // Prepare batch data
            const batchData = batch.map((record: ParsedRecord) => {
              const mappedData = mapToWeatherData(record);
              const combinedData = { ...record.data, ...mappedData };
              return {
                stationId: this.config!.stationId,
                tableName: parsed.tableName || 'Table1',
                recordNumber: record.recordNumber,
                timestamp: record.timestamp,
                data: combinedData,
              };
            });
            
            try {
              // Use batch insert for efficiency
              const inserted = await storage.insertWeatherDataBatch(batchData);
              recordsImported += inserted;
            } catch (err: any) {
              console.warn(`[DropboxSync] Batch insert error, falling back to individual inserts:`, err.message);
              // Fallback to individual inserts
              for (const data of batchData) {
                try {
                  await storage.createWeatherData(data);
                  recordsImported++;
                } catch (individualErr: any) {
                  if (!individualErr.message?.includes('UNIQUE constraint')) {
                    console.warn(`[DropboxSync] Error importing record:`, individualErr.message);
                  }
                }
              }
            }
            
            // Progress update every 500 records
            if (i > 0 && i % 500 === 0) {
              console.log(`[DropboxSync] Progress: ${i}/${recordsToImport.length} records processed`);
            }
          }

          console.log(`[DropboxSync] Imported ${recordsImported} new records from ${file.name}`);
          totalRecordsImported += recordsImported;

          // Mark file as synced
          this.syncedFiles.set(file.path_lower, {
            name: file.name,
            path: file.path_display,
            rev: file.rev!,
            modifiedAt: new Date(file.server_modified!),
            lastSynced: new Date(),
          });

          filesProcessed++;
        } catch (err: any) {
          console.error(`[DropboxSync] Error processing ${file.name}:`, err.message);
        }
      }

      this.lastSyncTime = new Date();
      this.emit('syncComplete', { filesProcessed, recordsImported: totalRecordsImported });
      
      // Get station info for timezone-aware logging
      const stationInfo = await storage.getStation(this.config!.stationId);
      const timezoneOffset = getStationTimezoneOffset(stationInfo?.latitude, stationInfo?.longitude);
      const localTime = formatLocalTime(this.lastSyncTime, timezoneOffset);
      
      console.log(`[DropboxSync] Sync complete: ${filesProcessed} files, ${totalRecordsImported} records`);
      console.log(`[DropboxSync] Local time: ${localTime} (UTC+${timezoneOffset})`);

      // Also sync any database-configured folders
      const dbResults = await this.syncDbConfigs();
      filesProcessed += dbResults.filesProcessed;
      totalRecordsImported += dbResults.recordsImported;

      return { success: true, filesProcessed, recordsImported: totalRecordsImported };
    } catch (err: any) {
      this.lastError = err.message;
      console.error('[DropboxSync] Sync error:', err.message);
      this.emit('syncError', err);
      return { success: false, filesProcessed, recordsImported: totalRecordsImported, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sync files based on database configurations
   */
  private async syncDbConfigs(): Promise<{ filesProcessed: number; recordsImported: number }> {
    let filesProcessed = 0;
    let recordsImported = 0;

    try {
      // Reload configs from database
      this.dbConfigs = await storage.getDropboxConfigs();
      
      if (this.dbConfigs.length === 0) {
        return { filesProcessed: 0, recordsImported: 0 };
      }

      console.log(`[DropboxSync] Processing ${this.dbConfigs.length} database configurations...`);

      // Get all files from Dropbox
      const allFiles = await this.listAllFiles();

      for (const dbConfig of this.dbConfigs) {
        if (!dbConfig.enabled) {
          console.log(`[DropboxSync] Skipping disabled config: ${dbConfig.name}`);
          continue;
        }

        console.log(`[DropboxSync] Processing config: ${dbConfig.name} (folder: ${dbConfig.folderPath})`);

        // Find matching files based on folder path and optional file pattern
        const matchingFiles = allFiles.filter(file => {
          // Check if file is in the configured folder
          const inFolder = file.path.toLowerCase().startsWith(dbConfig.folderPath.toLowerCase());
          
          // Check file pattern if specified (e.g., "HOPEFIELD*" or "*Table1*")
          if (dbConfig.filePattern) {
            const pattern = dbConfig.filePattern.replace(/\*/g, '.*');
            const regex = new RegExp(pattern, 'i');
            return inFolder && regex.test(file.name);
          }
          
          return inFolder;
        });

        console.log(`[DropboxSync] Found ${matchingFiles.length} matching files for ${dbConfig.name}`);

        for (const file of matchingFiles) {
          try {
            // Check if file has been modified since last sync
            const fileKey = `${dbConfig.id}:${file.path}`;
            const existingSynced = this.syncedFiles.get(fileKey);
            if (existingSynced && new Date(file.modified) <= existingSynced.modifiedAt) {
              console.log(`[DropboxSync] Skipping ${file.name} - no changes`);
              continue;
            }

            console.log(`[DropboxSync] Downloading ${file.name}...`);
            const content = await this.downloadFile(file.path);

            // Parse the file
            const parsed = parseDataFile(content);
            if (!parsed || parsed.records.length === 0) {
              console.warn(`[DropboxSync] No records found in ${file.name}`);
              continue;
            }

            console.log(`[DropboxSync] Parsed ${parsed.records.length} total records from ${file.name}`);

            // Extract station name from file or use config name
            const stationName = dbConfig.name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
            
            // Find or create station
            const stations = await storage.getStations();
            let station: any = dbConfig.stationId 
              ? stations.find(s => s.id === dbConfig.stationId)
              : stations.find(s => 
                  s.name.toLowerCase() === stationName.toLowerCase() ||
                  s.name.toLowerCase().includes(dbConfig.name.toLowerCase().split('_')[0])
                );

            if (!station) {
              console.log(`[DropboxSync] Creating new station: ${stationName}`);
              station = await storage.createStation({
                name: stationName,
                pakbusAddress: 1,
                connectionType: 'http',
                connectionConfig: { 
                  type: 'import-only', 
                  importSource: 'dropbox',
                  folderPath: dbConfig.folderPath 
                },
                isActive: true,
              });
              
              // Update config with new station ID
              await storage.updateDropboxConfig(dbConfig.id, { stationId: station.id });
            }

            // Filter records based on import mode
            let recordsToImport: ParsedRecord[];
            if (this.isFullImport) {
              // Full import: import all records (useful for initial setup)
              recordsToImport = parsed.records;
              console.log(`[DropboxSync] Full import: importing all ${recordsToImport.length} records`);
            } else {
              // Normal sync: filter to last 48 hours
              const cutoffTime = new Date();
              cutoffTime.setHours(cutoffTime.getHours() - 48);
              recordsToImport = parsed.records.filter(r => r.timestamp >= cutoffTime);
              console.log(`[DropboxSync] Importing ${recordsToImport.length} records from last 48 hours`);
            }

            let configRecordsImported = 0;
            const BATCH_SIZE = 100;
            
            for (let i = 0; i < recordsToImport.length; i += BATCH_SIZE) {
              const batch = recordsToImport.slice(i, i + BATCH_SIZE);
              const batchData = batch.map(record => {
                const mappedData = mapToWeatherData(record);
                return {
                  stationId: station.id,
                  tableName: parsed.tableName || 'Table1',
                  recordNumber: record.recordNumber,
                  timestamp: record.timestamp,
                  data: { ...record.data, ...mappedData },
                };
              });

              try {
                const inserted = await storage.insertWeatherDataBatch(batchData);
                configRecordsImported += inserted;
              } catch (err: any) {
                for (const data of batchData) {
                  try {
                    await storage.createWeatherData(data);
                    configRecordsImported++;
                  } catch (individualErr: any) {
                    if (!individualErr.message?.includes('UNIQUE constraint')) {
                      console.warn(`[DropboxSync] Error importing record:`, individualErr.message);
                    }
                  }
                }
              }
            }

            console.log(`[DropboxSync] Imported ${configRecordsImported} records from ${file.name}`);
            recordsImported += configRecordsImported;
            filesProcessed++;

            // Mark file as synced
            this.syncedFiles.set(fileKey, {
              name: file.name,
              path: file.path,
              rev: '',
              modifiedAt: new Date(file.modified),
              lastSynced: new Date(),
            });

            // Update sync status in database
            await storage.updateDropboxSyncStatus(dbConfig.id, 'success', configRecordsImported);
          } catch (fileErr: any) {
            console.error(`[DropboxSync] Error processing ${file.name}:`, fileErr.message);
            await storage.updateDropboxSyncStatus(dbConfig.id, `error: ${fileErr.message}`, 0);
          }
        }
      }
    } catch (err: any) {
      console.error('[DropboxSync] Error syncing db configs:', err.message);
    }

    return { filesProcessed, recordsImported };
  }

  /**
   * List files in Dropbox folder
   */
  private async listFiles(folderPath: string): Promise<DropboxEntry[]> {
    // Ensure we have a valid token before making API calls
    await this.ensureValidToken();
    
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config!.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: folderPath || '', // Empty string = app folder root
        recursive: false,
        include_media_info: false,
        include_deleted: false,
        include_has_explicit_shared_members: false,
        include_mounted_folders: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // If we get a 401, try to refresh the token and retry once
      if (response.status === 401 && this.config?.refreshToken) {
        console.log('[DropboxSync] Got 401, attempting token refresh and retry...');
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry the request with the new token
          return this.listFiles(folderPath);
        }
      }
      
      throw new Error(`Dropbox API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as DropboxListResponse;
    let allEntries = data.entries;

    // Handle pagination
    let cursor = data.cursor;
    while (data.has_more) {
      const continueResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config!.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor }),
      });

      if (!continueResponse.ok) {
        break;
      }

      const continueData = await continueResponse.json() as DropboxListResponse;
      allEntries = allEntries.concat(continueData.entries);
      cursor = continueData.cursor;
      
      if (!continueData.has_more) break;
    }

    return allEntries;
  }

  /**
   * Download file content from Dropbox
   */
  private async downloadFile(filePath: string): Promise<string> {
    // Ensure we have a valid token before making API calls
    await this.ensureValidToken();
    
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config!.accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: filePath }),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // If we get a 401, try to refresh the token and retry once
      if (response.status === 401 && this.config?.refreshToken) {
        console.log('[DropboxSync] Got 401 on download, attempting token refresh and retry...');
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry the request with the new token
          return this.downloadFile(filePath);
        }
      }
      
      throw new Error(`Dropbox download error: ${response.status} - ${errorText}`);
    }

    return await response.text();
  }

  /**
   * Test the Dropbox connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; files?: string[] }> {
    if (!this.config) {
      return { success: false, message: 'Not configured' };
    }

    try {
      const files = await this.listFiles(this.config.folderPath);
      const fileNames = files
        .filter(f => f['.tag'] === 'file')
        .map(f => f.name);
      
      return {
        success: true,
        message: `Connected! Found ${files.length} items in folder`,
        files: fileNames,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
      };
    }
  }

  /**
   * List ALL files and folders in Dropbox root (for discovery)
   */
  async listAllDropboxContents(): Promise<{ folders: string[]; files: { name: string; path: string; modified: string; size: number }[] }> {
    if (!this.config) {
      throw new Error('Not configured');
    }

    await this.ensureValidToken();

    // List recursively from root
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: '', // Root of app folder
        recursive: true, // Get everything
        include_media_info: false,
        include_deleted: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dropbox API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as DropboxListResponse;
    let allEntries = data.entries;

    // Handle pagination
    let cursor = data.cursor;
    let hasMore = data.has_more;
    while (hasMore) {
      const continueResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor }),
      });

      if (!continueResponse.ok) break;

      const continueData = await continueResponse.json() as DropboxListResponse;
      allEntries = allEntries.concat(continueData.entries);
      cursor = continueData.cursor;
      hasMore = continueData.has_more;
    }

    // Separate folders and files
    const folders = allEntries
      .filter(e => e['.tag'] === 'folder')
      .map(e => e.path_display);

    const files = allEntries
      .filter(e => e['.tag'] === 'file')
      .map(e => ({
        name: e.name,
        path: e.path_display,
        modified: e.server_modified || '',
        size: e.size || 0,
      }));

    // Log discovery results
    console.log('[DropboxSync] === DROPBOX CONTENTS DISCOVERY ===');
    console.log(`[DropboxSync] Found ${folders.length} folders:`);
    folders.forEach(f => console.log(`[DropboxSync]   📁 ${f}`));
    console.log(`[DropboxSync] Found ${files.length} files:`);
    files.forEach(f => console.log(`[DropboxSync]   📄 ${f.path} (${(f.size / 1024).toFixed(1)} KB, modified: ${f.modified})`));
    console.log('[DropboxSync] === END DISCOVERY ===');

    return { folders, files };
  }
}

// Singleton instance
export const dropboxSyncService = new DropboxSyncService();
