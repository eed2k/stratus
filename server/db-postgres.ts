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
      station_type TEXT DEFAULT 'http'
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
      parameter TEXT NOT NULL,
      condition TEXT NOT NULL,
      threshold REAL NOT NULL,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
           site_description, notes, station_image, protocol, station_type
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
           site_description, notes, station_image, protocol, station_type
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
  };
}

/**
 * Create a new station
 */
export async function createStation(station: Station): Promise<number> {
  const result = await query(`
    INSERT INTO stations (name, pakbus_address, connection_type, connection_config,
      security_code, is_active, latitude, longitude, altitude, location,
      datalogger_model, datalogger_serial_number, program_name, modem_model,
      modem_serial_number, site_description, notes, station_image, protocol, station_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING id
  `, [
    station.name,
    station.pakbusAddress || 1,
    station.connectionType || 'http',
    JSON.stringify(station.connectionConfig || {}),
    station.securityCode || null,
    station.isActive !== false,
    station.latitude || null,
    station.longitude || null,
    station.altitude || null,
    station.location || null,
    station.dataloggerModel || null,
    station.dataloggerSerialNumber || null,
    station.programName || null,
    station.modemModel || null,
    station.modemSerialNumber || null,
    station.siteDescription || null,
    station.notes || null,
    station.stationImage || null,
    station.protocol || 'pakbus',
    station.stationType || 'http',
  ]);
  
  return result.rows[0].id;
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
  await query('DELETE FROM stations WHERE id = $1', [id]);
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
      // Check for duplicate
      const existing = await client.query(`
        SELECT id FROM weather_data 
        WHERE station_id = $1 AND timestamp = $2
        LIMIT 1
      `, [record.stationId, record.timestamp]);
      
      if (existing.rows.length === 0) {
        await client.query(`
          INSERT INTO weather_data (station_id, table_name, record_number, timestamp, data)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          record.stationId,
          record.tableName,
          record.recordNumber || null,
          record.timestamp,
          JSON.stringify(record.data),
        ]);
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
  
  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) as count FROM weather_data WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);
  
  // Get records
  let queryText = `
    SELECT id, station_id, table_name, record_number, timestamp, data, collected_at
    FROM weather_data
    WHERE ${whereClause}
    ORDER BY timestamp DESC
  `;
  
  if (options.limit) {
    queryText += ` LIMIT $${paramIndex}`;
    params.push(options.limit);
    paramIndex++;
  }
  
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
    })),
    total,
  };
}

/**
 * Get latest weather data for a station
 */
export async function getLatestWeatherData(stationId: number, tableName: string): Promise<WeatherRecord | null> {
  const result = await query(`
    SELECT id, station_id, table_name, record_number, timestamp, data, collected_at
    FROM weather_data
    WHERE station_id = $1 AND table_name = $2
    ORDER BY timestamp DESC
    LIMIT 1
  `, [stationId, tableName]);
  
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
  };
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
  getUserByEmail,
  createUser,
  updateUserLastLogin,
  getAllDropboxConfigs,
  updateDropboxConfigSyncStatus,
};
