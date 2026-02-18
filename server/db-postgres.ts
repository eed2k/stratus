/**
 * PostgreSQL Database Adapter for Stratus Weather Server
 * 
 * This module provides PostgreSQL connectivity for cloud deployments.
 * Designed to work with Vultr Managed PostgreSQL or any PostgreSQL server.
 * 
 * Environment Variables:
 * - DATABASE_URL: PostgreSQL connection string (required for PostgreSQL mode)
 *   Format: postgresql://user:password@host:port/database?sslmode=require
 * 
 * If DATABASE_URL is not set, the application falls back to SQLite (server/db.ts)
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// PostgreSQL connection pool
let pool: Pool | null = null;

// Logger
const pgLog = {
  info: (message: string, ...args: any[]) => console.log(`[PostgreSQL] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[PostgreSQL] WARNING: ${message}`, ...args),
  error: (message: string, error?: any) => {
    console.error(`[PostgreSQL] ERROR: ${message}`);
    if (error) console.error(`[PostgreSQL] Details:`, error instanceof Error ? error.message : error);
  }
};

/**
 * Check if PostgreSQL mode is enabled
 */
export function isPostgresEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Get the PostgreSQL connection URL
 */
export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

/**
 * Initialize PostgreSQL connection pool
 */
export async function initPostgresDatabase(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for PostgreSQL mode');
  }

  pgLog.info('Initializing PostgreSQL connection...');
  
  try {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // SSL configuration for Vultr Managed DB
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
    });

    // Test connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now');
    client.release();
    
    pgLog.info(`Connected to PostgreSQL at ${result.rows[0].now}`);
    
    // Run migrations/table creation
    await createTables();
    
    pgLog.info('PostgreSQL database initialized successfully');
  } catch (error) {
    pgLog.error('Failed to initialize PostgreSQL', error);
    throw error;
  }
}

/**
 * Create database tables if they don't exist
 */
