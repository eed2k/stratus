// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * File Watcher API Routes
 * Endpoints for managing watched folders (Dropbox sync, etc.)
 */

import { Router, Request, Response } from 'express';
import { fileWatcherService } from './fileWatcherService';
import { nanoid } from 'nanoid';

const router = Router();

/**
 * GET /api/file-watcher/folders
 * Get all watched folders
 */
router.get('/folders', (_req: Request, res: Response) => {
  try {
    const folders = fileWatcherService.getWatchedFolders();
    // Convert Set to Array for JSON serialization
    const serializable = folders.map(f => ({
      ...f,
      processedFiles: Array.from(f.processedFiles),
    }));
    res.json(serializable);
  } catch (error: any) {
    console.error('[FileWatcher API] Error getting folders:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/file-watcher/folders
 * Add a new watched folder
 */
router.post('/folders', async (req: Request, res: Response) => {
  try {
    const { stationId, folderPath, filePattern, enabled = true } = req.body;

    if (!stationId || !folderPath) {
      return res.status(400).json({ error: 'stationId and folderPath are required' });
    }

    const folder = {
      id: nanoid(),
      stationId: parseInt(stationId),
      folderPath,
      filePattern: filePattern || '\\.dat$',
      enabled,
    };

    await fileWatcherService.addWatchedFolder(folder);

    res.status(201).json({
      success: true,
      folder: {
        ...folder,
        lastScan: null,
        processedFiles: [],
      },
    });
  } catch (error: any) {
    console.error('[FileWatcher API] Error adding folder:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/file-watcher/folders/:id
 * Remove a watched folder
 */
router.delete('/folders/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await fileWatcherService.removeWatchedFolder(id);
    res.json({ success: true });
  } catch (error: any) {
    console.error('[FileWatcher API] Error removing folder:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/file-watcher/scan
 * Manually trigger a scan of all watched folders
 */
router.post('/scan', async (_req: Request, res: Response) => {
  try {
    await fileWatcherService.scanAll();
    res.json({ success: true, message: 'Scan triggered' });
  } catch (error: any) {
    console.error('[FileWatcher API] Error scanning folders:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/file-watcher/scan/:id
 * Manually trigger a scan of a specific folder
 */
router.post('/scan/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const folders = fileWatcherService.getWatchedFolders();
    const folder = folders.find(f => f.id === id);
    
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    await fileWatcherService.scanAll(); // Will scan the specific folder
    res.json({ success: true, message: `Scan triggered for folder ${folder.folderPath}` });
  } catch (error: any) {
    console.error('[FileWatcher API] Error scanning folder:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
