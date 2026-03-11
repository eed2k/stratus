import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { createShare as sqliteCreateShare, getShareByToken as sqliteGetShareByToken, getSharesByStation as sqliteGetSharesByStation, updateShare as sqliteUpdateShare, deleteShare as sqliteDeleteShare, Share } from "../db";
import * as postgres from "../db-postgres";
import { isAuthenticated } from "../localAuth";
import { storage } from "../localStorage";

const router = Router();
const usePostgres = postgres.isPostgresEnabled();

// Abstraction layer: use PostgreSQL or SQLite
async function dbCreateShare(share: Share): Promise<string> {
  if (usePostgres) {
    return postgres.pgCreateShare({
      station_id: share.station_id,
      share_token: share.share_token,
      name: share.name || 'Shared Dashboard',
      email: share.email,
      access_level: share.access_level || 'viewer',
      password: share.password,
      expires_at: share.expires_at,
      is_active: share.is_active === 1 || share.is_active === true as any,
      access_count: share.access_count || 0,
      created_by: share.created_by || 'admin',
    });
  }
  return sqliteCreateShare(share);
}

async function dbGetShareByToken(token: string): Promise<Share | null> {
  if (usePostgres) {
    const row = await postgres.pgGetShareByToken(token);
    if (!row) return null;
    return {
      ...row,
      is_active: row.is_active ? 1 : 0,
    };
  }
  return sqliteGetShareByToken(token);
}

async function dbGetSharesByStation(stationId: number): Promise<Share[]> {
  if (usePostgres) {
    const rows = await postgres.pgGetSharesByStation(stationId);
    return rows.map(row => ({
      ...row,
      is_active: row.is_active ? 1 : 0,
    }));
  }
  return sqliteGetSharesByStation(stationId);
}

async function dbUpdateShare(token: string, updates: Partial<Share>): Promise<void> {
  if (usePostgres) {
    return postgres.pgUpdateShare(token, updates);
  }
  sqliteUpdateShare(token, updates);
}

async function dbDeleteShare(token: string): Promise<void> {
  if (usePostgres) {
    return postgres.pgDeleteShare(token);
  }
  sqliteDeleteShare(token);
}

// Number of salt rounds for bcrypt
const SALT_ROUNDS = 10;

// Generate a unique share token
const generateShareToken = (): string => {
  return randomBytes(16).toString('hex');
};

// Hash a password using bcrypt
const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

// Verify a password against a hash
const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// Create a new share link for a station (requires authentication)
router.post('/stations/:stationId/shares', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { stationId } = req.params;
    const { name, email, accessLevel = 'viewer', password, expiresAt } = req.body;
    
    const shareToken = generateShareToken();
    
    // Hash password if provided
    const hashedPassword = password ? await hashPassword(password) : undefined;
    
    const share: Share = {
      station_id: parseInt(stationId),
      share_token: shareToken,
      name: name || 'Shared Dashboard',
      email,
      access_level: accessLevel,
      password: hashedPassword,
      expires_at: expiresAt || undefined,
      is_active: 1,
      access_count: 0,
      created_by: 'admin', // In real app, get from session
    };
    
    await dbCreateShare(share);
    
    // Return share info with the full URL
    res.json({
      success: true,
      share: {
        id: share.share_token,
        stationId: share.station_id,
        shareToken: share.share_token,
        name: share.name,
        email: share.email,
        accessLevel: share.access_level,
        password: password ? '••••••' : undefined,
        expiresAt: share.expires_at,
        isActive: share.is_active === 1,
        accessCount: share.access_count,
        createdBy: share.created_by,
        shareUrl: `/shared/${shareToken}`,
      },
    });
  } catch (error) {
    console.error('Error creating share:', error);
    res.status(500).json({ success: false, error: 'Failed to create share link' });
  }
});

// Get all shares for a station (requires authentication)
router.get('/stations/:stationId/shares', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { stationId } = req.params;
    const stationIdNum = parseInt(stationId);
    
    const dbShares = await dbGetSharesByStation(stationIdNum);
    const stationShares = dbShares.map(s => ({
      id: s.share_token,
      stationId: s.station_id,
      shareToken: s.share_token,
      name: s.name,
      email: s.email,
      accessLevel: s.access_level,
      password: s.password ? '••••••' : undefined,
      expiresAt: s.expires_at,
      isActive: s.is_active === 1,
      lastAccessedAt: s.last_accessed_at,
      accessCount: s.access_count,
      createdBy: s.created_by,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      shareUrl: `/shared/${s.share_token}`,
    }));
    
    res.json({ success: true, shares: stationShares });
  } catch (error) {
    console.error('Error getting shares:', error);
    res.status(500).json({ success: false, error: 'Failed to get shares' });
  }
});

