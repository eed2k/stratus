/**
 * Local Authentication Module
 * Multi-user authentication with database-backed user storage
 * 
 * Features:
 * - Database-backed user authentication
 * - Secure password hashing with bcrypt
 * - Session management
 * - Role-based access control (admin/user)
 */

import type { Express, Request, Response, NextFunction, RequestHandler } from 'express';
import { storage } from './localStorage';
import { auditLog, AUDIT_ACTIONS } from './services/auditLogService';
import bcrypt from 'bcryptjs';

// Session storage - map of email to user data
const activeSessions = new Map<string, {
  email: string;
  role: 'admin' | 'user';
  assignedStations: number[];
  loginTime: Date;
}>();

/**
 * Setup authentication middleware
 */
export async function setupAuth(app: Express): Promise<void> {
  console.log('[Auth] Multi-user authentication enabled');

  // Session middleware - check for active session or auto-recover from database
  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    // Check if user email is in headers (set by client after login)
    const userEmail = req.headers['x-user-email'] as string;
    
    if (userEmail) {
      // Check if session already exists
      if (activeSessions.has(userEmail)) {
        const session = activeSessions.get(userEmail)!;
        (req as any).user = {
          email: session.email,
          role: session.role,
          assignedStations: session.assignedStations,
          isAuthenticated: true
        };
      } else {
        // Session not found - try to recover from database
        // This handles cases where server restarts but client still has the email
        try {
          const user = await storage.getUserByEmail(userEmail);
          if (user && user.isActive !== false) {
            // Re-establish session
            activeSessions.set(userEmail, {
              email: user.email,
              role: user.role,
              assignedStations: user.assignedStations || [],
              loginTime: new Date()
            });
            (req as any).user = {
              email: user.email,
              role: user.role,
              assignedStations: user.assignedStations || [],
              isAuthenticated: true
            };
            console.log(`[Auth] Session auto-recovered for user: ${userEmail}`);
          } else {
            (req as any).user = { isAuthenticated: false };
          }
        } catch (err) {
          console.error('[Auth] Error recovering session:', err);
          (req as any).user = { isAuthenticated: false };
        }
      }
    } else {
      (req as any).user = {
        isAuthenticated: false
      };
    }
    
    next();
  });

  // Login endpoint
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email and password are required' 
        });
      }

      // Get user from database
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Log failed login attempt
        await auditLog.log(AUDIT_ACTIONS.LOGIN_FAILED, 'auth', {
          userId: 'unknown',
          userEmail: email,
          details: { reason: 'User not found' },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          status: 'failure'
        });
        
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid email or password' 
        });
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(password, user.passwordHash);
      
      if (!passwordMatch) {
        // Log failed login attempt
        await auditLog.log(AUDIT_ACTIONS.LOGIN_FAILED, 'auth', {
          userId: user.id.toString(),
          userEmail: email,
          details: { reason: 'Invalid password' },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          status: 'failure'
        });
        
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid email or password' 
        });
      }

      // Create session
      activeSessions.set(email, {
        email: user.email,
        role: user.role,
        assignedStations: user.assignedStations || [],
        loginTime: new Date()
      });

      // Update last login time
      await storage.updateUserLastLogin(email);

      // Log successful login
      await auditLog.log(AUDIT_ACTIONS.LOGIN, 'auth', {
        userId: user.id.toString(),
        userEmail: email,
        details: { role: user.role },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({
        success: true,
        user: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          assignedStations: user.assignedStations || []
        }
      });
    } catch (error) {
      console.error('[Auth] Login error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Login failed due to server error' 
      });
    }
  });

  // Logout endpoint
  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      const userEmail = req.headers['x-user-email'] as string;
      
      if (userEmail && activeSessions.has(userEmail)) {
        const session = activeSessions.get(userEmail)!;
        
        // Log logout
        await auditLog.log(AUDIT_ACTIONS.LOGOUT, 'auth', {
          userId: userEmail,
          userEmail: userEmail,
          details: {},
          ip: req.ip,
          userAgent: req.headers['user-agent']
        });
        
        activeSessions.delete(userEmail);
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      res.status(500).json({ success: false, message: 'Logout failed' });
    }
  });

  // Get current user endpoint
  app.get('/api/auth/current', (req: Request, res: Response) => {
    const user = (req as any).user;
    
    if (user && user.isAuthenticated) {
      res.json({
        email: user.email,
        role: user.role,
        assignedStations: user.assignedStations
      });
    } else {
      res.status(401).json({ message: 'Not authenticated' });
    }
  });
}

/**
 * Middleware to check if user is authenticated
 */
export const isAuthenticated: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  
  if (!user || !user.isAuthenticated) {
    return res.status(401).json({ 
      success: false,
      message: 'Authentication required' 
    });
  }
  
  next();
};

/**
 * Middleware to check if user is admin
 */
export const isAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  
  if (!user || !user.isAuthenticated) {
    return res.status(401).json({ 
      success: false,
      message: 'Authentication required' 
    });
  }
  
  if (user.role !== 'admin') {
    return res.status(403).json({ 
      success: false,
      message: 'Admin access required' 
    });
  }
  
  next();
};

/**
 * Get user email from request
 */
export function getUserId(req: Request): string {
  const user = (req as any).user;
  return user?.email || 'unknown';
}

/**
 * Get user from request
 */
export function getUser(req: Request): any {
  return (req as any).user;
}

/**
 * Check if user can access a station
 */
export function canAccessStation(req: Request, stationId: number): boolean {
  const user = (req as any).user;
  
  if (!user || !user.isAuthenticated) {
    return false;
  }
  
  // Admins can access all stations
  if (user.role === 'admin') {
    return true;
  }
  
  // Users can only access assigned stations
  return user.assignedStations?.includes(stationId) || false;
}

export default {
  setupAuth,
  isAuthenticated,
  isAdmin,
  getUserId,
  getUser,
  canAccessStation
};
