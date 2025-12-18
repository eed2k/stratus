import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

// Use DATABASE_URL (local) or SUPABASE_DATABASE_URL (production)
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "SUPABASE_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

console.log(`[Database] Connecting to ${process.env.SUPABASE_DATABASE_URL ? 'Supabase' : 'Local'} PostgreSQL`);

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