async function createTables(): Promise<void> {
  if (!pool) throw new Error('Database not initialized');

  pgLog.info('Creating tables if not exists...');

  // Stations table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      pakbus_address INTEGER NOT NULL DEFAULT 1,
      connection_type TEXT NOT NULL DEFAULT 'http',
      connection_config JSONB NOT NULL DEFAULT '{}',
      security_code INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_connected TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      latitude REAL,
      longitude REAL,
      altitude REAL,
      installation_team TEXT,
      station_admin TEXT,
      station_admin_email TEXT,
      station_admin_phone TEXT,
      location TEXT,
      datalogger_model TEXT,
      datalogger_serial_number TEXT,
      program_name TEXT,
      modem_model TEXT,
      modem_serial_number TEXT,
      site_description TEXT,
      notes TEXT,
      station_image TEXT,
      protocol TEXT DEFAULT 'pakbus',
      station_type TEXT DEFAULT 'http',
      ingest_id VARCHAR(10) UNIQUE
    )
  `);
  pgLog.info('Stations table ready');

  // Weather data table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weather_data (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      table_name TEXT NOT NULL,
      record_number INTEGER,
      timestamp TIMESTAMP NOT NULL,
      data JSONB NOT NULL,
      collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Weather data table ready');

  // Create indexes for performance
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_weather_data_station_time 
    ON weather_data(station_id, timestamp DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_weather_data_record 
    ON weather_data(station_id, record_number)
  `);
  
  // Add unique constraint to prevent duplicate records (includes table_name for multi-table stations)
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_weather_data_unique_station_table_time
    ON weather_data(station_id, table_name, timestamp)
  `);
  // Drop old incomplete index if it exists
  await pool.query(`
    DROP INDEX IF EXISTS idx_weather_data_unique_station_time
  `).catch(() => {});
  pgLog.info('Weather data indexes ready');

  // Table definitions
  await pool.query(`
    CREATE TABLE IF NOT EXISTS table_definitions (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      table_number INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      columns JSONB NOT NULL,
      record_interval INTEGER,
      cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Table definitions table ready');

  // Collection schedules
  await pool.query(`
    CREATE TABLE IF NOT EXISTS collection_schedules (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      table_name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      is_enabled BOOLEAN DEFAULT true,
      last_collection TIMESTAMP,
      next_collection TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Collection schedules table ready');

  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      assigned_stations TEXT,
      is_active BOOLEAN DEFAULT true,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Users table ready');

  // Password reset tokens
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Password reset tokens table ready');

  // User invitation tokens (for new user setup)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_invitation_tokens (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      invited_by TEXT,
      custom_message TEXT,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('User invitation tokens table ready');

  // Dropbox configs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dropbox_configs (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      file_pattern TEXT,
      station_id INTEGER,
      sync_interval INTEGER DEFAULT 3600000,
      enabled BOOLEAN DEFAULT true,
      last_sync_at TIMESTAMP,
      last_sync_status TEXT,
      last_sync_records INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Dropbox configs table ready');

  // Shares table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shares (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      share_token TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT 'Shared Dashboard',
      email TEXT,
      access_level TEXT DEFAULT 'viewer',
      password TEXT,
      expires_at TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      last_accessed_at TIMESTAMP,
      access_count INTEGER DEFAULT 0,
      created_by TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Shares table ready');

  // Alarms table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alarms (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      name TEXT,
      parameter TEXT NOT NULL,
      condition TEXT NOT NULL,
      threshold REAL NOT NULL,
      stale_minutes INTEGER,
      unit VARCHAR(20) DEFAULT '',
      severity TEXT DEFAULT 'warning',
      enabled BOOLEAN DEFAULT true,
      email_notifications BOOLEAN DEFAULT false,
      email_recipients TEXT,
      last_triggered_at TIMESTAMP,
      trigger_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Alarms table ready');

  // Migration: add stale_minutes column if missing (for existing databases)
  await pool.query(`
    ALTER TABLE alarms ADD COLUMN IF NOT EXISTS stale_minutes INTEGER
  `).catch(() => { /* column already exists */ });

  // Alarm events
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alarm_events (
      id SERIAL PRIMARY KEY,
      alarm_id INTEGER NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
      station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
      triggered_value REAL,
      message TEXT,
      acknowledged BOOLEAN DEFAULT false,
      acknowledged_by TEXT,
      acknowledged_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Alarm events table ready');

  // Organizations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT,
      owner_id TEXT DEFAULT 'local-user',
      logo_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Add logo_url column if missing (migration for existing DBs)
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT`);
  pgLog.info('Organizations table ready');

  // Organization members
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_members (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Organization members table ready');

  // Organization invitations
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organization_invitations (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      token TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Organization invitations table ready');

  // Settings table for app configuration
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('Settings table ready');

  // User preferences table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE,
      temperature_unit TEXT DEFAULT 'celsius',
      wind_speed_unit TEXT DEFAULT 'ms',
      pressure_unit TEXT DEFAULT 'hpa',
      precipitation_unit TEXT DEFAULT 'mm',
      theme TEXT DEFAULT 'system',
      email_notifications BOOLEAN DEFAULT true,
      push_notifications BOOLEAN DEFAULT false,
      temp_high_alert REAL DEFAULT 35,
      wind_high_alert REAL DEFAULT 50,
      units TEXT DEFAULT 'metric',
      timezone TEXT DEFAULT 'auto',
      server_address TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  pgLog.info('User preferences table ready');

  // ── Performance indexes ──────────────────────────────────────────
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_alarms_station_id ON alarms(station_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_alarm_events_alarm_id ON alarm_events(alarm_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_shares_station_id ON shares(station_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_unique ON organization_members(organization_id, user_id)`);

  // ── Migrations for existing databases ──────────────────────────
  await pool.query(`ALTER TABLE alarms ADD COLUMN IF NOT EXISTS stale_minutes INTEGER`);
  await pool.query(`ALTER TABLE stations ADD COLUMN IF NOT EXISTS ingest_id VARCHAR(10) UNIQUE`);
  // New weather data columns for wind std dev, SDI-12, pump/port
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS wind_dir_std_dev REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS sdi12_wind_vector REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS pump_select_well REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS pump_select_bore REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS port_status_c1 REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS port_status_c2 REAL`);
  // MPPT Solar Charge Controller columns
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_solar_voltage REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_solar_current REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_solar_power REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_load_voltage REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_load_current REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_battery_voltage REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_charger_state REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_absi_avg REAL`);
  // MPPT additional fields
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_board_temp REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt_mode REAL`);
  // MPPT Charger 2 columns
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_solar_voltage REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_solar_current REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_solar_power REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_load_voltage REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_load_current REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_battery_voltage REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_charger_state REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_board_temp REAL`);
  await pool.query(`ALTER TABLE weather_data ADD COLUMN IF NOT EXISTS mppt2_mode REAL`);
  pgLog.info('Additional performance indexes ready');
}

/**
 * Get the connection pool
 */
export function getPool(): Pool | null {
  return pool;
}

/**
 * Execute a raw query
 */
export async function query(text: string, params?: any[]): Promise<QueryResult<QueryResultRow>> {
  if (!pool) throw new Error('Database not initialized');
  return pool.query(text, params);
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<PoolClient> {
  if (!pool) throw new Error('Database not initialized');
  return pool.connect();
}

/**
 * Close the database connection
 */
export async function closePostgresDatabase(): Promise<void> {
  if (pool) {
    pgLog.info('Closing PostgreSQL connection pool...');
    await pool.end();
    pool = null;
    pgLog.info('PostgreSQL connection closed');
  }
}

// ============================================================================
// Station Operations
// ============================================================================

export interface Station {
  id?: number;
  name: string;
  pakbusAddress: number;
  connectionType: string;
  connectionConfig: any;
  securityCode?: number | null;
  createdAt?: string;
  updatedAt?: string;
  lastConnected?: string | null;
  isActive?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  location?: string | null;
  dataloggerModel?: string | null;
  dataloggerSerialNumber?: string | null;
  programName?: string | null;
  modemModel?: string | null;
  modemSerialNumber?: string | null;
  siteDescription?: string | null;
  notes?: string | null;
  stationImage?: string | null;
  protocol?: string;
  stationType?: string;
  ingestId?: string | null;
}

/**
 * Get all stations
 */
export async function getAllStations(): Promise<Station[]> {
  const result = await query(`
    SELECT id, name, pakbus_address, connection_type, connection_config,
           security_code, created_at, updated_at, last_connected, is_active,
           latitude, longitude, altitude, location, datalogger_model,
           datalogger_serial_number, program_name, modem_model, modem_serial_number,
           site_description, notes, station_image, protocol, station_type, ingest_id
    FROM stations
    ORDER BY id
  `);
  
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    pakbusAddress: row.pakbus_address,
    connectionType: row.connection_type,
    connectionConfig: row.connection_config,
    securityCode: row.security_code,
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
    lastConnected: row.last_connected?.toISOString(),
    isActive: row.is_active,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    location: row.location,
    dataloggerModel: row.datalogger_model,
    dataloggerSerialNumber: row.datalogger_serial_number,
    programName: row.program_name,
    modemModel: row.modem_model,
    modemSerialNumber: row.modem_serial_number,
    siteDescription: row.site_description,
    notes: row.notes,
    stationImage: row.station_image,
    protocol: row.protocol,
    stationType: row.station_type,
    ingestId: row.ingest_id,
  }));
}

/**
 * Get station by ID
 */
export async function getStationById(id: number): Promise<Station | null> {
  const result = await query(`
    SELECT id, name, pakbus_address, connection_type, connection_config,
           security_code, created_at, updated_at, last_connected, is_active,
           latitude, longitude, altitude, location, datalogger_model,
           datalogger_serial_number, program_name, modem_model, modem_serial_number,
           site_description, notes, station_image, protocol, station_type, ingest_id
    FROM stations
    WHERE id = $1
  `, [id]);
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    pakbusAddress: row.pakbus_address,
    connectionType: row.connection_type,
    connectionConfig: row.connection_config,
    securityCode: row.security_code,
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
    lastConnected: row.last_connected?.toISOString(),
    isActive: row.is_active,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    location: row.location,
    dataloggerModel: row.datalogger_model,
    dataloggerSerialNumber: row.datalogger_serial_number,
    programName: row.program_name,
    modemModel: row.modem_model,
    modemSerialNumber: row.modem_serial_number,
    siteDescription: row.site_description,
    notes: row.notes,
    stationImage: row.station_image,
    protocol: row.protocol,
    stationType: row.station_type,
    ingestId: row.ingest_id,
  };
}

/**
 * Generate a unique 8-character alphanumeric ingest ID (e.g., "ST64ART3")
 */
function generateIngestId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Create a new station
 */
export async function createStation(station: Station): Promise<number> {
  // Generate unique ingest_id for HTTP POST stations
  let ingestId: string | null = null;
  if (station.connectionType === 'http_post') {
    // Retry up to 5 times in case of unique constraint collision
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateIngestId();
      const existing = await query('SELECT id FROM stations WHERE ingest_id = $1', [candidate]);
      if (existing.rows.length === 0) {
        ingestId = candidate;
        break;
      }
    }
    if (!ingestId) {
      throw new Error('Failed to generate unique ingest ID after 5 attempts');
    }
  }

  const result = await query(`
    INSERT INTO stations (name, pakbus_address, connection_type, connection_config,
      security_code, is_active, latitude, longitude, altitude, location,
      datalogger_model, datalogger_serial_number, program_name, modem_model,
      modem_serial_number, site_description, notes, station_image, protocol, station_type, ingest_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING id
  `, [
    station.name,
    station.pakbusAddress ?? 1,
    station.connectionType ?? 'http',
    JSON.stringify(station.connectionConfig ?? {}),
    station.securityCode ?? null,
    station.isActive !== false,
    station.latitude ?? null,
    station.longitude ?? null,
    station.altitude ?? null,
    station.location ?? null,
    station.dataloggerModel ?? null,
    station.dataloggerSerialNumber ?? null,
    station.programName ?? null,
    station.modemModel ?? null,
    station.modemSerialNumber || null,
    station.siteDescription || null,
    station.notes || null,
    station.stationImage || null,
    station.protocol || 'pakbus',
    station.stationType || 'http',
    ingestId,
  ]);
  
  return result.rows[0].id;
}

/**
 * Get a station by its unique ingest ID (for HTTP POST ingestion)
 */
export async function getStationByIngestId(ingestId: string): Promise<Station | null> {
  const result = await query(`
    SELECT id, name, pakbus_address, connection_type, connection_config,
           security_code, created_at, updated_at, last_connected, is_active,
           latitude, longitude, altitude, location, datalogger_model,
           datalogger_serial_number, program_name, modem_model, modem_serial_number,
           site_description, notes, station_image, protocol, station_type, ingest_id
    FROM stations
    WHERE ingest_id = $1
  `, [ingestId]);
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    pakbusAddress: row.pakbus_address,
    connectionType: row.connection_type,
    connectionConfig: row.connection_config,
    securityCode: row.security_code,
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
    lastConnected: row.last_connected?.toISOString(),
    isActive: row.is_active,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    location: row.location,
    dataloggerModel: row.datalogger_model,
    dataloggerSerialNumber: row.datalogger_serial_number,
    programName: row.program_name,
    modemModel: row.modem_model,
    modemSerialNumber: row.modem_serial_number,
    siteDescription: row.site_description,
    notes: row.notes,
    stationImage: row.station_image,
    protocol: row.protocol,
    stationType: row.station_type,
    ingestId: row.ingest_id,
  };
}

/**
 * Update a station
 */
export async function updateStation(id: number, updates: Partial<Station>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  const columnMap: Record<string, string> = {
    name: 'name',
    pakbusAddress: 'pakbus_address',
    connectionType: 'connection_type',
    connectionConfig: 'connection_config',
    securityCode: 'security_code',
    isActive: 'is_active',
    latitude: 'latitude',
    longitude: 'longitude',
    altitude: 'altitude',
    location: 'location',
    dataloggerModel: 'datalogger_model',
    dataloggerSerialNumber: 'datalogger_serial_number',
    programName: 'program_name',
    modemModel: 'modem_model',
    modemSerialNumber: 'modem_serial_number',
    siteDescription: 'site_description',
    notes: 'notes',
    stationImage: 'station_image',
    protocol: 'protocol',
    stationType: 'station_type',
    lastConnected: 'last_connected',
  };

  for (const [key, column] of Object.entries(columnMap)) {
    if (key in updates) {
      fields.push(`${column} = $${paramIndex}`);
      let value = (updates as any)[key];
      if (key === 'connectionConfig' && typeof value === 'object') {
        value = JSON.stringify(value);
      }
      values.push(value);
      paramIndex++;
    }
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  await query(`
    UPDATE stations 
    SET ${fields.join(', ')}
    WHERE id = $${paramIndex}
  `, values);
}

/**
 * Delete a station
 */
export async function deleteStation(id: number): Promise<void> {
  // Use a transaction to delete all referencing records and the station itself.
  // All child tables have ON DELETE CASCADE, but we explicitly delete first
  // to ensure clean removal under any circumstance (race conditions, partial schemas, etc.)
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Delete all referencing records before deleting the station
    // Order matters: alarm_events references both alarms and stations
    await client.query('DELETE FROM alarm_events WHERE station_id = $1', [id]);
    await client.query('DELETE FROM alarms WHERE station_id = $1', [id]);
    await client.query('DELETE FROM shares WHERE station_id = $1', [id]);
    await client.query('DELETE FROM collection_schedules WHERE station_id = $1', [id]);
    await client.query('DELETE FROM table_definitions WHERE station_id = $1', [id]);
    await client.query('DELETE FROM weather_data WHERE station_id = $1', [id]);
    await client.query('DELETE FROM dropbox_configs WHERE station_id = $1', [id]);
    await client.query('DELETE FROM stations WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Fallback: if explicit deletes fail (e.g. new FK tables added), try with just CASCADE
    console.warn(`[DB] Explicit station delete failed for ${id}, retrying with CASCADE:`, err);
    const fallbackClient = await getClient();
    try {
      await fallbackClient.query('BEGIN');
      // Force-delete the station — ON DELETE CASCADE handles all child rows
      await fallbackClient.query('DELETE FROM dropbox_configs WHERE station_id = $1', [id]);
      await fallbackClient.query('DELETE FROM stations WHERE id = $1', [id]);
      await fallbackClient.query('COMMIT');
    } catch (err2) {
      await fallbackClient.query('ROLLBACK');
      throw err2;
    } finally {
      fallbackClient.release();
    }
  } finally {
    client.release();
  }
}

// ============================================================================
// Weather Data Operations
// ============================================================================

export interface WeatherRecord {
  id?: number;
  stationId: number;
  tableName: string;
  recordNumber?: number | null;
  timestamp: string;
  data: any;
  collectedAt?: string;
  // MPPT dedicated columns
  mppt_solar_voltage?: number | null;
  mppt_solar_current?: number | null;
  mppt_solar_power?: number | null;
  mppt_load_voltage?: number | null;
  mppt_load_current?: number | null;
  mppt_battery_voltage?: number | null;
  mppt_charger_state?: number | null;
  mppt_absi_avg?: number | null;
}

/**
 * Insert weather data records
 */
export async function insertWeatherData(records: WeatherRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  
  const client = await getClient();
  let insertedCount = 0;
  
  try {
    await client.query('BEGIN');
    
    for (const record of records) {
      // Use ON CONFLICT DO UPDATE to allow re-syncs to fix incomplete records
      const result = await client.query(`
        INSERT INTO weather_data (station_id, table_name, record_number, timestamp, data)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (station_id, table_name, timestamp) 
        DO UPDATE SET data = EXCLUDED.data, collected_at = CURRENT_TIMESTAMP
      `, [
        record.stationId,
        record.tableName || 'Table1',
        record.recordNumber || null,
        record.timestamp,
        typeof record.data === 'string' ? record.data : JSON.stringify(record.data),
      ]);
      if (result.rowCount && result.rowCount > 0) {
        insertedCount++;
      }
    }
    
    await client.query('COMMIT');
    return insertedCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get weather data for a station
 */
export async function getWeatherData(
  stationId: number,
  options: {
    tableName?: string;
    startTime?: string;
    endTime?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ records: WeatherRecord[]; total: number }> {
  const conditions: string[] = ['station_id = $1'];
  const params: any[] = [stationId];
  let paramIndex = 2;
  
  if (options.tableName) {
    conditions.push(`table_name = $${paramIndex}`);
    params.push(options.tableName);
    paramIndex++;
  }
  
  if (options.startTime) {
    conditions.push(`timestamp >= $${paramIndex}`);
    params.push(options.startTime);
    paramIndex++;
  }
  
  if (options.endTime) {
    conditions.push(`timestamp <= $${paramIndex}`);
    params.push(options.endTime);
    paramIndex++;
  }
  
  const whereClause = conditions.join(' AND ');
  
  // Apply a default limit cap to prevent huge payloads (max 10000 records)
  const effectiveLimit = options.limit || 10000;
  
  // Get records with limit
  let queryText = `
    SELECT id, station_id, table_name, record_number, timestamp, data, collected_at,
           mppt_solar_voltage, mppt_solar_current, mppt_solar_power,
           mppt_load_voltage, mppt_load_current, mppt_battery_voltage,
           mppt_charger_state, mppt_absi_avg
    FROM weather_data
    WHERE ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${paramIndex}
  `;
  params.push(effectiveLimit);
  paramIndex++;
  
  if (options.offset) {
    queryText += ` OFFSET $${paramIndex}`;
    params.push(options.offset);
  }
  
  const result = await query(queryText, params);
  
  return {
    records: result.rows.map(row => ({
      id: row.id,
      stationId: row.station_id,
      tableName: row.table_name,
      recordNumber: row.record_number,
      timestamp: row.timestamp?.toISOString(),
      data: row.data,
      collectedAt: row.collected_at?.toISOString(),
      mppt_solar_voltage: row.mppt_solar_voltage,
      mppt_solar_current: row.mppt_solar_current,
      mppt_solar_power: row.mppt_solar_power,
      mppt_load_voltage: row.mppt_load_voltage,
      mppt_load_current: row.mppt_load_current,
      mppt_battery_voltage: row.mppt_battery_voltage,
      mppt_charger_state: row.mppt_charger_state,
      mppt_absi_avg: row.mppt_absi_avg,
    })),
    total: result.rows.length,
  };
}

/**
 * Get latest weather data for a station (optionally filtered by table name)
 */
export async function getLatestWeatherData(stationId: number, tableName?: string): Promise<WeatherRecord | null> {
  let result;
  if (tableName) {
    result = await query(`
      SELECT id, station_id, table_name, record_number, timestamp, data, collected_at,
             mppt_solar_voltage, mppt_solar_current, mppt_solar_power,
             mppt_load_voltage, mppt_load_current, mppt_battery_voltage,
             mppt_charger_state, mppt_absi_avg
      FROM weather_data
      WHERE station_id = $1 AND table_name = $2
      ORDER BY timestamp DESC
      LIMIT 1
    `, [stationId, tableName]);
  } else {
    // No table name filter — get the absolute latest record for this station
    result = await query(`
      SELECT id, station_id, table_name, record_number, timestamp, data, collected_at,
             mppt_solar_voltage, mppt_solar_current, mppt_solar_power,
             mppt_load_voltage, mppt_load_current, mppt_battery_voltage,
             mppt_charger_state, mppt_absi_avg
      FROM weather_data
      WHERE station_id = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `, [stationId]);
  }
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    id: row.id,
    stationId: row.station_id,
    tableName: row.table_name,
    recordNumber: row.record_number,
    timestamp: row.timestamp?.toISOString(),
    data: row.data,
    collectedAt: row.collected_at?.toISOString(),
    mppt_solar_voltage: row.mppt_solar_voltage,
    mppt_solar_current: row.mppt_solar_current,
    mppt_solar_power: row.mppt_solar_power,
    mppt_load_voltage: row.mppt_load_voltage,
    mppt_load_current: row.mppt_load_current,
    mppt_battery_voltage: row.mppt_battery_voltage,
    mppt_charger_state: row.mppt_charger_state,
    mppt_absi_avg: row.mppt_absi_avg,
  };
}

/**
 * Get distinct table names for a station (for multi-table merge)
 */
export async function getDistinctTableNames(stationId: number): Promise<string[]> {
  const result = await query(
    'SELECT DISTINCT table_name FROM weather_data WHERE station_id = $1',
    [stationId]
  );
  return result.rows.map((r: any) => r.table_name);
}

// ============================================================================
// User Operations
// ============================================================================

export interface User {
  id?: number;
  email: string;
  firstName: string;
  lastName?: string | null;
  passwordHash: string;
  role?: string;
  assignedStations?: string | null;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await query(`
    SELECT * FROM users WHERE email = $1
  `, [email.toLowerCase()]);
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    passwordHash: row.password_hash,
    role: row.role,
    assignedStations: row.assigned_stations,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at?.toISOString(),
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
  };
}

/**
 * Create a user
 */
export async function createUser(user: User): Promise<number> {
  const result = await query(`
    INSERT INTO users (email, first_name, last_name, password_hash, role, assigned_stations, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [
    user.email.toLowerCase(),
    user.firstName,
    user.lastName || null,
    user.passwordHash,
    user.role || 'user',
    user.assignedStations || null,
    user.isActive !== false,
  ]);
  
  return result.rows[0].id;
}

/**
 * Update user last login
 */
export async function updateUserLastLogin(userId: number): Promise<void> {
  await query(`
    UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1
  `, [userId]);
}

// ============================================================================
// Dropbox Config Operations
// ============================================================================

export interface DropboxConfig {
  id?: number;
  name: string;
  folderPath: string;
  filePattern?: string | null;
  stationId?: number | null;
  syncInterval?: number;
  enabled?: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncRecords?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Get all Dropbox configs
 */
export async function getAllDropboxConfigs(): Promise<DropboxConfig[]> {
  const result = await query(`
    SELECT * FROM dropbox_configs ORDER BY id
  `);
  
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    filePattern: row.file_pattern,
    stationId: row.station_id,
    syncInterval: row.sync_interval,
    enabled: row.enabled,
    lastSyncAt: row.last_sync_at?.toISOString(),
    lastSyncStatus: row.last_sync_status,
    lastSyncRecords: row.last_sync_records,
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
  }));
}

/**
 * Update Dropbox config sync status
 */
export async function updateDropboxConfigSyncStatus(
  id: number, 
  status: string, 
  recordCount: number
): Promise<void> {
  await query(`
    UPDATE dropbox_configs 
    SET last_sync_at = CURRENT_TIMESTAMP, 
        last_sync_status = $2, 
        last_sync_records = $3,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `, [id, status, recordCount]);
}

/**
 * Get a single Dropbox config by ID
 */
export async function getDropboxConfigById(id: number): Promise<DropboxConfig | null> {
  const result = await query(`SELECT * FROM dropbox_configs WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    filePattern: row.file_pattern,
    stationId: row.station_id,
    syncInterval: row.sync_interval,
    enabled: row.enabled,
    lastSyncAt: row.last_sync_at?.toISOString(),
    lastSyncStatus: row.last_sync_status,
    lastSyncRecords: row.last_sync_records,
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
  };
}

/**
 * Create a new Dropbox config
 */
export async function createDropboxConfig(
  name: string,
  folderPath: string,
  filePattern: string | null,
  stationId: number | null,
  syncInterval: number,
  enabled: boolean
): Promise<number> {
  const result = await query(`
    INSERT INTO dropbox_configs (name, folder_path, file_pattern, station_id, sync_interval, enabled)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `, [name, folderPath, filePattern, stationId, syncInterval, enabled]);
  return result.rows[0].id;
}

/**
 * Update an existing Dropbox config
 */
export async function updateDropboxConfig(
  id: number,
  data: {
    name?: string;
    folder_path?: string;
    file_pattern?: string | null;
    station_id?: number | null;
    sync_interval?: number;
    enabled?: boolean;
  }
): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.folder_path !== undefined) { fields.push(`folder_path = $${idx++}`); values.push(data.folder_path); }
  if (data.file_pattern !== undefined) { fields.push(`file_pattern = $${idx++}`); values.push(data.file_pattern); }
  if (data.station_id !== undefined) { fields.push(`station_id = $${idx++}`); values.push(data.station_id); }
  if (data.sync_interval !== undefined) { fields.push(`sync_interval = $${idx++}`); values.push(data.sync_interval); }
  if (data.enabled !== undefined) { fields.push(`enabled = $${idx++}`); values.push(data.enabled); }
  
  if (fields.length === 0) return;
  
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  await query(
    `UPDATE dropbox_configs SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );
}

/**
 * Delete a Dropbox config
 */
export async function deleteDropboxConfig(id: number): Promise<void> {
  await query(`DELETE FROM dropbox_configs WHERE id = $1`, [id]);
}

// ============================================================================
// Password Reset Token Operations
// ============================================================================

/**
 * Create a password reset token
 */
export async function createPasswordResetToken(email: string): Promise<string> {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  
  // Invalidate any existing tokens for this email
  await query('UPDATE password_reset_tokens SET used = true WHERE user_email = $1 AND used = false', [email]);
  
  await query(`
    INSERT INTO password_reset_tokens (user_email, token, expires_at)
    VALUES ($1, $2, $3)
  `, [email, token, expiresAt.toISOString()]);
  
  return token;
}

/**
 * Validate a password reset token
 */
export async function validatePasswordResetToken(token: string): Promise<string | null> {
  const result = await query(`
    SELECT user_email FROM password_reset_tokens 
    WHERE token = $1 AND used = false AND expires_at > CURRENT_TIMESTAMP
  `, [token]);
  
  if (result.rows.length === 0) return null;
  return result.rows[0].user_email;
}

/**
 * Mark a password reset token as used
 */
export async function markPasswordResetTokenUsed(token: string): Promise<void> {
  await query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [token]);
}

// ============================================================================
// User Invitation Token Operations
// ============================================================================

/**
 * Create a user invitation token
 */
export async function createUserInvitationToken(
  email: string, 
  invitedBy?: string, 
  customMessage?: string
): Promise<string> {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
  
  // Invalidate any existing tokens for this email
  await query('UPDATE user_invitation_tokens SET used = true WHERE user_email = $1 AND used = false', [email]);
  
  await query(`
    INSERT INTO user_invitation_tokens (user_email, token, invited_by, custom_message, expires_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [email, token, invitedBy || null, customMessage || null, expiresAt.toISOString()]);
  
  return token;
}

/**
 * Validate a user invitation token
 */
export async function validateUserInvitationToken(token: string): Promise<{email: string; invitedBy?: string; customMessage?: string} | null> {
  const result = await query(`
    SELECT user_email, invited_by, custom_message FROM user_invitation_tokens 
    WHERE token = $1 AND used = false AND expires_at > CURRENT_TIMESTAMP
  `, [token]);
  
  if (result.rows.length === 0) return null;
  return {
    email: result.rows[0].user_email,
    invitedBy: result.rows[0].invited_by,
    customMessage: result.rows[0].custom_message
  };
}

/**
 * Mark a user invitation token as used
 */
export async function markUserInvitationTokenUsed(token: string): Promise<void> {
  await query('UPDATE user_invitation_tokens SET used = true WHERE token = $1', [token]);
}

/**
 * Get all active users
 */
export async function getAllUsers(): Promise<User[]> {
  const result = await query(`
    SELECT * FROM users WHERE is_active = true ORDER BY created_at DESC
  `);
  
  return result.rows.map((row: any) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    passwordHash: row.password_hash,
    role: row.role,
    assignedStations: row.assigned_stations,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at?.toISOString(),
    createdAt: row.created_at?.toISOString(),
    updatedAt: row.updated_at?.toISOString(),
  }));
}

/**
 * Delete user by email
 */
export async function deleteUserByEmail(email: string): Promise<boolean> {
  const result = await query(`
    DELETE FROM users WHERE LOWER(email) = LOWER($1)
  `, [email]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Update user data by email (admin path)
 */
export async function updateUserDataByEmail(email: string, updates: {
  firstName?: string;
  lastName?: string;
  passwordHash?: string;
  role?: string;
  assignedStations?: number[];
}): Promise<any> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.firstName !== undefined) {
    setClauses.push(`first_name = $${paramIndex++}`);
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    setClauses.push(`last_name = $${paramIndex++}`);
    values.push(updates.lastName);
  }
  if (updates.passwordHash !== undefined) {
    setClauses.push(`password_hash = $${paramIndex++}`);
    values.push(updates.passwordHash);
  }
  if (updates.role !== undefined) {
    setClauses.push(`role = $${paramIndex++}`);
    values.push(updates.role);
  }
  if (updates.assignedStations !== undefined) {
    setClauses.push(`assigned_stations = $${paramIndex++}`);
    values.push(JSON.stringify(updates.assignedStations));
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(email.toLowerCase());

  const result = await query(`
    UPDATE users SET ${setClauses.join(', ')}
    WHERE LOWER(email) = LOWER($${paramIndex})
    RETURNING id, email, first_name, last_name, role, assigned_stations, last_login_at, created_at
  `, values);

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    assignedStations: row.assigned_stations ? (typeof row.assigned_stations === 'string' ? JSON.parse(row.assigned_stations) : row.assigned_stations) : [],
    lastLoginAt: row.last_login_at?.toISOString(),
    createdAt: row.created_at?.toISOString(),
  };
}

/**
 * Update user password hash
 */
export async function updateUserPassword(email: string, passwordHash: string): Promise<void> {
  await query(`
    UPDATE users SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
    WHERE email = $1
  `, [email.toLowerCase(), passwordHash]);
}

/**
 * Update user profile (firstName, lastName, email)
 */
export async function updateUserProfile(userId: number, updates: { firstName?: string; lastName?: string; email?: string }): Promise<any> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  if (updates.firstName !== undefined) {
    setClauses.push(`first_name = $${paramIndex++}`);
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    setClauses.push(`last_name = $${paramIndex++}`);
    values.push(updates.lastName);
  }
  if (updates.email !== undefined) {
    setClauses.push(`email = $${paramIndex++}`);
    values.push(updates.email.toLowerCase());
  }
  
  if (setClauses.length === 0) {
    // No updates provided, just return the current user
    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role,
      createdAt: row.created_at
    };
  }
  
  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  values.push(userId);
  
  const result = await query(`
    UPDATE users SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, email, first_name, last_name, role, created_at
  `, values);
  
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    createdAt: row.created_at
  };
}

// ============================================================================
// Settings Operations
// ============================================================================

/**
 * Get a setting by key
 */
export async function getSetting(key: string): Promise<string | null> {
  const result = await query('SELECT value FROM settings WHERE key = $1', [key]);
  if (result.rows.length === 0) return null;
  return result.rows[0].value;
}

/**
 * Set a setting value
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await query(`
    INSERT INTO settings (key, value, updated_at) 
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP
  `, [key, value]);
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  const result = await query('SELECT key, value FROM settings');
  const settings: Record<string, string> = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ============================================================================
// User Preferences Operations
// ============================================================================

export interface UserPreferences {
  userId: number;
  temperatureUnit: string;
  windSpeedUnit: string;
  pressureUnit: string;
  precipitationUnit: string;
  theme: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  tempHighAlert: number;
  windHighAlert: number;
  units: string;
  timezone: string;
  serverAddress: string;
}

/**
 * Get user preferences
 */
export async function getUserPreferences(userId: number): Promise<UserPreferences | null> {
  const result = await query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
  if (result.rows.length === 0) return null;
  
  const row = result.rows[0];
  return {
    userId: row.user_id,
    temperatureUnit: row.temperature_unit,
    windSpeedUnit: row.wind_speed_unit,
    pressureUnit: row.pressure_unit,
    precipitationUnit: row.precipitation_unit,
    theme: row.theme,
    emailNotifications: row.email_notifications,
    pushNotifications: row.push_notifications,
    tempHighAlert: row.temp_high_alert,
    windHighAlert: row.wind_high_alert,
    units: row.units,
    timezone: row.timezone,
    serverAddress: row.server_address,
  };
}

/**
 * Upsert user preferences
 */
export async function upsertUserPreferences(prefs: Partial<UserPreferences> & { userId: number }): Promise<UserPreferences> {
  const result = await query(`
    INSERT INTO user_preferences (
      user_id, temperature_unit, wind_speed_unit, pressure_unit, precipitation_unit,
      theme, email_notifications, push_notifications, temp_high_alert, wind_high_alert,
      units, timezone, server_address
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (user_id) DO UPDATE SET
      temperature_unit = COALESCE($2, user_preferences.temperature_unit),
      wind_speed_unit = COALESCE($3, user_preferences.wind_speed_unit),
      pressure_unit = COALESCE($4, user_preferences.pressure_unit),
      precipitation_unit = COALESCE($5, user_preferences.precipitation_unit),
      theme = COALESCE($6, user_preferences.theme),
      email_notifications = COALESCE($7, user_preferences.email_notifications),
      push_notifications = COALESCE($8, user_preferences.push_notifications),
      temp_high_alert = COALESCE($9, user_preferences.temp_high_alert),
      wind_high_alert = COALESCE($10, user_preferences.wind_high_alert),
      units = COALESCE($11, user_preferences.units),
      timezone = COALESCE($12, user_preferences.timezone),
      server_address = COALESCE($13, user_preferences.server_address),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [
    prefs.userId,
    prefs.temperatureUnit || 'celsius',
    prefs.windSpeedUnit || 'ms',
    prefs.pressureUnit || 'hpa',
    prefs.precipitationUnit || 'mm',
    prefs.theme || 'system',
    prefs.emailNotifications ?? true,
    prefs.pushNotifications ?? false,
    prefs.tempHighAlert ?? 35,
    prefs.windHighAlert ?? 50,
    prefs.units || 'metric',
    prefs.timezone || 'auto',
    prefs.serverAddress || '',
  ]);
  
  const row = result.rows[0];
  return {
    userId: row.user_id,
    temperatureUnit: row.temperature_unit,
    windSpeedUnit: row.wind_speed_unit,
    pressureUnit: row.pressure_unit,
    precipitationUnit: row.precipitation_unit,
    theme: row.theme,
    emailNotifications: row.email_notifications,
    pushNotifications: row.push_notifications,
    tempHighAlert: row.temp_high_alert,
    windHighAlert: row.wind_high_alert,
    units: row.units,
    timezone: row.timezone,
    serverAddress: row.server_address,
  };
}

// ==================== Alarm Functions ====================

export interface PgAlarm {
  id: number;
  station_id: number;
  name: string;
  parameter: string;
  condition: string;
  threshold: number;
  unit: string;
  severity: string;
  enabled: boolean;
  email_notifications: boolean;
  email_recipients?: string | null;
  last_triggered_at?: string | null;
  trigger_count: number;
  stale_minutes?: number | null;
  created_at: string;
  updated_at: string;
}

export interface PgAlarmEvent {
  id: number;
  alarm_id: number;
  station_id: number;
  triggered_value?: number | null;
  message?: string | null;
  acknowledged: boolean;
  acknowledged_by?: string | null;
  acknowledged_at?: string | null;
  created_at: string;
}

export async function pgCreateAlarm(alarm: {
  station_id: number;
  name: string;
  parameter: string;
  condition: string;
  threshold: number;
  unit?: string;
  severity?: string;
  enabled?: boolean;
  email_notifications?: boolean;
  email_recipients?: string | null;
  stale_minutes?: number | null;
}): Promise<number> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `INSERT INTO alarms (station_id, name, parameter, condition, threshold, unit, severity, enabled, email_notifications, email_recipients, stale_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      alarm.station_id,
      alarm.name,
      alarm.parameter,
      alarm.condition,
      alarm.threshold,
      alarm.unit || '',
      alarm.severity || 'warning',
      alarm.enabled !== false,
      alarm.email_notifications || false,
      alarm.email_recipients || null,
      alarm.stale_minutes || null
    ]
  );
  pgLog.info(`Created alarm ${result.rows[0].id} for station ${alarm.station_id}`);
  return result.rows[0].id;
}

export async function pgGetAlarmById(id: number): Promise<PgAlarm | null> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query('SELECT * FROM alarms WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return mapPgAlarmRow(row);
}

/** Map a raw postgres row to PgAlarm */
function mapPgAlarmRow(row: any): PgAlarm {
  return {
    id: row.id,
    station_id: row.station_id,
    name: row.name || row.parameter || '',
    parameter: row.parameter || '',
    condition: row.condition,
    threshold: parseFloat(row.threshold) || 0,
    unit: row.unit || '',
    severity: row.severity,
    enabled: row.enabled,
    email_notifications: row.email_notifications,
    email_recipients: row.email_recipients,
    last_triggered_at: row.last_triggered_at?.toISOString?.() ?? (row.last_triggered_at || null),
    trigger_count: row.trigger_count || 0,
    stale_minutes: row.stale_minutes ?? null,
    created_at: row.created_at?.toISOString?.() || new Date().toISOString(),
    updated_at: row.updated_at?.toISOString?.() || new Date().toISOString(),
  };
}

export async function pgGetAlarmsByStation(stationId: number): Promise<PgAlarm[]> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query('SELECT * FROM alarms WHERE station_id = $1 ORDER BY created_at DESC', [stationId]);
  return result.rows.map(mapPgAlarmRow);
}

export async function pgGetAllAlarms(): Promise<PgAlarm[]> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query('SELECT * FROM alarms ORDER BY created_at DESC');
  return result.rows.map(mapPgAlarmRow);
}

export async function pgUpdateAlarm(id: number, updates: Partial<{
  name: string;
  parameter: string;
  condition: string;
  threshold: number;
  unit: string;
  severity: string;
  enabled: boolean;
  email_notifications: boolean;
  email_recipients: string | null;
  last_triggered_at: string;
  trigger_count: number;
}>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) { fields.push(`name = $${paramIndex++}`); values.push(updates.name); }
  if (updates.parameter !== undefined) { fields.push(`parameter = $${paramIndex++}`); values.push(updates.parameter); }
  if (updates.condition !== undefined) { fields.push(`condition = $${paramIndex++}`); values.push(updates.condition); }
  if (updates.threshold !== undefined) { fields.push(`threshold = $${paramIndex++}`); values.push(updates.threshold); }
  if (updates.unit !== undefined) { fields.push(`unit = $${paramIndex++}`); values.push(updates.unit); }
  if (updates.severity !== undefined) { fields.push(`severity = $${paramIndex++}`); values.push(updates.severity); }
  if (updates.enabled !== undefined) { fields.push(`enabled = $${paramIndex++}`); values.push(updates.enabled); }
  if (updates.email_notifications !== undefined) { fields.push(`email_notifications = $${paramIndex++}`); values.push(updates.email_notifications); }
  if (updates.email_recipients !== undefined) { fields.push(`email_recipients = $${paramIndex++}`); values.push(updates.email_recipients); }
  if (updates.last_triggered_at !== undefined) { fields.push(`last_triggered_at = $${paramIndex++}`); values.push(updates.last_triggered_at); }
  if (updates.trigger_count !== undefined) { fields.push(`trigger_count = $${paramIndex++}`); values.push(updates.trigger_count); }
  if ((updates as any).stale_minutes !== undefined) { fields.push(`stale_minutes = $${paramIndex++}`); values.push((updates as any).stale_minutes); }

  if (fields.length === 0) return;

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query(`UPDATE alarms SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values);
  pgLog.info(`Updated alarm ${id}`);
}

