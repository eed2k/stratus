import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { createShare, getShareByToken, getSharesByStation, updateShare, deleteShare, Share } from "../db";

const router = Router();

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

// Create a new share link for a station
router.post('/stations/:stationId/shares', async (req: Request, res: Response) => {
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
    
    createShare(share);
    
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

// Get all shares for a station
router.get('/stations/:stationId/shares', (req: Request, res: Response) => {
  try {
    const { stationId } = req.params;
    const stationIdNum = parseInt(stationId);
    
    const dbShares = getSharesByStation(stationIdNum);
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
    
    const share = getShareByToken(shareToken);
    
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
    updateShare(shareToken, {
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
router.get('/shares/:shareToken', (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const share = getShareByToken(shareToken);
    
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

// Update a share
router.patch('/shares/:shareToken', async (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const share = getShareByToken(shareToken);
    
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
    
    updateShare(shareToken, updates);
    
    const updatedShare = getShareByToken(shareToken);
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

// Delete a share
router.delete('/shares/:shareToken', (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    
    const share = getShareByToken(shareToken);
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share not found' });
    }
    
    deleteShare(shareToken);
    res.json({ success: true, message: 'Share deleted successfully' });
  } catch (error) {
    console.error('Error deleting share:', error);
    res.status(500).json({ success: false, error: 'Failed to delete share' });
  }
});

export default router;
