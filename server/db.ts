/// <reference types="node" />
/**
 * Local SQLite Database Module
 * Uses sql.js for a pure JavaScript SQLite implementation
 * No native compilation required - perfect for Electron apps
 */

import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let db: Database | null = null;
const DB_FILE = 'stratus.db';

/**
 * Get the database file path
 * Uses standard app data location for the platform
 */
function getDbPath(): string {
  // Use platform-appropriate app data location
  const platform = process.platform;
  let appDataPath: string;
  
  if (platform === 'win32') {
    appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    appDataPath = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }
  
  const stratusPath = path.join(appDataPath, 'Stratus Weather Server');
  return path.join(stratusPath, DB_FILE);
}

/**
 * Initialize the database connection
 */
export async function initDatabase(): Promise<Database> {
  if (db) return db;

  const SQL = await initSqlJs();
  const dbPath = getDbPath();

  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    // Run migrations for existing databases
    await runMigrations(db);
  } else {
    db = new SQL.Database();
    await createTables(db);
  }

  return db;
}

/**
 * Run database migrations for existing databases
 */
async function runMigrations(database: Database): Promise<void> {
  // Add personnel columns if they don't exist
  const columns = ['installation_team', 'station_admin', 'station_admin_email', 'station_admin_phone'];
  for (const col of columns) {
    try {
      database.run(`ALTER TABLE stations ADD COLUMN ${col} TEXT`);
    } catch (e) {
      // Column already exists, ignore
    }
  }
}

/**
 * Create database tables
 */
async function createTables(database: Database): Promise<void> {
  // Stations table
  database.run(`
    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pakbus_address INTEGER NOT NULL,
      connection_type TEXT NOT NULL,
      connection_config TEXT NOT NULL,
      security_code INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_connected DATETIME,
      is_active INTEGER DEFAULT 1,
      installation_team TEXT,
      station_admin TEXT,
      station_admin_email TEXT,
      station_admin_phone TEXT
    )
  `);

  // Table definitions cache
  database.run(`
    CREATE TABLE IF NOT EXISTS table_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL,
      table_number INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      columns TEXT NOT NULL,
      record_interval INTEGER,
      cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
    )
  `);

  // Weather data table
  database.run(`
    CREATE TABLE IF NOT EXISTS weather_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      record_number INTEGER,
      timestamp DATETIME NOT NULL,
      data TEXT NOT NULL,
      collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
    )
  `);

  // Create index for faster queries
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_weather_data_station_time 
    ON weather_data(station_id, timestamp)
  `);

  // Collection schedules table
  database.run(`
    CREATE TABLE IF NOT EXISTS collection_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL,
      table_name TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      last_collection DATETIME,
      next_collection DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
    )
  `);

  // Programs table (for CRBasic programs)
  database.run(`
    CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_running INTEGER DEFAULT 0,
      run_on_powerup INTEGER DEFAULT 0,
      uploaded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE SET NULL
    )
  `);

  // Alerts table
  database.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      is_acknowledged INTEGER DEFAULT 0,
      acknowledged_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
    )
  `);

  // Settings table
  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default settings
  database.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('theme', 'system'),
    ('autoConnect', 'true'),
    ('dataRetentionDays', '365'),
    ('defaultPakbusAddress', '1'),
    ('collectionTimeout', '30000')
  `);

  saveDatabase();
}

/**
 * Save database to disk
 */
export function saveDatabase(): void {
  if (!db) return;
  
  const data = db.export();
  const buffer = Buffer.from(data);
  const dbPath = getDbPath();
  
  fs.writeFileSync(dbPath, buffer);
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}

/**
 * Get database instance
 */
export function getDatabase(): Database | null {
  return db;
}

// ============ Station Operations ============

export interface Station {
  id?: number;
  name: string;
  pakbus_address: number;
  connection_type: string;
  connection_config: string;
  security_code?: number;
  created_at?: string;
  updated_at?: string;
  last_connected?: string;
  is_active?: number;
}

export function getAllStations(): Station[] {
  if (!db) return [];
  const result = db.exec('SELECT * FROM stations WHERE is_active = 1 ORDER BY name');
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    name: row[1] as string,
    pakbus_address: row[2] as number,
    connection_type: row[3] as string,
    connection_config: row[4] as string,
    security_code: row[5] as number | undefined,
    created_at: row[6] as string,
    updated_at: row[7] as string,
    last_connected: row[8] as string | undefined,
    is_active: row[9] as number
  }));
}

export function getStationById(id: number): Station | null {
  if (!db) return null;
  const result = db.exec('SELECT * FROM stations WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const row = result[0].values[0];
  return {
    id: row[0] as number,
    name: row[1] as string,
    pakbus_address: row[2] as number,
    connection_type: row[3] as string,
    connection_config: row[4] as string,
    security_code: row[5] as number | undefined,
    created_at: row[6] as string,
    updated_at: row[7] as string,
    last_connected: row[8] as string | undefined,
    is_active: row[9] as number
  };
}

export function createStation(station: Station): number {
  if (!db) throw new Error('Database not initialized');
  
  db.run(
    `INSERT INTO stations (name, pakbus_address, connection_type, connection_config, security_code) 
     VALUES (?, ?, ?, ?, ?)`,
    [station.name, station.pakbus_address, station.connection_type, station.connection_config, station.security_code || null]
  );
  
  const result = db.exec('SELECT last_insert_rowid()');
  const id = result[0].values[0][0] as number;
  
  saveDatabase();
  return id;
}

export function updateStation(id: number, station: Partial<Station>): void {
  if (!db) throw new Error('Database not initialized');
  
  const fields: string[] = [];
  const values: any[] = [];
  
  if (station.name !== undefined) { fields.push('name = ?'); values.push(station.name); }
  if (station.pakbus_address !== undefined) { fields.push('pakbus_address = ?'); values.push(station.pakbus_address); }
  if (station.connection_type !== undefined) { fields.push('connection_type = ?'); values.push(station.connection_type); }
  if (station.connection_config !== undefined) { fields.push('connection_config = ?'); values.push(station.connection_config); }
  if (station.security_code !== undefined) { fields.push('security_code = ?'); values.push(station.security_code); }
  if (station.last_connected !== undefined) { fields.push('last_connected = ?'); values.push(station.last_connected); }
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  db.run(`UPDATE stations SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDatabase();
}

