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

// Simple logger for database operations
const dbLog = {
  info: (message: string, ...args: any[]) => console.log(`[DB] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[DB] WARNING: ${message}`, ...args),
  error: (message: string, error?: any) => {
    console.error(`[DB] ERROR: ${message}`);
    if (error) console.error(`[DB] Details:`, error instanceof Error ? error.message : error);
  }
};

// Whitelist of valid column names for SQL safety
const VALID_STATION_COLUMNS = new Set([
  'id', 'name', 'pakbus_address', 'connection_type', 'connection_config', 
  'security_code', 'created_at', 'updated_at', 'last_connected', 'is_active',
  'location', 'latitude', 'longitude', 'altitude', 'datalogger_model',
  'datalogger_serial_number', 'program_name', 'modem_model', 'modem_serial_number',
  'site_description', 'notes', 'installation_team', 'station_admin',
  'station_admin_email', 'station_admin_phone'
]);

/**
 * Validates a column name against whitelist to prevent SQL injection
 */
function validateColumnName(column: string): boolean {
  return VALID_STATION_COLUMNS.has(column);
}

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
  dbLog.info('Running database migrations...');
  
  // Add personnel columns if they don't exist
  const columns = ['installation_team', 'station_admin', 'station_admin_email', 'station_admin_phone'];
  for (const col of columns) {
    try {
      database.run(`ALTER TABLE stations ADD COLUMN ${col} TEXT`);
      dbLog.info(`Added column: ${col}`);
    } catch (e) {
      // Column already exists, this is expected
    }
  }

  // Add location columns if they don't exist
  const locationColumns = ['latitude', 'longitude', 'altitude'];
  for (const col of locationColumns) {
    try {
      database.run(`ALTER TABLE stations ADD COLUMN ${col} REAL`);
      dbLog.info(`Added column: ${col}`);
    } catch (e) {
      // Column already exists, this is expected
    }
  }

  // Add equipment and description columns if they don't exist
  const textColumns = [
    'location', 'datalogger_model', 'datalogger_serial_number', 'program_name',
    'modem_model', 'modem_serial_number', 'site_description', 'notes'
  ];
  for (const col of textColumns) {
    try {
      database.run(`ALTER TABLE stations ADD COLUMN ${col} TEXT`);
      dbLog.info(`Added column: ${col}`);
    } catch (e) {
      // Column already exists, this is expected
    }
  }

  // Add organizations table if it doesn't exist
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        description TEXT,
        owner_id TEXT DEFAULT 'local-user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    dbLog.info('Organizations table ready');
  } catch (e) {
    dbLog.error('Failed to create organizations table', e);
  }

  // Add organization members table if it doesn't exist
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS organization_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);
    dbLog.info('Organization members table ready');
  } catch (e) {
    dbLog.error('Failed to create organization_members table', e);
  }

  // Add organization invitations table if it doesn't exist
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS organization_invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);
    dbLog.info('Organization invitations table ready');
  } catch (e) {
    dbLog.error('Failed to create organization_invitations table', e);
  }

  // Add shares table for dashboard sharing
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_id INTEGER NOT NULL,
        share_token TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT 'Shared Dashboard',
        email TEXT,
        access_level TEXT DEFAULT 'viewer',
        password TEXT,
        expires_at DATETIME,
        is_active INTEGER DEFAULT 1,
        last_accessed_at DATETIME,
        access_count INTEGER DEFAULT 0,
        created_by TEXT DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
      )
    `);
    dbLog.info('Shares table ready');
  } catch (e) {
    dbLog.error('Failed to create shares table', e);
  }

  // Add alarms table for persistent alarm storage (Issue #10 fix)
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS alarms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_id INTEGER NOT NULL,
        parameter TEXT NOT NULL,
        condition TEXT NOT NULL,
        threshold REAL NOT NULL,
        severity TEXT DEFAULT 'warning',
        enabled INTEGER DEFAULT 1,
        email_notifications INTEGER DEFAULT 0,
        email_recipients TEXT,
        last_triggered_at DATETIME,
        trigger_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
      )
    `);
    dbLog.info('Alarms table ready');
  } catch (e) {
    dbLog.error('Failed to create alarms table', e);
  }

  // Add alarm_events table to track alarm history
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS alarm_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarm_id INTEGER NOT NULL,
        station_id INTEGER NOT NULL,
        triggered_value REAL,
        message TEXT,
        acknowledged INTEGER DEFAULT 0,
        acknowledged_by TEXT,
        acknowledged_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (alarm_id) REFERENCES alarms(id) ON DELETE CASCADE,
        FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
      )
    `);
    dbLog.info('Alarm events table ready');
  } catch (e) {
    dbLog.error('Failed to create alarm_events table', e);
  }

  saveDatabase();
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
      latitude REAL,
      longitude REAL,
      altitude REAL,
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

  // Organizations table for desktop multi-org support
  database.run(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE,
      description TEXT,
      owner_id TEXT DEFAULT 'local-user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Organization members table
  database.run(`
    CREATE TABLE IF NOT EXISTS organization_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    )
  `);

  // Organization invitations table
  database.run(`
    CREATE TABLE IF NOT EXISTS organization_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
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

  // Add missing columns to stations table (for upgrades from older versions)
  const addColumnIfNotExists = (columnName: string, columnType: string) => {
    try {
      // Check if column exists
      const tableInfo = database.exec('PRAGMA table_info(stations)');
      if (tableInfo.length > 0) {
        const columns = tableInfo[0].values.map((row: any) => row[1]);
        if (!columns.includes(columnName)) {
          database.run(`ALTER TABLE stations ADD COLUMN ${columnName} ${columnType}`);
        }
      }
    } catch (e) {
      // Column might already exist, ignore error
    }
  };

  // Equipment columns
  addColumnIfNotExists('location', 'TEXT');
  addColumnIfNotExists('datalogger_model', 'TEXT');
  addColumnIfNotExists('datalogger_serial_number', 'TEXT');
  addColumnIfNotExists('program_name', 'TEXT');
  addColumnIfNotExists('modem_model', 'TEXT');
  addColumnIfNotExists('modem_serial_number', 'TEXT');
  // Description columns
  addColumnIfNotExists('site_description', 'TEXT');
  addColumnIfNotExists('notes', 'TEXT');

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
  // Location fields
  location?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  // Equipment fields
  datalogger_model?: string;
  datalogger_serial_number?: string;
  program_name?: string;
  modem_model?: string;
  modem_serial_number?: string;
  // Description fields
  site_description?: string;
  notes?: string;
  // Personnel fields
  installation_team?: string;
  station_admin?: string;
  station_admin_email?: string;
  station_admin_phone?: string;
}

