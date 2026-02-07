/**
 * Weather API Routes
 * 
 * Server-side proxy for Windy Point Forecast API.
 * API keys are stored server-side for security - never exposed to the client.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";

const router = Router();

// ============================================================
// Configuration - API keys from environment variables
// ============================================================
const WINDY_API_KEY = process.env.WINDY_API_KEY || '';  // Point Forecast API key
const WINDY_MAP_API_KEY = process.env.WINDY_MAP_API_KEY || WINDY_API_KEY;  // Map Forecast API key (falls back to WINDY_API_KEY)

// ============================================================
// Validation schemas
// ============================================================
const pointForecastSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  model: z.enum(['arome', 'iconEu', 'gfs', 'gfsWave', 'namConus', 'namHawaii', 'namAlaska', 'cams']).default('gfs'),
  parameters: z.array(z.string()).default(['wind', 'temp', 'precip', 'pressure', 'rh', 'clouds']),
});



// ============================================================
// GET /api/weather/config
// Returns which APIs are configured (no keys exposed)
// ============================================================
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    windy: {
      configured: !!(WINDY_API_KEY || WINDY_MAP_API_KEY),
      mapApiKey: WINDY_MAP_API_KEY || '', // Map API key needed client-side for Windy Map embed
      pointForecastConfigured: !!WINDY_API_KEY,
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