export function deleteStation(id: number): void {
  if (!db) throw new Error('Database not initialized');
  db.run('UPDATE stations SET is_active = 0 WHERE id = ?', [id]);
  saveDatabase();
}

// ============ Weather Data Operations ============

export interface WeatherRecord {
  id?: number;
  station_id: number;
  table_name: string;
  record_number?: number;
  timestamp: string;
  data: string;
  collected_at?: string;
}

export function insertWeatherData(records: WeatherRecord[]): void {
  if (!db || records.length === 0) return;
  
  const stmt = db.prepare(
    `INSERT INTO weather_data (station_id, table_name, record_number, timestamp, data) 
     VALUES (?, ?, ?, ?, ?)`
  );
  
  for (const record of records) {
    stmt.run([record.station_id, record.table_name, record.record_number || null, record.timestamp, record.data]);
  }
  
  stmt.free();
  saveDatabase();
}

export function getWeatherData(
  stationId: number, 
  tableName: string, 
  startTime?: string, 
  endTime?: string,
  limit?: number
): WeatherRecord[] {
  if (!db) return [];
  
  let query = 'SELECT * FROM weather_data WHERE station_id = ? AND table_name = ?';
  const params: any[] = [stationId, tableName];
  
  if (startTime) {
    query += ' AND timestamp >= ?';
    params.push(startTime);
  }
  
  if (endTime) {
    query += ' AND timestamp <= ?';
    params.push(endTime);
  }
  
  query += ' ORDER BY timestamp DESC';
  
  if (limit) {
    query += ' LIMIT ?';
    params.push(limit);
  }
  
  const result = db.exec(query, params);
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    station_id: row[1] as number,
    table_name: row[2] as string,
    record_number: row[3] as number | undefined,
    timestamp: row[4] as string,
    data: row[5] as string,
    collected_at: row[6] as string
  }));
}

export function getLatestWeatherData(stationId: number, tableName: string): WeatherRecord | null {
  const records = getWeatherData(stationId, tableName, undefined, undefined, 1);
  return records.length > 0 ? records[0] : null;
}

// ============ Settings Operations ============

export function getSetting(key: string): string | null {
  if (!db) return null;
  const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  return result[0].values[0][0] as string;
}

export function setSetting(key: string, value: string): void {
  if (!db) throw new Error('Database not initialized');
  db.run(
    'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    [key, value]
  );
  saveDatabase();
}

export function getAllSettings(): Record<string, string> {
  if (!db) return {};
  const result = db.exec('SELECT key, value FROM settings');
  if (result.length === 0) return {};
  
  const settings: Record<string, string> = {};
  for (const row of result[0].values) {
    settings[row[0] as string] = row[1] as string;
  }
  return settings;
}

// ============ Alerts Operations ============

export interface Alert {
  id?: number;
  station_id?: number;
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  is_acknowledged?: number;
  acknowledged_at?: string;
  created_at?: string;
}

export function createAlert(alert: Alert): number {
  if (!db) throw new Error('Database not initialized');
  
  db.run(
    `INSERT INTO alerts (station_id, type, severity, message) VALUES (?, ?, ?, ?)`,
    [alert.station_id || null, alert.type, alert.severity, alert.message]
  );
  
  const result = db.exec('SELECT last_insert_rowid()');
  const id = result[0].values[0][0] as number;
  
  saveDatabase();
  return id;
}

export function getActiveAlerts(stationId?: number): Alert[] {
  if (!db) return [];
  
  let query = 'SELECT * FROM alerts WHERE is_acknowledged = 0';
  const params: any[] = [];
  
  if (stationId !== undefined) {
    query += ' AND station_id = ?';
    params.push(stationId);
  }
  
  query += ' ORDER BY created_at DESC';
  
  const result = db.exec(query, params);
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    station_id: row[1] as number | undefined,
    type: row[2] as string,
    severity: row[3] as 'info' | 'warning' | 'error' | 'critical',
    message: row[4] as string,
    is_acknowledged: row[5] as number,
    acknowledged_at: row[6] as string | undefined,
    created_at: row[7] as string
  }));
}

export function acknowledgeAlert(id: number): void {
  if (!db) throw new Error('Database not initialized');
  db.run(
    'UPDATE alerts SET is_acknowledged = 1, acknowledged_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id]
  );
  saveDatabase();
}

// Export database module
export default {
  initDatabase,
  saveDatabase,
  closeDatabase,
  getDatabase,
  getAllStations,
  getStationById,
  createStation,
  updateStation,
  deleteStation,
  insertWeatherData,
  getWeatherData,
  getLatestWeatherData,
  getSetting,
  setSetting,
  getAllSettings,
  createAlert,
  getActiveAlerts,
  acknowledgeAlert
};