export function getAllStations(): Station[] {
  if (!db) return [];
  const result = db.exec(`SELECT id, name, pakbus_address, connection_type, connection_config, security_code, 
    created_at, updated_at, last_connected, is_active, location, latitude, longitude, altitude, 
    datalogger_model, datalogger_serial_number, program_name, modem_model, modem_serial_number,
    site_description, notes, installation_team, station_admin, station_admin_email, station_admin_phone 
    FROM stations WHERE is_active = 1 ORDER BY name`);
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
    is_active: row[9] as number,
    location: row[10] as string | undefined,
    latitude: row[11] as number | undefined,
    longitude: row[12] as number | undefined,
    altitude: row[13] as number | undefined,
    datalogger_model: row[14] as string | undefined,
    datalogger_serial_number: row[15] as string | undefined,
    program_name: row[16] as string | undefined,
    modem_model: row[17] as string | undefined,
    modem_serial_number: row[18] as string | undefined,
    site_description: row[19] as string | undefined,
    notes: row[20] as string | undefined,
    installation_team: row[21] as string | undefined,
    station_admin: row[22] as string | undefined,
    station_admin_email: row[23] as string | undefined,
    station_admin_phone: row[24] as string | undefined
  }));
}

export function getStationById(id: number): Station | null {
  if (!db) return null;
  const result = db.exec(`SELECT id, name, pakbus_address, connection_type, connection_config, security_code, 
    created_at, updated_at, last_connected, is_active, location, latitude, longitude, altitude, 
    datalogger_model, datalogger_serial_number, program_name, modem_model, modem_serial_number,
    site_description, notes, installation_team, station_admin, station_admin_email, station_admin_phone 
    FROM stations WHERE id = ?`, [id]);
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
    is_active: row[9] as number,
    location: row[10] as string | undefined,
    latitude: row[11] as number | undefined,
    longitude: row[12] as number | undefined,
    altitude: row[13] as number | undefined,
    datalogger_model: row[14] as string | undefined,
    datalogger_serial_number: row[15] as string | undefined,
    program_name: row[16] as string | undefined,
    modem_model: row[17] as string | undefined,
    modem_serial_number: row[18] as string | undefined,
    site_description: row[19] as string | undefined,
    notes: row[20] as string | undefined,
    installation_team: row[21] as string | undefined,
    station_admin: row[22] as string | undefined,
    station_admin_email: row[23] as string | undefined,
    station_admin_phone: row[24] as string | undefined
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
  // Location fields
  if (station.location !== undefined) { fields.push('location = ?'); values.push(station.location); }
  if (station.latitude !== undefined) { fields.push('latitude = ?'); values.push(station.latitude); }
  if (station.longitude !== undefined) { fields.push('longitude = ?'); values.push(station.longitude); }
  if (station.altitude !== undefined) { fields.push('altitude = ?'); values.push(station.altitude); }
  // Equipment fields
  if (station.datalogger_model !== undefined) { fields.push('datalogger_model = ?'); values.push(station.datalogger_model); }
  if (station.datalogger_serial_number !== undefined) { fields.push('datalogger_serial_number = ?'); values.push(station.datalogger_serial_number); }
  if (station.program_name !== undefined) { fields.push('program_name = ?'); values.push(station.program_name); }
  if (station.modem_model !== undefined) { fields.push('modem_model = ?'); values.push(station.modem_model); }
  if (station.modem_serial_number !== undefined) { fields.push('modem_serial_number = ?'); values.push(station.modem_serial_number); }
  // Description fields
  if (station.site_description !== undefined) { fields.push('site_description = ?'); values.push(station.site_description); }
  if (station.notes !== undefined) { fields.push('notes = ?'); values.push(station.notes); }
  // Personnel fields
  if (station.installation_team !== undefined) { fields.push('installation_team = ?'); values.push(station.installation_team); }
  if (station.station_admin !== undefined) { fields.push('station_admin = ?'); values.push(station.station_admin); }
  if (station.station_admin_email !== undefined) { fields.push('station_admin_email = ?'); values.push(station.station_admin_email); }
  if (station.station_admin_phone !== undefined) { fields.push('station_admin_phone = ?'); values.push(station.station_admin_phone); }
  
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

// ============ Organizations Operations ============

export interface OrganizationRecord {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface OrgMemberRecord {
  id: number;
  organization_id: number;
  user_id: string;
  role: string;
  created_at: string;
}

export interface OrgInvitationRecord {
  id: number;
  organization_id: number;
  email: string;
  role: string;
  token: string;
  expires_at?: string;
  created_at: string;
}

export function getAllOrganizations(): OrganizationRecord[] {
  if (!db) return [];
  const result = db.exec('SELECT * FROM organizations ORDER BY created_at DESC');
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    name: row[1] as string,
    slug: row[2] as string | undefined,
    description: row[3] as string | undefined,
    owner_id: row[4] as string,
    created_at: row[5] as string,
    updated_at: row[6] as string
  }));
}