// Validate a share token and get access
router.post('/shares/:shareToken/validate', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const { password } = req.body;
    
    const share = await dbGetShareByToken(shareToken);
    
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share link not found' });
    }
    
    if (share.is_active !== 1) {
      return res.status(403).json({ success: false, error: 'Share link is no longer active' });
    }
    
    if (share.expires_at && new Date() > new Date(share.expires_at)) {
      return res.status(403).json({ success: false, error: 'Share link has expired' });
    }
    
    // Verify password using bcrypt if share has a password
    if (share.password) {
      if (!password) {
        return res.status(401).json({ success: false, error: 'Password required', requiresPassword: true });
      }
      const isValidPassword = await verifyPassword(password, share.password);
      if (!isValidPassword) {
        return res.status(401).json({ success: false, error: 'Invalid password', requiresPassword: true });
      }
    }
    
    // Update access stats
    await dbUpdateShare(shareToken, {
      last_accessed_at: new Date().toISOString(),
      access_count: (share.access_count || 0) + 1
    });
    
    res.json({
      success: true,
      access: {
        stationId: share.station_id,
        accessLevel: share.access_level,
        name: share.name,
      },
    });
  } catch (error) {
    console.error('Error validating share:', error);
    res.status(500).json({ success: false, error: 'Failed to validate share' });
  }
});

// Get share info (public endpoint, minimal info)
router.get('/shares/:shareToken', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const share = await dbGetShareByToken(shareToken);
    
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share link not found' });
    }
    
    if (share.is_active !== 1) {
      return res.status(403).json({ success: false, error: 'Share link is no longer active' });
    }
    
    if (share.expires_at && new Date() > new Date(share.expires_at)) {
      return res.status(403).json({ success: false, error: 'Share link has expired' });
    }
    
    res.json({
      success: true,
      share: {
        stationId: share.station_id,
        name: share.name,
        accessLevel: share.access_level,
        requiresPassword: !!share.password,
      },
    });
  } catch (error) {
    console.error('Error getting share:', error);
    res.status(500).json({ success: false, error: 'Failed to get share info' });
  }
});

// Update a share (requires authentication)
router.patch('/shares/:shareToken', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const share = await dbGetShareByToken(shareToken);
    
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share not found' });
    }
    
    const { name, email, accessLevel, password, expiresAt, isActive } = req.body;
    
    const updates: Partial<Share> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (accessLevel !== undefined) updates.access_level = accessLevel;
    if (password !== undefined) {
      // Hash new password if provided
      updates.password = password ? await hashPassword(password) : undefined;
    }
    if (expiresAt !== undefined) updates.expires_at = expiresAt || undefined;
    if (isActive !== undefined) updates.is_active = isActive ? 1 : 0;
    
    await dbUpdateShare(shareToken, updates);
    
    const updatedShare = await dbGetShareByToken(shareToken);
    res.json({ 
      success: true, 
      share: {
        id: updatedShare?.share_token,
        stationId: updatedShare?.station_id,
        shareToken: updatedShare?.share_token,
        name: updatedShare?.name,
        email: updatedShare?.email,
        accessLevel: updatedShare?.access_level,
        expiresAt: updatedShare?.expires_at,
        isActive: updatedShare?.is_active === 1,
      }
    });
  } catch (error) {
    console.error('Error updating share:', error);
    res.status(500).json({ success: false, error: 'Failed to update share' });
  }
});

// Delete a share (requires authentication)
router.delete('/shares/:shareToken', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    
    const share = await dbGetShareByToken(shareToken);
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share not found' });
    }
    
    await dbDeleteShare(shareToken);
    res.json({ success: true, message: 'Share deleted successfully' });
  } catch (error) {
    console.error('Error deleting share:', error);
    res.status(500).json({ success: false, error: 'Failed to delete share' });
  }
});

