import {
  users,
  weatherStations,
  weatherData,
  userStations,
  userPreferences,
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
}

export const storage = new DatabaseStorage();