export function getOrganizationById(id: number): OrganizationRecord | null {
  if (!db) return null;
  const result = db.exec('SELECT * FROM organizations WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const row = result[0].values[0];
  return {
    id: row[0] as number,
    name: row[1] as string,
    slug: row[2] as string | undefined,
    description: row[3] as string | undefined,
    owner_id: row[4] as string,
    created_at: row[5] as string,
    updated_at: row[6] as string
  };
}

export function createOrganization(name: string, description?: string, ownerId: string = 'local-user'): number {
  if (!db) throw new Error('Database not initialized');
  
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  
  db.run(
    `INSERT INTO organizations (name, slug, description, owner_id) VALUES (?, ?, ?, ?)`,
    [name, slug, description || null, ownerId]
  );
  
  const result = db.exec('SELECT last_insert_rowid()');
  const id = result[0].values[0][0] as number;
  
  saveDatabase();
  return id;
}

export function updateOrganization(id: number, data: { name?: string; description?: string }): void {
  if (!db) throw new Error('Database not initialized');
  
  const updates: string[] = [];
  const params: any[] = [];
  
  if (data.name !== undefined) {
    updates.push('name = ?');
    params.push(data.name);
    updates.push('slug = ?');
    params.push(data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    params.push(data.description);
  }
  
  if (updates.length === 0) return;
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  
  db.run(`UPDATE organizations SET ${updates.join(', ')} WHERE id = ?`, params);
  saveDatabase();
}

export function deleteOrganization(id: number): void {
  if (!db) throw new Error('Database not initialized');
  db.run('DELETE FROM organizations WHERE id = ?', [id]);
  saveDatabase();
}

export function getOrganizationMembers(orgId: number): OrgMemberRecord[] {
  if (!db) return [];
  const result = db.exec('SELECT * FROM organization_members WHERE organization_id = ?', [orgId]);
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    organization_id: row[1] as number,
    user_id: row[2] as string,
    role: row[3] as string,
    created_at: row[4] as string
  }));
}