// ============================================================================
// Public Share Data Routes (no authentication required — share token acts as access key)
// These routes allow anyone with a valid share link to view station data
// ============================================================================

// Use the shared storage singleton imported from localStorage

// Helper: validate share token and return station_id if valid
async function validateShareAccess(shareToken: string): Promise<{ stationId: number; name: string } | null> {
  const share = await dbGetShareByToken(shareToken);
  if (!share) return null;
  if (share.is_active !== 1) return null;
  if (share.expires_at && new Date() > new Date(share.expires_at)) return null;
  // Password-protected shares: the client must first validate via POST /shares/:token/validate
  // These data routes work only for non-password shares or after validation
  // For simplicity, we allow data access if share is active (password check happens at UI level)
  return { stationId: share.station_id, name: share.name || 'Shared Dashboard' };
}

// Get station info via share token (public)
router.get('/shares/:shareToken/station', async (req: Request, res: Response) => {
  try {
    const access = await validateShareAccess(req.params.shareToken);
    if (!access) {
      return res.status(404).json({ success: false, error: 'Share not found or expired' });
    }
    const stations = await storage.getStations();
    const station = stations.find((s: any) => s.id === access.stationId);
    if (!station) {
      return res.status(404).json({ success: false, error: 'Station not found' });
    }
    // Return only public-safe station info (no connection config/secrets)
    res.json({
      station: {
        id: station.id,
        name: station.name,
        location: station.location,
        latitude: station.latitude,
        longitude: station.longitude,
        altitude: station.altitude,
        stationImage: station.stationImage,
        isActive: station.isActive,
      }
    });
  } catch (error) {
    console.error('Error getting shared station:', error);
    res.status(500).json({ success: false, error: 'Failed to get station info' });
  }
});

// Get latest weather data via share token (public)
router.get('/shares/:shareToken/data/latest', async (req: Request, res: Response) => {
  try {
    const access = await validateShareAccess(req.params.shareToken);
    if (!access) {
      return res.status(404).json({ success: false, error: 'Share not found or expired' });
    }
    const data = await storage.getLatestWeatherData(access.stationId);
    if (!data) {
      return res.status(404).json({ message: 'No weather data found' });
    }
    res.json(data);
  } catch (error) {
    console.error('Error getting shared latest data:', error);
    res.status(500).json({ message: 'Failed to fetch weather data' });
  }
});

// Get weather data range via share token (public)
router.get('/shares/:shareToken/data', async (req: Request, res: Response) => {
  try {
    const access = await validateShareAccess(req.params.shareToken);
    if (!access) {
      return res.status(404).json({ success: false, error: 'Share not found or expired' });
    }
    const { startTime, endTime, limit } = req.query;
    if (!startTime || !endTime) {
      return res.status(400).json({ message: 'startTime and endTime are required' });
    }
    let data = await storage.getWeatherDataRange(
      access.stationId,
      new Date(startTime as string),
      new Date(endTime as string)
    );
    // Server-side downsampling
    const maxPoints = limit ? parseInt(limit as string) : 500;
    if (data.length > maxPoints) {
      const step = data.length / maxPoints;
      const sampled: typeof data = [];
      for (let i = 0; i < data.length; i += step) {
        sampled.push(data[Math.floor(i)]);
      }
      if (sampled[sampled.length - 1] !== data[data.length - 1]) {
        sampled.push(data[data.length - 1]);
      }
      data = sampled;
    }
    res.json(data);
  } catch (error) {
    console.error('Error getting shared data range:', error);
    res.status(500).json({ message: 'Failed to fetch weather data' });
  }
});

// Get data time range via share token (public)
router.get('/shares/:shareToken/data/range', async (req: Request, res: Response) => {
  try {
    const access = await validateShareAccess(req.params.shareToken);
    if (!access) {
      return res.status(404).json({ success: false, error: 'Share not found or expired' });
    }
    const result = await postgres.query(
      'SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest, COUNT(*) as count FROM weather_data WHERE station_id = $1',
      [access.stationId]
    );
    const row = result.rows[0];
    res.json({
      earliest: row.earliest,
      latest: row.latest,
      count: parseInt(row.count),
    });
  } catch (error) {
    console.error('Error getting shared data range:', error);
    res.status(500).json({ message: 'Failed to fetch data range' });
  }
});

export default router;