export async function pgDeleteAlarm(id: number): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  // Delete related alarm_events first (FK constraint may lack CASCADE)
  await pool.query('DELETE FROM alarm_events WHERE alarm_id = $1', [id]);
  await pool.query('DELETE FROM alarms WHERE id = $1', [id]);
  pgLog.info(`Deleted alarm ${id} and its events`);
}

export async function pgTriggerAlarm(alarmId: number, triggeredValue: number, message?: string): Promise<number> {
  const alarm = await pgGetAlarmById(alarmId);
  if (!alarm) throw new Error(`Alarm ${alarmId} not found`);

  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `INSERT INTO alarm_events (alarm_id, station_id, triggered_value, message)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [alarmId, alarm.station_id, triggeredValue, message || null]
  );

  await pool.query(
    `UPDATE alarms SET last_triggered_at = CURRENT_TIMESTAMP, trigger_count = COALESCE(trigger_count, 0) + 1 WHERE id = $1`,
    [alarmId]
  );

  const eventId = result.rows[0].id;
  pgLog.warn(`Alarm ${alarmId} triggered with value ${triggeredValue}, event ${eventId}`);
  return eventId;
}

export async function pgGetAlarmEvents(alarmId?: number, stationId?: number, limit: number = 100): Promise<PgAlarmEvent[]> {
  let query = 'SELECT * FROM alarm_events';
  const conditions: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (alarmId !== undefined) {
    conditions.push(`alarm_id = $${paramIndex++}`);
    params.push(alarmId);
  }
  if (stationId !== undefined) {
    conditions.push(`station_id = $${paramIndex++}`);
    params.push(stationId);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(query, params);
  return result.rows.map((row: any) => ({
    id: row.id,
    alarm_id: row.alarm_id,
    station_id: row.station_id,
    triggered_value: row.triggered_value,
    message: row.message,
    acknowledged: row.acknowledged || false,
    acknowledged_by: row.acknowledged_by,
    acknowledged_at: row.acknowledged_at?.toISOString() ?? null,
    created_at: row.created_at?.toISOString() || new Date().toISOString(),
  }));
}

export async function pgAcknowledgeAlarmEvent(eventId: number, acknowledgedBy: string): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query(
    `UPDATE alarm_events SET acknowledged = true, acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [acknowledgedBy, eventId]
  );
  pgLog.info(`Alarm event ${eventId} acknowledged by ${acknowledgedBy}`);
}

