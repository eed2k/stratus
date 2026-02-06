/**
 * Local Authentication Module
 * Multi-user authentication with database-backed user storage
 * 
 * Features:
 * - Database-backed user authentication
 * - Secure password hashing with bcrypt
 * - Session management
 * - Role-based access control (admin/user)
 * - Rate limiting on authentication endpoints
 */

import type { Express, Request, Response, NextFunction, RequestHandler } from 'express';
import { storage } from './localStorage';
import { auditLog, AUDIT_ACTIONS } from './services/auditLogService';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';

// Constants
const BCRYPT_SALT_ROUNDS = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS = 3;

// Rate limiter for login attempts
const loginRateLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  max: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  message: { 
    success: false, 
    message: 'Too many login attempts. Please try again in 15 minutes.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Rate limiter for password reset requests
const passwordResetRateLimiter = rateLimit({
  windowMs: PASSWORD_RESET_RATE_LIMIT_WINDOW_MS,
  max: PASSWORD_RESET_RATE_LIMIT_MAX_ATTEMPTS,
  message: { 
    success: false, 
    message: 'Too many password reset attempts. Please try again later.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
});

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

  // Login endpoint with rate limiting
  app.post('/api/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
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

  // Forgot Password endpoint - sends reset email (with rate limiting)
  app.post('/api/auth/forgot-password', passwordResetRateLimiter, async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ 
          success: false, 
          message: 'Email is required' 
        });
      }

      // Check if user exists
      const user = await storage.getUserByEmail(email);
      
      // Always return success to prevent email enumeration attacks
      if (!user) {
        console.log(`[Auth] Password reset requested for non-existent email: ${email}`);
        return res.json({ 
          success: true, 
          message: 'If an account with that email exists, a password reset link has been sent.' 
        });
      }

      // Create password reset token
      const postgres = require('./db-postgres');
      const token = await postgres.createPasswordResetToken(email);
      
      // Send reset email
      const { sendPasswordResetEmail } = require('./services/emailService');
      
      const emailSent = await sendPasswordResetEmail(
        email,
        {
          firstName: user.firstName || 'User',
          resetToken: token
        }
      );

      if (!emailSent) {
        console.error('[Auth] Failed to send password reset email');
        // Still return success to prevent enumeration
      }

      // Log the password reset request
      await auditLog.log(AUDIT_ACTIONS.PASSWORD_RESET_REQUEST || 'password_reset_request', 'auth', {
        userId: user.id?.toString() || 'unknown',
        userEmail: email,
        details: { emailSent },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ 
        success: true, 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      });
    } catch (error) {
      console.error('[Auth] Forgot password error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to process password reset request' 
      });
    }
  });

  // Reset Password endpoint - validates token and sets new password (with rate limiting)
  app.post('/api/auth/reset-password', passwordResetRateLimiter, async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;
      
      if (!token || !newPassword) {
        return res.status(400).json({ 
          success: false, 
          message: 'Token and new password are required' 
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({ 
          success: false, 
          message: 'Password must be at least 8 characters long' 
        });
      }

      // Validate the token
      const postgres = require('./db-postgres');
      const email = await postgres.validatePasswordResetToken(token);
      
      if (!email) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid or expired reset token' 
        });
      }

      // Hash the new password
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      // Update the user's password
      await postgres.updateUserPassword(email, passwordHash);
      
      // Mark the token as used
      await postgres.markPasswordResetTokenUsed(token);
      
      // Clear any existing sessions for this user
      activeSessions.delete(email);

      // Log the password reset
      await auditLog.log(AUDIT_ACTIONS.PASSWORD_RESET || 'password_reset', 'auth', {
        userId: email,
        userEmail: email,
        details: { success: true },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ 
        success: true, 
        message: 'Password has been reset successfully. You can now log in with your new password.' 
      });
    } catch (error) {
      console.error('[Auth] Reset password error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to reset password' 
      });
    }
  });

  // Validate reset token endpoint - checks if token is valid without using it
  app.get('/api/auth/validate-reset-token/:token', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      
      const postgres = require('./db-postgres');
      const email = await postgres.validatePasswordResetToken(token);
      
      if (!email) {
        return res.status(400).json({ 
          valid: false, 
          message: 'Invalid or expired reset token' 
        });
      }

      res.json({ 
        valid: true, 
        email: email // Optionally show masked email
      });
    } catch (error) {
      console.error('[Auth] Validate token error:', error);
      res.status(500).json({ valid: false, message: 'Failed to validate token' });
    }
  });

  // Self-service password change - any authenticated user can change their own password
  app.post('/api/auth/change-password', async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      if (!user?.isAuthenticated || !user?.email) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Current password and new password are required' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
      }

      // Verify current password
      const existingUser = await storage.getUserByEmail(user.email);
      if (!existingUser) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const bcrypt = require('bcryptjs');
      const isValid = await bcrypt.compare(currentPassword, existingUser.passwordHash || '');
      if (!isValid) {
        return res.status(403).json({ success: false, message: 'Current password is incorrect' });
      }

      // Hash and save new password
      const newHash = await bcrypt.hash(newPassword, 10);
      await storage.updateUserData(user.email, { passwordHash: newHash });

      console.log(`[Auth] Password changed for user: ${user.email}`);
      res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
      console.error('[Auth] Change password error:', error);
      res.status(500).json({ success: false, message: 'Failed to change password' });
    }
  });

  // Setup Password endpoint - for new invited users to set initial password
  app.post('/api/auth/setup-password', async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      
      if (!token || !password) {
        return res.status(400).json({ 
          success: false, 
          message: 'Token and password are required' 
        });
      }

      if (password.length < 8) {
        return res.status(400).json({ 
          success: false, 
          message: 'Password must be at least 8 characters long' 
        });
      }

      // Validate the invitation token
      const postgres = require('./db-postgres');
      const invitation = await postgres.validateUserInvitationToken(token);
      
      if (!invitation) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid or expired invitation token' 
        });
      }

      // Hash the password
      const passwordHash = await bcrypt.hash(password, 10);
      
      // Update the user's password
      await postgres.updateUserPassword(invitation.email, passwordHash);
      
      // Mark the invitation token as used
      await postgres.markUserInvitationTokenUsed(token);

      // Log the account activation
      await auditLog.log(AUDIT_ACTIONS.USER_ACTIVATED || 'user_activated', 'auth', {
        userId: invitation.email,
        userEmail: invitation.email,
        details: { invitedBy: invitation.invitedBy },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ 
        success: true, 
        message: 'Password set successfully. You can now log in.' 
      });
    } catch (error) {
      console.error('[Auth] Setup password error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to set password' 
      });
    }
  });

  // Validate invitation token endpoint
  app.get('/api/auth/validate-invitation/:token', async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      
      const postgres = require('./db-postgres');
      const invitation = await postgres.validateUserInvitationToken(token);
      
      if (!invitation) {
        return res.status(400).json({ 
          valid: false, 
          message: 'Invalid or expired invitation token' 
        });
      }

      res.json({ 
        valid: true, 
        email: invitation.email,
        customMessage: invitation.customMessage
      });
    } catch (error) {
      console.error('[Auth] Validate invitation error:', error);
      res.status(500).json({ valid: false, message: 'Failed to validate invitation' });
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
