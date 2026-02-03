/**
 * Unified Database Module
 * 
 * Automatically selects between SQLite and PostgreSQL based on environment:
 * - If DATABASE_URL is set: Use PostgreSQL (for cloud/managed database deployments)
 * - If DATABASE_URL is not set: Use SQLite (for local/portable deployments)
 * 
 * This provides a seamless transition path from SQLite to PostgreSQL
 * without changing application code.
 */

import { isPostgresMode } from './db-postgres';

// Type definitions for database operations
export interface Station {
  id: number;
  name: string;
  pakbus_address: number;
  connection_type: string;
  connection_config: string;
  security_code?: number;
  created_at: string;
  updated_at: string;
  last_connected?: string;
  is_active: number;
  location?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  datalogger_model?: string;
  datalogger_serial_number?: string;
  program_name?: string;
  modem_model?: string;
  modem_serial_number?: string;
  site_description?: string;
  notes?: string;
  installation_team?: string;
  station_admin?: string;
  station_admin_email?: string;
  station_admin_phone?: string;
  image_url?: string;
}

export interface WeatherData {
  id: number;
  station_id: number;
  timestamp: string;
  record_number?: number;
  battery_voltage?: number;
  panel_temperature?: number;
  air_temperature?: number;
  relative_humidity?: number;
  wind_speed?: number;
  wind_direction?: number;
  solar_radiation?: number;
  rainfall?: number;
  barometric_pressure?: number;
  soil_moisture?: number;
  soil_temperature?: number;
  raw_data?: string;
  created_at: string;
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name?: string;
  password_hash: string;
  role: string;
  station_permissions?: string;
  created_at: string;
  updated_at: string;
  is_active: number;
  last_login?: string;
}

export interface DropboxConfig {
  id: number;
  station_id: number;
  dropbox_path: string;
  file_pattern: string;
  sync_interval: number;
  last_sync?: string;
  last_sync_status?: string;
  created_at: string;
  updated_at: string;
  is_active: number;
  sync_enabled: number;
}

// Database mode detection
const usePostgres = isPostgresMode();

// Log which database mode is being used
console.log(`[Database] Mode: ${usePostgres ? 'PostgreSQL' : 'SQLite'}`);
if (usePostgres) {
  console.log(`[Database] PostgreSQL connection configured via DATABASE_URL`);
}

// Dynamic imports based on database mode
let dbModule: any = null;

/**
 * Initialize the database
 * Automatically selects SQLite or PostgreSQL based on DATABASE_URL
 */
export async function initDatabase(): Promise<any> {
  if (usePostgres) {
    const pgModule = await import('./db-postgres');
    dbModule = pgModule;
    return pgModule.initPostgresDatabase();
  } else {
    const sqliteModule = await import('./db');
    dbModule = sqliteModule;
    return sqliteModule.initDatabase();
  }
}

/**
 * Get all stations
 */
export function getAllStations(): Station[] {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getAllStations();
}

/**
 * Get station by ID
 */
export function getStationById(id: number): Station | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getStationById(id);
}

/**
 * Create a new station
 */
export function createStation(stationData: Partial<Station>): Station {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.createStation(stationData);
}

/**
 * Update a station
 */
export function updateStation(id: number, updates: Partial<Station>): Station | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.updateStation(id, updates);
}

/**
 * Delete a station
 */
export function deleteStation(id: number): boolean {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.deleteStation(id);
}

/**
 * Insert weather data
 */
export function insertWeatherData(stationId: number, data: Partial<WeatherData>[]): number {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.insertWeatherData(stationId, data);
}

/**
 * Get weather data for a station
 */
export function getWeatherData(
  stationId: number,
  options?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }
): WeatherData[] {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getWeatherData(stationId, options);
}

/**
 * Get latest weather data for a station
 */
export function getLatestWeatherData(stationId: number): WeatherData | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getLatestWeatherData(stationId);
}

/**
 * Get user by email
 */
export function getUserByEmail(email: string): User | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getUserByEmail(email);
}

/**
 * Get user by ID
 */
export function getUserById(id: number): User | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getUserById(id);
}

/**
 * Create a new user
 */
export function createUser(
  email: string,
  firstName: string,
  lastName: string | null,
  passwordHash: string,
  role: string,
  stationPermissions: number[]
): User {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.createUser(email, firstName, lastName, passwordHash, role, stationPermissions);
}

/**
 * Update user
 */
export function updateUser(id: number, updates: Partial<User>): User | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.updateUser(id, updates);
}

/**
 * Get all active users
 */
export function getAllActiveUsers(): User[] {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getAllActiveUsers();
}

/**
 * Get all Dropbox configs
 */
export function getAllDropboxConfigs(): DropboxConfig[] {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getAllDropboxConfigs();
}

/**
 * Get Dropbox config for a station
 */
export function getDropboxConfigByStationId(stationId: number): DropboxConfig | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.getDropboxConfigByStationId(stationId);
}

/**
 * Create Dropbox config
 */
export function createDropboxConfig(config: Partial<DropboxConfig>): DropboxConfig {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.createDropboxConfig(config);
}

/**
 * Update Dropbox config sync status
 */
export function updateDropboxConfigSyncStatus(
  id: number,
  status: string,
  timestamp?: string
): void {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.updateDropboxConfigSyncStatus(id, status, timestamp);
}

/**
 * Update Dropbox config
 */
export function updateDropboxConfig(id: number, updates: Partial<DropboxConfig>): DropboxConfig | undefined {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.updateDropboxConfig(id, updates);
}

/**
 * Delete Dropbox config
 */
export function deleteDropboxConfig(id: number): boolean {
  if (!dbModule) throw new Error('Database not initialized');
  return dbModule.deleteDropboxConfig(id);
}

/**
 * Get database mode
 */
export function getDatabaseMode(): 'sqlite' | 'postgresql' {
  return usePostgres ? 'postgresql' : 'sqlite';
}

/**
 * Check if using PostgreSQL
 */
export function isUsingPostgres(): boolean {
  return usePostgres;
}

// Re-export for backward compatibility
export { saveDatabase } from './db';
