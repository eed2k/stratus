import type { Express, RequestHandler, Request } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

declare global {
  namespace Express {
    interface Request {
      netlifyUser?: NetlifyUser;
    }
  }
}

interface NetlifyUser {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET || "development-secret-change-in-production",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
}

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  return Buffer.from(base64 + padding, 'base64').toString('utf-8');
}

function parseJwt(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = decodeBase64Url(parts[1]);
    return JSON.parse(payload);
  } catch (e) {
    return null;
  }
}

// NOTE: Netlify Identity does not expose JWT signing keys on free plans.
// For production use, consider:
// 1. Deploying to Netlify and using Netlify Functions (auto-verifies tokens)
// 2. Upgrading to Netlify Business plan for custom JWT secret
// 3. Using an alternative auth provider (Auth0, Clerk, Firebase)
// Current implementation decodes but cannot cryptographically verify tokens.

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: "Unauthorized - No token provided" });
  }

  const token = authHeader.substring(7);
  const payload = parseJwt(token);

  if (!payload) {
    return res.status(401).json({ message: "Unauthorized - Invalid token" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    return res.status(401).json({ message: "Unauthorized - Token expired" });
  }

  req.netlifyUser = {
    id: payload.sub,
    email: payload.email,
    full_name: payload.user_metadata?.full_name,
    avatar_url: payload.user_metadata?.avatar_url,
  };

  const nameParts = (payload.user_metadata?.full_name || '').split(' ');
  await storage.upsertUser({
    id: payload.sub,
    email: payload.email,
    firstName: nameParts[0] || null,
    lastName: nameParts.slice(1).join(' ') || null,
    profileImageUrl: payload.user_metadata?.avatar_url || null,
  });

  next();
};

export function getUserId(req: Request): string {
  return req.netlifyUser?.id || '';
}
