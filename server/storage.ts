import {
  users,
  weatherStations,
  weatherData,
  userStations,
  userPreferences,
  sensors,
  calibrationRecords,
  maintenanceEvents,
  configurationChanges,
  dataQualityFlags,
  alarms,
  alarmEvents,
  dataloggerPrograms,
  stationGroups,
  stationGroupMembers,
  type User,
  type UpsertUser,
  type WeatherStation,
  type InsertWeatherStation,
  type WeatherData,
  type InsertWeatherData,
  type UserStation,
  type InsertUserStation,
  type UserPreferences,
  type InsertUserPreferences,
  type Sensor,
  type InsertSensor,
  type CalibrationRecord,
  type InsertCalibrationRecord,
  type MaintenanceEvent,
  type InsertMaintenanceEvent,
  type ConfigurationChange,
  type InsertConfigurationChange,
  type DataQualityFlag,
  type InsertDataQualityFlag,
  type Alarm,
  type InsertAlarm,
  type AlarmEvent,
  type InsertAlarmEvent,
  type DataloggerProgram,
  type InsertDataloggerProgram,
  type StationGroup,
  type InsertStationGroup,
  type StationGroupMember,
  type InsertStationGroupMember,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte } from "drizzle-orm";

export interface IStorage {
  // User operations - Required for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Weather Station operations
  getStation(id: number): Promise<WeatherStation | undefined>;
  getStations(): Promise<WeatherStation[]>;
  createStation(station: InsertWeatherStation): Promise<WeatherStation>;
  updateStation(id: number, station: Partial<InsertWeatherStation>): Promise<WeatherStation | undefined>;
  deleteStation(id: number): Promise<boolean>;

  // User-Station operations
  getUserStations(userId: string): Promise<(UserStation & { station: WeatherStation })[]>;
  addUserStation(data: InsertUserStation): Promise<UserStation>;
  removeUserStation(userId: string, stationId: number): Promise<boolean>;
  setDefaultStation(userId: string, stationId: number): Promise<boolean>;

  // Weather Data operations
  getLatestWeatherData(stationId: number): Promise<WeatherData | undefined>;
  getWeatherDataRange(stationId: number, startTime: Date, endTime: Date): Promise<WeatherData[]>;
  insertWeatherData(data: InsertWeatherData): Promise<WeatherData>;

  // User Preferences operations
  getUserPreferences(userId: string): Promise<UserPreferences | undefined>;
  upsertUserPreferences(prefs: InsertUserPreferences): Promise<UserPreferences>;
}

export class DatabaseStorage implements IStorage {
  // User operations - Required for Replit Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Weather Station operations
  async getStation(id: number): Promise<WeatherStation | undefined> {
    const [station] = await db.select().from(weatherStations).where(eq(weatherStations.id, id));
    return station;
  }

  async getStations(): Promise<WeatherStation[]> {
    return await db.select().from(weatherStations).orderBy(weatherStations.name);
  }

  async createStation(station: InsertWeatherStation): Promise<WeatherStation> {
    const [newStation] = await db.insert(weatherStations).values(station).returning();
    return newStation;
  }

  async updateStation(id: number, station: Partial<InsertWeatherStation>): Promise<WeatherStation | undefined> {
    const [updated] = await db
      .update(weatherStations)
      .set({ ...station, updatedAt: new Date() })
      .where(eq(weatherStations.id, id))
      .returning();
    return updated;
  }

  async deleteStation(id: number): Promise<boolean> {
    const result = await db.delete(weatherStations).where(eq(weatherStations.id, id)).returning();
    return result.length > 0;
  }

  // User-Station operations
  async getUserStations(userId: string): Promise<(UserStation & { station: WeatherStation })[]> {
    const results = await db
      .select()
      .from(userStations)
      .innerJoin(weatherStations, eq(userStations.stationId, weatherStations.id))
      .where(eq(userStations.userId, userId));
    
    return results.map(r => ({
      ...r.user_stations,
      station: r.weather_stations,
    }));
  }

  async addUserStation(data: InsertUserStation): Promise<UserStation> {
    const [result] = await db.insert(userStations).values(data).returning();
    return result;
  }

