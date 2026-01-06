/**
 * Local Storage Layer for Desktop App
 * Wraps the SQLite database operations with an interface compatible with the server routes
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
  acknowledgeAlarmEvent as dbAcknowledgeAlarmEvent
} from './db';

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
}

export interface WeatherData {
  id: number;
  stationId: number;
  tableName: string;
  recordNumber?: number;
  timestamp: Date;
  data: Record<string, any>;
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
}

// Simple user for local desktop app
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
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
  condition: string;
  threshold: number;
  severity: string;
  isEnabled: boolean;
  createdAt: Date;
}

export interface Organization {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  ownerId: string;
  createdAt: Date;
}

/**
 * Database Storage Class
 * Provides a consistent interface for data access
 */
export class DatabaseStorage {
  // User operations - simplified for desktop
  async getUser(id: string): Promise<User | undefined> {
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
    // Store user updates in settings
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
    const station = db.getStationById(id);
    if (!station) return undefined;
    return this.mapDbStation(station);
  }

  async getWeatherStation(id: number): Promise<WeatherStation | undefined> {
    return this.getStation(id);
  }

  async getStations(): Promise<WeatherStation[]> {
    const stations = db.getAllStations();
    return stations.map(s => this.mapDbStation(s));
  }

  async createStation(station: InsertWeatherStation): Promise<WeatherStation> {
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
      security_code: station.securityCode
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
    
    db.updateStation(id, updateData);
    return this.getStation(id);
  }

  async deleteStation(id: number): Promise<boolean> {
    db.deleteStation(id);
    return true;
  }

  // Weather Data operations
  async getLatestWeatherData(stationId: number): Promise<WeatherData | undefined> {
    const record = db.getLatestWeatherData(stationId, 'OneMin');
    if (!record) return undefined;
    return this.mapDbWeatherData(record);
  }

  async getWeatherDataRange(stationId: number, startTime: Date, endTime: Date): Promise<WeatherData[]> {
    const records = db.getWeatherData(
      stationId, 
      'OneMin', 
      startTime.toISOString(), 
      endTime.toISOString()
    );
    return records.map(r => this.mapDbWeatherData(r));
  }

  async insertWeatherData(data: InsertWeatherData): Promise<WeatherData> {
    db.insertWeatherData([{
      station_id: data.stationId,
      table_name: data.tableName || 'OneMin',
      record_number: data.recordNumber,
      timestamp: data.timestamp.toISOString(),
      data: JSON.stringify(data.data)
    }]);
    
    const latest = await this.getLatestWeatherData(data.stationId);
    if (!latest) throw new Error('Failed to insert weather data');
    return latest;
  }

  async createWeatherData(data: InsertWeatherData): Promise<WeatherData> {
    return this.insertWeatherData(data);
  }

  // Station Logs operations
  async getStationLogs(stationId: number, limit: number = 100): Promise<StationLog[]> {
    return [];
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
    const storedPrefs = db.getSetting('user_preferences');
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
    // Get existing preferences
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
    const alarms = dbGetAlarmsByStation(stationId);
    return alarms.map(a => this.mapDbAlarm(a));
  }

  async getAllAlarms(): Promise<Alarm[]> {
    const alarms = dbGetAllAlarms();
    return alarms.map(a => this.mapDbAlarm(a));
  }

  async getAlarm(alarmId: number): Promise<Alarm | undefined> {
    const alarm = dbGetAlarmById(alarmId);
    if (!alarm) return undefined;
    return this.mapDbAlarm(alarm);
  }

  async createAlarm(alarm: any): Promise<Alarm> {
    const id = dbCreateAlarm({
      station_id: alarm.stationId,
      parameter: alarm.name || alarm.parameter,
      condition: alarm.condition || 'above',
      threshold: alarm.threshold,
      severity: alarm.severity || 'warning',
      enabled: alarm.isEnabled !== false,
      email_notifications: alarm.emailNotifications || false,
      email_recipients: alarm.emailRecipients
    });
    
    const created = dbGetAlarmById(id);
    if (!created) throw new Error('Failed to create alarm');
    return this.mapDbAlarm(created);
  }

