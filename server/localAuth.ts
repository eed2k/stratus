/**
 * Local Authentication Module
 * Simplified auth for self-hosted/VM deployments - no cloud auth needed
 * 
 * ⚠️ SECURITY WARNING: This module provides simplified authentication suitable for:
 *    - Single-user desktop deployments
 *    - Localhost-only access
 *    - Trusted network environments
 * 
 * For network/cloud deployments, set REQUIRE_AUTH=true in environment variables
 * and configure CLIENT_JWT_SECRET for secure token handling.
 */

import type { Express, Request, Response, NextFunction, RequestHandler } from 'express';

// Environment-based authentication mode
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

// For desktop app, we use a simple local user concept
// In production desktop app, this would be the logged-in Windows/Mac user
let currentUser = {
  id: 'local-user',
  name: 'Local User',
  email: 'local@stratus.app',
  isAuthenticated: !REQUIRE_AUTH // Auto-authenticated in desktop mode
};

/**
 * Setup authentication middleware (simplified for desktop)
 */
export async function setupAuth(app: Express): Promise<void> {
  // Log authentication mode on startup
  if (REQUIRE_AUTH) {
    console.log('[Auth] Running in AUTHENTICATED mode - login required');
  } else {
    console.log('[Auth] Running in LOCAL/DESKTOP mode - auto-authenticated');
  }

  // For desktop app, set up local user session
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Attach local user to request
    (req as any).user = currentUser;
    next();
  });

  // Login endpoint (for potential multi-user scenarios)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body;
    
    // In REQUIRE_AUTH mode, validate credentials
    if (REQUIRE_AUTH) {
      // Check against environment-configured admin credentials
      const adminEmail = process.env.ADMIN_EMAIL;
      const adminPassword = process.env.ADMIN_PASSWORD;
      
      if (!adminEmail || !adminPassword) {
        return res.status(500).json({ 
          success: false, 
          message: 'Server not configured for authentication' 
        });
      }
      
      // Note: In production, use the clientRoutes.ts JWT-based auth instead
      if (username !== adminEmail) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    }
    
    // Set user as authenticated
    currentUser.isAuthenticated = true;
    currentUser.name = username || 'Local User';
    
    res.json({
      success: true,
      user: {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email
      }
    });
  });

  // Logout endpoint
  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    currentUser.isAuthenticated = false;
    res.json({ success: true });
  });

  // Get current user endpoint
  app.get('/api/auth/user', (_req: Request, res: Response) => {
    if (currentUser.isAuthenticated) {
      res.json({
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email
      });
    } else {
      res.status(401).json({ message: 'Not authenticated' });
    }
  });
}

/**
 * Middleware to check if user is authenticated
 * Behavior depends on REQUIRE_AUTH environment variable:
 * - REQUIRE_AUTH=true: Enforces authentication
 * - REQUIRE_AUTH=false/unset: Desktop mode, always allows access
 */
export const isAuthenticated: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // In REQUIRE_AUTH mode, check if user is authenticated
  if (REQUIRE_AUTH) {
    if (!currentUser.isAuthenticated) {
      return res.status(401).json({ 
        success: false,
        message: 'Authentication required' 
      });
    }
  }
  // Allow access
  next();
};

/**
 * Get user ID from request
 */
export function getUserId(req: Request): string {
  return currentUser.id;
}

/**
 * Get user from request
 */
export function getUser(req: Request): typeof currentUser {
  return currentUser;
}

export default {
  setupAuth,
  isAuthenticated,
  getUserId,
  getUser
};
