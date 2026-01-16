/**
 * Dropbox Sync Service
 * Automatically syncs weather data files from Dropbox App Folder
 * and imports them into Stratus
 * 
 * Supports OAuth 2.0 refresh tokens for 24/7 operation
 */

import { EventEmitter } from 'events';
import { storage } from '../localStorage';
import { parseDataFile, mapToWeatherData, ParsedRecord } from '../parsers/campbellScientific';

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
  private syncedFiles: Map<string, SyncedFile> = new Map();
  private syncTimer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
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
  } {
    return {
      configured: this.config !== null,
      enabled: this.config?.enabled ?? false,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      syncedFileCount: this.syncedFiles.size,
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
   */
  async syncNow(): Promise<{ success: boolean; filesProcessed: number; recordsImported: number; error?: string }> {
    if (!this.config) {
      return { success: false, filesProcessed: 0, recordsImported: 0, error: 'Not configured' };
    }

    if (this.isSyncing) {
      console.log('[DropboxSync] Sync already in progress, skipping');
      return { success: false, filesProcessed: 0, recordsImported: 0, error: 'Sync already in progress' };
    }

    this.isSyncing = true;
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

          // Only import records from the last 48 hours to avoid processing huge historical files
          // This keeps syncs fast while still catching any gaps
          const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
          const recentRecords = parsed.records.filter(r => r.timestamp > cutoffTime);
          
          console.log(`[DropboxSync] Importing ${recentRecords.length} records from last 48 hours`);

          // Import records to database in efficient batches
          let recordsImported = 0;
          const batchSize = 100;
          
          for (let i = 0; i < recentRecords.length; i += batchSize) {
            const batch = recentRecords.slice(i, i + batchSize);
            
            // Prepare batch data
            const batchData = batch.map(record => {
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
              console.log(`[DropboxSync] Progress: ${i}/${recentRecords.length} records processed`);
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
      console.log(`[DropboxSync] Sync complete: ${filesProcessed} files, ${totalRecordsImported} records`);

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
}

// Singleton instance
export const dropboxSyncService = new DropboxSyncService();
