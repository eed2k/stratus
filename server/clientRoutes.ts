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

const router = Router();

// Secret for JWT tokens - in production, use environment variable
const JWT_SECRET = process.env.CLIENT_JWT_SECRET || 'stratus-client-secret-change-in-production';

// Rate limiter for login attempts - prevent brute force attacks
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 5, // Max 5 login attempts per window
  message: { 
    success: false, 
    error: 'Too many login attempts. Please try again in 15 minutes.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

// Rate limiter for registration
const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 3, // Max 3 registration attempts per hour
  message: { 
    success: false, 
    error: 'Too many registration attempts. Please try again later.',
    retryAfter: 60 * 60
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

// Initialize with client accounts
async function initClientAccounts() {
  // Main admin/client account
  const mainHash = await bcryptjs.hash('Lukas@2266', 10);
  clientAccounts.set('esterhuizen2k@proton.me', {
    id: 'client-1',
    email: 'esterhuizen2k@proton.me',
    passwordHash: mainHash,
    name: 'Lukas Esterhuizen',
    stationId: 1,
    createdAt: new Date(),
  });
  
  // Demo account for testing
  const demoHash = await bcryptjs.hash('demo123', 10);
  clientAccounts.set('demo@stratus.app', {
    id: 'demo-client-1',
    email: 'demo@stratus.app',
    passwordHash: demoHash,
    name: 'Demo Client',
    stationId: 1,
    createdAt: new Date(),
  });
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
    const payload = jwt.verify(token, JWT_SECRET) as ClientJwtPayload;
    (req as any).clientAuth = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Enable CORS for external clients
// Allow configured client origins and local development
const allowedOrigins = [
  // Add your client application URLs here
  // Example: 'https://your-client-app.example.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

// CORS middleware - applied to all routes
const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.some(allowed => origin.includes(allowed.replace(/^https?:\/\//, '')))) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
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

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const client = clientAccounts.get(email.toLowerCase());
    if (!client) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const validPassword = await bcryptjs.compare(password, client.passwordHash);
    if (!validPassword) {
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
      JWT_SECRET,
      { expiresIn: '7d' }
    );

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
    
    // Password strength validation
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
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
    
    // Password strength validation
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
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
