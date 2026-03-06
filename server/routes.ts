import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage, type WeatherData } from "./localStorage";
import { setupAuth, isAuthenticated, isAdmin, getUserId } from "./localAuth";
import { z } from "zod";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { auditLog, AUDIT_ACTIONS, type AuditAction } from "./services/auditLogService";

// Helper function to safely parse integer parameters with NaN validation
function parseIntSafe(value: string | undefined, paramName: string): { value: number | null; error: string | null } {
  if (value === undefined || value === '') {
    return { value: null, error: `Missing required parameter: ${paramName}` };
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return { value: null, error: `Invalid ${paramName}: must be a valid integer` };
  }
  return { value: parsed, error: null };
}

// Rate limiter for public ingest endpoint
const ingestRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 60, // Max 60 requests per minute per IP
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Local schema definitions for validation
// Enhanced for Campbell Scientific and WMO compliance
// Supported connection types for Campbell Scientific dataloggers:
// - dropbox: Dropbox sync for cellular modems uploading to cloud
// - http_post: HTTP POST from station to server (datalogger pushes data)
// - tcp_ip, tcp: Direct TCP/IP connection to datalogger (ethernet/WiFi)
// - ip, wifi, http: HTTP-based polling (server pulls from datalogger API)
// - lora: LoRaWAN long-range radio
// - gsm, 4g: Cellular network via GSM/4G modem
// - mqtt: MQTT publish/subscribe messaging
// - satellite: Satellite data communication (Iridium, Inmarsat)
// - modbus: Modbus TCP protocol
// - dnp3: DNP3 SCADA protocol
const VALID_CONNECTION_TYPES = [
  'dropbox', 'http_post', 'tcp_ip', 'tcp', 'ip', 'wifi', 'http',
  'lora', 'gsm', '4g', 'mqtt', 'satellite', 'modbus', 'dnp3', 'pakbus', 'demo', 'rikacloud', 'arduino_iot'
] as const;

const insertWeatherStationSchema = z.object({
  name: z.string().min(1, "Station name is required").max(100, "Station name too long"),
  pakbusAddress: z.number()
    .int("PakBus address must be an integer")
    .min(1, "PakBus address must be at least 1")
    .max(4094, "PakBus address must be at most 4094")
    .optional()
    .default(1),
  connectionType: z.enum(VALID_CONNECTION_TYPES, {
    errorMap: () => ({ message: `Invalid connection type. Must be one of: ${VALID_CONNECTION_TYPES.join(', ')}` })
  }),
  connectionConfig: z.union([
    z.string(), // Allow JSON string
    z.object({
      host: z.string().optional(),
      port: z.number().int().min(1).max(65535).optional(),
      apn: z.string().optional(),
      gatewayHost: z.string().optional(),
      gatewayPort: z.number().int().min(1).max(65535).optional(),
      timeout: z.number().int().min(1000).max(300000).optional(), // 1s to 5min
      retryAttempts: z.number().int().min(0).max(10).optional(),
      retryDelay: z.number().int().min(1000).max(60000).optional(), // 1s to 1min
      folderPath: z.string().optional(), // Dropbox folder path
      syncInterval: z.number().optional(), // Dropbox sync interval
      apiEndpoint: z.string().optional(), // HTTP POST endpoint
      apiKey: z.string().optional(), // API key for HTTP POST
      broker: z.string().optional(), // MQTT broker
      topic: z.string().optional(), // MQTT topic
      frequency: z.string().optional(), // LoRa frequency
    }).passthrough()
  ]).optional(),
  securityCode: z.number()
    .int("Security code must be an integer")
    .min(0, "Security code must be at least 0")
    .max(65535, "Security code must be at most 65535")
    .optional()
    .default(0),
  // WMO-compliant metadata fields
  latitude: z.number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90")
    .optional()
    .nullable(),
  longitude: z.number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180")
    .optional()
    .nullable(),
  altitude: z.number()
    .min(-500, "Altitude must be at least -500m (Dead Sea level)")
    .max(9000, "Altitude must be at most 9000m (above Everest)")
    .optional()
    .nullable(),
  timezone: z.string().optional(),
  location: z.string().max(200, "Location description too long").optional().nullable(),
  // Additional fields sent by client
  stationType: z.string().optional(),
  ipAddress: z.string().optional().nullable(),
  port: z.number().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  apiEndpoint: z.string().optional().nullable(),
  pollInterval: z.number().optional(),
  protocol: z.string().optional(),
  dataTable: z.string().optional(),
  dataloggerModel: z.string().optional().nullable(),
  dataloggerSerialNumber: z.string().optional().nullable(),
  dataloggerProgramName: z.string().optional().nullable(),
  modemModel: z.string().optional().nullable(),
  modemSerialNumber: z.string().optional().nullable(),
  modemPhoneNumber: z.string().optional().nullable(),
  simCardNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  siteDescription: z.string().optional().nullable(),
  lastCalibrationDate: z.any().optional().nullable(),
  nextCalibrationDate: z.any().optional().nullable(),
}).passthrough();

const insertWeatherDataSchema = z.object({
  stationId: z.number(),
  tableName: z.string().optional(),
  recordNumber: z.number().optional(),
  timestamp: z.coerce.date(),
  data: z.record(z.any())
});

const insertUserPreferencesSchema = z.object({
  userId: z.string(),
  temperatureUnit: z.string().optional(),
  windSpeedUnit: z.string().optional(),
  pressureUnit: z.string().optional(),
  precipitationUnit: z.string().optional(),
  theme: z.string().optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  tempHighAlert: z.number().optional(),
  windHighAlert: z.number().optional(),
  units: z.string().optional(),
  timezone: z.string().optional(),
  serverAddress: z.string().optional(),
});

const insertStationLogSchema = z.object({
  stationId: z.number(),
  logType: z.string(),
  message: z.string(),
  metadata: z.any().optional()
});

const insertOrganizationSchema = z.object({
  name: z.string(),
  description: z.string().optional().nullable(),
  ownerId: z.string(),
  slug: z.string().optional()
});

const insertOrganizationMemberSchema = z.object({
  organizationId: z.number(),
  userId: z.string(),
  role: z.string()
});

const insertOrganizationInvitationSchema = z.object({
  organizationId: z.number(),
  email: z.string(),
  role: z.string()
});

// Alarm validation schema
const insertAlarmSchema = z.object({
  stationId: z.number(),
  name: z.string().min(1, "Alarm name is required"),
  parameter: z.string().min(1, "Parameter is required"),
  condition: z.enum(['above', 'below', 'equals', 'not_equals', 'change', 'stale', 'no_charge'], {
    errorMap: () => ({ message: "Condition must be one of: above, below, equals, not_equals, change, stale, no_charge" })
  }),
  threshold: z.number({
    required_error: "Threshold is required",
    invalid_type_error: "Threshold must be a number"
  }),
  staleMinutes: z.number().int().min(5).max(10080).optional(), // 5 min to 7 days
  unit: z.string().optional().default(''),
  enabled: z.boolean().optional().default(true),
  notifyEmail: z.boolean().optional().default(true),
  notifyPush: z.boolean().optional().default(false)
});

// Map storage Alarm to client-expected format
function mapAlarmToClient(alarm: any) {
  return {
    id: alarm.id,
    stationId: alarm.stationId,
    name: alarm.name || alarm.parameter || '',
    parameter: alarm.parameter || '',
    condition: alarm.condition,
    threshold: alarm.threshold,
    staleMinutes: alarm.staleMinutes ?? alarm.stale_minutes ?? null,
    unit: alarm.unit || '',
    enabled: alarm.isEnabled !== undefined ? alarm.isEnabled : (alarm.enabled !== false),
    notifyEmail: alarm.emailNotifications !== undefined ? alarm.emailNotifications : (alarm.notifyEmail !== false),
    notifyPush: false,
    lastTriggered: alarm.lastTriggeredAt ? alarm.lastTriggeredAt.toISOString?.() || alarm.lastTriggeredAt : null,
    triggerCount: alarm.triggerCount || 0,
  };
}

import { nanoid } from "nanoid";
import { registerCampbellRoutes } from "./campbell/routes";
import { dataCollectionService } from "./campbell/dataCollectionService";
import { protocolManager } from "./protocols/protocolManager";
import { registerStationSetupRoutes } from "./station-setup/routes";
import shareRoutes from "./shares/routes";
import complianceRoutes from "./compliance/routes";
import clientRoutes from "./clientRoutes";
import fileWatcherRoutes from "./services/fileWatcherRoutes";
import { fileWatcherService } from "./services/fileWatcherService";
import dropboxSyncRoutes from "./services/dropboxSyncRoutes";
import { dropboxSyncService, setWeatherDataBroadcaster } from "./services/dropboxSyncService";
import * as postgres from "./db-postgres";
import * as db from "./db";
const usePostgres = postgres.isPostgresEnabled();
import { triggerStalenessCheck, sendTestStalenessAlert } from "./services/stalenessMonitorService";

const DEMO_MODE = process.env.VITE_DEMO_MODE === 'true';

const optionalAuth: RequestHandler = (req, res, next) => {
  if (DEMO_MODE) {
    // In demo mode, allow read-only access without auth
    // Write operations (POST/PUT/PATCH/DELETE) still require authentication
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    return isAuthenticated(req, res, next);
  }
  return isAuthenticated(req, res, next);
};

// Store connected WebSocket clients by station ID
const stationClients = new Map<number, Set<WebSocket>>();