export async function pgDeleteAlarmEvent(eventId: number): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query('DELETE FROM alarm_events WHERE id = $1', [eventId]);
  pgLog.info(`Deleted alarm event ${eventId}`);
}

export async function pgCleanupOldAlarmEvents(daysToKeep: number = 30): Promise<number> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `DELETE FROM alarm_events WHERE created_at < NOW() - INTERVAL '1 day' * $1 RETURNING id`,
    [daysToKeep]
  );
  const count = result.rowCount || 0;
  if (count > 0) pgLog.info(`Cleaned up ${count} alarm events older than ${daysToKeep} days`);
  return count;
}

// ── Organization CRUD ──────────────────────────────────────────────

export async function pgGetAllOrganizations(): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query('SELECT * FROM organizations ORDER BY created_at DESC');
  return result.rows;
}

export async function pgGetOrganizationById(id: number): Promise<any | null> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query('SELECT * FROM organizations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function pgCreateOrganization(name: string, slug: string, description: string | null, ownerId: string, logoUrl?: string | null): Promise<number> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `INSERT INTO organizations (name, slug, description, owner_id, logo_url) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, slug, description, ownerId, logoUrl || null]
  );
  pgLog.info(`Created organization ${result.rows[0].id}: ${name}`);
  return result.rows[0].id;
}

