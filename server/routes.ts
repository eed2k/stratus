import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertWeatherStationSchema, insertWeatherDataSchema, insertUserPreferencesSchema, type WeatherData } from "@shared/schema";

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
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Weather Stations routes
  app.get("/api/stations", isAuthenticated, async (req, res) => {
    try {
      const stations = await storage.getStations();
      res.json(stations);
    } catch (error) {
      console.error("Error fetching stations:", error);
      res.status(500).json({ message: "Failed to fetch stations" });
    }
  });

  app.get("/api/stations/:id", isAuthenticated, async (req, res) => {
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
      const station = await storage.createStation(parsed.data);
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
      res.json(station);
    } catch (error) {
      console.error("Error updating station:", error);
      res.status(500).json({ message: "Failed to update station" });
    }
  });

  app.delete("/api/stations/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteStation(parseInt(req.params.id));
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
  app.get("/api/user/stations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const stations = await storage.getUserStations(userId);
      res.json(stations);
    } catch (error) {
      console.error("Error fetching user stations:", error);
      res.status(500).json({ message: "Failed to fetch user stations" });
    }
  });

  app.post("/api/user/stations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { stationId, isDefault } = req.body;
      const result = await storage.addUserStation({
        userId,
        stationId,
        isDefault: isDefault || false,
      });
      res.status(201).json(result);
    } catch (error) {
      console.error("Error adding user station:", error);
      res.status(500).json({ message: "Failed to add station" });
    }
  });

  app.delete("/api/user/stations/:stationId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.patch("/api/user/stations/:stationId/default", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  // Weather Data routes
  app.get("/api/stations/:stationId/data/latest", isAuthenticated, async (req, res) => {
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

  app.get("/api/stations/:stationId/data", isAuthenticated, async (req, res) => {
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
      
      const data = await storage.insertWeatherData(parsed.data);
      
      // Broadcast weather data update to all subscribed clients
      broadcastWeatherData(stationId, data);
      
      res.status(201).json(data);
    } catch (error) {
      console.error("Error inserting weather data:", error);
      res.status(500).json({ message: "Failed to insert weather data" });
    }
  });

  // User Preferences routes
  app.get("/api/user/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const prefs = await storage.getUserPreferences(userId);
      res.json(prefs || {});
    } catch (error) {
      console.error("Error fetching user preferences:", error);
      res.status(500).json({ message: "Failed to fetch preferences" });
    }
  });

  app.put("/api/user/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  return httpServer;
}