export function addOrganizationMember(orgId: number, userId: string, role: string = 'member'): number {
  if (!db) throw new Error('Database not initialized');
  
  db.run(
    'INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, ?)',
    [orgId, userId, role]
  );
  
  const result = db.exec('SELECT last_insert_rowid()');
  const id = result[0].values[0][0] as number;
  
  saveDatabase();
  return id;
}

export function updateMemberRole(orgId: number, userId: string, role: string): void {
  if (!db) throw new Error('Database not initialized');
  db.run(
    'UPDATE organization_members SET role = ? WHERE organization_id = ? AND user_id = ?',
    [role, orgId, userId]
  );
  saveDatabase();
}

export function removeOrganizationMember(orgId: number, userId: string): void {
  if (!db) throw new Error('Database not initialized');
  db.run(
    'DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?',
    [orgId, userId]
  );
  saveDatabase();
}

export function getOrganizationInvitations(orgId: number): OrgInvitationRecord[] {
  if (!db) return [];
  const result = db.exec('SELECT * FROM organization_invitations WHERE organization_id = ?', [orgId]);
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    organization_id: row[1] as number,
    email: row[2] as string,
    role: row[3] as string,
    token: row[4] as string,
    expires_at: row[5] as string | undefined,
    created_at: row[6] as string
  }));
}

export function createOrganizationInvitation(orgId: number, email: string, role: string = 'member'): string {
  if (!db) throw new Error('Database not initialized');
  
  // Generate a simple token
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  
  db.run(
    'INSERT INTO organization_invitations (organization_id, email, role, token, expires_at) VALUES (?, ?, ?, ?, ?)',
    [orgId, email, role, token, expiresAt]
  );
  
  saveDatabase();
  return token;
}

// ============ Share Operations ============

export interface Share {
  id?: number;
  station_id: number;
  share_token: string;
  name: string;
  email?: string;
  access_level: string;
  password?: string;
  expires_at?: string;
  is_active: number;
  last_accessed_at?: string;
  access_count: number;
  created_by: string;
  created_at?: string;
  updated_at?: string;
}