  async removeUserStation(userId: string, stationId: number): Promise<boolean> {
    const result = await db
      .delete(userStations)
      .where(and(eq(userStations.userId, userId), eq(userStations.stationId, stationId)))
      .returning();
    return result.length > 0;
  }

  async setDefaultStation(userId: string, stationId: number): Promise<boolean> {
    // First, unset all defaults for this user
    await db
      .update(userStations)
      .set({ isDefault: false })
      .where(eq(userStations.userId, userId));
    
    // Then set the new default
    const [result] = await db
      .update(userStations)
      .set({ isDefault: true })
      .where(and(eq(userStations.userId, userId), eq(userStations.stationId, stationId)))
      .returning();
    
    return !!result;
  }

  // Weather Data operations
  async getLatestWeatherData(stationId: number): Promise<WeatherData | undefined> {
    const [data] = await db
      .select()
      .from(weatherData)
      .where(eq(weatherData.stationId, stationId))
      .orderBy(desc(weatherData.timestamp))
      .limit(1);
    return data;
  }

  async getWeatherDataRange(stationId: number, startTime: Date, endTime: Date): Promise<WeatherData[]> {
    return await db
      .select()
      .from(weatherData)
      .where(
        and(
          eq(weatherData.stationId, stationId),
          gte(weatherData.timestamp, startTime),
          lte(weatherData.timestamp, endTime)
        )
      )
      .orderBy(weatherData.timestamp);
  }

  async insertWeatherData(data: InsertWeatherData): Promise<WeatherData> {
    const [result] = await db.insert(weatherData).values(data).returning();
    return result;
  }

  // User Preferences operations
  async getUserPreferences(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
    return prefs;
  }

  async upsertUserPreferences(prefs: InsertUserPreferences): Promise<UserPreferences> {
    const [result] = await db
      .insert(userPreferences)
      .values(prefs)
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          ...prefs,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  // Sensor operations
  async getSensors(stationId: number): Promise<Sensor[]> {
    return await db.select().from(sensors).where(eq(sensors.stationId, stationId));
  }

  async getSensor(id: number): Promise<Sensor | undefined> {
    const [sensor] = await db.select().from(sensors).where(eq(sensors.id, id));
    return sensor;
  }

  async createSensor(sensor: InsertSensor): Promise<Sensor> {
    const [newSensor] = await db.insert(sensors).values(sensor).returning();
    return newSensor;
  }

  async updateSensor(id: number, sensor: Partial<InsertSensor>): Promise<Sensor | undefined> {
    const [updated] = await db
      .update(sensors)
      .set({ ...sensor, updatedAt: new Date() })
      .where(eq(sensors.id, id))
      .returning();
    return updated;
  }

  async deleteSensor(id: number): Promise<boolean> {
    const result = await db.delete(sensors).where(eq(sensors.id, id)).returning();
    return result.length > 0;
  }

  // Calibration operations
  async getCalibrationRecords(sensorId: number): Promise<CalibrationRecord[]> {
    return await db
      .select()
      .from(calibrationRecords)
      .where(eq(calibrationRecords.sensorId, sensorId))
      .orderBy(desc(calibrationRecords.calibrationDate));
  }

  async getCalibrationsDue(stationId: number, daysAhead: number): Promise<CalibrationRecord[]> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const stationSensors = await this.getSensors(stationId);
    const sensorIds = stationSensors.map(s => s.id);

    if (sensorIds.length === 0) return [];

    return await db
      .select()
      .from(calibrationRecords)
      .where(
        and(
          lte(calibrationRecords.nextCalibrationDue, futureDate),
          gte(calibrationRecords.nextCalibrationDue, new Date())
        )
      )
      .orderBy(calibrationRecords.nextCalibrationDue);
  }

  async createCalibrationRecord(record: InsertCalibrationRecord): Promise<CalibrationRecord> {
    const [newRecord] = await db.insert(calibrationRecords).values(record).returning();
    return newRecord;
  }

  async updateCalibrationRecord(id: number, record: Partial<InsertCalibrationRecord>): Promise<CalibrationRecord | undefined> {
    const [updated] = await db
      .update(calibrationRecords)
      .set({ ...record, updatedAt: new Date() })
      .where(eq(calibrationRecords.id, id))
      .returning();
    return updated;
  }

