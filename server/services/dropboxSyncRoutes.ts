/**
 * Dropbox Sync API Routes
 * Provides endpoints to configure and manage Dropbox synchronization
 */

import { Router, Request, Response } from 'express';
import { dropboxSyncService, DropboxConfig } from './dropboxSyncService';

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
 * GET /api/dropbox-sync/config
 * Get current configuration (token is masked)
 */
router.get('/config', (req: Request, res: Response) => {
  const config = dropboxSyncService.getConfig();
  if (!config) {
    return res.json({ configured: false });
  }

  // Mask the access token for security
  res.json({
    configured: true,
    folderPath: config.folderPath,
    stationId: config.stationId,
    syncInterval: config.syncInterval,
    enabled: config.enabled,
    accessToken: config.accessToken.substring(0, 10) + '...',
  });
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
