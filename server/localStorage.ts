/**
 * Local Storage Layer for Desktop App
 * Wraps the SQLite database operations with an interface compatible with the server routes
 * 
 * Supports both SQLite (local) and PostgreSQL (cloud) modes based on DATABASE_URL
 */

import db, { 
  Alarm as DbAlarm, 
  AlarmEvent as DbAlarmEvent,
  createAlarm as dbCreateAlarm,
  getAlarmById as dbGetAlarmById,
  getAlarmsByStation as dbGetAlarmsByStation,
  getAllAlarms as dbGetAllAlarms,
  updateAlarm as dbUpdateAlarm,
  deleteAlarm as dbDeleteAlarm,
  triggerAlarm as dbTriggerAlarm,
  getAlarmEvents as dbGetAlarmEvents,
  acknowledgeAlarmEvent as dbAcknowledgeAlarmEvent,
  deleteAlarmEvent as dbDeleteAlarmEventSqlite,
  cleanupOldAlarmEvents as dbCleanupOldAlarmEventsSqlite
} from './db';

import * as postgres from './db-postgres';
import { sendAlarmEmail, isEmailConfigured } from './services/emailService';
import type { AlarmEmailData } from './services/emailService';

// Check if PostgreSQL mode is enabled
const usePostgres = postgres.isPostgresEnabled();

// Storage logging utility (Issue #7 fix)
const storageLog = {
  info: (message: string, ...args: any[]) => console.log(`[Storage] ${message}`, ...args),
  warn: (message: string, ...args: any[]) => console.warn(`[Storage] WARNING: ${message}`, ...args),
  error: (message: string, error?: any) => {
    console.error(`[Storage] ERROR: ${message}`, error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error(`[Storage] Stack: ${error.stack}`);
    }
  }
};

// Types for the local desktop app
export interface WeatherStation {
  id: number;
  name: string;
  pakbusAddress: number;
  connectionType: string;
  connectionConfig: any;
  securityCode?: number;
  createdAt: Date;
  updatedAt: Date;
  lastConnected?: Date;
  isActive: boolean;
  // Extended properties for compatibility
  stationType?: string;
  ipAddress?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  protocol?: string;
  dataTable?: string;
  pollInterval?: number;
  apiKey?: string;
  apiEndpoint?: string;
  description?: string;
  location?: string;
  provider?: string;
  // Location coordinates for map
  latitude?: number;
  longitude?: number;
  altitude?: number;
  // Equipment fields
  dataloggerModel?: string;
  dataloggerSerialNumber?: string;
  programName?: string;
  dataloggerProgramName?: string;
  modemModel?: string;
  modemSerialNumber?: string;
  // Description fields
  siteDescription?: string;
  notes?: string;
  // Personnel fields
  installationTeam?: string;
  stationAdmin?: string;
  stationAdminEmail?: string;
  stationAdminPhone?: string;
  // Station image (base64)
  stationImage?: string | null;
  // Unique ingest ID for HTTP POST stations
  ingestId?: string | null;
}

export interface WeatherData {
  id: number;
  stationId: number;
  tableName: string;
  recordNumber?: number;
  timestamp: Date;
  data?: Record<string, any>;
  collectedAt: Date;
  // Extended properties
  temperature?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  windSpeed?: number | null;
  windDirection?: number | null;
  windGust?: number | null;
  rainfall?: number | null;
  solarRadiation?: number | null;
  dewPoint?: number | null;
  batteryVoltage?: number | null;
  // Air quality
  pm10?: number | null;
  pm25?: number | null;
  // Additional environment
  soilTemperature?: number | null;
  soilMoisture?: number | null;
  uvIndex?: number | null;
  panelTemperature?: number | null;
  // Water & sensors
  waterLevel?: number | null;
  temperatureSwitch?: number | null;
  levelSwitch?: number | null;
  temperatureSwitchOutlet?: number | null;
  levelSwitchStatus?: number | null;
  // Power & weather
  lightning?: number | null;
  chargerVoltage?: number | null;
  // Wind direction std dev & SDI-12
  windDirStdDev?: number | null;
  sdi12WindVector?: number | null;
  // Pump & port status
  pumpSelectWell?: number | null;
  pumpSelectBore?: number | null;
  portStatusC1?: number | null;
  portStatusC2?: number | null;
  // Allow additional fields
  [key: string]: any;
}

export interface InsertWeatherData {
  stationId: number;
  tableName?: string;
  recordNumber?: number;
  timestamp: Date;
  data: Record<string, any>;
}

export interface InsertWeatherStation {
  name: string;
  pakbusAddress: number;
  connectionType: string;
  connectionConfig: any;
  securityCode?: number;
  stationType?: string;
  ipAddress?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  protocol?: string;
  dataTable?: string;
  pollInterval?: number;
  apiKey?: string;
  apiEndpoint?: string;
  description?: string;
  location?: string;
  provider?: string;
  isActive?: boolean;
  // Location coordinates for map
  latitude?: number;
  longitude?: number;
  altitude?: number;
  // Personnel fields
  installationTeam?: string;
  stationAdmin?: string;
  stationAdminEmail?: string;
  stationAdminPhone?: string;
  // Station image (base64)
  stationImage?: string | null;
}

// Simple user for local desktop app
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
  role?: string;
  createdAt: Date;
}

export interface StationLog {
  id: number;
  stationId: number;
  logType: string;
  message: string;
  metadata?: any;
  createdAt: Date;
}

export interface Sensor {
  id: number;
  stationId: number;
  name: string;
  type: string;
  unit: string;
  minValue?: number;
  maxValue?: number;
  createdAt: Date;
}

export interface Alarm {
  id: number;
  stationId: number;
  name: string;
  parameter: string;
  condition: string;
  threshold: number;
  unit: string;
  severity: string;
  isEnabled: boolean;
  emailNotifications: boolean;
  emailRecipients?: string | null;
  lastTriggeredAt?: Date | null;
  triggerCount: number;
  staleMinutes?: number | null;
  createdAt: Date;
}

export interface Organization {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  ownerId: string;
  logoUrl?: string | null;
  createdAt: Date;
}

/**
 * Database Storage Class
 * Provides a consistent interface for data access
 */
export class DatabaseStorage {
  // Track which alarms are currently in triggered state (one-shot: only email on normal→triggered transition)
  private activeAlarms = new Set<number>();

  // User operations - simplified for desktop
  async getUser(id: string): Promise<User | undefined> {
    // Use PostgreSQL if available
    if (usePostgres) {
      try {
        // First try to parse as numeric ID
        const numericId = parseInt(id, 10);
        if (!isNaN(numericId)) {
          const result = await postgres.query('SELECT id, email, first_name, last_name, role, created_at FROM users WHERE id = $1', [numericId]);
          if (result.rows.length > 0) {
            const row = result.rows[0];
            return {
              id: String(row.id),
              email: row.email,
              firstName: row.first_name,
              lastName: row.last_name,
              role: row.role,
              createdAt: row.created_at
            };
          }
        }
        
        // If not numeric or not found, try to lookup by email
        if (id.includes('@')) {
          const result = await postgres.query('SELECT id, email, first_name, last_name, role, created_at FROM users WHERE LOWER(email) = LOWER($1)', [id]);
          if (result.rows.length > 0) {
            const row = result.rows[0];
            return {
              id: String(row.id),
              email: row.email,
              firstName: row.first_name,
              lastName: row.last_name,
              role: row.role,
              createdAt: row.created_at
            };
          }
        }
      } catch (error) {
        storageLog.error('Failed to get user from PostgreSQL, falling back to local storage', error);
      }
    }
    
    // Load from stored profile if available
    const storedProfile = db.getSetting('user_profile');
    if (storedProfile) {
      try {
        const profile = JSON.parse(storedProfile);
        return {
          id: 'local-user',
          email: profile.email || 'user@localhost',
          firstName: profile.firstName || 'Local',
          lastName: profile.lastName || 'User',
          createdAt: new Date()
        };
      } catch (e) {
        storageLog.warn('Failed to parse user profile, using defaults', e);
      }
    }
    return {
      id: 'local-user',
      email: 'user@localhost',
      firstName: 'Local',
      lastName: 'User',
      createdAt: new Date()
    };
  }

  async upsertUser(user: Partial<User>): Promise<User> {
    return {
      id: user.id || 'local-user',
      email: user.email || 'user@localhost',
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      createdAt: new Date()
    };
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User> {
    // Use PostgreSQL if available
    if (usePostgres) {
      try {
        let userIdNum: number | undefined;
        
        // First try to parse as numeric ID
        const numericId = parseInt(userId, 10);
        if (!isNaN(numericId)) {
          userIdNum = numericId;
        } else if (userId.includes('@')) {
          // If email, lookup the numeric ID
          const result = await postgres.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [userId]);
          if (result.rows.length > 0) {
            userIdNum = result.rows[0].id;
          }
        }
        
        if (userIdNum) {
          const updated = await postgres.updateUserProfile(userIdNum, {
            firstName: updates.firstName,
            lastName: updates.lastName,
            email: updates.email
          });
          if (updated) {
            return {
              id: String(updated.id),
              email: updated.email,
              firstName: updated.firstName,
              lastName: updated.lastName,
              createdAt: updated.createdAt
            };
          }
        }
      } catch (error) {
        storageLog.error('Failed to update user in PostgreSQL, falling back to local storage', error);
      }
    }
    
    // Fallback to local storage
    const existingUser = JSON.parse(db.getSetting('user_profile') || '{}');
    const updatedUser = { ...existingUser, ...updates, id: userId };
    db.setSetting('user_profile', JSON.stringify(updatedUser));
    
    return {
      id: userId,
      email: updatedUser.email || 'user@localhost',
      firstName: updatedUser.firstName || 'Local',
      lastName: updatedUser.lastName || 'User',
      createdAt: new Date()
    };
  }

  // Weather Station operations
  async getStation(id: number): Promise<WeatherStation | undefined> {
    if (usePostgres) {
      const station = await postgres.getStationById(id);
      if (!station) return undefined;
      return this.mapPgStation(station);
    }
    const station = db.getStationById(id);
    if (!station) return undefined;
    return this.mapDbStation(station);
  }

  async getWeatherStation(id: number): Promise<WeatherStation | undefined> {
    return this.getStation(id);
  }

  async getStationByIngestId(ingestId: string): Promise<WeatherStation | undefined> {
    if (usePostgres) {
      const station = await postgres.getStationByIngestId(ingestId);
      if (!station) return undefined;
      return this.mapPgStation(station);
    }
    return undefined; // SQLite doesn't support ingest IDs
  }

  async getStations(): Promise<WeatherStation[]> {
    if (usePostgres) {
      const stations = await postgres.getAllStations();
      return stations.map(s => this.mapPgStation(s));
    }
    const stations = db.getAllStations();
    return stations.map(s => this.mapDbStation(s));
  }

