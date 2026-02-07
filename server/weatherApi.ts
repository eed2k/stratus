/**
 * Weather API Routes
 * 
 * Server-side proxy for Windy Point Forecast API and AfriGIS Lightning API.
 * API keys are stored server-side for security - never exposed to the client.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";

const router = Router();

// ============================================================
// Configuration - API keys from environment variables
// ============================================================
const WINDY_API_KEY = process.env.WINDY_API_KEY || '';
const AFRIGIS_CLIENT_ID = process.env.AFRIGIS_CLIENT_ID || '';
const AFRIGIS_CLIENT_SECRET = process.env.AFRIGIS_CLIENT_SECRET || '';
const AFRIGIS_API_KEY = process.env.AFRIGIS_API_KEY || '';

// Cache for AfriGIS OAuth2 token
let afrigisToken: { accessToken: string; expiresAt: number } | null = null;

// ============================================================
// Validation schemas
// ============================================================
const pointForecastSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  model: z.enum(['arome', 'iconEu', 'gfs', 'gfsWave', 'namConus', 'namHawaii', 'namAlaska', 'cams']).default('gfs'),
  parameters: z.array(z.string()).default(['wind', 'temp', 'precip', 'pressure', 'rh', 'clouds']),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius: z.number().min(1).max(500).optional().default(50),
});

const lightningHistorySchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius: z.number().min(1).max(500).optional().default(50),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ============================================================
// Helper: AfriGIS OAuth2 Token
// ============================================================
async function getAfrigisToken(): Promise<string | null> {
  if (!AFRIGIS_CLIENT_ID || !AFRIGIS_CLIENT_SECRET) {
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (afrigisToken && afrigisToken.expiresAt > Date.now() + 60000) {
    return afrigisToken.accessToken;
  }

  try {
    const credentials = Buffer.from(`${AFRIGIS_CLIENT_ID}:${AFRIGIS_CLIENT_SECRET}`).toString('base64');
    const response = await fetch('https://auth.afrigis.services/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      console.error('[WeatherAPI] AfriGIS token error:', response.status, await response.text());
      return null;
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    afrigisToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };
    return afrigisToken.accessToken;
  } catch (error) {
    console.error('[WeatherAPI] AfriGIS token fetch failed:', error);
    return null;
  }
}

// ============================================================
// GET /api/weather/config
// Returns which APIs are configured (no keys exposed)
// ============================================================
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    windy: {
      configured: !!WINDY_API_KEY,
      mapApiKey: WINDY_API_KEY || '', // Map API key needed client-side for Windy Map embed
    },
    afrigis: {
      configured: !!(AFRIGIS_CLIENT_ID && AFRIGIS_CLIENT_SECRET && AFRIGIS_API_KEY),
    },
  });
});

// ============================================================
// POST /api/weather/forecast
// Proxy for Windy Point Forecast API
// ============================================================
router.post('/forecast', async (req: Request, res: Response) => {
  try {
    if (!WINDY_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Windy API key not configured. Set WINDY_API_KEY in environment variables.',
      });
    }

    const parsed = pointForecastSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: parsed.error.errors,
      });
    }

    const { lat, lon, model, parameters } = parsed.data;

    const response = await fetch('https://api.windy.com/api/point-forecast/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat,
        lon,
        model,
        parameters,
        levels: ['surface'],
        key: WINDY_API_KEY,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WeatherAPI] Windy forecast error:', response.status, errorText);
      return res.status(response.status).json({
        success: false,
        message: `Windy API error: ${response.status}`,
      });
    }

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[WeatherAPI] Forecast error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch forecast data' });
  }
});

// ============================================================
// GET /api/weather/lightning/feed
// AfriGIS real-time lightning feed
// ============================================================
router.get('/lightning/feed', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radius = parseFloat(req.query.radius as string) || 50;

    const parsed = locationSchema.safeParse({ lat, lon, radius });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates',
        errors: parsed.error.errors,
      });
    }

    const token = await getAfrigisToken();
    if (!token) {
      return res.status(503).json({
        success: false,
        message: 'AfriGIS Lightning API not configured. Contact products@afrigis.co.za for free trial credentials.',
        configRequired: {
          AFRIGIS_CLIENT_ID: 'App Client ID from AfriGIS',
          AFRIGIS_CLIENT_SECRET: 'App Client Secret from AfriGIS',
          AFRIGIS_API_KEY: 'API Key from AfriGIS',
        },
      });
    }

    const url = `https://afrigis.services/weather-lightning/v1/feed?latitude=${lat}&longitude=${lon}&radius=${radius}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-key': AFRIGIS_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WeatherAPI] AfriGIS feed error:', response.status, errorText);
      return res.status(response.status).json({
        success: false,
        message: `AfriGIS API error: ${response.status}`,
      });
    }

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[WeatherAPI] Lightning feed error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch lightning data' });
  }
});

// ============================================================
// GET /api/weather/lightning/history
// AfriGIS historical lightning data
// ============================================================
router.get('/lightning/history', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radius = parseFloat(req.query.radius as string) || 50;
    const startDate = req.query.startDate as string || '';
    const endDate = req.query.endDate as string || '';

    const parsed = lightningHistorySchema.safeParse({ lat, lon, radius, startDate, endDate });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid parameters',
        errors: parsed.error.errors,
      });
    }

    const token = await getAfrigisToken();
    if (!token) {
      return res.status(503).json({
        success: false,
        message: 'AfriGIS Lightning API not configured.',
      });
    }

    let url = `https://afrigis.services/weather-lightning/v1/locationhistory?latitude=${lat}&longitude=${lon}&radius=${radius}`;
    if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
    if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-key': AFRIGIS_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WeatherAPI] AfriGIS history error:', response.status, errorText);
      return res.status(response.status).json({
        success: false,
        message: `AfriGIS API error: ${response.status}`,
      });
    }

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[WeatherAPI] Lightning history error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch lightning history' });
  }
});

// ============================================================
// GET /api/weather/lightning/details
// AfriGIS detailed historical lightning data
// ============================================================
router.get('/lightning/details', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radius = parseFloat(req.query.radius as string) || 50;
    const startDate = req.query.startDate as string || '';
    const endDate = req.query.endDate as string || '';

    const parsed = lightningHistorySchema.safeParse({ lat, lon, radius, startDate, endDate });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid parameters',
        errors: parsed.error.errors,
      });
    }

    const token = await getAfrigisToken();
    if (!token) {
      return res.status(503).json({
        success: false,
        message: 'AfriGIS Lightning API not configured.',
      });
    }

    let url = `https://afrigis.services/weather-lightning/v1/historicaldetails?latitude=${lat}&longitude=${lon}&radius=${radius}`;
    if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
    if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-api-key': AFRIGIS_API_KEY,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WeatherAPI] AfriGIS details error:', response.status, errorText);
      return res.status(response.status).json({
        success: false,
        message: `AfriGIS API error: ${response.status}`,
      });
    }

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[WeatherAPI] Lightning details error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch lightning details' });
  }
});

// ============================================================
// GET /api/weather/geocode
// Geocode a location name using Nominatim (free, no API key needed)
// ============================================================
router.get('/geocode', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
      });
    }

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Stratus-Weather-Server/1.1.0',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: 'Geocoding service error',
      });
    }

    const results = await response.json();
    return res.json({
      success: true,
      data: (results as Array<{ lat: string; lon: string; display_name: string; address?: Record<string, string> }>).map((r) => ({
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        displayName: r.display_name,
        address: r.address,
      })),
    });
  } catch (error) {
    console.error('[WeatherAPI] Geocode error:', error);
    return res.status(500).json({ success: false, message: 'Failed to geocode location' });
  }
});

export default router;
