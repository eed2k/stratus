/**
 * Client Dashboard API Routes
 * These endpoints are used by external client dashboards and applications
 * They provide read-only access to weather data for authenticated clients
 * 
 * Developer: Lukas Esterhuizen (esterhuizen2k@proton.me)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { storage } from './localStorage';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { auditLog, AUDIT_ACTIONS } from './services/auditLogService';

const router = Router();

// Constants for security configuration
const BCRYPT_SALT_ROUNDS = 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const REGISTER_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REGISTER_RATE_LIMIT_MAX_ATTEMPTS = 3;

// Secret for JWT tokens - MUST be set via environment variable
const JWT_SECRET = process.env.CLIENT_JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Fail-fast in production if JWT secret is not configured
if (!JWT_SECRET) {
  if (NODE_ENV === 'production') {
    console.error('[CRITICAL] CLIENT_JWT_SECRET is not set. This is required in production.');
    console.error('[CRITICAL] Generate a secret with: openssl rand -hex 32');
    process.exit(1);
  } else {
    console.warn('[Security] CLIENT_JWT_SECRET not set - using random secret (development only)');
  }
}
const ACTIVE_JWT_SECRET = JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

// Rate limiter for login attempts - prevent brute force attacks
const loginRateLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
  max: LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  message: { 
    success: false, 
    error: 'Too many login attempts. Please try again in 15 minutes.',
    retryAfter: Math.floor(LOGIN_RATE_LIMIT_WINDOW_MS / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

// Rate limiter for registration
const registerRateLimiter = rateLimit({
  windowMs: REGISTER_RATE_LIMIT_WINDOW_MS,
  max: REGISTER_RATE_LIMIT_MAX_ATTEMPTS,
  message: { 
    success: false, 
    error: 'Too many registration attempts. Please try again later.',
    retryAfter: Math.floor(REGISTER_RATE_LIMIT_WINDOW_MS / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Client accounts storage (in production, use a proper database table)
interface ClientAccount {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  stationId: number;
  createdAt: Date;
}

// In-memory client accounts (for simplicity - extend to database for production)
const clientAccounts: Map<string, ClientAccount> = new Map();

// Initialize with client accounts from environment variables
async function initClientAccounts() {
  // Admin account - credentials from environment variables
  const adminEmail = process.env.STRATUS_ADMIN_EMAIL;
  const adminPassword = process.env.STRATUS_ADMIN_PASSWORD;
  
  if (adminEmail && adminPassword) {
    const adminHash = await bcryptjs.hash(adminPassword, 10);
    clientAccounts.set(adminEmail, {
      id: 'client-admin',
      email: adminEmail,
      passwordHash: adminHash,
      name: process.env.STRATUS_ADMIN_NAME || 'Admin',
      stationId: 1,
      createdAt: new Date(),
    });
    console.log('[Auth] Admin account configured');
  } else {
    console.warn('[Security] No admin credentials configured. Set STRATUS_ADMIN_EMAIL and STRATUS_ADMIN_PASSWORD environment variables.');
  }
}
initClientAccounts();

// Middleware to verify client JWT
interface ClientJwtPayload {
  clientId: string;
  email: string;
  stationId: number;
}

function verifyClientToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.substring(7);
  try {
    const payload = jwt.verify(token, ACTIVE_JWT_SECRET) as ClientJwtPayload;
    (req as any).clientAuth = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Enable CORS for external clients
// Allow configured client origins and local development
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .filter(Boolean)
  .concat([
    // Local development origins
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5000',
  ]);

// CORS middleware - applied to all routes
const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.some(allowed => origin === allowed)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  // Note: Do not use wildcard '*' with credentials
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
};

router.use(corsMiddleware);

/**
 * GET /api/client/health
 * Public health check endpoint - no authentication required
 * Used by external clients to verify server connectivity
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * POST /api/client/login
 * Authenticate client with email/password
 * Protected by rate limiting to prevent brute force attacks
 */
