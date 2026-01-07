/**
 * Client Dashboard API Routes
 * These endpoints are used by the Netlify-hosted client dashboard
 * They provide read-only access to weather data for authenticated clients
 */

import { Router, Request, Response, NextFunction } from 'express';
import { storage } from './localStorage';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';

const router = Router();

// Secret for JWT tokens - in production, use environment variable
const JWT_SECRET = process.env.CLIENT_JWT_SECRET || 'stratus-client-secret-change-in-production';

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

// Initialize with a demo client account
async function initDemoClient() {
  const hash = await bcryptjs.hash('demo123', 10);
  clientAccounts.set('demo@stratus.app', {
    id: 'demo-client-1',
    email: 'demo@stratus.app',
    passwordHash: hash,
    name: 'Demo Client',
    stationId: 1, // Will be assigned to first station
    createdAt: new Date(),
  });
}
initDemoClient();

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

// Enable CORS for Netlify client
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

/**
 * POST /api/client/login
 * Authenticate client with email/password
 */
router.post('/login', async (req: Request, res: Response) => {
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

/**
 * GET /api/client/export/csv
 * Export data as CSV for the client's station
 */
router.get('/export/csv', verifyClientToken, async (req: Request, res: Response) => {
  try {
    const { stationId } = (req as any).clientAuth;
    const hours = parseInt(req.query.hours as string) || 168; // Default 7 days

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

    const data = await storage.getWeatherDataRange(stationId, startTime, endTime);
    const station = await storage.getWeatherStation(stationId);

    // Build CSV
    const headers = ['timestamp', 'temperature', 'humidity', 'pressure', 'windSpeed', 'windDirection', 'solarRadiation', 'rainfall', 'uvIndex'];
    const rows = data.map((d) => {
      const values = d.data as Record<string, any>;
      return [
        d.timestamp?.toISOString() || '',
        values.temperature ?? '',
        values.humidity ?? '',
        values.pressure ?? '',
        values.windSpeed ?? '',
        values.windDirection ?? '',
        values.solarRadiation ?? '',
        values.rainfall ?? '',
        values.uvIndex ?? '',
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${station?.name || 'weather'}_data_${new Date().toISOString().split('T')[0]}.csv"`
    );
    res.send(csv);
  } catch (error: any) {
    console.error('Export CSV error:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

/**
 * POST /api/client/export/pdf
 * Export data as PDF for the client's station
 */
router.post('/export/pdf', verifyClientToken, async (req: Request, res: Response) => {
  try {
    const { stationId } = (req as any).clientAuth;
    const { generateDashboardPDF } = await import('./services/pdfExportService');

    const station = await storage.getWeatherStation(stationId);
    if (!station) {
      return res.status(404).json({ error: 'Station not found' });
    }

    const latestRecord = await storage.getLatestWeatherData(stationId);
    const latestData = latestRecord
      ? {
          timestamp: latestRecord.timestamp?.toISOString() || new Date().toISOString(),
          data: latestRecord.data as Record<string, any>,
        }
      : null;

    // Get all enabled parameters
    const enabledParameters = [
      'temperature',
      'humidity',
      'pressure',
      'windSpeed',
      'windDirection',
      'solarRadiation',
      'rainfall',
      'uvIndex',
      'dewPoint',
      'windGust',
    ];

    const pdfBuffer = await generateDashboardPDF({
      station: {
        name: station.name,
        location: station.location || undefined,
        latitude: station.latitude || undefined,
        longitude: station.longitude || undefined,
        altitude: station.altitude || undefined,
      },
      latestData,
      enabledParameters,
      title: `${station.name} - Weather Report`,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${station.name.replace(/\s+/g, '_')}_Report_${new Date().toISOString().split('T')[0]}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('Export PDF error:', error);
    res.status(500).json({ error: 'Failed to export PDF' });
  }
});

/**
 * Admin endpoint to create client accounts
 * POST /api/client/admin/create
 */
router.post('/admin/create', async (req: Request, res: Response) => {
  try {
    // In production, add admin authentication here
    const { email, password, name, stationId } = req.body;

    if (!email || !password || !stationId) {
      return res.status(400).json({ error: 'Email, password, and stationId required' });
    }

    if (clientAccounts.has(email.toLowerCase())) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hash = await bcryptjs.hash(password, 10);
    const client: ClientAccount = {
      id: `client-${Date.now()}`,
      email: email.toLowerCase(),
      passwordHash: hash,
      name,
      stationId,
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

export default router;