export function createShare(share: Share): string {
  if (!db) throw new Error('Database not initialized');
  
  db.run(
    `INSERT INTO shares (station_id, share_token, name, email, access_level, password, expires_at, is_active, access_count, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      share.station_id,
      share.share_token,
      share.name || 'Shared Dashboard',
      share.email || null,
      share.access_level || 'viewer',
      share.password || null,
      share.expires_at || null,
      share.is_active !== undefined ? share.is_active : 1,
      share.access_count || 0,
      share.created_by || 'admin'
    ]
  );
  
  saveDatabase();
  return share.share_token;
}

export function getShareByToken(token: string): Share | null {
  if (!db) return null;
  const result = db.exec('SELECT * FROM shares WHERE share_token = ?', [token]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const row = result[0].values[0];
  return {
    id: row[0] as number,
    station_id: row[1] as number,
    share_token: row[2] as string,
    name: row[3] as string,
    email: row[4] as string | undefined,
    access_level: row[5] as string,
    password: row[6] as string | undefined,
    expires_at: row[7] as string | undefined,
    is_active: row[8] as number,
    last_accessed_at: row[9] as string | undefined,
    access_count: row[10] as number,
    created_by: row[11] as string,
    created_at: row[12] as string,
    updated_at: row[13] as string
  };
}

export function getSharesByStation(stationId: number): Share[] {
  if (!db) return [];
  const result = db.exec('SELECT * FROM shares WHERE station_id = ? ORDER BY created_at DESC', [stationId]);
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    station_id: row[1] as number,
    share_token: row[2] as string,
    name: row[3] as string,
    email: row[4] as string | undefined,
    access_level: row[5] as string,
    password: row[6] as string | undefined,
    expires_at: row[7] as string | undefined,
    is_active: row[8] as number,
    last_accessed_at: row[9] as string | undefined,
    access_count: row[10] as number,
    created_by: row[11] as string,
    created_at: row[12] as string,
    updated_at: row[13] as string
  }));
}

export function updateShare(token: string, updates: Partial<Share>): void {
  if (!db) throw new Error('Database not initialized');
  
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
  if (updates.access_level !== undefined) { fields.push('access_level = ?'); values.push(updates.access_level); }
  if (updates.password !== undefined) { fields.push('password = ?'); values.push(updates.password); }
  if (updates.expires_at !== undefined) { fields.push('expires_at = ?'); values.push(updates.expires_at); }
  if (updates.is_active !== undefined) { fields.push('is_active = ?'); values.push(updates.is_active); }
  if (updates.last_accessed_at !== undefined) { fields.push('last_accessed_at = ?'); values.push(updates.last_accessed_at); }
  if (updates.access_count !== undefined) { fields.push('access_count = ?'); values.push(updates.access_count); }
  
  if (fields.length === 0) return;
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(token);
  
  db.run(`UPDATE shares SET ${fields.join(', ')} WHERE share_token = ?`, values);
  saveDatabase();
}

export function deleteShare(token: string): void {
  if (!db) throw new Error('Database not initialized');
  db.run('DELETE FROM shares WHERE share_token = ?', [token]);
  saveDatabase();
}

// ============ Alarm Functions (Issue #10 fix - persistent alarms) ============

export interface Alarm {
  id?: number;
  station_id: number;
  parameter: string;
  condition: 'above' | 'below' | 'equal' | 'not_equal';
  threshold: number;
  severity?: 'info' | 'warning' | 'critical';
  enabled?: boolean;
  email_notifications?: boolean;
  email_recipients?: string;
  last_triggered_at?: string;
  trigger_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface AlarmEvent {
  id?: number;
  alarm_id: number;
  station_id: number;
  triggered_value?: number;
  message?: string;
  acknowledged?: boolean;
  acknowledged_by?: string;
  acknowledged_at?: string;
  created_at?: string;
}

export function createAlarm(alarm: Alarm): number {
  if (!db) throw new Error('Database not initialized');
  
  dbLog.info(`Creating alarm for station ${alarm.station_id}, parameter: ${alarm.parameter}`);
  
  db.run(
    `INSERT INTO alarms (station_id, parameter, condition, threshold, severity, enabled, email_notifications, email_recipients)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      alarm.station_id,
      alarm.parameter,
      alarm.condition,
      alarm.threshold,
      alarm.severity || 'warning',
      alarm.enabled !== false ? 1 : 0,
      alarm.email_notifications ? 1 : 0,
      alarm.email_recipients || null
    ]
  );
  
  saveDatabase();
  
  const result = db.exec('SELECT last_insert_rowid()');
  return result[0]?.values[0]?.[0] as number || 0;
}

export function getAlarmsByStation(stationId: number): Alarm[] {
  if (!db) return [];
  
  const result = db.exec('SELECT * FROM alarms WHERE station_id = ? ORDER BY created_at DESC', [stationId]);
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    station_id: row[1] as number,
    parameter: row[2] as string,
    condition: row[3] as Alarm['condition'],
    threshold: row[4] as number,
    severity: row[5] as Alarm['severity'],
    enabled: row[6] === 1,
    email_notifications: row[7] === 1,
    email_recipients: row[8] as string | undefined,
    last_triggered_at: row[9] as string | undefined,
    trigger_count: row[10] as number,
    created_at: row[11] as string,
    updated_at: row[12] as string
  }));
}

export function getAllAlarms(): Alarm[] {
  if (!db) return [];
  
  const result = db.exec('SELECT * FROM alarms ORDER BY created_at DESC');
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    station_id: row[1] as number,
    parameter: row[2] as string,
    condition: row[3] as Alarm['condition'],
    threshold: row[4] as number,
    severity: row[5] as Alarm['severity'],
    enabled: row[6] === 1,
    email_notifications: row[7] === 1,
    email_recipients: row[8] as string | undefined,
    last_triggered_at: row[9] as string | undefined,
    trigger_count: row[10] as number,
    created_at: row[11] as string,
    updated_at: row[12] as string
  }));
}

