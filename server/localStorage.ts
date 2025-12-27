/**
 * Local Storage Layer for Desktop App
 * Wraps the SQLite database operations with an interface compatible with the server routes
 */

import db from './db';

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

  // User Preferences - simplified
  async getUserPreferences(userId: string): Promise<any> {
    const settings = db.getAllSettings();
    return {
      userId,
      temperatureUnit: 'celsius',
      windSpeedUnit: 'ms',
      pressureUnit: 'hpa',
      precipitationUnit: 'mm',
      theme: settings['theme'] || 'system'
    };
  }

  async upsertUserPreferences(prefs: any): Promise<any> {
    if (prefs.theme) db.setSetting('theme', prefs.theme);
    return prefs;
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

  // Alarm operations - stubs
  async getAlarms(stationId: number): Promise<Alarm[]> {
    return [];
  }

  async createAlarm(alarm: any): Promise<Alarm> {
    return { id: Date.now(), createdAt: new Date(), isEnabled: true, ...alarm };
  }

  async updateAlarm(id: number, data: any): Promise<Alarm | undefined> {
    return { id, createdAt: new Date(), isEnabled: true, ...data };
  }

  async deleteAlarm(id: number): Promise<boolean> {
    return true;
  }

  async getActiveAlarmEvents(stationId?: number): Promise<any[]> {
    return [];
  }

  async acknowledgeAlarmEvent(eventId: number, acknowledgedBy: string, notes?: string): Promise<any> {
    return { id: eventId, acknowledgedBy, notes, acknowledgedAt: new Date() };
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

  // Organization operations - stubs (desktop is single-user)
  async getOrganizations(): Promise<Organization[]> {
    return [];
  }

  async getUserOrganizations(userId: string): Promise<Organization[]> {
    return [];
  }

  async getOrganization(id: number): Promise<Organization | undefined> {
    return undefined;
  }

  async createOrganization(org: any): Promise<Organization> {
    return { id: Date.now(), createdAt: new Date(), ownerId: 'local-user', ...org };
  }

  async updateOrganization(id: number, data: any): Promise<Organization | undefined> {
    return { id, createdAt: new Date(), ownerId: 'local-user', ...data };
  }

  async deleteOrganization(id: number): Promise<boolean> {
    return true;
  }

  async getOrganizationMembers(orgId: number): Promise<any[]> {
    return [];
  }

  async addOrganizationMember(data: any): Promise<any> {
    return { id: Date.now(), ...data };
  }

  async updateMemberRole(orgId: number, userId: string, role: string): Promise<any> {
    return { organizationId: orgId, userId, role };
  }

  async removeOrganizationMember(orgId: number, userId: string): Promise<boolean> {
    return true;
  }

  async isOrganizationAdmin(orgId: number, userId: string): Promise<boolean> {
    return true; // Desktop is single-user, always admin
  }

  async isOrganizationMember(orgId: number, userId: string): Promise<boolean> {
    return true;
  }

  async getOrganizationInvitations(orgId: number): Promise<any[]> {
    return [];
  }

  async createInvitation(data: any): Promise<any> {
    return { id: Date.now(), token: 'local', ...data };
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
    } catch {
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
    } catch {
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