export async function pgUpdateOrganization(id: number, data: { name?: string; description?: string; logoUrl?: string | null }): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
  if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
  if (data.logoUrl !== undefined) { fields.push(`logo_url = $${idx++}`); values.push(data.logoUrl); }
  if (fields.length === 0) return;
  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);
  await pool.query(`UPDATE organizations SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

export async function pgDeleteOrganization(id: number): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query('DELETE FROM organizations WHERE id = $1', [id]);
  pgLog.info(`Deleted organization ${id}`);
}

export async function pgGetOrganizationMembers(orgId: number): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `SELECT om.*, u.email, u.first_name, u.last_name 
     FROM organization_members om 
     LEFT JOIN users u ON om.user_id = u.email 
     WHERE om.organization_id = $1 ORDER BY om.created_at`,
    [orgId]
  );
  return result.rows;
}

export async function pgAddOrganizationMember(orgId: number, userId: string, role: string): Promise<number> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3) 
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = $3 RETURNING id`,
    [orgId, userId, role]
  );
  return result.rows[0].id;
}

export async function pgUpdateMemberRole(orgId: number, userId: string, role: string): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query(
    `UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND user_id = $3`,
    [role, orgId, userId]
  );
}

export async function pgRemoveOrganizationMember(orgId: number, userId: string): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query(
    `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
    [orgId, userId]
  );
}

export async function pgIsOrganizationAdmin(orgId: number, userId: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
    [orgId, userId]
  );
  return result.rows.length > 0 && result.rows[0].role === 'admin';
}

export async function pgGetOrganizationInvitations(orgId: number): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `SELECT * FROM organization_invitations WHERE organization_id = $1 ORDER BY created_at DESC`,
    [orgId]
  );
  return result.rows;
}

export async function pgCreateOrganizationInvitation(orgId: number, email: string, role: string): Promise<string> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const token = require('crypto').randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await pool.query(
    `INSERT INTO organization_invitations (organization_id, email, role, token, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [orgId, email, role, token, expiresAt]
  );
  return token;
}