export function broadcastWeatherData(stationId: number, data: WeatherData) {
  const clients = stationClients.get(stationId);
  if (clients) {
    const message = JSON.stringify({ type: "weather_update", stationId, data });
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

// Wire up WebSocket broadcaster for Dropbox sync service
setWeatherDataBroadcaster(broadcastWeatherData);

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication
  await setupAuth(app);

  // Register Campbell Scientific routes
  registerCampbellRoutes(app);

  // Register station setup routes
  await registerStationSetupRoutes(app);

  // Register share routes
  app.use('/api', shareRoutes);

  // Register compliance routes (GDPR, ISO 17025, ISO 19157)
  app.use('/api/compliance', complianceRoutes);

  // Register client dashboard routes (for external client applications)
  app.use('/api/client', clientRoutes);

  // Register file watcher routes (local file sync)
  app.use('/api/file-watcher', isAuthenticated, isAdmin, fileWatcherRoutes);

  // Register Dropbox sync routes (admin-only)
  app.use('/api/dropbox-sync', isAuthenticated, isAdmin, dropboxSyncRoutes);

  // ── Staleness Monitor API routes ──────────────────────────────────────
  // GET /api/staleness/status - Check current staleness status of all stations
  app.get('/api/staleness/status', isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const result = await triggerStalenessCheck();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // POST /api/staleness/test-email - Send a test staleness alert email
  app.post('/api/staleness/test-email', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { email } = req.body || {};
      const sent = await sendTestStalenessAlert(email);
      if (sent) {
        res.json({ success: true, message: 'Test staleness alert email sent successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to send test email. Check MailerSend configuration.' });
      }
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ── Database Backup API routes (admin only) ────────────────────────────
  // POST /api/backup/create - Trigger a manual backup
  app.post('/api/backup/create', isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const { execSync } = await import('child_process');
      const backupDir = '/root/stratus/backups/daily';
      const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `stratus_backup_manual_${date}.sql.gz`;
      
      // Create backup directory if needed
      execSync(`mkdir -p ${backupDir}`);
      
      // Run pg_dump via docker exec
      execSync(
        `docker exec stratus-postgres pg_dump -U stratus -d stratus --clean --if-exists --no-owner --no-privileges | gzip > ${backupDir}/${filename}`,
        { timeout: 60000 }
      );
      
      const stats = fs.statSync(`${backupDir}/${filename}`);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      
      console.log(`[Backup] Manual backup created: ${filename} (${sizeMB} MB)`);
      res.json({ success: true, filename, size: `${sizeMB} MB`, timestamp: new Date().toISOString() });
    } catch (error: any) {
      console.error('[Backup] Manual backup failed:', error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // GET /api/backup/list - List available backups
  app.get('/api/backup/list', isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const backupBase = '/root/stratus/backups';
      const categories = ['daily', 'weekly', 'pre-deploy'];
      const backups: { category: string; filename: string; size: string; date: string }[] = [];
      
      for (const cat of categories) {
        const dir = `${backupBase}/${cat}`;
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql.gz')).sort().reverse();
          for (const file of files) {
            const stats = fs.statSync(`${dir}/${file}`);
            backups.push({
              category: cat,
              filename: file,
              size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
              date: stats.mtime.toISOString(),
            });
          }
        }
      }
      
      res.json({ success: true, backups, total: backups.length });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // GET /api/backup/status - Get backup system status
  app.get('/api/backup/status', isAuthenticated, isAdmin, async (_req, res) => {
    try {
      const backupBase = '/root/stratus/backups';
      const categories = ['daily', 'weekly', 'pre-deploy'];
      let latestBackup: string | null = null;
      let latestDate: Date | null = null;
      let totalBackups = 0;
      let totalSize = 0;
      
      for (const cat of categories) {
        const dir = `${backupBase}/${cat}`;
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql.gz'));
          totalBackups += files.length;
          for (const file of files) {
            const stats = fs.statSync(`${dir}/${file}`);
            totalSize += stats.size;
            if (!latestDate || stats.mtime > latestDate) {
              latestDate = stats.mtime;
              latestBackup = `${cat}/${file}`;
            }
          }
        }
      }
      
      const cronInstalled = fs.existsSync('/etc/cron.d/stratus-backup') || 
        (() => { try { const { execSync } = require('child_process'); return execSync('crontab -l 2>/dev/null').toString().includes('backup.sh'); } catch { return false; } })();
      
      res.json({
        success: true,
        cronScheduled: cronInstalled,
        latestBackup,
        latestDate: latestDate?.toISOString() || null,
        totalBackups,
        totalSize: `${(totalSize / 1024 / 1024).toFixed(2)} MB`,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Initialize file watcher service
  await fileWatcherService.initialize();

  // Initialize Dropbox sync with configuration from environment or DB
  // This auto-syncs .dat files from Dropbox folder every hour
  let DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || '';
  let DROPBOX_FOLDER_PATH = process.env.DROPBOX_FOLDER_PATH || '';
  // Station ID is optional - if not provided, will auto-create based on folder name
  const DROPBOX_STATION_ID_STR = process.env.DROPBOX_STATION_ID;
  let DROPBOX_STATION_ID = DROPBOX_STATION_ID_STR ? parseInt(DROPBOX_STATION_ID_STR, 10) : 0; // 0 means auto-detect/create
  const DROPBOX_SYNC_INTERVAL = parseInt(process.env.DROPBOX_SYNC_INTERVAL || '3600000', 10); // Default 1 hour
  
  // OAuth 2.0 refresh token support for 24/7 deployment
  let DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || '';
  let DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || '';
  let DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || '';

  // Restore Dropbox credentials from database if not set via environment
  if (!DROPBOX_REFRESH_TOKEN || !DROPBOX_APP_KEY) {
    try {
      const dbCreds = usePostgres
        ? await postgres.getSetting('dropbox_credentials')
        : db.getSetting('dropbox_credentials');
      if (dbCreds) {
        const parsed = JSON.parse(dbCreds);
        if (!DROPBOX_APP_KEY && parsed.appKey) { DROPBOX_APP_KEY = parsed.appKey; process.env.DROPBOX_APP_KEY = parsed.appKey; }
        if (!DROPBOX_APP_SECRET && parsed.appSecret) { DROPBOX_APP_SECRET = parsed.appSecret; process.env.DROPBOX_APP_SECRET = parsed.appSecret; }
        if (!DROPBOX_REFRESH_TOKEN && parsed.refreshToken) { DROPBOX_REFRESH_TOKEN = parsed.refreshToken; process.env.DROPBOX_REFRESH_TOKEN = parsed.refreshToken; }
        console.log('[Routes] Dropbox credentials restored from database');
      }
    } catch (err: any) {
      console.warn('[Routes] Could not restore Dropbox credentials from DB:', err.message);
    }
  }
  
  if (DROPBOX_ACCESS_TOKEN || DROPBOX_REFRESH_TOKEN) {
    dropboxSyncService.configure({
      accessToken: DROPBOX_ACCESS_TOKEN,
      folderPath: DROPBOX_FOLDER_PATH,
      stationId: DROPBOX_STATION_ID,
      syncInterval: DROPBOX_SYNC_INTERVAL,
      enabled: true,
      // Include refresh token config for automatic token renewal
      refreshToken: DROPBOX_REFRESH_TOKEN || undefined,
      appKey: DROPBOX_APP_KEY || undefined,
      appSecret: DROPBOX_APP_SECRET || undefined,
    });
    const stationInfo = DROPBOX_STATION_ID > 0 ? `station=${DROPBOX_STATION_ID}` : 'station=auto-detect';
    const refreshInfo = DROPBOX_REFRESH_TOKEN ? ', refresh_token=configured' : ', refresh_token=none (short-lived token only)';
    console.log(`[Routes] Dropbox sync configured: folder=${DROPBOX_FOLDER_PATH}, ${stationInfo}, interval=${DROPBOX_SYNC_INTERVAL}ms${refreshInfo}`);
  }

  // Public health check endpoint with CORS for external clients
  app.get('/api/health', (req, res) => {
    // Set CORS headers for cross-origin access
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.json({ status: 'ok', timestamp: new Date().toISOString(), server: 'stratus' });
  });

  // Initialize data collection service
  try {
    await dataCollectionService.initialize();
    console.log('Campbell Scientific data collection service initialized');
  } catch (error) {
    console.error('Failed to initialize data collection service:', error);
  }

  // Initialize Protocol Manager for all station types
  try {
    await protocolManager.initialize();
    console.log('Protocol Manager initialized');
  } catch (error) {
    console.error('Failed to initialize Protocol Manager:', error);
  }

  // Protocol Manager API endpoints
  app.get("/api/protocols/status", optionalAuth, async (req, res) => {
    try {
      const statuses: Record<number, any> = {};
      const allStatuses = protocolManager.getAllStationStatuses();
      for (const [id, status] of allStatuses) {
        statuses[id] = status;
      }
      res.json(statuses);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/protocols/status/:stationId", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const status = protocolManager.getStationStatus(stationId);
      if (!status) {
        return res.status(404).json({ message: "Station not found" });
      }
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/protocols/test/:stationId", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ success: false, message: error });
      }
      const result = await protocolManager.testConnection(stationId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/protocols/reconnect/:stationId", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const station = await storage.getWeatherStation(stationId);
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      
      // Re-register station to force reconnection
      await protocolManager.unregisterStation(stationId);
      
      let connectionConfig: any = {};
      if (station.connectionConfig) {
        try {
          connectionConfig = typeof station.connectionConfig === 'string' 
            ? JSON.parse(station.connectionConfig) 
            : station.connectionConfig;
        } catch (e) {
          connectionConfig = {};
        }
      }
      
      // Map connection type to protocol
      const protocolMap: Record<string, string> = {
        'mqtt': 'mqtt', 'http': 'http', 'ip': 'http', 'wifi': 'http',
        'tcp': 'http', 'tcp_ip': 'http', 'lora': 'lora', 'serial': 'modbus', 
        'satellite': 'satellite', 'dropbox': 'http', 'http_post': 'http',
        'gsm': 'http', '4g': 'http', 'pakbus': 'pakbus', 'rikacloud': 'http',
        'arduino_iot': 'http',
      };
      
      await protocolManager.registerStation(stationId, {
        stationId,
        protocol: (protocolMap[station.connectionType || ''] || 'http') as any,
        connectionType: (station.connectionType as any) || 'http',
        host: station.ipAddress || connectionConfig.broker,
        port: station.port || connectionConfig.port,
        apiKey: station.apiKey || undefined,
        apiEndpoint: station.apiEndpoint || connectionConfig.topic,
        ...connectionConfig,
      });
      
      res.json({ success: true, message: "Station reconnected" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Station cleanup endpoint - remove demo and duplicate stations
  app.post("/api/stations/cleanup", isAuthenticated, async (req, res) => {
    try {
      const stations = await storage.getStations();
      const deleted: number[] = [];
      const kept: any[] = [];
      const seenNames = new Set<string>();
      
      for (const station of stations) {
        // Delete demo stations
        if (station.name?.toLowerCase().includes('demo') || 
            station.connectionType === 'demo') {
          await storage.deleteStation(station.id);
          deleted.push(station.id);
          continue;
        }
        
        // Delete duplicates (keep first occurrence)
        const normalizedName = station.name?.toLowerCase().trim();
        if (seenNames.has(normalizedName)) {
          await storage.deleteStation(station.id);
          deleted.push(station.id);
        } else {
          seenNames.add(normalizedName);
          kept.push({ id: station.id, name: station.name });
        }
      }
      
      res.json({ 
        message: `Cleanup complete: deleted ${deleted.length} stations, kept ${kept.length}`,
        deleted,
        kept
      });
    } catch (error: any) {
      console.error("Error cleaning up stations:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // NOTE: Export functionality has been disabled
  // If you need to re-enable exports, uncomment the PDF and CSV export endpoints below

  // Setup WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    let subscribedStations: number[] = [];

    ws.on("message", (message) => {
      try {
        // Limit WebSocket message size to 4KB to prevent abuse
        const msgStr = message.toString();
        if (msgStr.length > 4096) {
          ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
          return;
        }
        const data = JSON.parse(msgStr);
        
        if (data.type === "subscribe" && typeof data.stationId === "number") {
          const stationId = data.stationId;
          if (!stationClients.has(stationId)) {
            stationClients.set(stationId, new Set());
          }
          stationClients.get(stationId)!.add(ws);
          subscribedStations.push(stationId);
          ws.send(JSON.stringify({ type: "subscribed", stationId }));
        }
        
        if (data.type === "unsubscribe" && typeof data.stationId === "number") {
          const stationId = data.stationId;
          const clients = stationClients.get(stationId);
          if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
              stationClients.delete(stationId);
            }
          }
          subscribedStations = subscribedStations.filter((id) => id !== stationId);
          ws.send(JSON.stringify({ type: "unsubscribed", stationId }));
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
      // Clean up subscriptions when client disconnects
      subscribedStations.forEach((stationId) => {
        const clients = stationClients.get(stationId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            stationClients.delete(stationId);
          }
        }
      });
    });

    ws.send(JSON.stringify({ type: "connected" }));
  });

  // Auth routes
  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Update user profile
  app.patch("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { firstName, lastName, email } = req.body;
      
      const updates: any = {};
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      if (email !== undefined) updates.email = email;
      
      const user = await storage.updateUser(userId, updates);
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // ========== User Management Routes ==========
  
  // Get all users (admin only)
  app.get("/api/users", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Remove password hashes from response
      const sanitizedUsers = users.map(({ passwordHash, ...user }) => user);
      res.json(sanitizedUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Get user by email
  app.get("/api/users/:email", isAuthenticated, async (req, res) => {
    try {
      const user = await storage.getUserByEmail(req.params.email);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Remove password hash from response
      const { passwordHash, ...sanitizedUser } = user;
      res.json(sanitizedUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Create new user (admin only)
  app.post("/api/users", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { email, firstName, lastName, password, role, assignedStations, sendInvitation, customMessage } = req.body;
      
      // Validate required fields
      if (!email || !firstName) {
        return res.status(400).json({ message: "Missing required fields: email, firstName" });
      }

      // Check if user already exists
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "User with this email already exists" });
      }

      // Hash password with bcrypt - never accept pre-hashed passwords from client
      const bcrypt = require('bcryptjs');
      let finalPasswordHash: string | undefined;
      
      // If sendInvitation is true, create user without password and send invitation email
      if (sendInvitation === true) {
        // Create user with a temporary placeholder password (will be set via invitation)
        const tempHash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10);
        finalPasswordHash = tempHash;
      } else {
        // Traditional flow - password required
        if (!password) {
          return res.status(400).json({ message: "Missing required field: password (or set sendInvitation: true)" });
        }
        finalPasswordHash = await bcrypt.hash(password, 10);
      }

      const user = await storage.createUser({
        email,
        firstName,
        lastName,
        passwordHash: finalPasswordHash!,
        role: role || 'user',
        assignedStations: assignedStations || []
      });

      // Log audit event
      await auditLog.log(AUDIT_ACTIONS.USER_CREATE, 'users', {
        userId: getUserId(req),
        userEmail: email,
        details: { newUserEmail: email, role: user.role, invitationSent: sendInvitation === true },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      // Send invitation email if requested
      if (sendInvitation === true) {
        try {
          const postgres = require('./db-postgres');
          const invitedBy = getUserId(req);
          const token = await postgres.createUserInvitationToken(email, invitedBy, customMessage);
          
          const { sendUserInvitationEmail } = require('./services/emailService');
          
          const emailSent = await sendUserInvitationEmail(
            email,
            {
              firstName,
              inviterName: invitedBy,
              setupToken: token,
              customMessage
            }
          );
          
          if (!emailSent) {
            console.error(`[Routes] Failed to send invitation email to ${email}`);
          } else {
            console.log(`[Routes] Invitation email sent to ${email}`);
          }
        } catch (emailError) {
          console.error('[Routes] Error sending invitation email:', emailError);
          // Don't fail the request - user was created, email just failed
        }
      }

      // Remove password hash from response
      const { passwordHash: _, ...sanitizedUser } = user;
      res.status(201).json({
        ...sanitizedUser,
        invitationSent: sendInvitation === true
      });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Resend invitation email to a user (admin only)
  app.post("/api/users/:email/resend-invitation", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { email } = req.params;
      const { customMessage } = req.body;
      
      // Check if user exists
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Create new invitation token and send email
      const postgres = require('./db-postgres');
      const invitedBy = getUserId(req);
      const token = await postgres.createUserInvitationToken(email, invitedBy, customMessage);
      
      const { sendUserInvitationEmail } = require('./services/emailService');
      
      const emailSent = await sendUserInvitationEmail(
        email,
        {
          firstName: user.firstName || 'User',
          inviterName: invitedBy,
          setupToken: token,
          customMessage
        }
      );
      
      if (!emailSent) {
        return res.status(500).json({ message: "Failed to send invitation email" });
      }

      // Log audit event
      await auditLog.log(AUDIT_ACTIONS.USER_UPDATE, 'users', {
        userId: getUserId(req),
        userEmail: email,
        details: { action: 'resend_invitation' },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ success: true, message: "Invitation email sent successfully" });
    } catch (error) {
      console.error("Error resending invitation:", error);
      res.status(500).json({ message: "Failed to resend invitation" });
    }
  });

  // Update user (admin only)
  app.patch("/api/users/:email", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { firstName, lastName, password, role, assignedStations } = req.body;
      
      const updates: any = {};
      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;
      
      // Handle password update - always hash server-side, never accept pre-hashed
      if (password) {
        const bcrypt = require('bcryptjs');
        updates.passwordHash = await bcrypt.hash(password, 10);
      }
      
      if (role !== undefined) updates.role = role;
      if (assignedStations !== undefined) updates.assignedStations = assignedStations;

      const user = await storage.updateUserData(req.params.email, updates);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Log audit event
      await auditLog.log(AUDIT_ACTIONS.USER_UPDATE, 'users', {
        userId: getUserId(req),
        userEmail: req.params.email,
        details: { updates: Object.keys(updates) },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      // Remove password hash from response
      const { passwordHash: _, ...sanitizedUser } = user;
      res.json(sanitizedUser);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:email", isAuthenticated, isAdmin, async (req, res) => {
    try {
      await storage.deleteUserByEmail(req.params.email);

      // Log audit event
      await auditLog.log(AUDIT_ACTIONS.USER_DELETE, 'users', {
        userId: getUserId(req),
        userEmail: req.params.email,
        details: { deletedUserEmail: req.params.email },
        ip: req.ip,
        userAgent: req.headers['user-agent']
      });

      res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Weather Stations routes (demo mode bypasses auth)
  app.get("/api/stations", optionalAuth, async (req, res) => {
    try {
      const stations = await storage.getStations();
      res.json(stations);
    } catch (error) {
      console.error("Error fetching stations:", error);
      res.status(500).json({ message: "Failed to fetch stations" });
    }
  });

  app.get("/api/stations/:id", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.id, 'id');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const station = await storage.getStation(stationId);
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      res.json(station);
    } catch (error) {
      console.error("Error fetching station:", error);
      res.status(500).json({ message: "Failed to fetch station" });
    }
  });

  app.post("/api/stations", isAuthenticated, async (req, res) => {
    try {
      const parsed = insertWeatherStationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid station data", errors: parsed.error.errors });
      }
      const station = await storage.createStation(parsed.data as any);
      
      // Auto-register with Protocol Manager if not demo
      if (station.connectionType !== 'demo' && station.isActive) {
        try {
          let connectionConfig: any = {};
          if (station.connectionConfig) {
            try {
              connectionConfig = typeof station.connectionConfig === 'string' 
                ? JSON.parse(station.connectionConfig) 
                : station.connectionConfig;
            } catch (e) {
              connectionConfig = {};
            }
          }
          
          // Handle Dropbox sync configuration
          const isDropboxStation = station.connectionType === 'dropbox' || 
            (connectionConfig.importSource === 'dropbox') || 
            (connectionConfig.type === 'import-only' && connectionConfig.importSource === 'dropbox');
          if (isDropboxStation) {
            const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || '';
            const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || '';
            const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || '';
            const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || '';
            
            if (DROPBOX_ACCESS_TOKEN || DROPBOX_REFRESH_TOKEN) {
              const folderPath = connectionConfig.folderPath || '';
              const filePattern = connectionConfig.filePattern || '';
              const syncInterval = parseInt(connectionConfig.syncInterval) || 3600;
              
              // Do NOT call dropboxSyncService.configure() here — it overwrites the main
              // singleton config (Hopefield), breaking existing sync. Instead, only create a
              // dropbox_configs DB entry so syncDbConfigs() picks up this new station.
              console.log(`[Routes] Creating DB-only Dropbox config for station ${station.id} (not overwriting main sync config)`);

              // Auto-create dropbox_configs entry so syncDbConfigs() picks up this station
              try {
                await storage.createDropboxConfig({
                  name: station.name || `Station ${station.id} Sync`,
                  folderPath: folderPath,
                  filePattern: filePattern || undefined,
                  stationId: station.id,
                  syncInterval: syncInterval * 1000,
                  enabled: true,
                });
                console.log(`[Routes] Dropbox config created for station ${station.id}: folder=${folderPath}, pattern=${filePattern || '*'}, interval=${syncInterval}s`);
                
                // Reinitialize sync service to pick up new config & trigger immediate sync
                await dropboxSyncService.reinitialize();
                setTimeout(async () => {
                  try {
                    console.log(`[Routes] Auto-triggering sync for new Dropbox station ${station.id}...`);
                    await dropboxSyncService.syncNow();
                  } catch (err: any) {
                    console.error(`[Routes] Auto-sync after station creation failed:`, err.message);
                  }
                }, 1000);
              } catch (dbErr: any) {
                console.warn(`[Routes] Could not create dropbox_configs entry: ${dbErr.message}`);
              }
            } else {
              console.warn(`[Routes] Station ${station.id} configured for Dropbox but no access token in environment`);
            }
          }
          
          const protocolMap: Record<string, string> = {
            'mqtt': 'mqtt', 'http': 'http', 'ip': 'http', 'wifi': 'http',
            'tcp': 'http', 'tcp_ip': 'http', 'lora': 'lora', 'serial': 'modbus', 
            'satellite': 'satellite', 'dropbox': 'http', 'http_post': 'http',
            'gsm': 'http', '4g': 'http', 'pakbus': 'pakbus', 'rikacloud': 'http',
            'arduino_iot': 'http',
          };
          
          await protocolManager.registerStation(station.id, {
            stationId: station.id,
            protocol: (protocolMap[station.connectionType || ''] || 'http') as any,
            connectionType: (station.connectionType as any) || 'http',
            host: station.ipAddress || connectionConfig.broker,
            port: station.port || connectionConfig.port,
            apiKey: station.apiKey || undefined,
            apiEndpoint: station.apiEndpoint || connectionConfig.topic,
            ...connectionConfig,
          });
        } catch (regError) {
          console.warn(`Failed to register station ${station.id} with Protocol Manager:`, regError);
        }
      }
      
      // Log station creation
      await auditLog.log(AUDIT_ACTIONS.STATION_CREATE, 'stations', {
        userId: getUserId(req),
        resourceId: station.id,
        details: { name: station.name, connectionType: station.connectionType },
        ip: req.ip || req.socket.remoteAddress,
        status: 'success'
      });
      
      res.status(201).json(station);
    } catch (error) {
      console.error("Error creating station:", error);
      res.status(500).json({ message: "Failed to create station" });
    }
  });

  app.patch("/api/stations/:id", isAuthenticated, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.id, 'id');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      // Whitelist allowed fields to prevent injection of unexpected properties
      const allowedFields = ['name', 'location', 'latitude', 'longitude', 'altitude', 'isActive',
        'connectionType', 'connectionConfig', 'ipAddress', 'port', 'protocol',
        'pakbusAddress', 'securityCode', 'dataloggerModel', 'dataloggerSerialNumber',
        'dataloggerProgramName', 'siteDescription', 'notes', 'modemModel', 'modemSerialNumber',
        'lastCalibrationDate', 'nextCalibrationDate', 'stationImage', 'stationType'];
      const sanitizedBody: Record<string, any> = {};
      for (const key of allowedFields) {
        if (req.body[key] !== undefined) {
          sanitizedBody[key] = req.body[key];
        }
      }
      const station = await storage.updateStation(stationId, sanitizedBody);
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      
      // Re-register with Protocol Manager if connection settings changed
      if (station.connectionType !== 'demo') {
        try {
          await protocolManager.unregisterStation(station.id);
          
          if (station.isActive) {
            let connectionConfig: any = {};
            if (station.connectionConfig) {
              try {
                connectionConfig = typeof station.connectionConfig === 'string' 
                  ? JSON.parse(station.connectionConfig) 
                  : station.connectionConfig;
              } catch (e) {
                connectionConfig = {};
              }
            }
            
            // Handle Dropbox sync configuration updates
            // Use DB-only approach (like the POST/create route) to avoid overwriting
            // the main singleton sync config (e.g. Hopefield)
            if (station.connectionType === 'dropbox') {
              const folderPath = connectionConfig.folderPath || '';
              const filePattern = connectionConfig.filePattern || '';
              const syncInterval = parseInt(connectionConfig.syncInterval) || 3600;
              
              try {
                // Update or create the dropbox_configs DB entry
                const existingConfigs = await storage.getDropboxConfigs();
                const existing = existingConfigs.find((c: any) => c.stationId === station.id);
                
                if (existing) {
                  await storage.updateDropboxConfig(existing.id, {
                    folderPath,
                    filePattern,
                    syncInterval: syncInterval * 1000,
                    enabled: true,
                  });
                  console.log(`[Routes] Dropbox config updated for station ${station.id}: folder=${folderPath}, pattern=${filePattern || '*'}, interval=${syncInterval}s`);
                } else {
                  await storage.createDropboxConfig({
                    name: station.name || `Station ${station.id}`,
                    folderPath,
                    filePattern,
                    stationId: station.id,
                    syncInterval: syncInterval * 1000,
                    enabled: true,
                  });
                  console.log(`[Routes] Dropbox config created for station ${station.id}: folder=${folderPath}, pattern=${filePattern || '*'}, interval=${syncInterval}s`);
                }
                
                // Reinitialize sync service to pick up DB changes
                await dropboxSyncService.reinitialize();
              } catch (dbErr: any) {
                console.warn(`[Routes] Could not update dropbox_configs entry: ${dbErr.message}`);
              }
            }
            
            const protocolMap: Record<string, string> = {
              'mqtt': 'mqtt', 'http': 'http', 'ip': 'http', 'wifi': 'http',
              'tcp': 'http', 'tcp_ip': 'http', 'lora': 'lora', 'serial': 'modbus', 
              'satellite': 'satellite', 'dropbox': 'http', 'http_post': 'http',
              'gsm': 'http', '4g': 'http', 'pakbus': 'pakbus', 'rikacloud': 'http',
              'arduino_iot': 'http',
            };
            
            await protocolManager.registerStation(station.id, {
              stationId: station.id,
              protocol: (protocolMap[station.connectionType || ''] || 'http') as any,
              connectionType: (station.connectionType as any) || 'http',
              host: station.ipAddress || connectionConfig.broker,
              port: station.port || connectionConfig.port,
              apiKey: station.apiKey || undefined,
              apiEndpoint: station.apiEndpoint || connectionConfig.topic,
              ...connectionConfig,
            });
          }
        } catch (regError) {
          console.warn(`Failed to update station ${station.id} in Protocol Manager:`, regError);
        }
      }
      
      res.json(station);
    } catch (error) {
      console.error("Error updating station:", error);
      res.status(500).json({ message: "Failed to update station" });
    }
  });

  app.delete("/api/stations/:id", isAuthenticated, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.id, 'id');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      
      // Unregister from Protocol Manager first
      try {
        await protocolManager.unregisterStation(stationId);
      } catch (regError) {
        console.warn(`Failed to unregister station ${stationId} from Protocol Manager:`, regError);
      }
      
      const deleted = await storage.deleteStation(stationId);
      if (!deleted) {
        return res.status(404).json({ message: "Station not found" });
      }
      
      // Reinitialize sync service so it drops references to deleted station/configs
      try {
        await dropboxSyncService.reinitialize();
      } catch (syncErr) {
        console.warn(`Failed to reinitialize sync service after deleting station ${stationId}:`, syncErr);
      }
      
      // Log station deletion
      await auditLog.log(AUDIT_ACTIONS.STATION_DELETE, 'stations', {
        userId: getUserId(req),
        resourceId: stationId,
        ip: req.ip || req.socket.remoteAddress,
        status: 'success'
      });
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting station:", error);
      res.status(500).json({ message: "Failed to delete station" });
    }
  });

  // Station image upload endpoint
  app.post("/api/stations/:id/image", isAuthenticated, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.id, 'id');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      
      const { image } = req.body;
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ message: "Image data is required" });
      }
      
      // Validate that it's a valid base64 image
      const base64Regex = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/;
      if (!base64Regex.test(image)) {
        return res.status(400).json({ message: "Invalid image format. Must be base64 encoded image." });
      }
      
      // Check image size (max 5MB after base64 encoding)
      const base64Data = image.split(',')[1];
      const imageSizeBytes = (base64Data.length * 3) / 4;
      if (imageSizeBytes > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "Image too large. Maximum size is 5MB." });
      }
      
      const station = await storage.updateStation(stationId, { stationImage: image });
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      
      res.json({ success: true, message: "Station image updated" });
    } catch (error) {
      console.error("Error uploading station image:", error);
      res.status(500).json({ message: "Failed to upload station image" });
    }
  });

  // Delete station image endpoint
  app.delete("/api/stations/:id/image", isAuthenticated, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.id, 'id');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      
      const station = await storage.updateStation(stationId, { stationImage: null });
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      
      res.json({ success: true, message: "Station image removed" });
    } catch (error) {
      console.error("Error removing station image:", error);
      res.status(500).json({ message: "Failed to remove station image" });
    }
  });

  // User-Station routes
  app.get("/api/user/stations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const stations = await storage.getUserStations(userId);
      res.json(stations);
    } catch (error) {
      console.error("Error fetching user stations:", error);
      res.status(500).json({ message: "Failed to fetch user stations" });
    }
  });

  app.post("/api/user/stations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { stationId, isDefault } = req.body;
      const result = await storage.addUserStation({
        userId,
        stationId
      });
      res.status(201).json(result);
    } catch (error) {
      console.error("Error adding user station:", error);
      res.status(500).json({ message: "Failed to add station" });
    }
  });

  app.delete("/api/user/stations/:stationId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const deleted = await storage.removeUserStation(userId, stationId);
      if (!deleted) {
        return res.status(404).json({ message: "User station not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error removing user station:", error);
      res.status(500).json({ message: "Failed to remove station" });
    }
  });

  app.patch("/api/user/stations/:stationId/default", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const success = await storage.setDefaultStation(userId, stationId);
      if (!success) {
        return res.status(404).json({ message: "User station not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error setting default station:", error);
      res.status(500).json({ message: "Failed to set default station" });
    }
  });

  // Weather Data routes (demo mode bypasses auth)
  app.get("/api/stations/:stationId/data/latest", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const data = await storage.getLatestWeatherData(stationId);
      if (!data) {
        return res.status(404).json({ message: "No weather data found" });
      }
      res.json(data);
    } catch (error) {
      console.error("Error fetching latest weather data:", error);
      res.status(500).json({ message: "Failed to fetch weather data" });
    }
  });

  app.get("/api/stations/:stationId/data", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const { startTime, endTime, limit } = req.query;
      
      if (!startTime || !endTime) {
        return res.status(400).json({ message: "startTime and endTime are required" });
      }

      let data = await storage.getWeatherDataRange(
        stationId,
        new Date(startTime as string),
        new Date(endTime as string)
      );

      // Server-side downsampling: if >500 records, thin to ~500 evenly-spaced points
      // This prevents huge payloads while still providing sufficient chart resolution
      const maxPoints = limit ? parseInt(limit as string) : 500;
      if (data.length > maxPoints) {
        const step = data.length / maxPoints;
        const sampled: typeof data = [];
        for (let i = 0; i < data.length; i += step) {
          sampled.push(data[Math.floor(i)]);
        }
        // Always include the very last (most recent) record
        if (sampled[sampled.length - 1] !== data[data.length - 1]) {
          sampled.push(data[data.length - 1]);
        }
        data = sampled;
      }

      res.json(data);
    } catch (error) {
      console.error("Error fetching weather data:", error);
      res.status(500).json({ message: "Failed to fetch weather data" });
    }
  });

  app.post("/api/stations/:stationId/data", isAuthenticated, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const parsed = insertWeatherDataSchema.safeParse({
        ...req.body,
        stationId,
        timestamp: new Date(req.body.timestamp),
      });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid weather data", errors: parsed.error.errors });
      }
      
      const data = await storage.insertWeatherData({
        stationId,
        timestamp: parsed.data.timestamp,
        tableName: parsed.data.tableName || 'manual',
        data: parsed.data.data || {}
      });
      
      // Broadcast weather data update to all subscribed clients
      broadcastWeatherData(stationId, data);
      
      res.status(201).json(data);
    } catch (error) {
      console.error("Error inserting weather data:", error);
      res.status(500).json({ message: "Failed to insert weather data" });
    }
  });

  // ============================================================================
  // PUBLIC DATA INGEST ENDPOINT FOR DATALOGGERS
  // ============================================================================
  // This endpoint allows Campbell Scientific dataloggers and other devices to
  // POST weather data without authentication (uses station ID + optional API key)
  // 
  // POST /api/ingest/:stationId
  // Headers:
  //   Content-Type: application/json
  //   X-API-Key: optional API key for additional security
  // Body:
  //   { "data": { "temperature": 22.5, "humidity": 65, ... }, "timestamp": "ISO8601" }
  // Accepts both numeric station IDs and alphanumeric ingest IDs (e.g., "ST64ART3")
  // ============================================================================
  app.post("/api/ingest/:stationId", ingestRateLimiter, async (req, res) => {
    try {
      const paramId = req.params.stationId;
      let station: any = null;
      let stationId: number = 0;
      
      // Try numeric ID first, then alphanumeric ingest ID
      const numericId = parseInt(paramId, 10);
      if (!isNaN(numericId) && String(numericId) === paramId) {
        station = await storage.getStation(numericId);
        if (station) {
          stationId = numericId;
        }
      }
      
      // If not found by numeric ID, try ingest ID
      if (!station) {
        station = await storage.getStationByIngestId(paramId.toUpperCase());
        if (station) {
          stationId = station.id;
        }
      }
      
      if (!station) {
        return res.status(404).json({ 
          success: false,
          message: "Station not found",
          stationId: paramId 
        });
      }
      
      // Optional API key validation (if station has apiKey configured)
      const providedKey = req.headers['x-api-key'] as string;
      const stationConfig = station.connectionConfig as any;
      if (stationConfig?.apiKey && stationConfig.apiKey !== providedKey) {
        return res.status(401).json({ 
          success: false,
          message: "Invalid API key" 
        });
      }
      
      // Parse and validate data
      const { data, timestamp, source } = req.body;
      
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ 
          success: false,
          message: "Missing or invalid 'data' object" 
        });
      }
      
      // Insert weather data
      const weatherData = await storage.insertWeatherData({
        stationId,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        tableName: source || 'datalogger',
        data
      });
      
      // Broadcast to connected WebSocket clients
      broadcastWeatherData(stationId, weatherData);
      
      res.status(201).json({ 
        success: true,
        message: "Data received",
        id: weatherData.id,
        timestamp: weatherData.timestamp
      });
      
    } catch (error) {
      console.error("Error ingesting weather data:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to ingest weather data" 
      });
    }
  });

  // File import endpoint for Campbell Scientific data files
  app.post("/api/stations/:stationId/import", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const { content, filename } = req.body;
      
      if (!content) {
        return res.status(400).json({ message: "File content is required" });
      }

      const { parseDataFile, mapToWeatherData: _mapToWeatherData } = await import("./parsers/campbellScientific");
      const mapToWeatherData = _mapToWeatherData as (record: any, units?: string[], headers?: string[]) => Record<string, number | null>;
      const parsed = parseDataFile(content);

      if (parsed.errors.length > 0 && parsed.records.length === 0) {
        return res.status(400).json({ 
          message: "Failed to parse file", 
          errors: parsed.errors 
        });
      }

      // Import records into the database
      let importedCount = 0;
      const importErrors: string[] = [];

      for (const record of parsed.records) {
        try {
          const weatherData = mapToWeatherData(record, parsed.units, parsed.headers);
          
          // Only insert if we have some valid data
          if (Object.values(weatherData).some(v => v !== null)) {
            await storage.insertWeatherData({
              stationId,
              timestamp: record.timestamp,
              tableName: 'import',
              data: {
                temperature: weatherData.temperature ?? undefined,
                humidity: weatherData.humidity ?? undefined,
                pressure: weatherData.pressure ?? undefined,
                windSpeed: weatherData.windSpeed ?? undefined,
                windDirection: weatherData.windDirection ?? undefined,
                windGust: weatherData.windGust ?? undefined,
                solarRadiation: weatherData.solarRadiation ?? undefined,
                rainfall: weatherData.rainfall ?? undefined,
                dewPoint: weatherData.dewPoint ?? undefined,
                soilTemperature: weatherData.soilTemperature ?? undefined,
                soilMoisture: weatherData.soilMoisture ?? undefined,
                batteryVoltage: weatherData.batteryVoltage ?? undefined,
                panelTemperature: weatherData.panelTemperature ?? undefined,
              }
            });
            importedCount++;
          }
        } catch (err: any) {
          importErrors.push(`Record ${record.recordNumber}: ${err.message}`);
        }
      }

      res.json({
        message: "File imported successfully",
        format: parsed.format,
        stationName: parsed.stationName,
        tableName: parsed.tableName,
        totalRecords: parsed.records.length,
        importedRecords: importedCount,
        errors: [...parsed.errors, ...importErrors],
      });
    } catch (error: any) {
      console.error("Error importing data file:", error);
      res.status(500).json({ message: "Failed to import file", error: error.message });
    }
  });

  // User Preferences routes
  app.get("/api/user/preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const prefs = await storage.getUserPreferences(userId);
      res.json(prefs || {});
    } catch (error) {
      console.error("Error fetching user preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.put("/api/user/preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const parsed = insertUserPreferencesSchema.safeParse({
        ...req.body,
        userId,
      });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid preferences", errors: parsed.error.errors });
      }
      
      const prefs = await storage.upsertUserPreferences(parsed.data);
      res.json(prefs);
    } catch (error) {
      console.error("Error updating user preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  // NOTE: Station PATCH route is defined above with isAuthenticated middleware
  // Removed duplicate route here to avoid route conflict

  // Sensors routes
  app.get("/api/stations/:stationId/sensors", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const sensors = await storage.getSensors(stationId);
      res.json(sensors);
    } catch (error) {
      console.error("Error fetching sensors:", error);
      res.status(500).json({ message: "Failed to fetch sensors" });
    }
  });

  app.post("/api/stations/:stationId/sensors", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const sensor = await storage.createSensor({
        ...req.body,
        stationId,
      });
      res.status(201).json(sensor);
    } catch (error) {
      console.error("Error creating sensor:", error);
      res.status(500).json({ message: "Failed to create sensor" });
    }
  });

  // Station Logs routes
  app.get("/api/stations/:stationId/logs", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const logs = await storage.getStationLogs(stationId, isNaN(limit) ? 50 : limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching station logs:", error);
      res.status(500).json({ message: "Failed to fetch station logs" });
    }
  });

  app.post("/api/stations/:stationId/logs", optionalAuth, async (req, res) => {
    try {
      const { value: stationId, error } = parseIntSafe(req.params.stationId, 'stationId');
      if (error || stationId === null) {
        return res.status(400).json({ message: error });
      }
      const parsed = insertStationLogSchema.safeParse({
        ...req.body,
        stationId,
      });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid log entry", errors: parsed.error.errors });
      }
      
      const log = await storage.createStationLog({
        stationId,
        logType: parsed.data.logType || 'info',
        message: parsed.data.message || '',
        metadata: parsed.data.metadata
      });
      res.status(201).json(log);
    } catch (error) {
      console.error("Error creating station log:", error);
      res.status(500).json({ message: "Failed to create station log" });
    }
  });

  // Helper to check if user is admin of an organization
  async function isOrgAdmin(orgId: number, userId: string): Promise<boolean> {
    return await storage.isOrganizationAdmin(orgId, userId);
  }

  // Helper to check if user is member of an organization
  async function isOrgMember(orgId: number, userId: string): Promise<boolean> {
    return await storage.isOrganizationMember(orgId, userId);
  }

  // Organization routes
  app.get("/api/organizations", optionalAuth, async (req, res) => {
    try {
      if (DEMO_MODE) {
        const orgs = await storage.getOrganizations();
        return res.json(orgs);
      }
      const userId = getUserId(req);
      const orgs = await storage.getUserOrganizations(userId);
      res.json(orgs);
    } catch (error) {
      console.error("Error fetching organizations:", error);
      res.status(500).json({ message: "Failed to fetch organisations" });
    }
  });

  app.get("/api/organizations/:id", optionalAuth, async (req, res) => {
    try {
      const { value: orgId, error } = parseIntSafe(req.params.id, 'id');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      const org = await storage.getOrganization(orgId);
      if (!org) {
        return res.status(404).json({ message: "Organisation not found" });
      }
      
      // Check membership unless demo mode
      if (!DEMO_MODE) {
        const userId = getUserId(req);
        if (!(await isOrgMember(orgId, userId))) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      res.json(org);
    } catch (error) {
      console.error("Error fetching organization:", error);
      res.status(500).json({ message: "Failed to fetch organisation" });
    }
  });

  app.post("/api/organizations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name, description } = req.body;
      
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: "Organisation name is required" });
      }
      
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      
      const parsed = insertOrganizationSchema.safeParse({
        name: name.trim(),
        description: description?.trim() || null,
        ownerId: userId,
        slug,
      });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid organisation data", errors: parsed.error.errors });
      }
      
      const org = await storage.createOrganization(parsed.data);
      
      // Add owner as admin member
      await storage.addOrganizationMember({
        organizationId: org.id,
        userId,
        role: "admin",
        status: "active",
      });
      
      res.status(201).json(org);
    } catch (error) {
      console.error("Error creating organization:", error);
      res.status(500).json({ message: "Failed to create organisation" });
    }
  });

  app.patch("/api/organizations/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { value: orgId, error } = parseIntSafe(req.params.id, 'id');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      
      // Only admins can update organization
      if (!(await isOrgAdmin(orgId, userId))) {
        return res.status(403).json({ message: "Only organisation admins can update organisation" });
      }
      
      // Only allow updating specific fields
      const { name, description, logoUrl } = req.body;
      const updateData: { name?: string; description?: string | null; logoUrl?: string | null } = {};
      if (name) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description?.trim() || null;
      if (logoUrl !== undefined) updateData.logoUrl = logoUrl || null;
      
      const org = await storage.updateOrganization(orgId, updateData);
      if (!org) {
        return res.status(404).json({ message: "Organisation not found" });
      }
      res.json(org);
    } catch (error) {
      console.error("Error updating organization:", error);
      res.status(500).json({ message: "Failed to update organisation" });
    }
  });

  app.delete("/api/organizations/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { value: orgId, error } = parseIntSafe(req.params.id, 'id');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      
      // Only owner can delete organization
      const org = await storage.getOrganization(orgId);
      if (!org) {
        return res.status(404).json({ message: "Organisation not found" });
      }
      if (org.ownerId !== userId) {
        return res.status(403).json({ message: "Only the organisation owner can delete it" });
      }
      
      await storage.deleteOrganization(orgId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ message: "Failed to delete organisation" });
    }
  });

  // Organization Members routes
  app.get("/api/organizations/:orgId/members", optionalAuth, async (req, res) => {
    try {
      const { value: orgId, error } = parseIntSafe(req.params.orgId, 'orgId');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      
      // Check membership unless demo mode
      if (!DEMO_MODE) {
        const userId = getUserId(req);
        if (!(await isOrgMember(orgId, userId))) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const members = await storage.getOrganizationMembers(orgId);
      res.json(members);
    } catch (error) {
      console.error("Error fetching organization members:", error);
      res.status(500).json({ message: "Failed to fetch members" });
    }
  });

  app.post("/api/organizations/:orgId/members", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { value: orgId, error } = parseIntSafe(req.params.orgId, 'orgId');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      
      // Only admins can add members directly
      if (!(await isOrgAdmin(orgId, userId))) {
        return res.status(403).json({ message: "Only organisation admins can add members" });
      }
      
      const { userId: targetUserId, role } = req.body;
      if (!targetUserId || !['admin', 'member', 'viewer'].includes(role)) {
        return res.status(400).json({ message: "Invalid member data" });
      }
      
      const member = await storage.addOrganizationMember({
        organizationId: orgId,
        userId: targetUserId,
        role,
        status: "active",
        invitedBy: userId,
      });
      res.status(201).json(member);
    } catch (error) {
      console.error("Error adding organization member:", error);
      res.status(500).json({ message: "Failed to add member" });
    }
  });

  app.patch("/api/organizations/:orgId/members/:userId/role", isAuthenticated, async (req, res) => {
    try {
      const currentUserId = getUserId(req);
      const { value: orgId, error } = parseIntSafe(req.params.orgId, 'orgId');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      const targetUserId = req.params.userId;
      
      // Only admins can update roles
      if (!(await isOrgAdmin(orgId, currentUserId))) {
        return res.status(403).json({ message: "Only organisation admins can update roles" });
      }
      
      const { role } = req.body;
      if (!['admin', 'member', 'viewer'].includes(role)) {
        return res.status(400).json({ message: "Invalid role. Must be admin, member, or viewer" });
      }
      
      const member = await storage.updateMemberRole(orgId, targetUserId, role);
      if (!member) {
        return res.status(404).json({ message: "Member not found" });
      }
      res.json(member);
    } catch (error) {
      console.error("Error updating member role:", error);
      res.status(500).json({ message: "Failed to update member role" });
    }
  });

  app.delete("/api/organizations/:orgId/members/:userId", isAuthenticated, async (req, res) => {
    try {
      const currentUserId = getUserId(req);
      const { value: orgId, error } = parseIntSafe(req.params.orgId, 'orgId');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      const targetUserId = req.params.userId;
      
      // Only admins can remove members (or user can remove themselves)
      if (targetUserId !== currentUserId && !(await isOrgAdmin(orgId, currentUserId))) {
        return res.status(403).json({ message: "Only organisation admins can remove members" });
      }
      
      // Prevent owner from being removed
      const org = await storage.getOrganization(orgId);
      if (org && org.ownerId === targetUserId) {
        return res.status(400).json({ message: "Cannot remove the organisation owner" });
      }
      
      const removed = await storage.removeOrganizationMember(orgId, targetUserId);
      if (!removed) {
        return res.status(404).json({ message: "Member not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error removing organization member:", error);
      res.status(500).json({ message: "Failed to remove member" });
    }
  });

  // Organization Invitations routes
  app.get("/api/organizations/:orgId/invitations", optionalAuth, async (req, res) => {
    try {
      const { value: orgId, error } = parseIntSafe(req.params.orgId, 'orgId');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      
      // Check membership unless demo mode
      if (!DEMO_MODE) {
        const userId = getUserId(req);
        if (!(await isOrgMember(orgId, userId))) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      
      const invitations = await storage.getOrganizationInvitations(orgId);
      res.json(invitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  });

  app.post("/api/organizations/:orgId/invitations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { value: orgId, error } = parseIntSafe(req.params.orgId, 'orgId');
      if (error || orgId === null) {
        return res.status(400).json({ message: error });
      }
      
      // Only admins can create invitations
      if (!(await isOrgAdmin(orgId, userId))) {
        return res.status(403).json({ message: "Only organisation admins can send invitations" });
      }
      
      const { email, role } = req.body;
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ message: "Valid email address is required" });
      }
      
      const validRole = ['admin', 'member', 'viewer'].includes(role) ? role : 'member';
      
      const token = nanoid(32);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      const invitation = await storage.createInvitation({
        organizationId: orgId,
        email: email.toLowerCase().trim(),
        role: validRole,
        token,
        invitedBy: userId,
        expiresAt,
      });
      
      res.status(201).json(invitation);
    } catch (error) {
      console.error("Error creating invitation:", error);
      res.status(500).json({ message: "Failed to create invitation" });
    }
  });

  app.get("/api/invitations/:token", async (req, res) => {
    try {
      const invitation = await storage.getInvitationByToken(req.params.token);
      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }
      if (invitation.acceptedAt) {
        return res.status(400).json({ message: "Invitation already accepted" });
      }
      if (new Date() > invitation.expiresAt) {
        return res.status(400).json({ message: "Invitation expired" });
      }
      
      const org = await storage.getOrganization(invitation.organizationId);
      res.json({ invitation, organization: org });
    } catch (error) {
      console.error("Error fetching invitation:", error);
      res.status(500).json({ message: "Failed to fetch invitation" });
    }
  });

  app.post("/api/invitations/:token/accept", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const accepted = await storage.acceptInvitation(req.params.token, userId);
      if (!accepted) {
        return res.status(400).json({ message: "Failed to accept invitation" });
      }
      res.json({ message: "Invitation accepted successfully" });
    } catch (error) {
      console.error("Error accepting invitation:", error);
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  });

  // Alarms now use persistent database storage (Issue #10 fix)
  // The storage layer wraps db.ts alarm functions

  // Alarms routes
  app.get("/api/alarms", optionalAuth, async (req, res) => {
    try {
      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      
      let userAlarms;
      if (stationId && !isNaN(stationId)) {
        userAlarms = await storage.getAlarms(stationId);
      } else {
        userAlarms = await storage.getAllAlarms();
      }
      res.json(userAlarms.map(mapAlarmToClient));
    } catch (error) {
      console.error("Error fetching alarms:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to fetch alarms", details: errorMessage });
    }
  });

  app.post("/api/alarms", optionalAuth, async (req, res) => {
    try {
      // Validate alarm data using Zod schema
      const parsed = insertAlarmSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ 
          message: "Invalid alarm data", 
          errors: parsed.error.errors 
        });
      }
      
      const { stationId, name, parameter, condition, threshold, staleMinutes, unit, enabled, notifyEmail, notifyPush } = parsed.data;
      
      // Get the current user's email for notifications
      let emailRecipients: string | null = null;
      if (notifyEmail && (req as any).user) {
        emailRecipients = (req as any).user.email || null;
      }
      
      const alarm = await storage.createAlarm({
        stationId,
        name: name || parameter,
        parameter,
        condition,
        threshold,
        staleMinutes: condition === 'stale' ? (staleMinutes || 120) : undefined,
        unit: unit || '',
        severity: 'warning',
        isEnabled: enabled !== false,
        emailNotifications: notifyEmail !== false,
        emailRecipients,
      });
      
      res.status(201).json(mapAlarmToClient(alarm));
    } catch (error) {
      console.error("Error creating alarm:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to create alarm", details: errorMessage });
    }
  });

  app.patch("/api/alarms/:id", optionalAuth, async (req, res) => {
    try {
      const { value: alarmId, error } = parseIntSafe(req.params.id, 'id');
      if (error || alarmId === null) {
        return res.status(400).json({ message: error });
      }
      
      const existingAlarm = await storage.getAlarm(alarmId);
      if (!existingAlarm) {
        return res.status(404).json({ message: `Alarm with id ${alarmId} not found` });
      }
      
      const updated = await storage.updateAlarm(alarmId, req.body);
      res.json(updated ? mapAlarmToClient(updated) : null);
    } catch (error) {
      console.error("Error updating alarm:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to update alarm", details: errorMessage });
    }
  });

  app.delete("/api/alarms/:id", optionalAuth, async (req, res) => {
    try {
      const { value: alarmId, error } = parseIntSafe(req.params.id, 'id');
      if (error || alarmId === null) {
        return res.status(400).json({ message: error });
      }
      
      const existingAlarm = await storage.getAlarm(alarmId);
      if (!existingAlarm) {
        return res.status(404).json({ message: `Alarm with id ${alarmId} not found` });
      }
      
      await storage.deleteAlarm(alarmId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting alarm:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to delete alarm", details: errorMessage });
    }
  });

  // Alarm events routes
  app.get("/api/alarm-events", optionalAuth, async (req, res) => {
    try {
      const stationId = req.query.stationId ? parseInt(req.query.stationId as string, 10) : undefined;
      const alarmId = req.query.alarmId ? parseInt(req.query.alarmId as string, 10) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      
      const events = await storage.getAlarmEvents(alarmId, stationId, limit);
      res.json(events);
    } catch (error) {
      console.error("Error fetching alarm events:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to fetch alarm events", details: errorMessage });
    }
  });

  app.post("/api/alarm-events/:id/acknowledge", optionalAuth, async (req, res) => {
    try {
      const { value: eventId, error } = parseIntSafe(req.params.id, 'id');
      if (error || eventId === null) {
        return res.status(400).json({ message: error });
      }
      
      const userId = DEMO_MODE ? "demo" : getUserId(req);
      const result = await storage.acknowledgeAlarmEvent(eventId, userId, req.body.notes);
      res.json(result);
    } catch (error) {
      console.error("Error acknowledging alarm event:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to acknowledge alarm event", details: errorMessage });
    }
  });

  // Delete a single alarm event
  app.delete("/api/alarm-events/:id", optionalAuth, async (req, res) => {
    try {
      const { value: eventId, error } = parseIntSafe(req.params.id, 'id');
      if (error || eventId === null) {
        return res.status(400).json({ message: error });
      }
      await storage.deleteAlarmEvent(eventId);
      res.json({ success: true, message: "Alarm event deleted" });
    } catch (error) {
      console.error("Error deleting alarm event:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to delete alarm event", details: errorMessage });
    }
  });

  // Cleanup alarm events older than 30 days
  app.post("/api/alarm-events/cleanup", optionalAuth, async (req, res) => {
    try {
      const days = req.body.days || 30;
      const count = await storage.cleanupOldAlarmEvents(days);
      res.json({ success: true, deleted: count, message: `Cleaned up ${count} events older than ${days} days` });
    } catch (error) {
      console.error("Error cleaning up alarm events:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to cleanup alarm events", details: errorMessage });
    }
  });

  // Documentation download routes
  const docsDir = path.join(__dirname, '..', 'docs');
  
  app.get("/api/docs", async (req, res) => {
    try {
      const docs = [
        { 
          id: 'user-guide', 
          name: 'Stratus Weather Server - Complete User Guide', 
          filename: 'Stratus-Complete-User-Guide.pdf',
          description: 'Complete guide covering features, capabilities, station setup, and configuration'
        }
      ];
      
      // Check which PDFs exist
      const availableDocs = docs.map(doc => {
        const filePath = path.join(docsDir, doc.filename);
        const exists = fs.existsSync(filePath);
        let size = 0;
        if (exists) {
          const stats = fs.statSync(filePath);
          size = stats.size;
        }
        return { ...doc, available: exists, size };
      });
      
      res.json(availableDocs);
    } catch (error) {
      console.error("Error listing documentation:", error);
      res.status(500).json({ message: "Failed to list documentation" });
    }
  });

  app.get("/api/docs/:docId/download", async (req, res) => {
    try {
      const { docId } = req.params;
      
      const docMap: Record<string, string> = {
        'user-guide': 'Stratus-Complete-User-Guide.pdf'
      };
      
      const filename = docMap[docId];
      if (!filename) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const filePath = path.join(docsDir, filename);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ 
          message: "PDF not generated yet. Run 'npm run docs:pdf' to generate documentation." 
        });
      }
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading documentation:", error);
      res.status(500).json({ message: "Failed to download documentation" });
    }
  });

  // ============================================
  // Audit Log API Routes (Admin Only)
  // ============================================
  
  /**
   * GET /api/audit-logs
   * Retrieve audit logs for admin review
   */
  app.get("/api/audit-logs", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { action, userId, resource, startDate, endDate, status, limit } = req.query;
      
      const logs = await auditLog.searchLogs({
        action: action as AuditAction | undefined,
        userId: userId as string | undefined,
        resource: resource as string | undefined,
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
        status: status as 'success' | 'failure' | undefined,
      }, limit ? parseInt(limit as string, 10) : 500);
      
      res.json(logs);
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ message: "Failed to fetch audit logs" });
    }
  });

  /**
   * GET /api/audit-logs/recent
   * Get recent audit logs from memory (faster for dashboards)
   */
  app.get("/api/audit-logs/recent", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const logs = auditLog.getRecentLogs(limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching recent audit logs:", error);
      res.status(500).json({ message: "Failed to fetch recent audit logs" });
    }
  });

  /**
   * GET /api/audit-logs/user/:userId
   * Get audit logs for a specific user
   */
  app.get("/api/audit-logs/user/:userId", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
      
      const logs = await auditLog.getLogsForUser(userId, days);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching user audit logs:", error);
      res.status(500).json({ message: "Failed to fetch user audit logs" });
    }
  });

  // ============================================
  // Public Embed/Widget API (CORS enabled, read-only)
  // These endpoints provide READ-ONLY access to weather data
  // They do NOT expose any admin functions, user accounts, or configuration
  // ============================================

  // Rate limiter for embed API to prevent abuse
  const embedRateLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 120, // 120 requests per minute per IP
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Middleware to set CORS headers and validate embed access
  const embedCorsMiddleware: RequestHandler = (req, res, next) => {
    // Allow all origins for widget embedding
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Embed-Key');
    
    // Block access to sensitive headers that could expose internal info
    res.removeHeader('X-Powered-By');
    
    next();
  };

  /**
   * GET /api/embed/stations
   * Public endpoint to get list of stations for embedding
   * Returns ONLY public station info (no config, credentials, or admin data)
   */
  app.get("/api/embed/stations", embedRateLimiter, embedCorsMiddleware, async (req, res) => {
    
    try {
      const stations = await storage.getStations();
      // Return minimal public data
      const publicStations = stations.map((s: any) => ({
        id: s.id,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        altitude: s.altitude,
        status: s.isActive ? 'online' : 'offline'
      }));
      res.json(publicStations);
    } catch (error) {
      console.error("Error fetching embed stations:", error);
      res.status(500).json({ message: "Failed to fetch stations" });
    }
  });

  /**
   * GET /api/embed/station/:id
   * Public endpoint to get station details and latest data for embedding
   * Returns ONLY weather data - no configuration, credentials, or admin info
   */
  app.get("/api/embed/station/:id", embedRateLimiter, embedCorsMiddleware, async (req, res) => {
    
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) {
        return res.status(400).json({ message: "Invalid station ID" });
      }
      
      const station = await storage.getStation(stationId);
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      
      // Get latest weather data (last 24 hours)
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weatherData = await storage.getWeatherDataRange(stationId, yesterday, now);
      
      // Get latest record
      const latest = weatherData.length > 0 ? weatherData[weatherData.length - 1] : null;
      
      res.json({
        station: {
          id: station.id,
          name: station.name,
          latitude: station.latitude,
          longitude: station.longitude,
          altitude: station.altitude,
          status: station.isActive ? 'online' : 'offline'
        },
        latest: latest ? {
          timestamp: latest.timestamp,
          temperature: latest.temperature,
          humidity: latest.humidity,
          pressure: latest.pressure,
          windSpeed: latest.windSpeed,
          windDirection: latest.windDirection,
          rainfall: latest.rainfall,
          solarRadiation: latest.solarRadiation,
          batteryVoltage: latest.batteryVoltage
        } : null,
        recordCount: weatherData.length
      });
    } catch (error) {
      console.error("Error fetching embed station:", error);
      res.status(500).json({ message: "Failed to fetch station data" });
    }
  });

  /**
   * GET /api/embed/station/:id/data
   * Public endpoint to get weather data for a station (for charts)
   * Returns ONLY historical weather readings - no admin data
   */
  app.get("/api/embed/station/:id/data", embedRateLimiter, embedCorsMiddleware, async (req, res) => {
    
    try {
      const stationId = parseInt(req.params.id, 10);
      if (isNaN(stationId)) {
        return res.status(400).json({ message: "Invalid station ID" });
      }
      
      const hours = parseInt(req.query.hours as string, 10) || 24;
      
      const station = await storage.getStation(stationId);
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      
      const now = new Date();
      const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
      const weatherData = await storage.getWeatherDataRange(stationId, start, now);
      
      // Return minimal data for charts
      const chartData = weatherData.map((d: any) => ({
        t: d.timestamp,
        temp: d.temperature,
        hum: d.humidity,
        pres: d.pressure,
        wind: d.windSpeed,
        windDir: d.windDirection,
        rain: d.rainfall,
        solar: d.solarRadiation,
        batt: d.batteryVoltage
      }));
      
      res.json({
        stationId,
        stationName: station.name,
        data: chartData
      });
    } catch (error) {
      console.error("Error fetching embed data:", error);
      res.status(500).json({ message: "Failed to fetch weather data" });
    }
  });

  /**
   * GET /api/embed/widget.js
   * Serve the embeddable widget JavaScript
   * This widget can ONLY display weather data - it cannot access admin functions
   */
  app.get("/api/embed/widget.js", embedRateLimiter, (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    
    const widgetScript = `
/**
 * Stratus Weather Widget
 * Embed weather station data on any website
 * Usage: <div id="stratus-widget" data-station="1" data-server="https://your-stratus-server.com"></div>
 *        <script src="https://your-stratus-server.com/api/embed/widget.js"></script>
 */
(function() {
  'use strict';
  
  const StratusWidget = {
    version: '1.1.0',
    
    styles: \`
      .stratus-widget {
        font-family: Arial, Helvetica, sans-serif;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px;
        max-width: 400px;
        color: #000000;
      }
      .stratus-widget-dark {
        background: #1f2937;
        border-color: #374151;
        color: #ffffff;
      }
      .stratus-widget-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #e5e7eb;
      }
      .stratus-widget-dark .stratus-widget-header {
        border-bottom-color: #374151;
      }
      .stratus-widget-title {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
      }
      .stratus-widget-status {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 9999px;
        background: #dcfce7;
        color: #166534;
      }
      .stratus-widget-status.offline {
        background: #fee2e2;
        color: #991b1b;
      }
      .stratus-widget-dark .stratus-widget-status {
        background: #166534;
        color: #dcfce7;
      }
      .stratus-widget-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }
      .stratus-widget-item {
        padding: 8px;
        background: #f9fafb;
        border-radius: 6px;
      }
      .stratus-widget-dark .stratus-widget-item {
        background: #374151;
      }
      .stratus-widget-label {
        font-size: 11px;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 4px;
      }
      .stratus-widget-dark .stratus-widget-label {
        color: #9ca3af;
      }
      .stratus-widget-value {
        font-size: 20px;
        font-weight: 600;
      }
      .stratus-widget-unit {
        font-size: 12px;
        font-weight: 400;
        color: #6b7280;
      }
      .stratus-widget-dark .stratus-widget-unit {
        color: #9ca3af;
      }
      .stratus-widget-footer {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid #e5e7eb;
        font-size: 11px;
        color: #6b7280;
        display: flex;
        justify-content: space-between;
      }
      .stratus-widget-dark .stratus-widget-footer {
        border-top-color: #374151;
        color: #9ca3af;
      }
      .stratus-widget-error {
        padding: 16px;
        text-align: center;
        color: #991b1b;
      }
      .stratus-widget-loading {
        padding: 32px;
        text-align: center;
        color: #6b7280;
      }
    \`,
    
    formatValue: function(value, decimals) {
      if (value === null || value === undefined) return '--';
      return Number(value).toFixed(decimals || 1);
    },
    
    formatTimestamp: function(ts) {
      if (!ts) return '--';
      const date = new Date(ts);
      return date.toLocaleString();
    },
    
    getWindDirection: function(deg) {
      if (deg === null || deg === undefined) return '--';
      const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      return dirs[Math.round(deg / 22.5) % 16];
    },
    
    render: function(container, data, options) {
      const dark = options.theme === 'dark';
      const latest = data.latest || {};
      
      container.innerHTML = \`
        <div class="stratus-widget \${dark ? 'stratus-widget-dark' : ''}">
          <div class="stratus-widget-header">
            <h3 class="stratus-widget-title">\${data.station?.name || 'Weather Station'}</h3>
            <span class="stratus-widget-status \${data.station?.status !== 'online' ? 'offline' : ''}">\${data.station?.status || 'Unknown'}</span>
          </div>
          <div class="stratus-widget-grid">
            <div class="stratus-widget-item">
              <div class="stratus-widget-label">Temperature</div>
              <div class="stratus-widget-value">\${this.formatValue(latest.temperature)}<span class="stratus-widget-unit">°C</span></div>
            </div>
            <div class="stratus-widget-item">
              <div class="stratus-widget-label">Humidity</div>
              <div class="stratus-widget-value">\${this.formatValue(latest.humidity, 0)}<span class="stratus-widget-unit">%</span></div>
            </div>
            <div class="stratus-widget-item">
              <div class="stratus-widget-label">Pressure</div>
              <div class="stratus-widget-value">\${this.formatValue(latest.pressure, 0)}<span class="stratus-widget-unit">hPa</span></div>
            </div>
            <div class="stratus-widget-item">
              <div class="stratus-widget-label">Wind</div>
              <div class="stratus-widget-value">\${this.formatValue(latest.windSpeed)}<span class="stratus-widget-unit">m/s \${this.getWindDirection(latest.windDirection)}</span></div>
            </div>
            \${options.showRain !== false ? \`
            <div class="stratus-widget-item">
              <div class="stratus-widget-label">Rainfall</div>
              <div class="stratus-widget-value">\${this.formatValue(latest.rainfall)}<span class="stratus-widget-unit">mm</span></div>
            </div>
            \` : ''}
            \${options.showSolar !== false && latest.solarRadiation !== undefined ? \`
            <div class="stratus-widget-item">
              <div class="stratus-widget-label">Solar</div>
              <div class="stratus-widget-value">\${this.formatValue(latest.solarRadiation, 0)}<span class="stratus-widget-unit">W/m²</span></div>
            </div>
            \` : ''}
          </div>
          <div class="stratus-widget-footer">
            <span>Updated: \${this.formatTimestamp(latest.timestamp)}</span>
            <span>Powered by Stratus</span>
          </div>
        </div>
      \`;
    },
    
    renderError: function(container, message) {
      container.innerHTML = \`
        <div class="stratus-widget">
          <div class="stratus-widget-error">\${message}</div>
        </div>
      \`;
    },
    
    renderLoading: function(container) {
      container.innerHTML = \`
        <div class="stratus-widget">
          <div class="stratus-widget-loading">Loading weather data...</div>
        </div>
      \`;
    },
    
    init: function(container, options) {
      const self = this;
      options = options || {};
      
      // Inject styles if not already done
      if (!document.getElementById('stratus-widget-styles')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'stratus-widget-styles';
        styleEl.textContent = this.styles;
        document.head.appendChild(styleEl);
      }
      
      this.renderLoading(container);
      
      const server = options.server || container.dataset.server || window.location.origin;
      const stationId = options.station || container.dataset.station;
      
      if (!stationId) {
        this.renderError(container, 'No station ID specified');
        return;
      }
      
      fetch(server + '/api/embed/station/' + stationId)
        .then(function(res) {
          if (!res.ok) throw new Error('Failed to fetch data');
          return res.json();
        })
        .then(function(data) {
          self.render(container, data, options);
          
          // Auto-refresh every 5 minutes
          if (options.autoRefresh !== false) {
            setInterval(function() {
              fetch(server + '/api/embed/station/' + stationId)
                .then(function(res) { return res.json(); })
                .then(function(data) { self.render(container, data, options); })
                .catch(function() {});
            }, (options.refreshInterval || 300) * 1000);
          }
        })
        .catch(function(err) {
          self.renderError(container, 'Unable to load weather data');
        });
    }
  };
  
  // Auto-initialize widgets on page load
  function initWidgets() {
    var widgets = document.querySelectorAll('[data-stratus-widget], #stratus-widget, .stratus-widget-container');
    widgets.forEach(function(el) {
      StratusWidget.init(el, {
        theme: el.dataset.theme,
        showRain: el.dataset.showRain !== 'false',
        showSolar: el.dataset.showSolar !== 'false'
      });
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidgets);
  } else {
    initWidgets();
  }
  
  // Expose globally for manual initialization
  window.StratusWidget = StratusWidget;
})();
`;
    
    res.send(widgetScript);
  });

  // Handle OPTIONS for CORS preflight on embed endpoints
  app.options("/api/embed/*", embedCorsMiddleware, (req, res) => {
    res.status(204).send();
  });

  return httpServer;
}
