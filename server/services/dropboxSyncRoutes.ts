/**
 * Dropbox Sync API Routes
 * Provides endpoints to configure and manage Dropbox synchronization
 */

import { Router, Request, Response } from 'express';
import { dropboxSyncService, DropboxConfig } from './dropboxSyncService';
import { storage } from '../localStorage';
import https from 'https';

const router = Router();

/**
 * GET /api/dropbox-sync/oauth/url
 * Generate OAuth authorization URL for Dropbox
 */
router.get('/oauth/url', (req: Request, res: Response) => {
  const { appKey } = req.query;
  
  if (!appKey) {
    return res.status(400).json({ error: 'App Key is required' });
  }
  
  const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${appKey}&response_type=code&token_access_type=offline`;
  res.json({ authUrl });
});

/**
 * POST /api/dropbox-sync/oauth/token
 * Exchange authorization code for refresh token
 */
router.post('/oauth/token', async (req: Request, res: Response) => {
  try {
    const { appKey, appSecret, authCode } = req.body;
    
    if (!appKey || !appSecret || !authCode) {
      return res.status(400).json({ error: 'App Key, App Secret, and Authorization Code are required' });
    }
    
    // Exchange code for tokens using Dropbox OAuth endpoint
    const tokenData = await new Promise<any>((resolve, reject) => {
      const postData = `code=${encodeURIComponent(authCode)}&grant_type=authorization_code`;
      const auth = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
      
      const options = {
        hostname: 'api.dropboxapi.com',
        path: '/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (response.statusCode !== 200) {
              reject(new Error(parsed.error_description || parsed.error || 'Token exchange failed'));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error('Failed to parse Dropbox response'));
          }
        });
      });
      
      request.on('error', reject);
      request.write(postData);
      request.end();
    });
    
    if (!tokenData.refresh_token) {
      return res.status(400).json({ error: 'No refresh token received. Make sure token_access_type=offline was used.' });
    }
    
    res.json({
      success: true,
      refreshToken: tokenData.refresh_token,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
      accountId: tokenData.account_id
    });
  } catch (err: any) {
    console.error('[DropboxSync] OAuth token exchange error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
 * GET /api/dropbox-sync/discover
 * Discover ALL files and folders in Dropbox (for finding new data sources)
 */
router.get('/discover', async (req: Request, res: Response) => {
  try {
    const contents = await dropboxSyncService.listAllDropboxContents();
    res.json(contents);
  } catch (err: any) {
    console.error('[DropboxSync] Error discovering contents:', err);
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
 * Query params:
 *   - fullImport=true: Import all records (not just last 48 hours)
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const fullImport = req.query.fullImport === 'true' || req.body.fullImport === true;
    const result = await dropboxSyncService.syncNow(fullImport);
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