export async function pgGetUserOrganizations(userId: string): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    `SELECT o.* FROM organizations o 
     JOIN organization_members om ON o.id = om.organization_id 
     WHERE om.user_id = $1 
     ORDER BY o.created_at DESC`,
    [userId]
  );
  return result.rows;
}

// ── Share / Dashboard Sharing CRUD ──────────────────────────────────

export async function pgCreateShare(share: {
  station_id: number;
  share_token: string;
  name: string;
  email?: string;
  access_level: string;
  password?: string;
  expires_at?: string;
  is_active: boolean;
  access_count: number;
  created_by: string;
}): Promise<string> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query(
    `INSERT INTO shares (station_id, share_token, name, email, access_level, password, expires_at, is_active, access_count, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      share.station_id,
      share.share_token,
      share.name || 'Shared Dashboard',
      share.email || null,
      share.access_level || 'viewer',
      share.password || null,
      share.expires_at || null,
      share.is_active,
      share.access_count || 0,
      share.created_by || 'admin',
    ]
  );
  return share.share_token;
}

export async function pgGetShareByToken(token: string): Promise<any | null> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query('SELECT * FROM shares WHERE share_token = $1', [token]);
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

export async function pgGetSharesByStation(stationId: number): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const result = await pool.query(
    'SELECT * FROM shares WHERE station_id = $1 ORDER BY created_at DESC',
    [stationId]
  );
  return result.rows;
}

export async function pgUpdateShare(shareToken: string, updates: Record<string, any>): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const setClauses: string[] = [];
  const values: any[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${i}`);
      values.push(value);
      i++;
    }
  }
  if (setClauses.length === 0) return;
  setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(shareToken);
  await pool.query(
    `UPDATE shares SET ${setClauses.join(', ')} WHERE share_token = $${i}`,
    values
  );
}

