import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage, type WeatherData } from "./localStorage";
import { setupAuth, isAuthenticated, getUserId } from "./localAuth";
import { z } from "zod";

// Local schema definitions for validation
const insertWeatherStationSchema = z.object({
  name: z.string(),
  pakbusAddress: z.number(),
  connectionType: z.string(),
  connectionConfig: z.any(),
  securityCode: z.number().optional()
});

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
  theme: z.string().optional()
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
import { nanoid } from "nanoid";
import { registerCampbellRoutes } from "./campbell/routes";
import { dataCollectionService } from "./campbell/dataCollectionService";
import { protocolManager } from "./protocols/protocolManager";
import { registerStationSetupRoutes } from "./station-setup/routes";
import { registerSerialMonitorRoutes } from "./serial/routes";
import shareRoutes from "./shares/routes";

const DEMO_MODE = process.env.VITE_DEMO_MODE === 'true';

const optionalAuth: RequestHandler = (req, res, next) => {
  if (DEMO_MODE) {
    return next();
  }
  return isAuthenticated(req, res, next);
};

// Store connected WebSocket clients by station ID
const stationClients = new Map<number, Set<WebSocket>>();

function broadcastWeatherData(stationId: number, data: WeatherData) {
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

  // Register serial monitor routes
  registerSerialMonitorRoutes(app, httpServer);

  // Register share routes
  app.use('/api', shareRoutes);

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
      const stationId = parseInt(req.params.stationId);
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
      const stationId = parseInt(req.params.stationId);
      const result = await protocolManager.testConnection(stationId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/protocols/reconnect/:stationId", optionalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
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
        'mqtt': 'mqtt',
        'http': 'http',
        'ip': 'http',
        'wifi': 'http',
        'lora': 'lora',
        'serial': 'modbus',
        'satellite': 'satellite',
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

  // Demo station initialization endpoint (no auth required for easy setup)
  app.post("/api/demo/initialize", async (req, res) => {
    try {
      const { initializeDemoStation } = await import("./demo/generateDemoData");
      const station = await initializeDemoStation();
      res.json({ 
        message: "Demo station created successfully", 
        station 
      });
    } catch (error: any) {
      console.error("Error initializing demo station:", error);
      res.status(500).json({ 
        message: "Failed to initialize demo station", 
        error: error.message 
      });
    }
  });

  // Setup WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    let subscribedStations: number[] = [];

    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        
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
      const station = await storage.getStation(parseInt(req.params.id));
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
          
          const protocolMap: Record<string, string> = {
            'mqtt': 'mqtt', 'http': 'http', 'ip': 'http', 'wifi': 'http',
            'lora': 'lora', 'serial': 'modbus', 'satellite': 'satellite',
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
      
      res.status(201).json(station);
    } catch (error) {
      console.error("Error creating station:", error);
      res.status(500).json({ message: "Failed to create station" });
    }
  });

  app.patch("/api/stations/:id", isAuthenticated, async (req, res) => {
    try {
      const station = await storage.updateStation(parseInt(req.params.id), req.body);
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
            
            const protocolMap: Record<string, string> = {
              'mqtt': 'mqtt', 'http': 'http', 'ip': 'http', 'wifi': 'http',
              'lora': 'lora', 'serial': 'modbus', 'satellite': 'satellite',
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
      const stationId = parseInt(req.params.id);
      
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
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting station:", error);
      res.status(500).json({ message: "Failed to delete station" });
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
      const stationId = parseInt(req.params.stationId);
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
      const stationId = parseInt(req.params.stationId);
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
      const stationId = parseInt(req.params.stationId);
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
      const stationId = parseInt(req.params.stationId);
      const { startTime, endTime } = req.query;
      
      if (!startTime || !endTime) {
        return res.status(400).json({ message: "startTime and endTime are required" });
      }

      const data = await storage.getWeatherDataRange(
        stationId,
        new Date(startTime as string),
        new Date(endTime as string)
      );
      res.json(data);
    } catch (error) {
      console.error("Error fetching weather data:", error);
      res.status(500).json({ message: "Failed to fetch weather data" });
    }
  });

  app.post("/api/stations/:stationId/data", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
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
  // ============================================================================
  app.post("/api/ingest/:stationId", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      
      // Verify station exists
      const station = await storage.getStation(stationId);
      if (!station) {
        return res.status(404).json({ 
          success: false,
          message: "Station not found",
          stationId 
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
      const stationId = parseInt(req.params.stationId);
      const { content, filename } = req.body;
      
      if (!content) {
        return res.status(400).json({ message: "File content is required" });
      }

      const { parseDataFile, mapToWeatherData } = await import("./parsers/campbellScientific");
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
          const weatherData = mapToWeatherData(record);
          
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

  // Update station (for personnel, etc.)
  app.patch("/api/stations/:id", optionalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.id);
      const station = await storage.getStation(stationId);
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      const updated = await storage.updateStation(stationId, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating station:", error);
      res.status(500).json({ message: "Failed to update station" });
    }
  });

  // Sensors routes
  app.get("/api/stations/:stationId/sensors", optionalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const sensors = await storage.getSensors(stationId);
      res.json(sensors);
    } catch (error) {
      console.error("Error fetching sensors:", error);
      res.status(500).json({ message: "Failed to fetch sensors" });
    }
  });

  app.post("/api/stations/:stationId/sensors", optionalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
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
      const stationId = parseInt(req.params.stationId);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const logs = await storage.getStationLogs(stationId, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching station logs:", error);
      res.status(500).json({ message: "Failed to fetch station logs" });
    }
  });

  app.post("/api/stations/:stationId/logs", optionalAuth, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
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
      res.status(500).json({ message: "Failed to fetch organizations" });
    }
  });

  app.get("/api/organizations/:id", optionalAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.params.id);
      const org = await storage.getOrganization(orgId);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
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
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  app.post("/api/organizations", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name, description } = req.body;
      
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: "Organization name is required" });
      }
      
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      
      const parsed = insertOrganizationSchema.safeParse({
        name: name.trim(),
        description: description?.trim() || null,
        ownerId: userId,
        slug,
      });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid organization data", errors: parsed.error.errors });
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
      res.status(500).json({ message: "Failed to create organization" });
    }
  });

  app.patch("/api/organizations/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const orgId = parseInt(req.params.id);
      
      // Only admins can update organization
      if (!(await isOrgAdmin(orgId, userId))) {
        return res.status(403).json({ message: "Only organization admins can update organization" });
      }
      
      // Only allow updating specific fields
      const { name, description } = req.body;
      const updateData: { name?: string; description?: string } = {};
      if (name) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description?.trim() || null;
      
      const org = await storage.updateOrganization(orgId, updateData);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      res.json(org);
    } catch (error) {
      console.error("Error updating organization:", error);
      res.status(500).json({ message: "Failed to update organization" });
    }
  });

  app.delete("/api/organizations/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const orgId = parseInt(req.params.id);
      
      // Only owner can delete organization
      const org = await storage.getOrganization(orgId);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      if (org.ownerId !== userId) {
        return res.status(403).json({ message: "Only the organization owner can delete it" });
      }
      
      await storage.deleteOrganization(orgId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ message: "Failed to delete organization" });
    }
  });

  // Organization Members routes
  app.get("/api/organizations/:orgId/members", optionalAuth, async (req, res) => {
    try {
      const orgId = parseInt(req.params.orgId);
      
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
      const orgId = parseInt(req.params.orgId);
      
      // Only admins can add members directly
      if (!(await isOrgAdmin(orgId, userId))) {
        return res.status(403).json({ message: "Only organization admins can add members" });
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
      const orgId = parseInt(req.params.orgId);
      const targetUserId = req.params.userId;
      
      // Only admins can update roles
      if (!(await isOrgAdmin(orgId, currentUserId))) {
        return res.status(403).json({ message: "Only organization admins can update roles" });
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
      const orgId = parseInt(req.params.orgId);
      const targetUserId = req.params.userId;
      
      // Only admins can remove members (or user can remove themselves)
      if (targetUserId !== currentUserId && !(await isOrgAdmin(orgId, currentUserId))) {
        return res.status(403).json({ message: "Only organization admins can remove members" });
      }
      
      // Prevent owner from being removed
      const org = await storage.getOrganization(orgId);
      if (org && org.ownerId === targetUserId) {
        return res.status(400).json({ message: "Cannot remove the organization owner" });
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
      const orgId = parseInt(req.params.orgId);
      
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
      const orgId = parseInt(req.params.orgId);
      
      // Only admins can create invitations
      if (!(await isOrgAdmin(orgId, userId))) {
        return res.status(403).json({ message: "Only organization admins can send invitations" });
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

  // In-memory alarms storage (for demo - would use database in production)
  const alarms: Map<number, any> = new Map();
  let alarmIdCounter = 1;

  // Alarms routes
  app.get("/api/alarms", optionalAuth, async (req, res) => {
    try {
      const userId = DEMO_MODE ? "demo" : getUserId(req);
      const userAlarms = Array.from(alarms.values()).filter(
        (a) => a.userId === userId
      );
      res.json(userAlarms);
    } catch (error) {
      console.error("Error fetching alarms:", error);
      res.status(500).json({ message: "Failed to fetch alarms" });
    }
  });

  app.post("/api/alarms", optionalAuth, async (req, res) => {
    try {
      const userId = DEMO_MODE ? "demo" : getUserId(req);
      const { stationId, name, parameter, condition, threshold, unit, enabled, notifyEmail, notifyPush } = req.body;
      
      const alarm = {
        id: alarmIdCounter++,
        userId,
        stationId,
        name,
        parameter,
        condition,
        threshold,
        unit,
        enabled: enabled !== false,
        notifyEmail: notifyEmail !== false,
        notifyPush: notifyPush === true,
        lastTriggered: null,
        triggerCount: 0,
        createdAt: new Date().toISOString(),
      };
      
      alarms.set(alarm.id, alarm);
      res.status(201).json(alarm);
    } catch (error) {
      console.error("Error creating alarm:", error);
      res.status(500).json({ message: "Failed to create alarm" });
    }
  });

  app.patch("/api/alarms/:id", optionalAuth, async (req, res) => {
    try {
      const alarmId = parseInt(req.params.id);
      const alarm = alarms.get(alarmId);
      
      if (!alarm) {
        return res.status(404).json({ message: "Alarm not found" });
      }
      
      const updated = { ...alarm, ...req.body };
      alarms.set(alarmId, updated);
      res.json(updated);
    } catch (error) {
      console.error("Error updating alarm:", error);
      res.status(500).json({ message: "Failed to update alarm" });
    }
  });

  app.delete("/api/alarms/:id", optionalAuth, async (req, res) => {
    try {
      const alarmId = parseInt(req.params.id);
      if (!alarms.has(alarmId)) {
        return res.status(404).json({ message: "Alarm not found" });
      }
      alarms.delete(alarmId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting alarm:", error);
      res.status(500).json({ message: "Failed to delete alarm" });
    }
  });

  return httpServer;
}
