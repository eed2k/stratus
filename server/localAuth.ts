/**
 * Local Authentication Module
 * Simplified auth for self-hosted/VM deployments - no cloud auth needed
 */

import type { Express, Request, Response, NextFunction, RequestHandler } from 'express';

// For desktop app, we use a simple local user concept
// In production desktop app, this would be the logged-in Windows/Mac user
let currentUser = {
  id: 'local-user',
  name: 'Local User',
  email: 'local@stratus.app',
  isAuthenticated: true
};

/**
 * Setup authentication middleware (simplified for desktop)
 */
export async function setupAuth(app: Express): Promise<void> {
  // For desktop app, set up local user session
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Attach local user to request
    (req as any).user = currentUser;
    next();
  });

  // Login endpoint (for potential multi-user scenarios)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { username, password } = req.body;
    
    // For desktop app, just set user as authenticated
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
 * For desktop app, always allows access (single user)
 */
export const isAuthenticated: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  // Desktop app - always authenticated
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