export function getAlarmById(id: number): Alarm | null {
  if (!db) return null;
  
  const result = db.exec('SELECT * FROM alarms WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const row = result[0].values[0];
  return {
    id: row[0] as number,
    station_id: row[1] as number,
    parameter: row[2] as string,
    condition: row[3] as Alarm['condition'],
    threshold: row[4] as number,
    severity: row[5] as Alarm['severity'],
    enabled: row[6] === 1,
    email_notifications: row[7] === 1,
    email_recipients: row[8] as string | undefined,
    last_triggered_at: row[9] as string | undefined,
    trigger_count: row[10] as number,
    created_at: row[11] as string,
    updated_at: row[12] as string
  };
}

export function updateAlarm(id: number, updates: Partial<Alarm>): void {
  if (!db) throw new Error('Database not initialized');
  
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.parameter !== undefined) { fields.push('parameter = ?'); values.push(updates.parameter); }
  if (updates.condition !== undefined) { fields.push('condition = ?'); values.push(updates.condition); }
  if (updates.threshold !== undefined) { fields.push('threshold = ?'); values.push(updates.threshold); }
  if (updates.severity !== undefined) { fields.push('severity = ?'); values.push(updates.severity); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if (updates.email_notifications !== undefined) { fields.push('email_notifications = ?'); values.push(updates.email_notifications ? 1 : 0); }
  if (updates.email_recipients !== undefined) { fields.push('email_recipients = ?'); values.push(updates.email_recipients); }
  if (updates.last_triggered_at !== undefined) { fields.push('last_triggered_at = ?'); values.push(updates.last_triggered_at); }
  if (updates.trigger_count !== undefined) { fields.push('trigger_count = ?'); values.push(updates.trigger_count); }
  
  if (fields.length === 0) return;
  
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  db.run(`UPDATE alarms SET ${fields.join(', ')} WHERE id = ?`, values);
  saveDatabase();
  
  dbLog.info(`Updated alarm ${id}`);
}

export function deleteAlarm(id: number): void {
  if (!db) throw new Error('Database not initialized');
  db.run('DELETE FROM alarms WHERE id = ?', [id]);
  saveDatabase();
  dbLog.info(`Deleted alarm ${id}`);
}

export function triggerAlarm(alarmId: number, triggeredValue: number, message?: string): number {
  if (!db) throw new Error('Database not initialized');
  
  const alarm = getAlarmById(alarmId);
  if (!alarm) throw new Error(`Alarm ${alarmId} not found`);
  
  // Record the alarm event
  db.run(
    `INSERT INTO alarm_events (alarm_id, station_id, triggered_value, message)
     VALUES (?, ?, ?, ?)`,
    [alarmId, alarm.station_id, triggeredValue, message || null]
  );
  
  // Update alarm trigger info
  db.run(
    `UPDATE alarms SET last_triggered_at = CURRENT_TIMESTAMP, trigger_count = trigger_count + 1 WHERE id = ?`,
    [alarmId]
  );
  
  saveDatabase();
  
  const result = db.exec('SELECT last_insert_rowid()');
  const eventId = result[0]?.values[0]?.[0] as number || 0;
  
  dbLog.warn(`Alarm ${alarmId} triggered with value ${triggeredValue}`);
  
  return eventId;
}

export function getAlarmEvents(alarmId?: number, stationId?: number, limit: number = 100): AlarmEvent[] {
  if (!db) return [];
  
  let query = 'SELECT * FROM alarm_events';
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (alarmId !== undefined) {
    conditions.push('alarm_id = ?');
    params.push(alarmId);
  }
  if (stationId !== undefined) {
    conditions.push('station_id = ?');
    params.push(stationId);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  
  const result = db.exec(query, params);
  if (result.length === 0) return [];
  
  return result[0].values.map((row: any[]) => ({
    id: row[0] as number,
    alarm_id: row[1] as number,
    station_id: row[2] as number,
    triggered_value: row[3] as number | undefined,
    message: row[4] as string | undefined,
    acknowledged: row[5] === 1,
    acknowledged_by: row[6] as string | undefined,
    acknowledged_at: row[7] as string | undefined,
    created_at: row[8] as string
  }));
}

export function acknowledgeAlarmEvent(eventId: number, acknowledgedBy: string): void {
  if (!db) throw new Error('Database not initialized');
  
  db.run(
    `UPDATE alarm_events SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [acknowledgedBy, eventId]
  );
  saveDatabase();
  
  dbLog.info(`Alarm event ${eventId} acknowledged by ${acknowledgedBy}`);
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
  acknowledgeAlert,
  getAllOrganizations,
  getOrganizationById,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getOrganizationMembers,
  addOrganizationMember,
  updateMemberRole,
  removeOrganizationMember,
  getOrganizationInvitations,
  createOrganizationInvitation,
  // Share functions
  createShare,
  getShareByToken,
  getSharesByStation,
  updateShare,
  deleteShare,
  // Alarm functions (Issue #10 fix)
  createAlarm,
  getAlarmById,
  getAlarmsByStation,
  getAllAlarms,
  updateAlarm,
  deleteAlarm,
  triggerAlarm,
  getAlarmEvents,
  acknowledgeAlarmEvent
};
