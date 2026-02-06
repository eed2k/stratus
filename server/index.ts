import 'dotenv/config';
import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { initDatabase } from "./db";
import * as postgres from "./db-postgres";
import { auditLog, AUDIT_ACTIONS } from "./services/auditLogService";

// Check if PostgreSQL mode is enabled
const usePostgres = postgres.isPostgresEnabled();

// Environment validation
const validateEnvironment = () => {
  const port = parseInt(process.env.PORT || "5000", 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    console.error("Invalid PORT environment variable. Must be a number between 0 and 65535.");
    process.exit(1);
  }
  
  // Validate VITE_DEMO_MODE if set
  if (process.env.VITE_DEMO_MODE && !['true', 'false'].includes(process.env.VITE_DEMO_MODE)) {
    console.warn("VITE_DEMO_MODE should be 'true' or 'false'. Defaulting to false.");
  }
  
  return { port };
};

const { port: validatedPort } = validateEnvironment();

const app = express();
const httpServer = createServer(app);

// Trust proxy when behind reverse proxy (nginx)
// This is required for rate limiting to work correctly with X-Forwarded-For headers
app.set('trust proxy', 1);

// Security headers with Helmet.js
// Note: upgrade-insecure-requests disabled for HTTP-only deployments
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "'unsafe-eval'",
        "https://unpkg.com",      // Leaflet JS CDN
        "https://cdnjs.cloudflare.com", // Leaflet JS fallback CDN
      ],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'",
        "https://unpkg.com",      // Leaflet CSS CDN
        "https://cdnjs.cloudflare.com", // Leaflet CSS fallback CDN
      ],
      imgSrc: [
        "'self'", 
        "data:", 
        "blob:", 
        "https:",
        "https://*.tile.openstreetmap.org", // OpenStreetMap tiles
      ],
      connectSrc: [
        "'self'", 
        "ws:", 
        "wss:",
        "https://nominatim.openstreetmap.org", // OSM Nominatim geocoding API
        "https://unpkg.com",      // Leaflet CDN
        "https://cdnjs.cloudflare.com", // Leaflet fallback CDN
        "https://cdn.jsdelivr.net", // Leaflet fallback CDN
      ],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: null, // Disable for HTTP-only servers
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding resources
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: false, // Disable for HTTP
  originAgentCluster: false, // Disable for HTTP
}));

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize database first
  try {
    if (usePostgres) {
      await postgres.initPostgresDatabase();
      log("PostgreSQL database initialized successfully");
    } else {
      await initDatabase();
      log("SQLite database initialized successfully");
    }
  } catch (error) {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  }

  // Create default admin user and demo user if they don't exist
  // Skip user creation for PostgreSQL mode - users already exist from migration
  if (!usePostgres) {
    try {
      const { getUserByEmail, createUser, getAllActiveUsers } = await import('./db');
      const bcrypt = await import('bcryptjs');
    
    // bcryptjs exports hash as a named function
    const hashFn = bcrypt.hash || bcrypt.default?.hash;
    if (!hashFn) {
      throw new Error("bcrypt.hash function not found");
    }
    
    const users = getAllActiveUsers();
    
    // Create admin user if no users exist
    if (users.length === 0) {
      const adminEmail = process.env.STRATUS_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
      const adminPassword = process.env.STRATUS_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
      const adminName = process.env.STRATUS_ADMIN_NAME || "Admin";
      
      if (adminEmail && adminPassword) {
        const passwordHash = await hashFn(adminPassword, 10);
        
        // Parse admin name (could be "First Last" or just "First")
        const nameParts = adminName.split(' ');
        const firstName = nameParts[0] || "Admin";
        const lastName = nameParts.slice(1).join(' ') || null;
        
        createUser(
          adminEmail,
          firstName,
          lastName,
          passwordHash,
          "admin",
          []
        );
        log(`Default admin user created: ${adminEmail}`);
      } else {
        log("Warning: No admin credentials configured. Set STRATUS_ADMIN_EMAIL and STRATUS_ADMIN_PASSWORD environment variables.");
      }
    }
    } catch (err) {
      console.error("Failed to create default users:", err);
    }
  } else {
    log("PostgreSQL mode - skipping default user creation (users from migration)");
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = validatedPort;
  
  httpServer.on('error', (err) => {
    console.error('Server error:', err);
  });
  
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    // Log system startup
    auditLog.log(AUDIT_ACTIONS.SYSTEM_STARTUP, 'system', {
      details: { port, nodeEnv: process.env.NODE_ENV || 'development' },
      status: 'success'
    });
  });
  
  // Keep process alive
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
  });

  // Log graceful shutdown
  process.on('SIGTERM', () => {
    auditLog.log(AUDIT_ACTIONS.SYSTEM_SHUTDOWN, 'system', {
      details: { reason: 'SIGTERM received' },
      status: 'success'
    });
    process.exit(0);
  });

  process.on('SIGINT', () => {
    auditLog.log(AUDIT_ACTIONS.SYSTEM_SHUTDOWN, 'system', {
      details: { reason: 'SIGINT received' },
      status: 'success'
    });
    process.exit(0);
  });
})();