  // Maintenance operations
  async getMaintenanceEvents(stationId: number, startDate?: Date, endDate?: Date): Promise<MaintenanceEvent[]> {
    let query = db.select().from(maintenanceEvents).where(eq(maintenanceEvents.stationId, stationId));

    if (startDate && endDate) {
      return await db
        .select()
        .from(maintenanceEvents)
        .where(
          and(
            eq(maintenanceEvents.stationId, stationId),
            gte(maintenanceEvents.eventDate, startDate),
            lte(maintenanceEvents.eventDate, endDate)
          )
        )
        .orderBy(desc(maintenanceEvents.eventDate));
    }

    return await db
      .select()
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.stationId, stationId))
      .orderBy(desc(maintenanceEvents.eventDate));
  }

  async createMaintenanceEvent(event: InsertMaintenanceEvent): Promise<MaintenanceEvent> {
    const [newEvent] = await db.insert(maintenanceEvents).values(event).returning();
    return newEvent;
  }

  async updateMaintenanceEvent(id: number, event: Partial<InsertMaintenanceEvent>): Promise<MaintenanceEvent | undefined> {
    const [updated] = await db
      .update(maintenanceEvents)
      .set({ ...event, updatedAt: new Date() })
      .where(eq(maintenanceEvents.id, id))
      .returning();
    return updated;
  }

  // Configuration change operations
  async getConfigurationHistory(stationId: number): Promise<ConfigurationChange[]> {
    return await db
      .select()
      .from(configurationChanges)
      .where(eq(configurationChanges.stationId, stationId))
      .orderBy(desc(configurationChanges.changeDate));
  }

  async createConfigurationChange(change: InsertConfigurationChange): Promise<ConfigurationChange> {
    const [newChange] = await db.insert(configurationChanges).values(change).returning();
    return newChange;
  }

  // Data quality flag operations
  async getDataQualityFlags(stationId: number, startTime?: Date, endTime?: Date): Promise<DataQualityFlag[]> {
    if (startTime && endTime) {
      return await db
        .select()
        .from(dataQualityFlags)
        .where(
          and(
            eq(dataQualityFlags.stationId, stationId),
            gte(dataQualityFlags.startTime, startTime),
            lte(dataQualityFlags.startTime, endTime)
          )
        )
        .orderBy(desc(dataQualityFlags.startTime));
    }

    return await db
      .select()
      .from(dataQualityFlags)
      .where(eq(dataQualityFlags.stationId, stationId))
      .orderBy(desc(dataQualityFlags.startTime));
  }

  async createDataQualityFlag(flag: InsertDataQualityFlag): Promise<DataQualityFlag> {
    const [newFlag] = await db.insert(dataQualityFlags).values(flag).returning();
    return newFlag;
  }

  async updateDataQualityFlag(id: number, flag: Partial<InsertDataQualityFlag>): Promise<DataQualityFlag | undefined> {
    const [updated] = await db
      .update(dataQualityFlags)
      .set(flag)
      .where(eq(dataQualityFlags.id, id))
      .returning();
    return updated;
  }

  // Alarm operations
  async getAlarms(stationId: number): Promise<Alarm[]> {
    return await db.select().from(alarms).where(eq(alarms.stationId, stationId));
  }

  async createAlarm(alarm: InsertAlarm): Promise<Alarm> {
    const [newAlarm] = await db.insert(alarms).values(alarm).returning();
    return newAlarm;
  }

  async updateAlarm(id: number, alarm: Partial<InsertAlarm>): Promise<Alarm | undefined> {
    const [updated] = await db
      .update(alarms)
      .set({ ...alarm, updatedAt: new Date() })
      .where(eq(alarms.id, id))
      .returning();
    return updated;
  }

  async deleteAlarm(id: number): Promise<boolean> {
    const result = await db.delete(alarms).where(eq(alarms.id, id)).returning();
    return result.length > 0;
  }

  // Alarm event operations
  async getAlarmEvents(stationId: number, startTime?: Date, endTime?: Date): Promise<AlarmEvent[]> {
    if (startTime && endTime) {
      return await db
        .select()
        .from(alarmEvents)
        .where(
          and(
            eq(alarmEvents.stationId, stationId),
            gte(alarmEvents.triggeredAt, startTime),
            lte(alarmEvents.triggeredAt, endTime)
          )
        )
        .orderBy(desc(alarmEvents.triggeredAt));
    }

    return await db
      .select()
      .from(alarmEvents)
      .where(eq(alarmEvents.stationId, stationId))
      .orderBy(desc(alarmEvents.triggeredAt));
  }

  async getActiveAlarmEvents(stationId: number): Promise<AlarmEvent[]> {
    return await db
      .select()
      .from(alarmEvents)
      .where(
        and(
          eq(alarmEvents.stationId, stationId),
          eq(alarmEvents.status, 'active')
        )
      )
      .orderBy(desc(alarmEvents.triggeredAt));
  }

  async createAlarmEvent(event: InsertAlarmEvent): Promise<AlarmEvent> {
    const [newEvent] = await db.insert(alarmEvents).values(event).returning();
    return newEvent;
  }

  async acknowledgeAlarmEvent(id: number, acknowledgedBy: string, notes?: string): Promise<AlarmEvent | undefined> {
    const [updated] = await db
      .update(alarmEvents)
      .set({
        acknowledgedAt: new Date(),
        acknowledgedBy,
        notes,
      })
      .where(eq(alarmEvents.id, id))
      .returning();
    return updated;
  }

  async clearAlarmEvent(id: number): Promise<AlarmEvent | undefined> {
    const [updated] = await db
      .update(alarmEvents)
      .set({
        clearedAt: new Date(),
        status: 'cleared',
      })
      .where(eq(alarmEvents.id, id))
      .returning();
    return updated;
  }

  // Datalogger program operations
  async getDataloggerPrograms(stationId: number): Promise<DataloggerProgram[]> {
    return await db
      .select()
      .from(dataloggerPrograms)
      .where(eq(dataloggerPrograms.stationId, stationId))
      .orderBy(desc(dataloggerPrograms.uploadedAt));
  }

  async createDataloggerProgram(program: InsertDataloggerProgram): Promise<DataloggerProgram> {
    const [newProgram] = await db.insert(dataloggerPrograms).values(program).returning();
    return newProgram;
  }

  // Station group operations
  async getStationGroups(): Promise<StationGroup[]> {
    return await db.select().from(stationGroups).orderBy(stationGroups.name);
  }

  async getStationGroup(id: number): Promise<StationGroup | undefined> {
    const [group] = await db.select().from(stationGroups).where(eq(stationGroups.id, id));
    return group;
  }

  async createStationGroup(group: InsertStationGroup): Promise<StationGroup> {
    const [newGroup] = await db.insert(stationGroups).values(group).returning();
    return newGroup;
  }

  async updateStationGroup(id: number, group: Partial<InsertStationGroup>): Promise<StationGroup | undefined> {
    const [updated] = await db
      .update(stationGroups)
      .set({ ...group, updatedAt: new Date() })
      .where(eq(stationGroups.id, id))
      .returning();
    return updated;
  }

  async deleteStationGroup(id: number): Promise<boolean> {
    const result = await db.delete(stationGroups).where(eq(stationGroups.id, id)).returning();
    return result.length > 0;
  }

  async addStationToGroup(groupId: number, stationId: number): Promise<StationGroupMember> {
    const [member] = await db
      .insert(stationGroupMembers)
      .values({ groupId, stationId })
      .returning();
    return member;
  }

  async removeStationFromGroup(groupId: number, stationId: number): Promise<boolean> {
    const result = await db
      .delete(stationGroupMembers)
      .where(
        and(
          eq(stationGroupMembers.groupId, groupId),
          eq(stationGroupMembers.stationId, stationId)
        )
      )
      .returning();
    return result.length > 0;
  }

  async getGroupStations(groupId: number): Promise<WeatherStation[]> {
    const results = await db
      .select()
      .from(stationGroupMembers)
      .innerJoin(weatherStations, eq(stationGroupMembers.stationId, weatherStations.id))
      .where(eq(stationGroupMembers.groupId, groupId));
    
    return results.map(r => r.weather_stations);
  }
}

export const storage = new DatabaseStorage();
