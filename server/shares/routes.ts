import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";

const router = Router();

// In-memory storage for shares (in production, use database)
interface StationShare {
  id: string;
  stationId: number;
  shareToken: string;
  name: string;
  email?: string;
  accessLevel: 'viewer' | 'editor';
  password?: string;
  expiresAt?: Date;
  isActive: boolean;
  lastAccessedAt?: Date;
  accessCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const shares: Map<string, StationShare> = new Map();

// Generate a unique share token
const generateShareToken = (): string => {
  return randomBytes(16).toString('hex');
};

// Create a new share link for a station
router.post('/stations/:stationId/shares', (req: Request, res: Response) => {
  try {
    const { stationId } = req.params;
    const { name, email, accessLevel = 'viewer', password, expiresAt } = req.body;
    
    const shareToken = generateShareToken();
    const id = randomBytes(8).toString('hex');
    
    const share: StationShare = {
      id,
      stationId: parseInt(stationId),
      shareToken,
      name: name || 'Shared Dashboard',
      email,
      accessLevel,
      password,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      isActive: true,
      accessCount: 0,
      createdBy: 'admin', // In real app, get from session
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    shares.set(shareToken, share);
    
    // Return share info with the full URL
    res.json({
      success: true,
      share: {
        ...share,
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
    
    const stationShares = Array.from(shares.values())
      .filter(s => s.stationId === stationIdNum)
      .map(s => ({
        ...s,
        shareUrl: `/shared/${s.shareToken}`,
        // Don't expose password in list
        password: s.password ? '••••••' : undefined,
      }));
    
    res.json({ success: true, shares: stationShares });
  } catch (error) {
    console.error('Error getting shares:', error);
    res.status(500).json({ success: false, error: 'Failed to get shares' });
  }
});

// Validate a share token and get access
router.post('/shares/:shareToken/validate', (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const { password } = req.body;
    
    const share = shares.get(shareToken);
    
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share link not found' });
    }
    
    if (!share.isActive) {
      return res.status(403).json({ success: false, error: 'Share link is no longer active' });
    }
    
    if (share.expiresAt && new Date() > share.expiresAt) {
      return res.status(403).json({ success: false, error: 'Share link has expired' });
    }
    
    if (share.password && share.password !== password) {
      return res.status(401).json({ success: false, error: 'Invalid password', requiresPassword: true });
    }
    
    // Update access stats
    share.lastAccessedAt = new Date();
    share.accessCount++;
    shares.set(shareToken, share);
    
    res.json({
      success: true,
      access: {
        stationId: share.stationId,
        accessLevel: share.accessLevel,
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
    const share = shares.get(shareToken);
    
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share link not found' });
    }
    
    if (!share.isActive) {
      return res.status(403).json({ success: false, error: 'Share link is no longer active' });
    }
    
    if (share.expiresAt && new Date() > share.expiresAt) {
      return res.status(403).json({ success: false, error: 'Share link has expired' });
    }
    
    res.json({
      success: true,
      share: {
        stationId: share.stationId,
        name: share.name,
        accessLevel: share.accessLevel,
        requiresPassword: !!share.password,
      },
    });
  } catch (error) {
    console.error('Error getting share:', error);
    res.status(500).json({ success: false, error: 'Failed to get share info' });
  }
});

// Update a share
router.patch('/shares/:shareToken', (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    const share = shares.get(shareToken);
    
    if (!share) {
      return res.status(404).json({ success: false, error: 'Share not found' });
    }
    
    const { name, email, accessLevel, password, expiresAt, isActive } = req.body;
    
    if (name !== undefined) share.name = name;
    if (email !== undefined) share.email = email;
    if (accessLevel !== undefined) share.accessLevel = accessLevel;
    if (password !== undefined) share.password = password;
    if (expiresAt !== undefined) share.expiresAt = expiresAt ? new Date(expiresAt) : undefined;
    if (isActive !== undefined) share.isActive = isActive;
    share.updatedAt = new Date();
    
    shares.set(shareToken, share);
    
    res.json({ success: true, share });
  } catch (error) {
    console.error('Error updating share:', error);
    res.status(500).json({ success: false, error: 'Failed to update share' });
  }
});

// Delete a share
router.delete('/shares/:shareToken', (req: Request, res: Response) => {
  try {
    const { shareToken } = req.params;
    
    if (!shares.has(shareToken)) {
      return res.status(404).json({ success: false, error: 'Share not found' });
    }
    
    shares.delete(shareToken);
    res.json({ success: true, message: 'Share deleted successfully' });
  } catch (error) {
    console.error('Error deleting share:', error);
    res.status(500).json({ success: false, error: 'Failed to delete share' });
  }
});

export default router;
