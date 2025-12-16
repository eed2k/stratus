import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  integer,
  real,
  boolean,
  serial,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table - Required for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - Required for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Weather Stations table
export const weatherStations = pgTable("weather_stations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  altitude: real("altitude"),
  apiKey: text("api_key"),
  apiEndpoint: text("api_endpoint"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWeatherStationSchema = createInsertSchema(weatherStations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWeatherStation = z.infer<typeof insertWeatherStationSchema>;
export type WeatherStation = typeof weatherStations.$inferSelect;

// User-Station relationship (many-to-many)
export const userStations = pgTable("user_stations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserStationSchema = createInsertSchema(userStations).omit({
  id: true,
  createdAt: true,
});

export type InsertUserStation = z.infer<typeof insertUserStationSchema>;
export type UserStation = typeof userStations.$inferSelect;

// Weather Data table
export const weatherData = pgTable(
  "weather_data",
  {
    id: serial("id").primaryKey(),
    stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp").notNull(),
    temperature: real("temperature"),
    humidity: real("humidity"),
    pressure: real("pressure"),
    windSpeed: real("wind_speed"),
    windDirection: real("wind_direction"),
    windGust: real("wind_gust"),
    rainfall: real("rainfall"),
    solarRadiation: real("solar_radiation"),
    uvIndex: real("uv_index"),
    dewPoint: real("dew_point"),
    airDensity: real("air_density"),
    eto: real("eto"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("IDX_weather_data_station_timestamp").on(table.stationId, table.timestamp),
  ],
);

export const insertWeatherDataSchema = createInsertSchema(weatherData).omit({
  id: true,
  createdAt: true,
});

export type InsertWeatherData = z.infer<typeof insertWeatherDataSchema>;
export type WeatherData = typeof weatherData.$inferSelect;

// User preferences table
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  temperatureUnit: varchar("temperature_unit").default("celsius"),
  windSpeedUnit: varchar("wind_speed_unit").default("kmh"),
  pressureUnit: varchar("pressure_unit").default("hpa"),
  rainfallUnit: varchar("rainfall_unit").default("mm"),
  theme: varchar("theme").default("system"),
  emailAlerts: boolean("email_alerts").default(false),
  pushNotifications: boolean("push_notifications").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;
