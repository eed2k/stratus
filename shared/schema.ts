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

// Organizations table
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  description: text("description"),
  ownerId: varchar("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

// Organization Members table
export const organizationMembers = pgTable("organization_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().default("member"), // admin, member, viewer
  status: varchar("status", { length: 20 }).notNull().default("active"), // active, pending, inactive
  joinedAt: timestamp("joined_at").defaultNow(),
  invitedBy: varchar("invited_by").references(() => users.id),
});

export const insertOrganizationMemberSchema = createInsertSchema(organizationMembers).omit({
  id: true,
  joinedAt: true,
});

export type InsertOrganizationMember = z.infer<typeof insertOrganizationMemberSchema>;
export type OrganizationMember = typeof organizationMembers.$inferSelect;

// Organization Invitations table
export const organizationInvitations = pgTable("organization_invitations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  token: text("token").notNull().unique(),
  invitedBy: varchar("invited_by").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOrganizationInvitationSchema = createInsertSchema(organizationInvitations).omit({
  id: true,
  createdAt: true,
  acceptedAt: true,
});

export type InsertOrganizationInvitation = z.infer<typeof insertOrganizationInvitationSchema>;
export type OrganizationInvitation = typeof organizationInvitations.$inferSelect;

// Weather Stations table
export const weatherStations = pgTable("weather_stations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  location: text("location"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  altitude: real("altitude"),
  timezone: text("timezone").default("UTC"),
  siteDescription: text("site_description"),
  installationDate: timestamp("installation_date"),
  stationType: varchar("station_type", { length: 50 }).default("campbell_scientific"),
  dataloggerModel: varchar("datalogger_model", { length: 50 }),
  dataloggerSerialNumber: text("datalogger_serial_number"),
  dataloggerFirmwareVersion: text("datalogger_firmware_version"),
  dataloggerProgramName: text("datalogger_program_name"),
  dataloggerProgramSignature: text("datalogger_program_signature"),
  connectionType: varchar("connection_type", { length: 50 }).default("http"),
  protocol: varchar("protocol", { length: 50 }).default("pakbus"),
  ipAddress: text("ip_address"),
  port: integer("port").default(6785),
  serialPort: text("serial_port"),
  baudRate: integer("baud_rate").default(115200),
  pakbusAddress: integer("pakbus_address").default(1),
  securityCode: integer("security_code").default(0),
  username: text("username"),
  password: text("password"),
  apiKey: text("api_key"),
  apiEndpoint: text("api_endpoint"),
  dataTable: text("data_table").default("OneMin"),
  pollInterval: integer("poll_interval").default(60),
  connectionConfig: jsonb("connection_config"),
  isActive: boolean("is_active").default(true),
  isConnected: boolean("is_connected").default(false),
  lastConnectionTime: timestamp("last_connection_time"),
  lastDataTime: timestamp("last_data_time"),
  batteryVoltage: real("battery_voltage"),
  panelTemperature: real("panel_temperature"),
  installationTeam: text("installation_team"),
  stationAdmin: text("station_admin"),
  stationAdminEmail: text("station_admin_email"),
  stationAdminPhone: text("station_admin_phone"),
  // Maintenance and notes fields
  notes: text("notes"),
  lastCalibrationDate: timestamp("last_calibration_date"),
  nextCalibrationDate: timestamp("next_calibration_date"),
  maintenanceHistory: text("maintenance_history"),
  modemModel: varchar("modem_model", { length: 100 }),
  modemSerialNumber: text("modem_serial_number"),
  modemPhoneNumber: text("modem_phone_number"),
  simCardNumber: text("sim_card_number"),
  antennaType: varchar("antenna_type", { length: 100 }),
  solarPanelWatts: integer("solar_panel_watts"),
  batteryAmpHours: integer("battery_amp_hours"),
  enclosureType: varchar("enclosure_type", { length: 100 }),
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
    temperatureMin: real("temperature_min"),
    temperatureMax: real("temperature_max"),
    humidity: real("humidity"),
    pressure: real("pressure"),
    pressureSeaLevel: real("pressure_sea_level"),
    windSpeed: real("wind_speed"),
    windDirection: real("wind_direction"),
    windGust: real("wind_gust"),
    windGust10min: real("wind_gust_10min"),
    windPower: real("wind_power"),
    rainfall: real("rainfall"),
    rainfall10min: real("rainfall_10min"),
    rainfall24h: real("rainfall_24h"),
    rainfall7d: real("rainfall_7d"),
    rainfall30d: real("rainfall_30d"),
    rainfallYearly: real("rainfall_yearly"),
    solarRadiation: real("solar_radiation"),
    solarRadiationMax: real("solar_radiation_max"),
    uvIndex: real("uv_index"),
    dewPoint: real("dew_point"),
    airDensity: real("air_density"),
    eto: real("eto"),
    eto24h: real("eto_24h"),
    eto7d: real("eto_7d"),
    eto30d: real("eto_30d"),
    sunAzimuth: real("sun_azimuth"),
    sunElevation: real("sun_elevation"),
    sunrise: timestamp("sunrise"),
    sunset: timestamp("sunset"),
    soilTemperature: real("soil_temperature"),
    soilMoisture: real("soil_moisture"),
    leafWetness: real("leaf_wetness"),
    visibility: real("visibility"),
    cloudBase: real("cloud_base"),
    batteryVoltage: real("battery_voltage"),
    panelTemperature: real("panel_temperature"),
    // Air quality metrics
    pm25: real("pm25"),
    pm10: real("pm10"),
    pm1: real("pm1"),
    particulateCount: real("particulate_count"),
    aqi: integer("aqi"),
    co2: real("co2"),
    tvoc: real("tvoc"),
    // Additional atmospheric
    atmosphericVisibility: real("atmospheric_visibility"),
    cloudCover: real("cloud_cover"),
    // Davis-specific fields
    consoleBatteryVoltage: real("console_battery_voltage"),
    transmitterBatteryStatus: integer("transmitter_battery_status"),
    forecastIcon: integer("forecast_icon"),
    forecastRule: integer("forecast_rule"),
    stormRain: real("storm_rain"),
    stormStartDate: timestamp("storm_start_date"),
    dayRain: real("day_rain"),
    monthRain: real("month_rain"),
    yearRain: real("year_rain"),
    dayET: real("day_et"),
    monthET: real("month_et"),
    yearET: real("year_et"),
    insideTemperature: real("inside_temperature"),
    insideHumidity: real("inside_humidity"),
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

// Sensors table - Track individual sensors at each station
export const sensors = pgTable("sensors", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  sensorType: varchar("sensor_type", { length: 100 }).notNull(),
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNumber: text("serial_number"),
  measurementType: varchar("measurement_type", { length: 50 }).notNull(),
  installationDate: timestamp("installation_date"),
  installationHeight: real("installation_height"),
  installationDepth: real("installation_depth"),
  orientation: text("orientation"),
  boomPosition: text("boom_position"),
  wiringDiagram: text("wiring_diagram"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSensorSchema = createInsertSchema(sensors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSensor = z.infer<typeof insertSensorSchema>;
export type Sensor = typeof sensors.$inferSelect;

// Calibration Records table
export const calibrationRecords = pgTable("calibration_records", {
  id: serial("id").primaryKey(),
  sensorId: integer("sensor_id").notNull().references(() => sensors.id, { onDelete: "cascade" }),
  calibrationDate: timestamp("calibration_date").notNull(),
  nextCalibrationDue: timestamp("next_calibration_due"),
  calibratingInstitution: text("calibrating_institution"),
  certificateNumber: text("certificate_number"),
  certificateFileUrl: text("certificate_file_url"),
  calibrationStandard: text("calibration_standard"),
  uncertaintyValue: real("uncertainty_value"),
  uncertaintyUnit: text("uncertainty_unit"),
  temperatureCoefficient: real("temperature_coefficient"),
  preCalibrationReading: real("pre_calibration_reading"),
  postCalibrationReading: real("post_calibration_reading"),
  adjustmentFactor: real("adjustment_factor"),
  calibrationStatus: varchar("calibration_status", { length: 50 }).default("valid"),
  notes: text("notes"),
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_calibration_sensor_date").on(table.sensorId, table.calibrationDate),
  index("IDX_calibration_due_date").on(table.nextCalibrationDue),
]);

export const insertCalibrationRecordSchema = createInsertSchema(calibrationRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCalibrationRecord = z.infer<typeof insertCalibrationRecordSchema>;
export type CalibrationRecord = typeof calibrationRecords.$inferSelect;

// Maintenance Events table
export const maintenanceEvents = pgTable("maintenance_events", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  sensorId: integer("sensor_id").references(() => sensors.id, { onDelete: "set null" }),
  eventDate: timestamp("event_date").notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  description: text("description").notNull(),
  performedBy: text("performed_by"),
  partsReplaced: text("parts_replaced"),
  oldSerialNumber: text("old_serial_number"),
  newSerialNumber: text("new_serial_number"),
  downtimeMinutes: integer("downtime_minutes"),
  beforePhotos: jsonb("before_photos"),
  afterPhotos: jsonb("after_photos"),
  dataQualityImpact: boolean("data_quality_impact").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_maintenance_station_date").on(table.stationId, table.eventDate),
]);

export const insertMaintenanceEventSchema = createInsertSchema(maintenanceEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMaintenanceEvent = z.infer<typeof insertMaintenanceEventSchema>;
export type MaintenanceEvent = typeof maintenanceEvents.$inferSelect;

// Configuration Changes table - Audit trail
export const configurationChanges = pgTable("configuration_changes", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  changeDate: timestamp("change_date").notNull().defaultNow(),
  changeType: varchar("change_type", { length: 50 }).notNull(),
  fieldChanged: text("field_changed"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  changedBy: text("changed_by"),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_config_changes_station_date").on(table.stationId, table.changeDate),
]);

export const insertConfigurationChangeSchema = createInsertSchema(configurationChanges).omit({
  id: true,
  createdAt: true,
});

export type InsertConfigurationChange = z.infer<typeof insertConfigurationChangeSchema>;
export type ConfigurationChange = typeof configurationChanges.$inferSelect;

// Data Quality Flags table
export const dataQualityFlags = pgTable("data_quality_flags", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  flagType: varchar("flag_type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("warning"),
  affectedParameters: jsonb("affected_parameters"),
  reason: text("reason"),
  relatedMaintenanceId: integer("related_maintenance_id").references(() => maintenanceEvents.id),
  relatedCalibrationId: integer("related_calibration_id").references(() => calibrationRecords.id),
  flaggedBy: text("flagged_by"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_quality_flags_station_time").on(table.stationId, table.startTime, table.endTime),
]);

export const insertDataQualityFlagSchema = createInsertSchema(dataQualityFlags).omit({
  id: true,
  createdAt: true,
});

export type InsertDataQualityFlag = z.infer<typeof insertDataQualityFlagSchema>;
export type DataQualityFlag = typeof dataQualityFlags.$inferSelect;

// Alarms table
export const alarms = pgTable("alarms", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  alarmName: text("alarm_name").notNull(),
  alarmType: varchar("alarm_type", { length: 50 }).notNull(),
  parameter: varchar("parameter", { length: 50 }).notNull(),
  condition: varchar("condition", { length: 50 }).notNull(),
  thresholdValue: real("threshold_value"),
  thresholdValueHigh: real("threshold_value_high"),
  hysteresis: real("hysteresis"),
  duration: integer("duration"),
  severity: varchar("severity", { length: 20 }).default("warning"),
  isEnabled: boolean("is_enabled").default(true),
  notificationEmail: text("notification_email"),
  notificationSms: text("notification_sms"),
  notificationWebhook: text("notification_webhook"),
  escalationLevel: integer("escalation_level").default(1),
  escalationDelay: integer("escalation_delay"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_alarms_station").on(table.stationId),
]);

export const insertAlarmSchema = createInsertSchema(alarms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAlarm = z.infer<typeof insertAlarmSchema>;
export type Alarm = typeof alarms.$inferSelect;

// Alarm Events table - Log of triggered alarms
export const alarmEvents = pgTable("alarm_events", {
  id: serial("id").primaryKey(),
  alarmId: integer("alarm_id").notNull().references(() => alarms.id, { onDelete: "cascade" }),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  clearedAt: timestamp("cleared_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  triggerValue: real("trigger_value"),
  status: varchar("status", { length: 20 }).default("active"),
  notificationsSent: jsonb("notifications_sent"),
  notes: text("notes"),
}, (table) => [
  index("IDX_alarm_events_station_time").on(table.stationId, table.triggeredAt),
  index("IDX_alarm_events_status").on(table.status),
]);

export const insertAlarmEventSchema = createInsertSchema(alarmEvents).omit({
  id: true,
});

export type InsertAlarmEvent = z.infer<typeof insertAlarmEventSchema>;
export type AlarmEvent = typeof alarmEvents.$inferSelect;

// Datalogger Programs table - Store program versions
export const dataloggerPrograms = pgTable("datalogger_programs", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  programName: text("program_name").notNull(),
  programVersion: text("program_version"),
  programSignature: text("program_signature"),
  programContent: text("program_content"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  uploadedBy: text("uploaded_by"),
  compileStatus: varchar("compile_status", { length: 50 }),
  compileErrors: text("compile_errors"),
  isActive: boolean("is_active").default(true),
  notes: text("notes"),
}, (table) => [
  index("IDX_programs_station").on(table.stationId),
]);

export const insertDataloggerProgramSchema = createInsertSchema(dataloggerPrograms).omit({
  id: true,
  uploadedAt: true,
});

export type InsertDataloggerProgram = z.infer<typeof insertDataloggerProgramSchema>;
export type DataloggerProgram = typeof dataloggerPrograms.$inferSelect;

// Station Groups table - Organize multiple stations
export const stationGroups = pgTable("station_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertStationGroupSchema = createInsertSchema(stationGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStationGroup = z.infer<typeof insertStationGroupSchema>;
export type StationGroup = typeof stationGroups.$inferSelect;

// Station Group Members table
export const stationGroupMembers = pgTable("station_group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => stationGroups.id, { onDelete: "cascade" }),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStationGroupMemberSchema = createInsertSchema(stationGroupMembers).omit({
  id: true,
  createdAt: true,
});

export type InsertStationGroupMember = z.infer<typeof insertStationGroupMemberSchema>;
export type StationGroupMember = typeof stationGroupMembers.$inferSelect;

// Station Logs table - Comprehensive log for updates, upgrades, errors, calibrations
export const stationLogs = pgTable("station_logs", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  logType: varchar("log_type", { length: 50 }).notNull(),
  severity: varchar("severity", { length: 20 }).default("info"),
  title: text("title").notNull(),
  message: text("message"),
  details: jsonb("details"),
  source: varchar("source", { length: 100 }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_station_logs_station_type").on(table.stationId, table.logType),
  index("IDX_station_logs_created").on(table.createdAt),
]);

export const insertStationLogSchema = createInsertSchema(stationLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertStationLog = z.infer<typeof insertStationLogSchema>;
export type StationLog = typeof stationLogs.$inferSelect;

// Station Shares table - Share dashboard access with clients/viewers
export const stationShares = pgTable("station_shares", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  shareToken: text("share_token").notNull().unique(),
  name: text("name").notNull(), // Name/description for this share link
  email: text("email"), // Optional: email of the person it's shared with
  accessLevel: varchar("access_level", { length: 20 }).notNull().default("viewer"), // viewer (read-only), editor (can edit settings)
  password: text("password"), // Optional: password protection
  expiresAt: timestamp("expires_at"), // Optional: expiration date
  isActive: boolean("is_active").default(true),
  lastAccessedAt: timestamp("last_accessed_at"),
  accessCount: integer("access_count").default(0),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_station_shares_token").on(table.shareToken),
  index("IDX_station_shares_station").on(table.stationId),
]);

export const insertStationShareSchema = createInsertSchema(stationShares).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastAccessedAt: true,
  accessCount: true,
});

export type InsertStationShare = z.infer<typeof insertStationShareSchema>;
export type StationShare = typeof stationShares.$inferSelect;