export async function pgDeleteShare(shareToken: string): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  await pool.query('DELETE FROM shares WHERE share_token = $1', [shareToken]);
}

export default {
  isPostgresEnabled,
  initPostgresDatabase,
  closePostgresDatabase,
  getPool,
  query,
  getClient,
  getAllStations,
  getStationById,
  createStation,
  updateStation,
  deleteStation,
  insertWeatherData,
  getWeatherData,
  getLatestWeatherData,
  getDistinctTableNames,
  getUserByEmail,
  createUser,
  updateUserLastLogin,
  getAllDropboxConfigs,
  getDropboxConfigById,
  createDropboxConfig,
  updateDropboxConfig,
  deleteDropboxConfig,
  updateDropboxConfigSyncStatus,
  // Password reset
  createPasswordResetToken,
  validatePasswordResetToken,
  markPasswordResetTokenUsed,
  // User invitation
  createUserInvitationToken,
  validateUserInvitationToken,
  markUserInvitationTokenUsed,
  updateUserPassword,
  updateUserProfile,
  // Settings
  getSetting,
  setSetting,
  getAllSettings,
  // User preferences
  getUserPreferences,
  upsertUserPreferences,
  // Alarms
  pgCreateAlarm,
  pgGetAlarmById,
  pgGetAlarmsByStation,
  pgGetAllAlarms,
  pgUpdateAlarm,
  pgDeleteAlarm,
  pgTriggerAlarm,
  pgGetAlarmEvents,
  pgAcknowledgeAlarmEvent,
  pgDeleteAlarmEvent,
  pgCleanupOldAlarmEvents,
  // Organizations
  pgGetAllOrganizations,
  pgGetOrganizationById,
  pgCreateOrganization,
  pgUpdateOrganization,
  pgDeleteOrganization,
  pgGetOrganizationMembers,
  pgAddOrganizationMember,
  pgUpdateMemberRole,
  pgRemoveOrganizationMember,
  pgIsOrganizationAdmin,
  pgGetOrganizationInvitations,
  pgCreateOrganizationInvitation,
  pgGetUserOrganizations,
  // Shares
  pgCreateShare,
  pgGetShareByToken,
  pgGetSharesByStation,
  pgUpdateShare,
  pgDeleteShare,
};