  async updateAlarm(id: number, data: any): Promise<Alarm | undefined> {
    dbUpdateAlarm(id, {
      parameter: data.name || data.parameter,
      condition: data.condition,
      threshold: data.threshold,
      severity: data.severity,
      enabled: data.isEnabled,
      email_notifications: data.emailNotifications,
      email_recipients: data.emailRecipients
    });
    return this.getAlarm(id);
  }

  async deleteAlarm(id: number): Promise<boolean> {
    dbDeleteAlarm(id);
    return true;
  }

  async getActiveAlarmEvents(stationId?: number): Promise<any[]> {
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
    return dbTriggerAlarm(alarmId, value, message);
  }

  async acknowledgeAlarmEvent(eventId: number, acknowledgedBy: string, notes?: string): Promise<any> {
    dbAcknowledgeAlarmEvent(eventId, acknowledgedBy);
    return { id: eventId, acknowledgedBy, notes, acknowledgedAt: new Date() };
  }

  private mapDbAlarm(alarm: DbAlarm): Alarm {
    return {
      id: alarm.id!,
      stationId: alarm.station_id,
      name: alarm.parameter,
      condition: alarm.condition,
      threshold: alarm.threshold,
      severity: alarm.severity || 'warning',
      isEnabled: alarm.enabled !== false,
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
    // For desktop, return all organizations (single user)
    return this.getOrganizations();
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
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
    db.updateOrganization(id, data);
    return this.getOrganization(id);
  }

  async deleteOrganization(id: number): Promise<boolean> {
    db.deleteOrganization(id);
    return true;
  }

  async getOrganizationMembers(orgId: number): Promise<any[]> {
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
    const id = db.addOrganizationMember(data.organizationId, data.userId, data.role);
    return { id, ...data, createdAt: new Date() };
  }

  async updateMemberRole(orgId: number, userId: string, role: string): Promise<any> {
    db.updateMemberRole(orgId, userId, role);
    return { organizationId: orgId, userId, role };
  }

  async removeOrganizationMember(orgId: number, userId: string): Promise<boolean> {
    db.removeOrganizationMember(orgId, userId);
    return true;
  }

  async isOrganizationAdmin(orgId: number, userId: string): Promise<boolean> {
    return true; // Desktop is single-user, always admin
  }

  async isOrganizationMember(orgId: number, userId: string): Promise<boolean> {
    return true;
  }

  async getOrganizationInvitations(orgId: number): Promise<any[]> {
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
      programName: station.program_name || undefined,
      modemModel: station.modem_model || undefined,
      modemSerialNumber: station.modem_serial_number || undefined,
      // Description fields
      siteDescription: station.site_description || undefined,
      notes: station.notes || undefined,
      // Personnel fields
      installationTeam: station.installation_team || undefined,
      stationAdmin: station.station_admin || undefined,
      stationAdminEmail: station.station_admin_email || undefined,
      stationAdminPhone: station.station_admin_phone || undefined
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

    return {
      id: record.id,
      stationId: record.station_id,
      tableName: record.table_name,
      recordNumber: record.record_number,
      timestamp: new Date(record.timestamp),
      data,
      collectedAt: new Date(record.collected_at),
      // Map data fields
      temperature: data.temperature,
      humidity: data.humidity,
      pressure: data.pressure,
      windSpeed: data.windSpeed,
      windDirection: data.windDirection,
      windGust: data.windGust,
      rainfall: data.rainfall,
      solarRadiation: data.solarRadiation,
      dewPoint: data.dewPoint,
      batteryVoltage: data.batteryVoltage
    };
  }
}

// Export singleton instance
export const storage = new DatabaseStorage();