  async createStation(station: InsertWeatherStation): Promise<WeatherStation> {
    if (usePostgres) {
      const id = await postgres.createStation({
        name: station.name,
        pakbusAddress: station.pakbusAddress || 1,
        connectionType: station.connectionType,
        connectionConfig: station.connectionConfig || {},
        securityCode: station.securityCode,
        latitude: station.latitude,
        longitude: station.longitude,
        altitude: station.altitude,
        location: (station as any).location,
        stationType: (station as any).stationType || null,
        protocol: (station as any).protocol || 'pakbus',
        dataloggerModel: (station as any).dataloggerModel || null,
        dataloggerSerialNumber: (station as any).dataloggerSerialNumber || null,
        programName: (station as any).dataloggerProgramName || null,
        modemModel: (station as any).modemModel || null,
        modemSerialNumber: (station as any).modemSerialNumber || null,
        siteDescription: (station as any).siteDescription || null,
        notes: (station as any).notes || null,
      });
      const created = await postgres.getStationById(id);
      if (!created) throw new Error('Failed to create station');
      return this.mapPgStation(created);
    }
    
    const config = {
      ...(station.connectionConfig || {}),
      ipAddress: station.ipAddress,
      port: station.port,
      serialPort: station.serialPort,
      baudRate: station.baudRate,
      dataTable: station.dataTable,
      pollInterval: station.pollInterval,
      apiKey: station.apiKey,
      apiEndpoint: station.apiEndpoint
    };

    const id = db.createStation({
      name: station.name,
      pakbus_address: station.pakbusAddress || 1,
      connection_type: station.connectionType,
      connection_config: JSON.stringify(config),
      security_code: station.securityCode,
      latitude: station.latitude,
      longitude: station.longitude,
      altitude: station.altitude,
      location: (station as any).location,
    });
    
    const created = db.getStationById(id);
    if (!created) throw new Error('Failed to create station');
    return this.mapDbStation(created);
  }

  async updateStation(id: number, station: Partial<InsertWeatherStation>): Promise<WeatherStation | undefined> {
    const updateData: any = {};
    if (station.name !== undefined) updateData.name = station.name;
    if (station.pakbusAddress !== undefined) updateData.pakbus_address = station.pakbusAddress;
    if (station.connectionType !== undefined) updateData.connection_type = station.connectionType;
    if (station.connectionConfig !== undefined) updateData.connection_config = JSON.stringify(station.connectionConfig);
    if (station.securityCode !== undefined) updateData.security_code = station.securityCode;
    // Location fields
    if ((station as any).location !== undefined) updateData.location = (station as any).location;
    if (station.latitude !== undefined) updateData.latitude = station.latitude;
    if (station.longitude !== undefined) updateData.longitude = station.longitude;
    if (station.altitude !== undefined) updateData.altitude = station.altitude;
    // Equipment fields
    if ((station as any).dataloggerModel !== undefined) updateData.datalogger_model = (station as any).dataloggerModel;
    if ((station as any).dataloggerSerialNumber !== undefined) updateData.datalogger_serial_number = (station as any).dataloggerSerialNumber;
    if ((station as any).programName !== undefined) updateData.program_name = (station as any).programName;
    if ((station as any).modemModel !== undefined) updateData.modem_model = (station as any).modemModel;
    if ((station as any).modemSerialNumber !== undefined) updateData.modem_serial_number = (station as any).modemSerialNumber;
    // Description fields
    if ((station as any).siteDescription !== undefined) updateData.site_description = (station as any).siteDescription;
    if ((station as any).notes !== undefined) updateData.notes = (station as any).notes;
    // Personnel fields
    if ((station as any).installationTeam !== undefined) updateData.installation_team = (station as any).installationTeam;
    if ((station as any).stationAdmin !== undefined) updateData.station_admin = (station as any).stationAdmin;
    if ((station as any).stationAdminEmail !== undefined) updateData.station_admin_email = (station as any).stationAdminEmail;
    if ((station as any).stationAdminPhone !== undefined) updateData.station_admin_phone = (station as any).stationAdminPhone;
    // Station image
    if (station.stationImage !== undefined) updateData.station_image = station.stationImage;
    // Sync timestamp
    if ((station as any).lastConnected !== undefined) updateData.last_connected = (station as any).lastConnected;
    // Active status
    if ((station as any).isActive !== undefined) updateData.is_active = (station as any).isActive;
    
    if (usePostgres) {
      // Map snake_case DB fields back to camelCase for postgres.updateStation
      const pgUpdates: any = {};
      for (const [key, value] of Object.entries(updateData)) {
        // Convert snake_case to camelCase for the PG adapter
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        pgUpdates[camelKey] = value;
      }
      await postgres.updateStation(id, pgUpdates);
    } else {
      db.updateStation(id, updateData);
    }
    return this.getStation(id);
  }

  async deleteStation(id: number): Promise<boolean> {
    if (usePostgres) {
      await postgres.deleteStation(id);
    } else {
      db.deleteStation(id);
    }
    return true;
  }

  // Weather Data operations
  async getLatestWeatherData(stationId: number, tableName?: string): Promise<WeatherData | undefined> {
    // If a specific table name is provided, use it directly
    if (tableName) {
      if (usePostgres) {
        const record = await postgres.getLatestWeatherData(stationId, tableName);
        if (record) return this.mapPgWeatherData(record);
      } else {
        const record = db.getLatestWeatherData(stationId, tableName);
        if (record) return this.mapDbWeatherData(record);
      }
      return undefined;
    }

    // No table name — merge latest records from ALL tables for this station
    // This ensures multi-table stations (e.g. Table5m, Table10m, TableHour) show all fields
    if (usePostgres) {
      const tableNames = await postgres.getDistinctTableNames(stationId);
      if (tableNames.length === 0) return undefined;
      
      if (tableNames.length === 1) {
        // Single table — fast path, no merge needed
        const record = await postgres.getLatestWeatherData(stationId, tableNames[0]);
        if (record) return this.mapPgWeatherData(record);
        return undefined;
      }
      
      // Multi-table: get latest from each table and merge non-null fields
      let merged: WeatherData | undefined;
      for (const tbl of tableNames) {
        const record = await postgres.getLatestWeatherData(stationId, tbl);
        if (!record) continue;
        const mapped = this.mapPgWeatherData(record);
        if (!merged) {
          merged = mapped;
        } else {
          // Merge: non-null values from this table fill in nulls
          for (const key of Object.keys(mapped) as (keyof WeatherData)[]) {
            if (key === 'id' || key === 'stationId' || key === 'tableName' || key === 'recordNumber' || key === 'collectedAt') continue;
            if (key === 'timestamp') {
              // Keep the most recent timestamp
              if (mapped.timestamp > merged.timestamp) {
                merged.timestamp = mapped.timestamp;
              }
              continue;
            }
            if ((merged[key] === null || merged[key] === undefined) && mapped[key] !== null && mapped[key] !== undefined) {
              (merged as any)[key] = mapped[key];
            }
          }
        }
      }
      return merged;
    } else {
      // For SQLite, try common table names as fallback
      const tableNames = ['OneMin', 'Table1', 'FiveMin', 'Hourly', 'Daily', 'weather', 'TableHour', 'TableSolarCharger10m', 'Test'];
      let merged: WeatherData | undefined;
      for (const tbl of tableNames) {
        const record = db.getLatestWeatherData(stationId, tbl);
        if (!record) continue;
        const mapped = this.mapDbWeatherData(record);
        if (!merged) {
          merged = mapped;
        } else {
          for (const key of Object.keys(mapped) as (keyof WeatherData)[]) {
            if (key === 'id' || key === 'stationId' || key === 'tableName' || key === 'recordNumber' || key === 'collectedAt') continue;
            if (key === 'timestamp') {
              if (mapped.timestamp > merged.timestamp) {
                merged.timestamp = mapped.timestamp;
              }
              continue;
            }
            if ((merged[key] === null || merged[key] === undefined) && mapped[key] !== null && mapped[key] !== undefined) {
              (merged as any)[key] = mapped[key];
            }
          }
        }
      }
      return merged;
    }
  }

  async getWeatherDataRange(stationId: number, startTime: Date, endTime: Date, tableName?: string): Promise<WeatherData[]> {
    if (usePostgres) {
      // PostgreSQL: single query, tableName is optional (omit to get all tables)
      const result = await postgres.getWeatherData(stationId, {
        tableName: tableName || undefined,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      });
      if (result.records && result.records.length > 0) {
        return result.records.map((r: any) => this.mapPgWeatherData(r));
      }
      return [];
    }

    // SQLite: try provided table name, then fallback to common names
    const tableNames = tableName ? [tableName] : ['OneMin', 'Table1', 'FiveMin', 'Hourly', 'Daily', 'weather', 'TableHour', 'TableSolarCharger10m', 'Test'];
    for (const tbl of tableNames) {
      const records = db.getWeatherData(
        stationId, 
        tbl, 
        startTime.toISOString(), 
        endTime.toISOString()
      );
      if (records.length > 0) {
        return records.map(r => this.mapDbWeatherData(r));
      }
    }
    return [];
  }