router.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const clientIp = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const client = clientAccounts.get(email.toLowerCase());
    if (!client) {
      // Log failed login attempt
      await auditLog.log(AUDIT_ACTIONS.LOGIN_FAILED, 'auth', {
        userEmail: email.toLowerCase(),
        details: { reason: 'User not found' },
        ip: clientIp,
        userAgent,
        status: 'failure'
      });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await bcryptjs.compare(password, client.passwordHash);
    if (!validPassword) {
      // Log failed login attempt
      await auditLog.log(AUDIT_ACTIONS.LOGIN_FAILED, 'auth', {
        userId: client.id,
        userEmail: email.toLowerCase(),
        details: { reason: 'Invalid password' },
        ip: clientIp,
        userAgent,
        status: 'failure'
      });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Get the station for this client
    const station = await storage.getWeatherStation(client.stationId);

    // Generate JWT token
    const token = jwt.sign(
      {
        clientId: client.id,
        email: client.email,
        stationId: client.stationId,
      },
      ACTIVE_JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Log successful login
    await auditLog.log(AUDIT_ACTIONS.LOGIN, 'auth', {
      userId: client.id,
      userEmail: client.email,
      details: { stationId: client.stationId },
      ip: clientIp,
      userAgent,
      status: 'success'
    });

    res.json({
      success: true,
      token,
      user: {
        id: client.id,
        email: client.email,
        name: client.name,
        stationId: client.stationId,
        stationName: station?.name,
      },
    });
  } catch (error: any) {
    console.error('Client login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

/**
 * GET /api/client/verify
 * Verify if token is still valid
 */
router.get('/verify', verifyClientToken, (req: Request, res: Response) => {
  res.json({ valid: true });
});

/**
 * GET /api/client/station
 * Get station info for the authenticated client
 */
router.get('/station', verifyClientToken, async (req: Request, res: Response) => {
  try {
    const { stationId } = (req as any).clientAuth;
    const station = await storage.getWeatherStation(stationId);

    if (!station) {
      return res.status(404).json({ error: 'Station not found' });
    }

    res.json({
      id: station.id,
      name: station.name,
      location: station.location,
      latitude: station.latitude,
      longitude: station.longitude,
      altitude: station.altitude,
      isActive: station.isActive,
    });
  } catch (error: any) {
    console.error('Get station error:', error);
    res.status(500).json({ error: 'Failed to get station' });
  }
});

/**
 * GET /api/client/data/latest
 * Get latest weather data for the client's station
 */
router.get('/data/latest', verifyClientToken, async (req: Request, res: Response) => {
  try {
    const { stationId } = (req as any).clientAuth;
    const data = await storage.getLatestWeatherData(stationId);

    if (!data) {
      return res.status(404).json({ error: 'No data available' });
    }

    res.json({
      id: data.id,
      stationId: data.stationId,
      timestamp: data.timestamp,
      data: data.data,
    });
  } catch (error: any) {
    console.error('Get latest data error:', error);
    res.status(500).json({ error: 'Failed to get data' });
  }
});

/**
 * GET /api/client/data/history
 * Get historical weather data for the client's station
 */
router.get('/data/history', verifyClientToken, async (req: Request, res: Response) => {
  try {
    const { stationId } = (req as any).clientAuth;
    const hours = parseInt(req.query.hours as string) || 24;

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

    const data = await storage.getWeatherDataRange(stationId, startTime, endTime);

    res.json(
      data.map((d) => ({
        id: d.id,
        stationId: d.stationId,
        timestamp: d.timestamp,
        data: d.data,
      }))
    );
  } catch (error: any) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

// NOTE: Export functionality (CSV and PDF) has been disabled
// The export routes have been removed from client API

/**
 * Admin endpoint to create client accounts
 * POST /api/client/admin/create
 * Protected by rate limiting to prevent abuse
 */
router.post('/admin/create', registerRateLimiter, async (req: Request, res: Response) => {
  try {
    // In production, add admin authentication here
    const { email, password, name, stationId } = req.body;

    // Input validation
    if (!email || !password || !stationId) {
      return res.status(400).json({ error: 'Email, password, and stationId required' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Password strength validation (minimum 8 characters)
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (clientAccounts.has(email.toLowerCase())) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Sanitize name input (remove potential XSS)
    const sanitizedName = name ? String(name).replace(/<[^>]*>/g, '').trim().substring(0, 100) : undefined;

    const hash = await bcryptjs.hash(password, 10);
    const client: ClientAccount = {
      id: `client-${Date.now()}`,
      email: email.toLowerCase().trim(),
      passwordHash: hash,
      name: sanitizedName,
      stationId: typeof stationId === 'number' ? stationId : parseInt(stationId, 10),
      createdAt: new Date(),
    };

    clientAccounts.set(email.toLowerCase(), client);

    // Log user creation
    await auditLog.log(AUDIT_ACTIONS.USER_CREATE, 'users', {
      userEmail: 'admin',
      resourceId: client.id,
      details: { email: client.email, name: client.name, stationId: client.stationId },
      ip: req.ip || req.socket.remoteAddress,
      status: 'success'
    });

    res.json({
      success: true,
      client: {
        id: client.id,
        email: client.email,
        name: client.name,
        stationId: client.stationId,
      },
    });
  } catch (error: any) {
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

/**
 * POST /api/clients/register
 * Public registration endpoint for new client accounts
 * Used by the welcome screen for first-run registration
 */
router.post('/register', registerRateLimiter, async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    // Input validation
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'Username, email, and password required' });
    }
    
    // Username validation
    if (username.length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    
    // Password strength validation (minimum 8 characters)
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    if (clientAccounts.has(email.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // Sanitize inputs
    const sanitizedUsername = String(username).replace(/<[^>]*>/g, '').trim().substring(0, 50);

    const hash = await bcryptjs.hash(password, 10);
    const client: ClientAccount = {
      id: `client-${Date.now()}`,
      email: email.toLowerCase().trim(),
      passwordHash: hash,
      name: sanitizedUsername,
      stationId: 1, // Default station for new registrations
      createdAt: new Date(),
    };

    clientAccounts.set(email.toLowerCase(), client);

    // Log user registration
    await auditLog.log(AUDIT_ACTIONS.USER_CREATE, 'users', {
      userId: client.id,
      userEmail: client.email,
      resourceId: client.id,
      details: { name: client.name, registrationType: 'self-registration' },
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: client.id,
        email: client.email,
        name: client.name,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

export default router;
