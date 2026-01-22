/**
 * Dropbox Sync API Routes
 * Provides endpoints to configure and manage Dropbox synchronization
 */

import { Router, Request, Response } from 'express';
import { dropboxSyncService, DropboxConfig } from './dropboxSyncService';
import { storage } from '../localStorage';

const router = Router();

/**
 * GET /api/dropbox-sync/status
 * Get the current sync status
 */
router.get('/status', (req: Request, res: Response) => {
  const status = dropboxSyncService.getStatus();
  res.json(status);
});

/**
 * GET /api/dropbox-sync/configs
 * Get all Dropbox sync configurations from database
 */
router.get('/configs', async (req: Request, res: Response) => {
  try {
    const configs = await storage.getDropboxConfigs();
    res.json(configs);
  } catch (err: any) {
    console.error('[DropboxSync] Error getting configs:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dropbox-sync/configs
 * Create a new Dropbox sync configuration
 */
router.post('/configs', async (req: Request, res: Response) => {
  try {
    const { name, folderPath, filePattern, stationId, syncInterval, enabled } = req.body;
    
    if (!name || !folderPath) {
      return res.status(400).json({ error: 'Name and folder path are required' });
    }
    
    const config = await storage.createDropboxConfig({
      name,
      folderPath,
      filePattern,
      stationId,
      syncInterval: syncInterval || 3600000,
      enabled: enabled !== false,
    });
    
    // Reinitialize sync service to pick up new config
    await dropboxSyncService.reinitialize();
    
    res.json({ success: true, config });
  } catch (err: any) {
    console.error('[DropboxSync] Error creating config:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/dropbox-sync/configs/:id
 * Update a Dropbox sync configuration
 */
router.put('/configs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, folderPath, filePattern, stationId, syncInterval, enabled } = req.body;
    
    const config = await storage.updateDropboxConfig(id, {
      name,
      folderPath,
      filePattern,
      stationId,
      syncInterval,
      enabled,
    });
    
    // Reinitialize sync service to pick up changes
    await dropboxSyncService.reinitialize();
    
    res.json({ success: true, config });
  } catch (err: any) {
    console.error('[DropboxSync] Error updating config:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/dropbox-sync/configs/:id
 * Delete a Dropbox sync configuration
 */
router.delete('/configs/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    await storage.deleteDropboxConfig(id);
    
    // Reinitialize sync service to pick up changes
    await dropboxSyncService.reinitialize();
    
    res.json({ success: true });
  } catch (err: any) {
    console.error('[DropboxSync] Error deleting config:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dropbox-sync/files
 * List all available .dat files in Dropbox (for browsing)
 */
router.get('/files', async (req: Request, res: Response) => {
  try {
    const files = await dropboxSyncService.listAllFiles();
    res.json(files);
  } catch (err: any) {
    console.error('[DropboxSync] Error listing files:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dropbox-sync/credentials
 * Check if Dropbox credentials are configured
 */
router.get('/credentials', (req: Request, res: Response) => {
  const configured = dropboxSyncService.hasCredentials();
  // Return whether refresh token is configured (for UI display)
  const hasRefreshToken = !!process.env.DROPBOX_REFRESH_TOKEN;
  res.json({ 
    configured,
    hasRefreshToken,
    // Return partial info about configuration (not the actual secrets)
    appKeyConfigured: !!process.env.DROPBOX_APP_KEY,
    appSecretConfigured: !!process.env.DROPBOX_APP_SECRET,
    refreshTokenConfigured: hasRefreshToken,
  });
});

/**
 * POST /api/dropbox-sync/credentials
 * Save Dropbox credentials (admin only - updates .env file on server)
 */
router.post('/credentials', async (req: Request, res: Response) => {
  try {
    const { appKey, appSecret, refreshToken } = req.body;
    
    if (!appKey || !appSecret || !refreshToken) {
      return res.status(400).json({ 
        success: false, 
        error: 'App Key, App Secret, and Refresh Token are all required' 
      });
    }
    
    // Store credentials in memory and configure the service
    process.env.DROPBOX_APP_KEY = appKey;
    process.env.DROPBOX_APP_SECRET = appSecret;
    process.env.DROPBOX_REFRESH_TOKEN = refreshToken;
    
    // Configure the dropbox service with the new credentials
    dropboxSyncService.configure({
      accessToken: '', // Will be obtained via refresh token
      refreshToken,
      appKey,
      appSecret,
      folderPath: process.env.DROPBOX_FOLDER_PATH || '',
      stationId: parseInt(process.env.DROPBOX_STATION_ID || '0', 10),
      syncInterval: parseInt(process.env.DROPBOX_SYNC_INTERVAL || '3600000', 10),
      enabled: true,
    });
    
    // Test the connection with new credentials
    const testResult = await dropboxSyncService.testConnection();
    
    if (!testResult.success) {
      return res.status(400).json({ 
        success: false, 
        error: `Credentials saved but connection test failed: ${testResult.message}`,
        testResult
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Dropbox credentials configured successfully. Connection test passed.',
      testResult
    });
  } catch (err: any) {
    console.error('[DropboxSync] Credentials configuration error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dropbox-sync/configure
 * Configure Dropbox sync settings
 */
router.post('/configure', async (req: Request, res: Response) => {
  try {
    const { accessToken, folderPath, stationId, syncInterval, enabled } = req.body;

    if (!accessToken) {
      return res.status(400).json({ success: false, error: 'Access token is required' });
    }

    if (!stationId) {
      return res.status(400).json({ success: false, error: 'Station ID is required' });
    }

    const config: DropboxConfig = {
      accessToken,
      folderPath: folderPath || '',
      stationId: parseInt(stationId, 10),
      syncInterval: syncInterval || 300000, // Default: 5 minutes
      enabled: enabled !== false, // Default: true
    };

    dropboxSyncService.configure(config);

    res.json({ 
      success: true, 
      message: 'Dropbox sync configured successfully',
      enabled: config.enabled,
    });
  } catch (err: any) {
    console.error('[DropboxSync] Configuration error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dropbox-sync/test
 * Test the Dropbox connection
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const result = await dropboxSyncService.testConnection();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/dropbox-sync/sync
 * Trigger an immediate sync
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const result = await dropboxSyncService.syncNow();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dropbox-sync/start
 * Start automatic syncing
 */
router.post('/start', (req: Request, res: Response) => {
  dropboxSyncService.startSync();
  res.json({ success: true, message: 'Sync started' });
});

/**
 * POST /api/dropbox-sync/stop
 * Stop automatic syncing
 */
router.post('/stop', (req: Request, res: Response) => {
  dropboxSyncService.stopSync();
  res.json({ success: true, message: 'Sync stopped' });
});

export default router;