  /**
   * Evaluate incoming weather data against configured alarm thresholds
   * Uses one-shot logic: only sends email on transition from normal→triggered.
   * When condition clears, alarm resets silently (no "back to normal" email).
   */
  private async evaluateAlarms(stationId: number, weatherData: WeatherData): Promise<void> {
    try {
      const alarms = await this.getAlarms(stationId);
      if (!alarms || alarms.length === 0) return;

      for (const alarm of alarms) {
        if (!alarm.isEnabled) continue;

        // Get the current value for the alarm's parameter
        const value = (weatherData as any)[alarm.parameter] ?? weatherData.data?.[alarm.parameter];
        if (value === null || value === undefined) continue;

        const numValue = parseFloat(String(value));
        if (isNaN(numValue)) continue;

        // Check if the alarm condition is met
        let triggered = false;
        switch (alarm.condition) {
          case 'above':
            triggered = numValue > alarm.threshold;
            break;
          case 'below':
            triggered = numValue < alarm.threshold;
            break;
          case 'equals':
            triggered = Math.abs(numValue - alarm.threshold) < 0.01;
            break;
          case 'change':
            // For "change" condition, we'd need previous value — skip for now
            break;
          case 'stale': {
            // Check if data hasn't updated within the configured staleMinutes window
            const staleMinutes = alarm.staleMinutes || 60;
            const latestData = await this.getLatestWeatherData(stationId);
            if (latestData?.timestamp) {
              const lastUpdate = new Date(latestData.timestamp);
              const minutesSinceUpdate = (Date.now() - lastUpdate.getTime()) / 60000;
              triggered = minutesSinceUpdate > staleMinutes;
            }
            break;
          }
          case 'no_charge': {
            // Check if battery voltage has NOT increased by the threshold amount over the past 24h
            const minIncrease = alarm.threshold || 1;
            try {
              const endTime = new Date();
              const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
              const records = await this.getWeatherDataRange(stationId, startTime, endTime);
              const voltages = records
                .map(r => r.batteryVoltage)
                .filter((v): v is number => v != null && v > 0);
              if (voltages.length >= 2) {
                const maxV = Math.max(...voltages);
                const minV = Math.min(...voltages);
                const voltageIncrease = maxV - minV;
                triggered = voltageIncrease < minIncrease;
              }
            } catch (err) {
              storageLog.warn(`Error checking battery charging for station ${stationId}`, err);
            }
            break;
          }
        }

        // ONE-SHOT LOGIC:
        // - If condition is NOT met → clear active state silently (no recovery email)
        // - If condition IS met AND alarm already active → skip (already alerted)
        // - If condition IS met AND alarm NOT active → trigger + send email
        if (!triggered) {
          // Condition cleared — reset alarm state silently
          this.activeAlarms.delete(alarm.id);
          continue;
        }

        // Alarm condition is met — check if already in active state
        if (this.activeAlarms.has(alarm.id)) {
          // Already alerted for this breach event, skip
          continue;
        }

        // Mark alarm as active BEFORE async work (prevents race conditions)
        this.activeAlarms.add(alarm.id);

        // Trigger the alarm event
        try {
          let message: string;
          if (alarm.condition === 'no_charge') {
            message = `${alarm.name || 'Battery Charging Alert'}: Battery voltage has not increased by ${alarm.threshold}V in the last 24 hours (current: ${numValue}V). Solar panel may not be charging.`;
          } else {
            message = `${alarm.name || alarm.parameter}: ${numValue}${alarm.unit || ''} is ${alarm.condition} threshold ${alarm.threshold}${alarm.unit || ''}`;
          }
          await this.triggerAlarm(alarm.id, numValue, message);
          storageLog.warn(`Alarm triggered: ${message}`);

          // Send email notification to alarm recipients + all admin users
          if (isEmailConfigured()) {
            const station = await this.getStation(stationId);
            const emailData: AlarmEmailData = {
              stationName: station?.name || `Station ${stationId}`,
              stationId,
              alarmName: alarm.name || alarm.parameter,
              severity: (alarm.severity as any) || 'warning',
              condition: alarm.condition,
              threshold: alarm.threshold,
              currentValue: numValue,
              unit: alarm.unit || '',
              triggeredAt: new Date(),
              dashboardUrl: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/dashboard?stationId=${stationId}` : undefined,
            };

            // Collect alarm-specific recipients
            const alarmRecipients = alarm.emailRecipients
              ? alarm.emailRecipients.split(',').map((e: string) => e.trim()).filter(Boolean)
              : [];

            // Also include all admin users
            try {
              const allUsers = await this.getAllUsers();
              const adminEmails = allUsers
                .filter((u: any) => u.role === 'admin' && u.email)
                .map((u: any) => u.email);
              alarmRecipients.push(...adminEmails);
            } catch (adminErr) {
              storageLog.warn('Could not fetch admin users for alarm notification', adminErr);
            }

            // Deduplicate and send
            const recipients = [...new Set(alarmRecipients.map((e: string) => e.toLowerCase()))];
            if (recipients.length > 0) {
              await sendAlarmEmail(recipients, emailData);
              storageLog.info(`Alarm email sent to ${recipients.join(', ')}`);
            }
          }
        } catch (triggerErr) {
          // If triggering/emailing failed, remove from active set so it can retry next cycle
          this.activeAlarms.delete(alarm.id);
          storageLog.error(`Failed to trigger alarm ${alarm.id}`, triggerErr);
        }
      }
    } catch (err) {
      // Don't let alarm evaluation crash data ingest
      storageLog.error('Alarm evaluation failed', err);
    }
  }

  async insertWeatherData(data: InsertWeatherData): Promise<WeatherData> {
    const tableName = data.tableName || 'Table1';
    
    try {
      if (usePostgres) {
        // Note: postgres.insertWeatherData will JSON.stringify the data internally
        await postgres.insertWeatherData([{
          stationId: data.stationId,
          tableName: tableName,
          recordNumber: data.recordNumber,
          timestamp: data.timestamp.toISOString(),
          data: data.data  // Pass raw object, postgres will stringify
        }]);
      } else {
        db.insertWeatherData([{
          station_id: data.stationId,
          table_name: tableName,
          record_number: data.recordNumber,
          timestamp: data.timestamp.toISOString(),
          data: JSON.stringify(data.data)
        }]);
      }
    } catch (err: any) {
      // Check for UNIQUE constraint violation (duplicate record) - this is expected
      if (err.message?.includes('UNIQUE constraint') || err.message?.includes('duplicate key')) {
        // Record already exists, fetch and return it
        const existing = await this.getLatestWeatherData(data.stationId, tableName);
        if (existing) return existing;
      }
      throw err;
    }
    
    // Return the inserted data as WeatherData object
    // Don't query back - just construct it from input to avoid table name issues
    const weatherResult: WeatherData = {
      id: Date.now(), // Temporary ID
      stationId: data.stationId,
      tableName: tableName,
      recordNumber: data.recordNumber,
      timestamp: data.timestamp,
      data: data.data,
      collectedAt: new Date(),
      temperature: data.data.temperature ?? data.data.AirTC_Avg ?? data.data.AirTemp ?? data.data.Temp_Avg ?? null,
      humidity: data.data.humidity ?? data.data.RH_Avg ?? data.data.RH ?? null,
      pressure: data.data.pressure ?? data.data.BP_mbar ?? data.data.Pressure ?? data.data.Pressure_Avg ?? null,
      windSpeed: data.data.windSpeed ?? data.data.WS_ms_Avg ?? data.data.WindSpeed ?? data.data.Wind_Spd_S_WVT ?? null,
      windDirection: data.data.windDirection ?? data.data.WindDir ?? data.data.WindDir_D1_WVT ?? data.data.Wind_Dir_D1_WVT ?? null,
      windGust: data.data.windGust ?? data.data.WS_ms_Max ?? data.data.Wind_Spd_Max ?? null,
      rainfall: data.data.rainfall ?? data.data.Rain_mm_Tot ?? data.data.Rain ?? null,
      solarRadiation: data.data.solarRadiation ?? data.data.SlrW ?? data.data.Solar ?? data.data.Solar_Rad_Avg ?? null,
      batteryVoltage: data.data.batteryVoltage ?? data.data.BattV ?? data.data.BattV_Min ?? data.data.Batt_volt_Min ?? null,
      waterLevel: data.data.waterLevel ?? data.data.Water_Level_Avg ?? data.data.WaterLevel ?? null,
      temperatureSwitch: data.data.temperatureSwitch ?? data.data.Temp_Switch_Avg ?? null,
      levelSwitch: data.data.levelSwitch ?? data.data.Level_Switch ?? null,
      temperatureSwitchOutlet: data.data.temperatureSwitchOutlet ?? data.data.Temp_Switch_Outlet ?? null,
      levelSwitchStatus: data.data.levelSwitchStatus ?? data.data.Level_Switch_Status ?? null,
      // Power & weather
      lightning: data.data.lightning ?? data.data.Lightning_Tot ?? data.data.Lightning_Count ?? null,
      chargerVoltage: data.data.chargerVoltage ?? data.data.DC_Chg_Volts ?? data.data.ChgV_Avg ?? null,
      // Wind direction std dev & SDI-12
      windDirStdDev: data.data.windDirStdDev ?? data.data.Wind_Dir_SD1_WVT ?? null,
      sdi12WindVector: data.data.sdi12WindVector ?? data.data.SDI12_WVc ?? null,
      // Pump & port status
      pumpSelectWell: data.data.pumpSelectWell ?? data.data.Pump_Select_Well ?? null,
      pumpSelectBore: data.data.pumpSelectBore ?? data.data.Pump_Select_Bore ?? null,
      portStatusC1: data.data.portStatusC1 ?? data.data.Port_Status_C1 ?? null,
      portStatusC2: data.data.portStatusC2 ?? data.data.Port_Status_C2 ?? null,
      // Extra mapped fields for alarm evaluation
      dewPoint: data.data.dewPoint ?? data.data.DewPoint_Avg ?? data.data.DewPt ?? null,
      pm10: data.data.pm10 ?? data.data.PM10_Avg ?? data.data.PM10 ?? null,
      pm25: data.data.pm25 ?? data.data.PM2_5_Avg ?? data.data.PM2_5 ?? null,
      soilTemperature: data.data.soilTemperature ?? data.data.SoilTemp_Avg ?? data.data.SoilTC ?? null,
      soilMoisture: data.data.soilMoisture ?? data.data.SoilMoist_Avg ?? data.data.VWC ?? null,
      uvIndex: data.data.uvIndex ?? data.data.UV_Index_Avg ?? data.data.UV_Index ?? null,
      panelTemperature: data.data.panelTemperature ?? data.data.PTemp_Avg ?? data.data.PTemp ?? null,
    };

    // Evaluate alarms against the new data (async, don't block return)
    this.evaluateAlarms(data.stationId, weatherResult).catch(() => {});

    return weatherResult;
  }

  async createWeatherData(data: InsertWeatherData): Promise<WeatherData> {
    return this.insertWeatherData(data);
  }

  // Station Logs operations
  async getStationLogs(stationId: number, limit: number = 100): Promise<StationLog[]> {
    return [];
  }

  /**
   * Batch insert multiple weather data records efficiently
   * Uses a single database transaction for all records
   */
  async insertWeatherDataBatch(records: InsertWeatherData[]): Promise<number> {
    if (records.length === 0) return 0;
    
    try {
      if (usePostgres) {
        // Use PostgreSQL batch insert
        // Note: postgres.insertWeatherData will JSON.stringify the data internally
        const pgRecords = records.map(data => ({
          stationId: data.stationId,
          tableName: data.tableName || 'Table1',
          recordNumber: data.recordNumber,
          timestamp: data.timestamp.toISOString(),
          data: data.data  // Pass raw object, postgres will stringify
        }));
        
        const inserted = await postgres.insertWeatherData(pgRecords);
        storageLog.info(`Batch inserted ${inserted} records to PostgreSQL`);
        
        // Evaluate alarms on the latest record per station
        if (inserted > 0) {
          const latestByStation = new Map<number, InsertWeatherData>();
          for (const r of records) {
            const existing = latestByStation.get(r.stationId);
            if (!existing || r.timestamp > existing.timestamp) {
              latestByStation.set(r.stationId, r);
            }
          }
          for (const [stationId, record] of latestByStation) {
            const wd = await this.getLatestWeatherData(stationId);
            if (wd) this.evaluateAlarms(stationId, wd).catch(() => {});
          }
        }
        
        return inserted;
      } else {
        // Use SQLite batch insert
        const dbRecords = records.map(data => ({
          station_id: data.stationId,
          table_name: data.tableName || 'Table1',
          record_number: data.recordNumber,
          timestamp: data.timestamp.toISOString(),
          data: JSON.stringify(data.data)
        }));
        
        db.insertWeatherData(dbRecords);
        return records.length;
      }
    } catch (err: any) {
      // If batch fails due to duplicates, fall back to individual inserts
      if (err.message?.includes('UNIQUE constraint') || err.message?.includes('duplicate key')) {
        storageLog.warn(`Batch insert failed with duplicates, falling back to individual inserts`);
        let inserted = 0;
        for (const data of records) {
          try {
            await this.insertWeatherData(data);
            inserted++;
          } catch {
            // Skip duplicates
          }
        }
        return inserted;
      }
      throw err;
    }
  }

  async createStationLog(log: { stationId: number; logType: string; message: string; metadata?: any }): Promise<StationLog> {
    return {
      id: Date.now(),
      stationId: log.stationId,
      logType: log.logType,
      message: log.message,
      metadata: log.metadata,
      createdAt: new Date()
    };
  }

  // User-Station operations - simplified for desktop
  async getUserStations(userId: string): Promise<(any & { station: WeatherStation })[]> {
    const stations = await this.getStations();
    return stations.map(station => ({
      userId,
      stationId: station.id,
      isDefault: false,
      station
    }));
  }

  async addUserStation(data: { userId: string; stationId: number; isDefault?: boolean }): Promise<any> {
    return { userId: data.userId, stationId: data.stationId, isDefault: data.isDefault || false };
  }

  async removeUserStation(userId: string, stationId: number): Promise<boolean> {
    return true;
  }

  async setDefaultStation(userId: string, stationId: number): Promise<boolean> {
    return true;
  }

  // User Preferences - full settings storage
  async getUserPreferences(userId: string): Promise<any> {
    const defaults = {
      userId,
      temperatureUnit: 'celsius',
      windSpeedUnit: 'ms',
      pressureUnit: 'hpa',
      precipitationUnit: 'mm',
      theme: 'system',
      emailNotifications: true,
      pushNotifications: false,
      tempHighAlert: 35,
      windHighAlert: 50,
      units: 'metric',
      timezone: 'auto',
      serverAddress: ''
    };
    
    // Use PostgreSQL if available
    if (usePostgres) {
      try {
        let userIdNum: number | undefined;
        
        // First try to parse as numeric ID
        const numericId = parseInt(userId, 10);
        if (!isNaN(numericId)) {
          userIdNum = numericId;
        } else if (userId.includes('@')) {
          // If email, lookup the numeric ID
          const result = await postgres.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [userId]);
          if (result.rows.length > 0) {
            userIdNum = result.rows[0].id;
          }
        }
        
        if (userIdNum) {
          const prefs = await postgres.getUserPreferences(userIdNum);
          if (prefs) {
            return { ...defaults, ...prefs, userId };
          }
        }
      } catch (error) {
        storageLog.error('Failed to get preferences from PostgreSQL', error);
      }
    }
    
    // Fallback to local storage
    const storedPrefs = db.getSetting('user_preferences');
    if (storedPrefs) {
      try {
        return { ...defaults, ...JSON.parse(storedPrefs), userId };
      } catch (e) {
        storageLog.warn('Failed to parse user preferences, using defaults', e);
        return defaults;
      }
    }
    return defaults;
  }

  async upsertUserPreferences(prefs: any): Promise<any> {
    // Use PostgreSQL if available
    if (usePostgres) {
      try {
        let userIdNum: number | undefined;
        
        // First try to parse as numeric ID
        const numericId = parseInt(prefs.userId, 10);
        if (!isNaN(numericId)) {
          userIdNum = numericId;
        } else if (prefs.userId && prefs.userId.includes('@')) {
          // If email, lookup the numeric ID
          const result = await postgres.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [prefs.userId]);
          if (result.rows.length > 0) {
            userIdNum = result.rows[0].id;
          }
        }
        
        if (userIdNum) {
          const updated = await postgres.upsertUserPreferences({
            userId: userIdNum,
            temperatureUnit: prefs.temperatureUnit,
            windSpeedUnit: prefs.windSpeedUnit,
            pressureUnit: prefs.pressureUnit,
            precipitationUnit: prefs.precipitationUnit,
            theme: prefs.theme,
            emailNotifications: prefs.emailNotifications,
            pushNotifications: prefs.pushNotifications,
            tempHighAlert: prefs.tempHighAlert,
            windHighAlert: prefs.windHighAlert,
            units: prefs.units,
            timezone: prefs.timezone,
            serverAddress: prefs.serverAddress,
          });
          return updated;
        }
      } catch (error) {
        storageLog.error('Failed to upsert preferences in PostgreSQL', error);
      }
    }
    
    // Fallback to local storage
    const existing = await this.getUserPreferences(prefs.userId);
    const updated = { ...existing, ...prefs };
    
    // Store to database
    db.setSetting('user_preferences', JSON.stringify(updated));
    
    // Also store theme separately for backwards compatibility
    if (prefs.theme) db.setSetting('theme', prefs.theme);
    
    return updated;
  }

  // Sensor operations - stubs for desktop app
  async getSensors(stationId: number): Promise<Sensor[]> {
    return [];
  }

  async createSensor(sensor: any): Promise<Sensor> {
    return { id: Date.now(), createdAt: new Date(), ...sensor };
  }

  async updateSensor(id: number, data: any): Promise<Sensor | undefined> {
    return { id, createdAt: new Date(), ...data };
  }

  async deleteSensor(id: number): Promise<boolean> {
    return true;
  }

  // Calibration operations - stubs
  async getCalibrationRecords(sensorId: number): Promise<any[]> {
    return [];
  }

  async getCalibrationsDue(stationId: number, daysAhead: number): Promise<any[]> {
    return [];
  }

  async createCalibrationRecord(record: any): Promise<any> {
    return { id: Date.now(), createdAt: new Date(), ...record };
  }

  // Maintenance operations - stubs
  async getMaintenanceEvents(stationId: number, type?: string, start?: Date, end?: Date): Promise<any[]> {
    return [];
  }

  async createMaintenanceEvent(event: any): Promise<any> {
    return { id: Date.now(), createdAt: new Date(), ...event };
  }

  // Alarm operations - now with real database persistence (Issue #10 fix)
  async getAlarms(stationId: number): Promise<Alarm[]> {
    if (usePostgres) {
      const alarms = await postgres.pgGetAlarmsByStation(stationId);
      return alarms.map(a => this.mapDbAlarm(a));
    }
    const alarms = dbGetAlarmsByStation(stationId);
    return alarms.map(a => this.mapDbAlarm(a));
  }

  async getAllAlarms(): Promise<Alarm[]> {
    if (usePostgres) {
      const alarms = await postgres.pgGetAllAlarms();
      return alarms.map(a => this.mapDbAlarm(a));
    }
    const alarms = dbGetAllAlarms();
    return alarms.map(a => this.mapDbAlarm(a));
  }

  async getAlarm(alarmId: number): Promise<Alarm | undefined> {
    if (usePostgres) {
      const alarm = await postgres.pgGetAlarmById(alarmId);
      if (!alarm) return undefined;
      return this.mapDbAlarm(alarm);
    }
    const alarm = dbGetAlarmById(alarmId);
    if (!alarm) return undefined;
    return this.mapDbAlarm(alarm);
  }

  async createAlarm(alarm: any): Promise<Alarm> {
    if (usePostgres) {
      const id = await postgres.pgCreateAlarm({
        station_id: alarm.stationId,
        name: alarm.name || alarm.parameter,
        parameter: alarm.parameter || 'temperature',
        condition: alarm.condition || 'above',
        threshold: alarm.threshold,
        unit: alarm.unit || '',
        severity: alarm.severity || 'warning',
        enabled: alarm.isEnabled !== false,
        email_notifications: alarm.emailNotifications || false,
        email_recipients: alarm.emailRecipients || null,
        stale_minutes: alarm.staleMinutes || null
      });
      const created = await postgres.pgGetAlarmById(id);
      if (!created) throw new Error('Failed to create alarm');
      return this.mapDbAlarm(created);
    }
    const id = dbCreateAlarm({
      station_id: alarm.stationId,
      parameter: alarm.parameter || 'temperature',
      condition: alarm.condition || 'above',
      threshold: alarm.threshold,
      severity: alarm.severity || 'warning',
      enabled: alarm.isEnabled !== false,
      email_notifications: alarm.emailNotifications || false,
      email_recipients: alarm.emailRecipients || null
    });
    
    const created = dbGetAlarmById(id);
    if (!created) throw new Error('Failed to create alarm');
    return this.mapDbAlarm(created);
  }

  async updateAlarm(id: number, data: any): Promise<Alarm | undefined> {
    if (usePostgres) {
      await postgres.pgUpdateAlarm(id, {
        name: data.name,
        parameter: data.parameter,
        condition: data.condition,
        threshold: data.threshold !== undefined ? parseFloat(data.threshold) : undefined,
        unit: data.unit,
        severity: data.severity,
        enabled: data.enabled ?? data.isEnabled,
        email_notifications: data.notifyEmail ?? data.emailNotifications,
        email_recipients: data.emailRecipients
      });
      return this.getAlarm(id);
    }
    dbUpdateAlarm(id, {
      parameter: data.parameter,
      condition: data.condition,
      threshold: data.threshold !== undefined ? parseFloat(data.threshold) : undefined,
      severity: data.severity,
      enabled: data.enabled ?? data.isEnabled,
      email_notifications: data.notifyEmail ?? data.emailNotifications,
      email_recipients: data.emailRecipients
    });
    return this.getAlarm(id);
  }

  async deleteAlarm(id: number): Promise<boolean> {
    if (usePostgres) {
      await postgres.pgDeleteAlarm(id);
      return true;
    }
    dbDeleteAlarm(id);
    return true;
  }

  async getActiveAlarmEvents(stationId?: number): Promise<any[]> {
    if (usePostgres) {
      const events = await postgres.pgGetAlarmEvents(undefined, stationId, 100);
      return events.filter(e => !e.acknowledged).map(e => ({
        id: e.id,
        alarmId: e.alarm_id,
        stationId: e.station_id,
        triggeredValue: e.triggered_value,
        message: e.message,
        acknowledged: e.acknowledged,
        acknowledgedBy: e.acknowledged_by,
        acknowledgedAt: e.acknowledged_at ? new Date(e.acknowledged_at) : undefined,
        createdAt: new Date(e.created_at || Date.now())
      }));
    }
    const events = dbGetAlarmEvents(undefined, stationId, 100);
    return events.filter(e => !e.acknowledged).map(e => ({
      id: e.id,
      alarmId: e.alarm_id,
      stationId: e.station_id,
      triggeredValue: e.triggered_value,
      message: e.message,
      acknowledged: e.acknowledged,
      acknowledgedBy: e.acknowledged_by,
      acknowledgedAt: e.acknowledged_at ? new Date(e.acknowledged_at) : undefined,
      createdAt: new Date(e.created_at || Date.now())
    }));
  }

  async getAlarmEvents(alarmId?: number, stationId?: number, limit: number = 100): Promise<any[]> {
    if (usePostgres) {
      const events = await postgres.pgGetAlarmEvents(alarmId, stationId, limit);
      return events.map(e => ({
        id: e.id,
        alarmId: e.alarm_id,
        stationId: e.station_id,
        triggeredValue: e.triggered_value,
        message: e.message,
        acknowledged: e.acknowledged,
        acknowledgedBy: e.acknowledged_by,
        acknowledgedAt: e.acknowledged_at ? new Date(e.acknowledged_at) : undefined,
        createdAt: new Date(e.created_at || Date.now())
      }));
    }
    const events = dbGetAlarmEvents(alarmId, stationId, limit);
    return events.map(e => ({
      id: e.id,
      alarmId: e.alarm_id,
      stationId: e.station_id,
      triggeredValue: e.triggered_value,
      message: e.message,
      acknowledged: e.acknowledged,
      acknowledgedBy: e.acknowledged_by,
      acknowledgedAt: e.acknowledged_at ? new Date(e.acknowledged_at) : undefined,
      createdAt: new Date(e.created_at || Date.now())
    }));
  }

  async triggerAlarm(alarmId: number, value: number, message?: string): Promise<number> {
    if (usePostgres) {
      return postgres.pgTriggerAlarm(alarmId, value, message);
    }
    return dbTriggerAlarm(alarmId, value, message);
  }

  async acknowledgeAlarmEvent(eventId: number, acknowledgedBy: string, notes?: string): Promise<any> {
    if (usePostgres) {
      await postgres.pgAcknowledgeAlarmEvent(eventId, acknowledgedBy);
      return { id: eventId, acknowledgedBy, notes, acknowledgedAt: new Date() };
    }
    dbAcknowledgeAlarmEvent(eventId, acknowledgedBy);
    return { id: eventId, acknowledgedBy, notes, acknowledgedAt: new Date() };
  }

  async deleteAlarmEvent(eventId: number): Promise<void> {
    if (usePostgres) {
      await postgres.pgDeleteAlarmEvent(eventId);
    } else {
      dbDeleteAlarmEventSqlite(eventId);
    }
  }

  async cleanupOldAlarmEvents(daysToKeep: number = 30): Promise<number> {
    if (usePostgres) {
      return postgres.pgCleanupOldAlarmEvents(daysToKeep);
    }
    return dbCleanupOldAlarmEventsSqlite(daysToKeep);
  }

  private mapDbAlarm(alarm: DbAlarm | postgres.PgAlarm): Alarm {
    const pgAlarm = alarm as postgres.PgAlarm;
    return {
      id: alarm.id!,
      stationId: alarm.station_id,
      name: pgAlarm.name || alarm.parameter || '',
      parameter: alarm.parameter || '',
      condition: alarm.condition as string,
      threshold: parseFloat(String(alarm.threshold)) || 0,
      unit: pgAlarm.unit || '',
      severity: (alarm.severity || 'warning') as string,
      isEnabled: alarm.enabled !== false,
      emailNotifications: alarm.email_notifications || false,
      emailRecipients: alarm.email_recipients || null,
      lastTriggeredAt: alarm.last_triggered_at ? new Date(alarm.last_triggered_at) : null,
      triggerCount: alarm.trigger_count || 0,
      staleMinutes: (alarm as any).stale_minutes ?? null,
      createdAt: new Date(alarm.created_at || Date.now())
    };
  }

  // Data quality operations - stubs
  async getDataQualityFlags(stationId: number, start?: Date, end?: Date): Promise<any[]> {
    return [];
  }

  async createDataQualityFlag(flag: any): Promise<any> {
    return { id: Date.now(), createdAt: new Date(), ...flag };
  }

  // Configuration history - stubs
  async getConfigurationHistory(stationId: number): Promise<any[]> {
    return [];
  }

  // Station groups - stubs
  async getStationGroups(): Promise<any[]> {
    return [];
  }

  async createStationGroup(group: any): Promise<any> {
    return { id: Date.now(), createdAt: new Date(), ...group };
  }

  async addStationToGroup(groupId: number, stationId: number): Promise<void> {
    // No-op for desktop
  }

  async removeStationFromGroup(groupId: number, stationId: number): Promise<void> {
    // No-op for desktop
  }

  // Organization operations - now with real database persistence
  async getOrganizations(): Promise<Organization[]> {
    if (usePostgres) {
      const orgs = await postgres.pgGetAllOrganizations();
      return orgs.map((org: any) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
        ownerId: org.owner_id,
        logoUrl: org.logo_url || null,
        createdAt: new Date(org.created_at)
      }));
    }
    const orgs = db.getAllOrganizations();
    return orgs.map(org => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      ownerId: org.owner_id,
      createdAt: new Date(org.created_at)
    }));
  }

  async getUserOrganizations(userId: string): Promise<Organization[]> {
    if (usePostgres) {
      const orgs = await postgres.pgGetUserOrganizations(userId);
      if (orgs.length === 0) {
        // Fall back to all orgs if user has no memberships yet
        return this.getOrganizations();
      }
      return orgs.map((org: any) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
        ownerId: org.owner_id,
        logoUrl: org.logo_url || null,
        createdAt: new Date(org.created_at)
      }));
    }
    // For desktop, return all organizations (single user)
    return this.getOrganizations();
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    if (usePostgres) {
      const org = await postgres.pgGetOrganizationById(id);
      if (!org) return undefined;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
        ownerId: org.owner_id,
        logoUrl: org.logo_url || null,
        createdAt: new Date(org.created_at)
      };
    }
    const org = db.getOrganizationById(id);
    if (!org) return undefined;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      description: org.description,
      ownerId: org.owner_id,
      createdAt: new Date(org.created_at)
    };
  }

  async createOrganization(orgData: any): Promise<Organization> {
    if (usePostgres) {
      const slug = (orgData.slug || orgData.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const id = await postgres.pgCreateOrganization(
        orgData.name,
        slug,
        orgData.description || null,
        orgData.ownerId || 'local-user',
        orgData.logoUrl || null
      );
      const org = await postgres.pgGetOrganizationById(id);
      return {
        id: org!.id,
        name: org!.name,
        slug: org!.slug,
        description: org!.description,
        ownerId: org!.owner_id,
        logoUrl: org!.logo_url || null,
        createdAt: new Date(org!.created_at)
      };
    }
    const id = db.createOrganization(orgData.name, orgData.description, 'local-user');
    const org = db.getOrganizationById(id);
    return {
      id: org!.id,
      name: org!.name,
      slug: org!.slug,
      description: org!.description,
      ownerId: org!.owner_id,
      createdAt: new Date(org!.created_at)
    };
  }

  async updateOrganization(id: number, data: any): Promise<Organization | undefined> {
    if (usePostgres) {
      await postgres.pgUpdateOrganization(id, data);
      return this.getOrganization(id);
    }
    db.updateOrganization(id, data);
    return this.getOrganization(id);
  }

  async deleteOrganization(id: number): Promise<boolean> {
    if (usePostgres) {
      await postgres.pgDeleteOrganization(id);
      return true;
    }
    db.deleteOrganization(id);
    return true;
  }

  async getOrganizationMembers(orgId: number): Promise<any[]> {
    if (usePostgres) {
      const members = await postgres.pgGetOrganizationMembers(orgId);
      return members.map((m: any) => ({
        id: m.id,
        organizationId: m.organization_id,
        userId: m.user_id,
        role: m.role,
        createdAt: new Date(m.created_at),
        user: {
          id: m.user_id,
          email: m.email || m.user_id,
          firstName: m.first_name || '',
          lastName: m.last_name || ''
        }
      }));
    }
    const members = db.getOrganizationMembers(orgId);
    return members.map(m => ({
      id: m.id,
      organizationId: m.organization_id,
      userId: m.user_id,
      role: m.role,
      createdAt: new Date(m.created_at),
      user: {
        id: m.user_id,
        email: m.user_id === 'local-user' ? 'user@localhost' : m.user_id,
        firstName: 'Local',
        lastName: 'User'
      }
    }));
  }

  async addOrganizationMember(data: any): Promise<any> {
    if (usePostgres) {
      const id = await postgres.pgAddOrganizationMember(data.organizationId, data.userId, data.role);
      return { id, ...data, createdAt: new Date() };
    }
    const id = db.addOrganizationMember(data.organizationId, data.userId, data.role);
    return { id, ...data, createdAt: new Date() };
  }

  async updateMemberRole(orgId: number, userId: string, role: string): Promise<any> {
    if (usePostgres) {
      await postgres.pgUpdateMemberRole(orgId, userId, role);
      return { organizationId: orgId, userId, role };
    }
    db.updateMemberRole(orgId, userId, role);
    return { organizationId: orgId, userId, role };
  }

  async removeOrganizationMember(orgId: number, userId: string): Promise<boolean> {
    if (usePostgres) {
      await postgres.pgRemoveOrganizationMember(orgId, userId);
      return true;
    }
    db.removeOrganizationMember(orgId, userId);
    return true;
  }

  async isOrganizationAdmin(orgId: number, userId: string): Promise<boolean> {
    if (usePostgres) {
      return postgres.pgIsOrganizationAdmin(orgId, userId);
    }
    return true; // Desktop is single-user, always admin
  }

  async isOrganizationMember(orgId: number, userId: string): Promise<boolean> {
    return true;
  }

  async getOrganizationInvitations(orgId: number): Promise<any[]> {
    if (usePostgres) {
      const invitations = await postgres.pgGetOrganizationInvitations(orgId);
      return invitations.map((inv: any) => ({
        id: inv.id,
        organizationId: inv.organization_id,
        email: inv.email,
        role: inv.role,
        token: inv.token,
        expiresAt: inv.expires_at ? new Date(inv.expires_at) : undefined,
        acceptedAt: inv.accepted_at ? new Date(inv.accepted_at) : undefined,
        createdAt: new Date(inv.created_at)
      }));
    }
    const invitations = db.getOrganizationInvitations(orgId);
    return invitations.map(inv => ({
      id: inv.id,
      organizationId: inv.organization_id,
      email: inv.email,
      role: inv.role,
      token: inv.token,
      expiresAt: inv.expires_at ? new Date(inv.expires_at) : undefined,
      createdAt: new Date(inv.created_at)
    }));
  }

  async createInvitation(data: any): Promise<any> {
    if (usePostgres) {
      const token = await postgres.pgCreateOrganizationInvitation(data.organizationId, data.email, data.role);
      return {
        id: Date.now(),
        token,
        ...data,
        createdAt: new Date()
      };
    }
    const token = db.createOrganizationInvitation(data.organizationId, data.email, data.role);
    return { 
      id: Date.now(), 
      token,
      ...data,
      createdAt: new Date()
    };
  }

  async getInvitationByToken(token: string): Promise<any> {
    return null;
  }

  async acceptInvitation(token: string, userId: string): Promise<boolean> {
    return true;
  }

  // ==================== Dropbox Config Methods ====================
  
  async getDropboxConfigs(): Promise<any[]> {
    if (usePostgres) {
      const results = await postgres.getAllDropboxConfigs();
      return results.map((row: any) => ({
        id: row.id,
        name: row.name,
        folderPath: row.folderPath ?? row.folder_path,
        filePattern: row.filePattern ?? row.file_pattern,
        stationId: row.stationId ?? row.station_id,
        syncInterval: row.syncInterval ?? row.sync_interval,
        enabled: !!row.enabled,
        lastSyncAt: row.lastSyncAt ?? row.last_sync_at ? new Date(row.lastSyncAt ?? row.last_sync_at) : null,
        lastSyncStatus: row.lastSyncStatus ?? row.last_sync_status,
        lastSyncRecords: row.lastSyncRecords ?? row.last_sync_records ?? 0,
        createdAt: new Date(row.createdAt ?? row.created_at),
        updatedAt: new Date(row.updatedAt ?? row.updated_at),
      }));
    }
    
    const results = db.getAllDropboxConfigs();
    return results.map((row: any) => ({
      id: row.id,
      name: row.name,
      folderPath: row.folder_path,
      filePattern: row.file_pattern,
      stationId: row.station_id,
      syncInterval: row.sync_interval,
      enabled: !!row.enabled,
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
      lastSyncStatus: row.last_sync_status,
      lastSyncRecords: row.last_sync_records || 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  async getDropboxConfig(id: number): Promise<any | null> {
    if (usePostgres) {
      const row = await postgres.getDropboxConfigById(id);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        folderPath: row.folderPath,
        filePattern: row.filePattern,
        stationId: row.stationId,
        syncInterval: row.syncInterval,
        enabled: !!row.enabled,
        lastSyncAt: row.lastSyncAt ? new Date(row.lastSyncAt) : null,
        lastSyncStatus: row.lastSyncStatus,
        lastSyncRecords: row.lastSyncRecords ?? 0,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
      };
    }

    const row = db.getDropboxConfigById(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      folderPath: row.folder_path,
      filePattern: row.file_pattern,
      stationId: row.station_id,
      syncInterval: row.sync_interval,
      enabled: !!row.enabled,
      lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at) : null,
      lastSyncStatus: row.last_sync_status,
      lastSyncRecords: row.last_sync_records || 0,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async createDropboxConfig(data: { name: string; folderPath: string; filePattern?: string; stationId?: number; syncInterval?: number; enabled?: boolean }): Promise<any> {
    if (usePostgres) {
      const id = await postgres.createDropboxConfig(
        data.name,
        data.folderPath,
        data.filePattern || null,
        data.stationId || null,
        data.syncInterval || 3600000,
        data.enabled !== false
      );
      return this.getDropboxConfig(id);
    }

    const id = db.createDropboxConfig(
      data.name, 
      data.folderPath, 
      data.filePattern || null, 
      data.stationId || null, 
      data.syncInterval || 3600000, 
      data.enabled !== false
    );
    return this.getDropboxConfig(id);
  }

  async updateDropboxConfig(id: number, data: Partial<{ name: string; folderPath: string; filePattern: string; stationId: number; syncInterval: number; enabled: boolean }>): Promise<any> {
    if (usePostgres) {
      await postgres.updateDropboxConfig(id, {
        name: data.name,
        folder_path: data.folderPath,
        file_pattern: data.filePattern,
        station_id: data.stationId,
        sync_interval: data.syncInterval,
        enabled: data.enabled,
      });
      return this.getDropboxConfig(id);
    }

    db.updateDropboxConfig(id, {
      name: data.name,
      folder_path: data.folderPath,
      file_pattern: data.filePattern,
      station_id: data.stationId,
      sync_interval: data.syncInterval,
      enabled: data.enabled,
    });
    return this.getDropboxConfig(id);
  }

  async updateDropboxSyncStatus(id: number, status: string, recordsImported: number): Promise<void> {
    if (usePostgres) {
      await postgres.updateDropboxConfigSyncStatus(id, status, recordsImported);
      return;
    }
    db.updateDropboxSyncStatus(id, status, recordsImported);
  }

  async deleteDropboxConfig(id: number): Promise<boolean> {
    if (usePostgres) {
      await postgres.deleteDropboxConfig(id);
      return true;
    }
    db.deleteDropboxConfig(id);
    return true;
  }

  // Helper methods
  private mapDbStation(station: any): WeatherStation {
    let connectionConfig: any = {};
    try {
      connectionConfig = JSON.parse(station.connection_config || '{}');
    } catch (e) {
      storageLog.warn(`Failed to parse connection_config for station ${station.id}`, e);
      connectionConfig = {};
    }

    return {
      id: station.id,
      name: station.name,
      pakbusAddress: station.pakbus_address,
      connectionType: station.connection_type,
      connectionConfig,
      securityCode: station.security_code,
      createdAt: new Date(station.created_at),
      updatedAt: new Date(station.updated_at),
      lastConnected: station.last_connected ? new Date(station.last_connected) : undefined,
      isActive: !!station.is_active,
      // Extract extended properties from connectionConfig
      ipAddress: connectionConfig.ipAddress || connectionConfig.host,
      port: connectionConfig.port,
      serialPort: connectionConfig.serialPort,
      baudRate: connectionConfig.baudRate,
      protocol: connectionConfig.protocol || 'pakbus',
      dataTable: connectionConfig.dataTable,
      pollInterval: connectionConfig.pollInterval,
      apiKey: connectionConfig.apiKey,
      apiEndpoint: connectionConfig.apiEndpoint,
      stationType: connectionConfig.stationType || station.connection_type,
      // Location fields
      location: station.location || undefined,
      latitude: station.latitude || undefined,
      longitude: station.longitude || undefined,
      altitude: station.altitude || undefined,
      // Equipment fields
      dataloggerModel: station.datalogger_model || undefined,
      dataloggerSerialNumber: station.datalogger_serial_number || undefined,
      dataloggerProgramName: station.program_name || undefined,
      modemModel: station.modem_model || undefined,
      modemSerialNumber: station.modem_serial_number || undefined,
      // Description fields
      siteDescription: station.site_description || undefined,
      notes: station.notes || undefined,
      // Personnel fields
      installationTeam: station.installation_team || undefined,
      stationAdmin: station.station_admin || undefined,
      stationAdminEmail: station.station_admin_email || undefined,
      stationAdminPhone: station.station_admin_phone || undefined,
      // Station image
      stationImage: station.station_image || null
    };
  }

  // Map PostgreSQL station (uses camelCase from db-postgres.ts)
  private mapPgStation(station: any): WeatherStation {
    let connectionConfig: any = {};
    try {
      connectionConfig = typeof station.connectionConfig === 'string' 
        ? JSON.parse(station.connectionConfig || '{}')
        : station.connectionConfig || {};
    } catch (e) {
      storageLog.warn(`Failed to parse connection_config for station ${station.id}`, e);
      connectionConfig = {};
    }

    return {
      id: station.id,
      name: station.name,
      pakbusAddress: station.pakbusAddress,
      connectionType: station.connectionType,
      connectionConfig,
      securityCode: station.securityCode,
      createdAt: station.createdAt ? new Date(station.createdAt) : new Date(),
      updatedAt: station.updatedAt ? new Date(station.updatedAt) : new Date(),
      lastConnected: station.lastConnected ? new Date(station.lastConnected) : undefined,
      isActive: station.isActive !== false,
      // Extract extended properties from connectionConfig
      ipAddress: connectionConfig.ipAddress || connectionConfig.host,
      port: connectionConfig.port,
      serialPort: connectionConfig.serialPort,
      baudRate: connectionConfig.baudRate,
      protocol: connectionConfig.protocol || station.protocol || 'pakbus',
      dataTable: connectionConfig.dataTable,
      pollInterval: connectionConfig.pollInterval,
      apiKey: connectionConfig.apiKey,
      apiEndpoint: connectionConfig.apiEndpoint,
      stationType: connectionConfig.stationType || station.stationType || station.connectionType,
      // Location fields
      location: station.location || undefined,
      latitude: station.latitude || undefined,
      longitude: station.longitude || undefined,
      altitude: station.altitude || undefined,
      // Equipment fields
      dataloggerModel: station.dataloggerModel || undefined,
      dataloggerSerialNumber: station.dataloggerSerialNumber || undefined,
      dataloggerProgramName: station.programName || undefined,
      modemModel: station.modemModel || undefined,
      modemSerialNumber: station.modemSerialNumber || undefined,
      // Description fields
      siteDescription: station.siteDescription || undefined,
      notes: station.notes || undefined,
      // Personnel fields (may not exist in postgres)
      installationTeam: station.installationTeam || undefined,
      stationAdmin: station.stationAdmin || undefined,
      stationAdminEmail: station.stationAdminEmail || undefined,
      stationAdminPhone: station.stationAdminPhone || undefined,
      // Station image
      stationImage: station.stationImage || null,
      // Ingest ID for HTTP POST stations
      ingestId: station.ingestId || null
    };
  }

  private mapDbWeatherData(record: any): WeatherData {
    let data: Record<string, any> = {};
    try {
      data = JSON.parse(record.data || '{}');
    } catch (e) {
      storageLog.warn(`Failed to parse weather data for record ${record.id}`, e);
      data = {};
    }

    // Helper: charger voltage sanity — values > 100V are likely in mV
    const sanitizeChargerVoltage = (v: number | null) => v !== null && v > 100 ? v / 100 : v;
    // Helper: solar radiation cap — values > 2000 W/m² are unrealistic raw readings
    const sanitizeSolarRadiation = (v: number | null) => v !== null && v > 2000 ? null : v;
    // Helper: convert pg REAL/FLOAT columns (returned as strings) to numbers
    const toNum = (v: any): number | null => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };

    return {
      id: record.id,
      stationId: record.station_id,
      tableName: record.table_name,
      recordNumber: record.record_number,
      timestamp: new Date(record.timestamp),
      collectedAt: new Date(record.collected_at),
      // Map data fields - support all Campbell Scientific field name variants
      temperature: data.temperature ?? data.AirTC_Avg ?? data.AirTemp ?? data.Temp_Avg ?? data.AirTemp_Avg ?? data.AirTC ?? data.Temp_C ?? data.Temperature ?? null,
      humidity: data.humidity ?? data.RH_Avg ?? data.RH ?? data.RelHumidity_Avg ?? data.RelHumidity ?? data.Humidity ?? null,
      pressure: data.pressure ?? data.BP_mbar ?? data.Pressure ?? data.Pressure_Avg ?? data.BaroPressure_Avg ?? data.BP_Avg ?? data.BaroPres ?? data.BP_mbar_Avg ?? data.BPress_Avg ?? data.BPress ?? null,
      windSpeed: data.windSpeed ?? data.WS_ms_Avg ?? data.WindSpeed ?? data.Wind_Spd_S_WVT ?? data.WindSpeed_Avg ?? data.WS_ms ?? data.WS_Avg ?? data.WS_ms_S_WVT ?? data.WSpd_1_Avg ?? data.WSpd_Avg ?? data.WSpd_1_S_WVT ?? null,
      windDirection: data.windDirection ?? data.WindDir ?? data.WindDir_D1_WVT ?? data.Wind_Dir_D1_WVT ?? data.WindDir_Avg ?? data.WD_Deg ?? data.WD_Avg ?? data.WDir_1_Avg ?? data.WDir_Avg ?? data.WDir_1_D1_WVT ?? null,
      windGust: data.windGust ?? data.WS_ms_Max ?? data.Wind_Spd_Max ?? data.WindSpeed_Max ?? data.WS_Max ?? data.Wind_Gust ?? data.WSpd_1_Max ?? data.WSpd_Max ?? null,
      rainfall: data.rainfall ?? data.Rain_mm_Tot ?? data.Rain ?? data.Rain_Tot ?? data.Precip ?? data.Precip_Tot ?? data.Rain_1_Tot ?? data.Rain_Tot_1 ?? null,
      solarRadiation: data.solarRadiation ?? data.SlrW ?? data.Solar ?? data.Solar_Rad_Avg ?? data.SolarRad_Avg ?? data.SlrW_Avg ?? data.SR_Avg ?? null,
      dewPoint: data.dewPoint ?? data.DewPoint_Avg ?? data.DewPt ?? data.DewPoint ?? data.Dew_C ?? data.DewPointTemp_Avg ?? data.DewPointTemp ?? null,
      batteryVoltage: data.batteryVoltage ?? data.BattV ?? data.BattV_Min ?? data.Batt_volt_Min ?? data.BattV_Avg ?? data.Batt_V ?? data.LoggerBattery_Avg ?? data.LoggerBattery ?? null,
      // Air quality
      pm10: data.pm10 ?? data.PM10_Avg ?? data.PM10 ?? null,
      pm25: data.pm25 ?? data.pm2_5 ?? data.PM2_5_Avg ?? data.PM2_5 ?? null,
      // Additional environment
      soilTemperature: data.soilTemperature ?? data.SoilTemp_Avg ?? data.SoilTC ?? data.Soil_Temp ?? null,
      soilMoisture: data.soilMoisture ?? data.SoilMoist_Avg ?? data.VWC ?? data.VWC_Avg ?? data.Soil_VWC ?? null,
      uvIndex: data.uvIndex ?? data.UV_Index_Avg ?? data.UV_Index ?? null,
      panelTemperature: data.panelTemperature ?? data.PTemp_Avg ?? data.PTemp ?? data.PTemp_C ?? data.PTemp_C_Avg ?? data.LoggerTemp_Avg ?? data.LoggerTemp ?? null,
      // Water & sensors
      waterLevel: data.waterLevel ?? data.Water_Level_Avg ?? data.WaterLevel ?? data.Water_Level ?? null,
      temperatureSwitch: data.temperatureSwitch ?? data.Temp_Switch_Avg ?? data.TempSwitch ?? data.Temp_Switch ?? null,
      levelSwitch: data.levelSwitch ?? data.Level_Switch ?? data.LevelSwitch ?? data.Level_Switch_Avg ?? null,
      temperatureSwitchOutlet: data.temperatureSwitchOutlet ?? data.Temp_Switch_Outlet ?? data.TempSwitchOutlet ?? null,
      levelSwitchStatus: data.levelSwitchStatus ?? data.Level_Switch_Status ?? data.LevelSwitchStatus ?? null,
      // Power & weather
      lightning: data.lightning ?? data.Lightning_Tot ?? data.Lightning_Count ?? data.Lightning ?? null,
      chargerVoltage: data.chargerVoltage ?? data.DC_Chg_Volts ?? data.ChgV_Avg ?? data.Charger_V ?? data.SolarCharger_V ?? null,
      // Wind direction std dev & SDI-12
      windDirStdDev: data.windDirStdDev ?? data.Wind_Dir_SD1_WVT ?? data.WindDir_SD1_WVT ?? null,
      sdi12WindVector: data.sdi12WindVector ?? data.SDI12_WVc ?? data.SDI12_WV ?? null,
      // Pump & port status
      pumpSelectWell: data.pumpSelectWell ?? data.Pump_Select_Well ?? null,
      pumpSelectBore: data.pumpSelectBore ?? data.Pump_Select_Bore ?? null,
      portStatusC1: data.portStatusC1 ?? data.Port_Status_C1 ?? null,
      portStatusC2: data.portStatusC2 ?? data.Port_Status_C2 ?? null,
      // MPPT Solar Charge Controller
      mpptSolarVoltage: toNum(data.mpptSolarVoltage) ?? toNum(data.SolarCharger_PanelVoltage_1_Avg) ?? null,
      mpptSolarCurrent: toNum(data.mpptSolarCurrent) ?? toNum(data.SolarCharger_PanelCurrent_1_Avg) ?? null,
      mpptSolarPower: toNum(data.mpptSolarPower) ?? toNum(data.SolarCharger_PanelPower_1_Avg) ?? null,
      mpptLoadVoltage: toNum(data.mpptLoadVoltage) ?? toNum(data.SolarCharger_LoadVoltage_1_Avg) ?? null,
      mpptLoadCurrent: toNum(data.mpptLoadCurrent) ?? toNum(data.SolarCharger_LoadCurrent_1_Avg) ?? null,
      mpptBatteryVoltage: toNum(data.mpptBatteryVoltage) ?? toNum(data.SolarCharger_BatteryVoltage_1_Avg) ?? null,
      mpptChargerState: toNum(data.mpptChargerState) ?? toNum(data.SolarCharger_State_1) ?? null,
      mpptAbsiAvg: toNum(data.mpptAbsiAvg) ?? null,
      mpptBoardTemp: toNum(data.mpptBoardTemp) ?? toNum(data.SolarCharger_BoardTemp_1_Avg) ?? null,
      mpptMode: toNum(data.mpptMode) ?? toNum(data.SolarCharger_Mode_1) ?? null,
      // MPPT Charger 2
      mppt2SolarVoltage: toNum(data.mppt2SolarVoltage) ?? toNum(data.SolarCharger_PanelVoltage_2_Avg) ?? null,
      mppt2SolarCurrent: toNum(data.mppt2SolarCurrent) ?? toNum(data.SolarCharger_PanelCurrent_2_Avg) ?? null,
      mppt2SolarPower: toNum(data.mppt2SolarPower) ?? toNum(data.SolarCharger_PanelPower_2_Avg) ?? null,
      mppt2LoadVoltage: toNum(data.mppt2LoadVoltage) ?? toNum(data.SolarCharger_LoadVoltage_2_Avg) ?? null,
      mppt2LoadCurrent: toNum(data.mppt2LoadCurrent) ?? toNum(data.SolarCharger_LoadCurrent_2_Avg) ?? null,
      mppt2BatteryVoltage: toNum(data.mppt2BatteryVoltage) ?? toNum(data.SolarCharger_BatteryVoltage_2_Avg) ?? null,
      mppt2ChargerState: toNum(data.mppt2ChargerState) ?? toNum(data.SolarCharger_State_2) ?? null,
      mppt2BoardTemp: toNum(data.mppt2BoardTemp) ?? toNum(data.SolarCharger_BoardTemp_2_Avg) ?? null,
      mppt2Mode: toNum(data.mppt2Mode) ?? toNum(data.SolarCharger_Mode_2) ?? null,
    };
  }

  // Map PostgreSQL weather data (uses camelCase from db-postgres.ts)
  private mapPgWeatherData(record: any): WeatherData {
    let data: Record<string, any> = {};
    try {
      data = typeof record.data === 'string' ? JSON.parse(record.data || '{}') : record.data || {};
    } catch (e) {
      storageLog.warn(`Failed to parse weather data for record ${record.id}`, e);
      data = {};
    }

    // Helper: charger voltage sanity — values > 100V are likely in mV
    const sanitizeChargerVoltage = (v: number | null) => v !== null && v > 100 ? v / 100 : v;
    // Helper: solar radiation cap — values > 2000 W/m² are unrealistic raw readings
    const sanitizeSolarRadiation = (v: number | null) => v !== null && v > 2000 ? null : v;
    // Helper: convert pg REAL/FLOAT columns (returned as strings) to numbers
    const toNum = (v: any): number | null => {
      if (v === null || v === undefined) return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };

    return {
      id: record.id,
      stationId: record.stationId ?? record.station_id,
      tableName: record.tableName ?? record.table_name,
      recordNumber: record.recordNumber ?? record.record_number,
      timestamp: new Date(record.timestamp),
      collectedAt: new Date(record.collectedAt ?? record.collected_at ?? new Date()),
      // Map data fields - support all Campbell Scientific field name variants
      temperature: data.temperature ?? data.AirTC_Avg ?? data.AirTemp ?? data.Temp_Avg ?? data.AirTemp_Avg ?? data.AirTC ?? data.Temp_C ?? data.Temperature ?? null,
      humidity: data.humidity ?? data.RH_Avg ?? data.RH ?? data.RelHumidity_Avg ?? data.RelHumidity ?? data.Humidity ?? null,
      pressure: data.pressure ?? data.BP_mbar ?? data.Pressure ?? data.Pressure_Avg ?? data.BaroPressure_Avg ?? data.BP_Avg ?? data.BaroPres ?? data.BP_mbar_Avg ?? data.BPress_Avg ?? data.BPress ?? null,
      windSpeed: data.windSpeed ?? data.WS_ms_Avg ?? data.WindSpeed ?? data.Wind_Spd_S_WVT ?? data.WindSpeed_Avg ?? data.WS_ms ?? data.WS_Avg ?? data.WS_ms_S_WVT ?? data.WSpd_1_Avg ?? data.WSpd_Avg ?? data.WSpd_1_S_WVT ?? null,
      windDirection: data.windDirection ?? data.WindDir ?? data.WindDir_D1_WVT ?? data.Wind_Dir_D1_WVT ?? data.WindDir_Avg ?? data.WD_Deg ?? data.WD_Avg ?? data.WDir_1_Avg ?? data.WDir_Avg ?? data.WDir_1_D1_WVT ?? null,
      windGust: data.windGust ?? data.WS_ms_Max ?? data.Wind_Spd_Max ?? data.WindSpeed_Max ?? data.WS_Max ?? data.Wind_Gust ?? data.WSpd_1_Max ?? data.WSpd_Max ?? null,
      rainfall: data.rainfall ?? data.Rain_mm_Tot ?? data.Rain ?? data.Rain_Tot ?? data.Precip ?? data.Precip_Tot ?? data.Rain_1_Tot ?? data.Rain_Tot_1 ?? null,
      solarRadiation: sanitizeSolarRadiation(data.solarRadiation ?? data.SlrW ?? data.Solar ?? data.Solar_Rad_Avg ?? data.SolarRad_Avg ?? data.SlrW_Avg ?? data.SR_Avg ?? null),
      dewPoint: data.dewPoint ?? data.DewPoint_Avg ?? data.DewPt ?? data.DewPoint ?? data.Dew_C ?? data.DewPointTemp_Avg ?? data.DewPointTemp ?? null,
      batteryVoltage: data.batteryVoltage ?? data.BattV ?? data.BattV_Min ?? data.Batt_volt_Min ?? data.BattV_Avg ?? data.Batt_V ?? data.LoggerBattery_Avg ?? data.LoggerBattery ?? null,
      // Air quality
      pm10: data.pm10 ?? data.PM10_Avg ?? data.PM10 ?? null,
      pm25: data.pm25 ?? data.pm2_5 ?? data.PM2_5_Avg ?? data.PM2_5 ?? null,
      // Additional environment
      soilTemperature: data.soilTemperature ?? data.SoilTemp_Avg ?? data.SoilTC ?? data.Soil_Temp ?? null,
      soilMoisture: data.soilMoisture ?? data.SoilMoist_Avg ?? data.VWC ?? data.VWC_Avg ?? data.Soil_VWC ?? null,
      uvIndex: data.uvIndex ?? data.UV_Index_Avg ?? data.UV_Index ?? null,
      panelTemperature: data.panelTemperature ?? data.PTemp_Avg ?? data.PTemp ?? data.PTemp_C ?? data.PTemp_C_Avg ?? data.LoggerTemp_Avg ?? data.LoggerTemp ?? null,
      // Water & sensors
      waterLevel: data.waterLevel ?? data.Water_Level_Avg ?? data.WaterLevel ?? data.Water_Level ?? null,
      temperatureSwitch: data.temperatureSwitch ?? data.Temp_Switch_Avg ?? data.TempSwitch ?? data.Temp_Switch ?? null,
      levelSwitch: data.levelSwitch ?? data.Level_Switch ?? data.LevelSwitch ?? data.Level_Switch_Avg ?? null,
      temperatureSwitchOutlet: data.temperatureSwitchOutlet ?? data.Temp_Switch_Outlet ?? data.TempSwitchOutlet ?? null,
      levelSwitchStatus: data.levelSwitchStatus ?? data.Level_Switch_Status ?? data.LevelSwitchStatus ?? null,
      // Power & weather
      lightning: data.lightning ?? data.Lightning_Tot ?? data.Lightning_Count ?? data.Lightning ?? null,
      chargerVoltage: sanitizeChargerVoltage(data.chargerVoltage ?? data.DC_Chg_Volts ?? data.ChgV_Avg ?? data.Charger_V ?? data.SolarCharger_V ?? null),
      // Wind direction std dev & SDI-12
      windDirStdDev: data.windDirStdDev ?? data.Wind_Dir_SD1_WVT ?? data.WindDir_SD1_WVT ?? null,
      sdi12WindVector: data.sdi12WindVector ?? data.SDI12_WVc ?? data.SDI12_WV ?? null,
      // Pump & port status
      pumpSelectWell: data.pumpSelectWell ?? data.Pump_Select_Well ?? null,
      pumpSelectBore: data.pumpSelectBore ?? data.Pump_Select_Bore ?? null,
      portStatusC1: data.portStatusC1 ?? data.Port_Status_C1 ?? null,
      portStatusC2: data.portStatusC2 ?? data.Port_Status_C2 ?? null,
      // MPPT Solar Charge Controller (dedicated columns + JSONB fallback)
      mpptSolarVoltage: toNum(record.mppt_solar_voltage) ?? toNum(data.mpptSolarVoltage) ?? toNum(data.SolarCharger_PanelVoltage_1_Avg) ?? null,
      mpptSolarCurrent: toNum(record.mppt_solar_current) ?? toNum(data.mpptSolarCurrent) ?? toNum(data.SolarCharger_PanelCurrent_1_Avg) ?? null,
      mpptSolarPower: toNum(record.mppt_solar_power) ?? toNum(data.mpptSolarPower) ?? toNum(data.SolarCharger_PanelPower_1_Avg) ?? null,
      mpptLoadVoltage: toNum(record.mppt_load_voltage) ?? toNum(data.mpptLoadVoltage) ?? toNum(data.SolarCharger_LoadVoltage_1_Avg) ?? null,
      mpptLoadCurrent: toNum(record.mppt_load_current) ?? toNum(data.mpptLoadCurrent) ?? toNum(data.SolarCharger_LoadCurrent_1_Avg) ?? null,
      mpptBatteryVoltage: toNum(record.mppt_battery_voltage) ?? toNum(data.mpptBatteryVoltage) ?? toNum(data.SolarCharger_BatteryVoltage_1_Avg) ?? null,
      mpptChargerState: toNum(record.mppt_charger_state) ?? toNum(data.mpptChargerState) ?? toNum(data.SolarCharger_State_1) ?? null,
      mpptAbsiAvg: toNum(record.mppt_absi_avg) ?? toNum(data.mpptAbsiAvg) ?? null,
      mpptBoardTemp: toNum(record.mppt_board_temp) ?? toNum(data.mpptBoardTemp) ?? toNum(data.SolarCharger_BoardTemp_1_Avg) ?? null,
      mpptMode: toNum(data.mpptMode) ?? toNum(data.SolarCharger_Mode_1) ?? null,
      // MPPT Charger 2 (from JSONB data)
      mppt2SolarVoltage: toNum(data.mppt2SolarVoltage) ?? toNum(data.SolarCharger_PanelVoltage_2_Avg) ?? null,
      mppt2SolarCurrent: toNum(data.mppt2SolarCurrent) ?? toNum(data.SolarCharger_PanelCurrent_2_Avg) ?? null,
      mppt2SolarPower: toNum(data.mppt2SolarPower) ?? toNum(data.SolarCharger_PanelPower_2_Avg) ?? null,
      mppt2LoadVoltage: toNum(data.mppt2LoadVoltage) ?? toNum(data.SolarCharger_LoadVoltage_2_Avg) ?? null,
      mppt2LoadCurrent: toNum(data.mppt2LoadCurrent) ?? toNum(data.SolarCharger_LoadCurrent_2_Avg) ?? null,
      mppt2BatteryVoltage: toNum(data.mppt2BatteryVoltage) ?? toNum(data.SolarCharger_BatteryVoltage_2_Avg) ?? null,
      mppt2ChargerState: toNum(data.mppt2ChargerState) ?? toNum(data.SolarCharger_State_2) ?? null,
      mppt2BoardTemp: toNum(data.mppt2BoardTemp) ?? toNum(data.SolarCharger_BoardTemp_2_Avg) ?? null,
      mppt2Mode: toNum(data.mppt2Mode) ?? toNum(data.SolarCharger_Mode_2) ?? null,
    };
  }

  // ============ User Management Operations ============
  
  async getAllUsers(): Promise<any[]> {
    if (usePostgres) {
      try {
        const users = await postgres.getAllUsers();
        return users.map((u: any) => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          assignedStations: u.assignedStations
            ? (typeof u.assignedStations === 'string' ? JSON.parse(u.assignedStations) : u.assignedStations)
            : [],
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt
        }));
      } catch (error) {
        storageLog.error('Failed to get all users from PostgreSQL', error);
      }
    }
    const users = db.getAllActiveUsers();
    return users.map(u => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      role: u.role,
      assignedStations: u.assigned_stations ? JSON.parse(u.assigned_stations) : [],
      lastLoginAt: u.last_login_at,
      createdAt: u.created_at
    }));
  }

  async getUserByEmail(email: string): Promise<any | null> {
    if (usePostgres) {
      const user = await postgres.getUserByEmail(email) as any;
      if (!user) return null;
      
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        passwordHash: user.passwordHash,
        role: user.role,
        assignedStations: user.assignedStations 
          ? (typeof user.assignedStations === 'string' 
            ? JSON.parse(user.assignedStations) 
            : user.assignedStations)
          : [],
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
      };
    }
    
    const user = db.getUserByEmail(email);
    if (!user) return null;
    
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      passwordHash: user.password_hash,
      role: user.role,
      assignedStations: user.assigned_stations ? JSON.parse(user.assigned_stations) : [],
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at
    };
  }

  async createUser(data: {
    email: string;
    firstName: string;
    lastName?: string;
    passwordHash: string;
    role: 'admin' | 'user';
    assignedStations?: number[];
  }): Promise<any> {
    if (usePostgres) {
      const id = await postgres.createUser({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName || null,
        passwordHash: data.passwordHash,
        role: data.role,
        assignedStations: data.assignedStations ? JSON.stringify(data.assignedStations) : null
      });
      
      const user = await postgres.getUserByEmail(data.email) as any;
      if (!user) throw new Error('Failed to create user');
      
      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        assignedStations: [],
        createdAt: user.createdAt
      };
    }
    
    const id = db.createUser(
      data.email,
      data.firstName,
      data.lastName || null,
      data.passwordHash,
      data.role,
      data.assignedStations || []
    );
    
    const user = db.getUserByEmail(data.email);
    if (!user) throw new Error('Failed to create user');
    
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      assignedStations: user.assigned_stations ? JSON.parse(user.assigned_stations) : [],
      createdAt: user.created_at
    };
  }

  async updateUserData(email: string, updates: {
    firstName?: string;
    lastName?: string;
    passwordHash?: string;
    role?: 'admin' | 'user';
    assignedStations?: number[];
  }): Promise<any> {
    if (usePostgres) {
      try {
        const updated = await postgres.updateUserDataByEmail(email, updates);
        if (updated) return updated;
      } catch (error) {
        storageLog.error('Failed to update user data in PostgreSQL', error);
      }
    }
    // Fallback to SQLite
    const dbUpdates: any = {};
    if (updates.firstName !== undefined) dbUpdates.first_name = updates.firstName;
    if (updates.lastName !== undefined) dbUpdates.last_name = updates.lastName;
    if (updates.passwordHash !== undefined) dbUpdates.password_hash = updates.passwordHash;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.assignedStations !== undefined) dbUpdates.assigned_stations = updates.assignedStations;
    
    db.updateUser(email, dbUpdates);
    return this.getUserByEmail(email);
  }

  async deleteUserByEmail(email: string): Promise<boolean> {
    if (usePostgres) {
      try {
        return await postgres.deleteUserByEmail(email);
      } catch (error) {
        storageLog.error('Failed to delete user from PostgreSQL', error);
      }
    }
    db.deleteUser(email);
    return true;
  }

  async updateUserLastLogin(email: string): Promise<void> {
    if (usePostgres) {
      // Get user by email first to get the ID
      const user = await postgres.getUserByEmail(email);
      if (user && user.id) {
        await postgres.updateUserLastLogin(user.id);
      }
      return;
    }
    db.updateUserLastLogin(email);
  }
}

// Export singleton instance
export const storage = new DatabaseStorage();
