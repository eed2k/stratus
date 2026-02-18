/**
 * Shared Schema Definitions for Stratus Weather Server
 * 
 * ARCHITECTURE NOTE (Issue #17 - Type Alignment):
 * ================================================
 * This file defines schemas using Drizzle ORM with PostgreSQL types for
 * cloud deployment compatibility.
 * 
 * For desktop/Electron deployments, the application uses SQLite via sql.js
 * (see server/db.ts). The actual database schema is defined in db.ts
 * createTables() and runMigrations() functions.
 * 
 * Type mapping between PostgreSQL (this file) and SQLite (db.ts):
 * - serial/integer -> INTEGER
 * - varchar/text -> TEXT  
 * - timestamp -> DATETIME (stored as ISO string)
 * - jsonb -> TEXT (JSON serialized)
 * - boolean -> INTEGER (0/1)
 * - real -> REAL
 * 
 * The Zod schemas exported here are used for runtime validation in routes.ts
 * and are compatible with both storage backends.
 * 
 * When adding new tables:
 * 1. Define PostgreSQL schema here for cloud deployments
 * 2. Add corresponding SQLite CREATE TABLE in server/db.ts createTables()
 * 3. Add migration logic in server/db.ts runMigrations() for existing databases
 * 4. Export Zod schemas for route validation
 */

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
  // DEPRECATED: Serial fields not used in cloud deployment
  serialPort: text("serial_port"), // Kept for schema compatibility
  baudRate: integer("baud_rate").default(115200), // Kept for schema compatibility
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
  stationImage: text("station_image"), // Base64 encoded image or URL
  ingestId: varchar("ingest_id", { length: 10 }), // Unique alphanumeric ID for HTTP POST ingestion
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
    // Water & sensor fields
    waterLevel: real("water_level"),
    temperatureSwitch: real("temperature_switch"),
    levelSwitch: real("level_switch"),
    temperatureSwitchOutlet: real("temperature_switch_outlet"),
    levelSwitchStatus: real("level_switch_status"),
    // Lightning
    lightning: real("lightning"),
    // Charger
    chargerVoltage: real("charger_voltage"),
    // Wind direction standard deviation & SDI-12 wind vector
    windDirStdDev: real("wind_dir_std_dev"),
    sdi12WindVector: real("sdi12_wind_vector"),
    // Pump & port status fields
    pumpSelectWell: real("pump_select_well"),
    pumpSelectBore: real("pump_select_bore"),
    portStatusC1: real("port_status_c1"),
    portStatusC2: real("port_status_c2"),
    // MPPT Solar Charge Controller fields
    mpptSolarVoltage: real("mppt_solar_voltage"),
    mpptSolarCurrent: real("mppt_solar_current"),
    mpptSolarPower: real("mppt_solar_power"),
    mpptLoadVoltage: real("mppt_load_voltage"),
    mpptLoadCurrent: real("mppt_load_current"),
    mpptBatteryVoltage: real("mppt_battery_voltage"),
    mpptChargerState: real("mppt_charger_state"),
    mpptAbsiAvg: real("mppt_absi_avg"),
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

// Sensors table - Track individual sensors at each station (ISO 19115 Metadata Compliant)
export const sensors = pgTable("sensors", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  sensorType: varchar("sensor_type", { length: 100 }).notNull(),
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNumber: text("serial_number"),
  firmwareVersion: text("firmware_version"),
  measurementType: varchar("measurement_type", { length: 50 }).notNull(),
  // ISO 19115 Lineage/Provenance
  dataProducer: text("data_producer"), // Organization responsible for data
  dataProcessingLevel: varchar("data_processing_level", { length: 20 }).default("raw"), // raw, qc, calibrated
  // Measurement Specifications
  measurementRange: jsonb("measurement_range"), // {min, max, unit}
  measurementResolution: real("measurement_resolution"),
  measurementAccuracy: real("measurement_accuracy"),
  measurementUncertainty: real("measurement_uncertainty"),
  measurementUnit: text("measurement_unit"),
  samplingInterval: integer("sampling_interval"), // seconds
  averagingPeriod: integer("averaging_period"), // seconds
  // Installation Details
  installationDate: timestamp("installation_date"),
  installationHeight: real("installation_height"),
  installationDepth: real("installation_depth"),
  orientation: text("orientation"),
  boomPosition: text("boom_position"),
  boomAzimuth: real("boom_azimuth"), // degrees from north
  shieldingType: text("shielding_type"), // e.g., "Stevenson screen", "radiation shield"
  // Calibration Status
  lastCalibrationDate: timestamp("last_calibration_date"),
  nextCalibrationDue: timestamp("next_calibration_due"),
  calibrationInterval: integer("calibration_interval"), // months
  calibrationStatus: varchar("calibration_status", { length: 20 }).default("unknown"), // valid, expired, due_soon
  // Documentation
  wiringDiagram: text("wiring_diagram"),
  datasheet: text("datasheet_url"),
  manualUrl: text("manual_url"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_sensors_station").on(table.stationId),
  index("IDX_sensors_calibration_due").on(table.nextCalibrationDue),
]);

export const insertSensorSchema = createInsertSchema(sensors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSensor = z.infer<typeof insertSensorSchema>;
export type Sensor = typeof sensors.$inferSelect;

// Calibration Records table - ISO/IEC 17025 & NIST Traceability Compliant
export const calibrationRecords = pgTable("calibration_records", {
  id: serial("id").primaryKey(),
  sensorId: integer("sensor_id").notNull().references(() => sensors.id, { onDelete: "cascade" }),
  calibrationDate: timestamp("calibration_date").notNull(),
  nextCalibrationDue: timestamp("next_calibration_due"),
  // Calibrating Laboratory (ISO 17025)
  calibratingInstitution: text("calibrating_institution"),
  laboratoryAccreditation: text("laboratory_accreditation"), // e.g., "ISO/IEC 17025:2017", "NVLAP", "A2LA"
  accreditationNumber: text("accreditation_number"),
  accreditationScope: text("accreditation_scope"),
  certificateNumber: text("certificate_number"),
  certificateFileUrl: text("certificate_file_url"),
  // NIST Traceability Chain
  calibrationStandard: text("calibration_standard"),
  referenceStandardId: text("reference_standard_id"), // ID of reference standard used
  referenceStandardTraceability: text("reference_standard_traceability"), // Chain back to NIST/national standard
  referenceStandardCertificateNumber: text("reference_standard_certificate_number"),
  referenceStandardCalibrationDate: timestamp("reference_standard_calibration_date"),
  // Measurement Uncertainty (ISO/IEC 17025 requirement)
  uncertaintyValue: real("uncertainty_value"),
  uncertaintyUnit: text("uncertainty_unit"),
  uncertaintyConfidenceLevel: real("uncertainty_confidence_level").default(95), // % confidence (typically 95%)
  uncertaintyCoverageFactor: real("uncertainty_coverage_factor").default(2), // k-factor (typically k=2)
  uncertaintyBudget: jsonb("uncertainty_budget"), // Detailed uncertainty components
  // Environmental Conditions During Calibration
  calibrationTemperature: real("calibration_temperature"),
  calibrationHumidity: real("calibration_humidity"),
  calibrationPressure: real("calibration_pressure"),
  temperatureCoefficient: real("temperature_coefficient"),
  // Calibration Results
  preCalibrationReading: real("pre_calibration_reading"),
  postCalibrationReading: real("post_calibration_reading"),
  adjustmentFactor: real("adjustment_factor"),
  correctionPolynomial: jsonb("correction_polynomial"), // For multi-point calibration curves
  calibrationPoints: jsonb("calibration_points"), // Array of {reference, measured, deviation}
  // Status and Compliance
  calibrationStatus: varchar("calibration_status", { length: 50 }).default("valid"), // valid, expired, due_soon, suspended
  calibrationMethod: text("calibration_method"), // Reference to calibration procedure
  complianceStandard: text("compliance_standard"), // e.g., "ISO 17714:2007" for meteorological instruments
  notes: text("notes"),
  performedBy: text("performed_by"),
  verifiedBy: text("verified_by"), // Second signatory for ISO 17025
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_calibration_sensor_date").on(table.sensorId, table.calibrationDate),
  index("IDX_calibration_due_date").on(table.nextCalibrationDue),
  index("IDX_calibration_status").on(table.calibrationStatus),
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

// Data Quality Flags table - ISO 19157 (Data Quality) Compliant
export const dataQualityFlags = pgTable("data_quality_flags", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => weatherStations.id, { onDelete: "cascade" }),
  sensorId: integer("sensor_id").references(() => sensors.id, { onDelete: "set null" }),
  // Time range affected
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  // ISO 19157 Data Quality Elements
  flagType: varchar("flag_type", { length: 50 }).notNull(), // missing, suspect, estimated, interpolated, aggregated, validated, rejected
  qualityDimension: varchar("quality_dimension", { length: 50 }), // completeness, logical_consistency, positional_accuracy, temporal_accuracy, thematic_accuracy
  qualityMeasure: varchar("quality_measure", { length: 100 }), // e.g., "rate of missing items", "value domain non-conformance"
  qualityResult: jsonb("quality_result"), // {value, unit, pass_fail, conformance_level}
  // WMO Quality Control Levels
  qcLevel: integer("qc_level").default(0), // 0=raw, 1=automatic_qc, 2=manual_qc, 3=validated
  // Severity and scope
  severity: varchar("severity", { length: 20 }).default("warning"), // info, warning, error, critical
  affectedParameters: jsonb("affected_parameters"), // Array of parameter names
  affectedRecordCount: integer("affected_record_count"),
  // Cause and resolution
  reason: text("reason"),
  causeCategory: varchar("cause_category", { length: 50 }), // sensor_failure, maintenance, calibration, environmental, communication, unknown
  correctionApplied: boolean("correction_applied").default(false),
  correctionMethod: text("correction_method"),
  correctedValue: jsonb("corrected_value"),
  // Related records
  relatedMaintenanceId: integer("related_maintenance_id").references(() => maintenanceEvents.id),
  relatedCalibrationId: integer("related_calibration_id").references(() => calibrationRecords.id),
  // Review workflow
  flaggedBy: text("flagged_by"),
  flaggedMethod: varchar("flagged_method", { length: 20 }).default("automatic"), // automatic, manual
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewStatus: varchar("review_status", { length: 20 }).default("pending"), // pending, approved, rejected, deferred
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_quality_flags_station_time").on(table.stationId, table.startTime, table.endTime),
  index("IDX_quality_flags_type").on(table.flagType),
  index("IDX_quality_flags_qc_level").on(table.qcLevel),
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

// ============================================================================
// COMPLIANCE & AUDIT TABLES (GDPR Art. 32, ISO 27001, ISO 27701)
// ============================================================================

// Audit Log table - Comprehensive data access and modification tracking
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  // Event identification
  eventType: varchar("event_type", { length: 50 }).notNull(), // create, read, update, delete, export, login, logout, share
  eventCategory: varchar("event_category", { length: 50 }).notNull(), // data_access, data_modification, authentication, configuration, export
  // Actor information
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  userEmail: text("user_email"),
  userRole: varchar("user_role", { length: 50 }),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  sessionId: text("session_id"),
  // Target information
  resourceType: varchar("resource_type", { length: 50 }).notNull(), // station, sensor, weather_data, user, calibration, etc.
  resourceId: text("resource_id"),
  resourceName: text("resource_name"),
  stationId: integer("station_id").references(() => weatherStations.id, { onDelete: "set null" }),
  // Event details
  action: text("action").notNull(),
  description: text("description"),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  affectedFields: jsonb("affected_fields"), // Array of field names changed
  // Data export specifics (GDPR Art. 20 - Right to data portability)
  exportFormat: varchar("export_format", { length: 20 }),
  exportDataRange: jsonb("export_data_range"), // {startDate, endDate, parameters}
  exportRecordCount: integer("export_record_count"),
  // Request tracking
  requestId: text("request_id"), // For correlation
  requestMethod: varchar("request_method", { length: 10 }),
  requestPath: text("request_path"),
  responseStatus: integer("response_status"),
  // Compliance metadata
  legalBasis: varchar("legal_basis", { length: 50 }), // consent, contract, legal_obligation, vital_interest, public_task, legitimate_interest
  dataProcessingPurpose: text("data_processing_purpose"),
  retentionPeriod: integer("retention_period"), // days
  // Timestamps
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
}, (table) => [
  index("IDX_audit_log_timestamp").on(table.timestamp),
  index("IDX_audit_log_user").on(table.userId),
  index("IDX_audit_log_station").on(table.stationId),
  index("IDX_audit_log_event_type").on(table.eventType),
  index("IDX_audit_log_resource").on(table.resourceType, table.resourceId),
]);

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({
  id: true,
  timestamp: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

// Data Retention Policies table (GDPR Art. 5(1)(e) - Storage limitation)
export const dataRetentionPolicies = pgTable("data_retention_policies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  // Scope
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  stationId: integer("station_id").references(() => weatherStations.id, { onDelete: "cascade" }),
  dataType: varchar("data_type", { length: 50 }).notNull(), // weather_data, audit_log, calibration, maintenance, etc.
  // Retention rules
  retentionPeriodDays: integer("retention_period_days").notNull(),
  retentionPeriodType: varchar("retention_period_type", { length: 20 }).default("rolling"), // rolling, fixed_date
  archiveBeforeDelete: boolean("archive_before_delete").default(true),
  archiveLocation: text("archive_location"),
  // Aggregation rules (keep aggregated data longer than raw data)
  aggregationLevel: varchar("aggregation_level", { length: 20 }), // none, hourly, daily, monthly
  aggregatedRetentionDays: integer("aggregated_retention_days"),
  // Legal basis
  legalBasis: text("legal_basis"),
  regulatoryRequirement: text("regulatory_requirement"),
  // Execution
  lastExecuted: timestamp("last_executed"),
  nextExecution: timestamp("next_execution"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_retention_policies_station").on(table.stationId),
  index("IDX_retention_policies_next_exec").on(table.nextExecution),
]);

export const insertDataRetentionPolicySchema = createInsertSchema(dataRetentionPolicies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastExecuted: true,
});

export type InsertDataRetentionPolicy = z.infer<typeof insertDataRetentionPolicySchema>;
export type DataRetentionPolicy = typeof dataRetentionPolicies.$inferSelect;

// Data Subject Requests table (GDPR Art. 15-22 - Rights of the data subject)
export const dataSubjectRequests = pgTable("data_subject_requests", {
  id: serial("id").primaryKey(),
  // Request identification
  requestType: varchar("request_type", { length: 50 }).notNull(), // access, rectification, erasure, restriction, portability, objection
  requestReference: text("request_reference").notNull().unique(),
  // Data subject information
  dataSubjectEmail: text("data_subject_email").notNull(),
  dataSubjectName: text("data_subject_name"),
  dataSubjectId: varchar("data_subject_id").references(() => users.id, { onDelete: "set null" }),
  // Request details
  requestDate: timestamp("request_date").notNull().defaultNow(),
  requestDetails: text("request_details"),
  scopeDescription: text("scope_description"),
  affectedStations: jsonb("affected_stations"), // Array of station IDs
  // Processing
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, in_progress, completed, rejected
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  dueDate: timestamp("due_date").notNull(), // GDPR requires response within 30 days
  completedDate: timestamp("completed_date"),
  // Response
  responseDetails: text("response_details"),
  rejectionReason: text("rejection_reason"),
  dataExportUrl: text("data_export_url"), // For access/portability requests
  dataExportExpiry: timestamp("data_export_expiry"),
  // Audit trail
  verificationMethod: varchar("verification_method", { length: 50 }), // email, id_document, etc.
  verifiedAt: timestamp("verified_at"),
  verifiedBy: varchar("verified_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_dsr_email").on(table.dataSubjectEmail),
  index("IDX_dsr_status").on(table.status),
  index("IDX_dsr_due_date").on(table.dueDate),
]);

export const insertDataSubjectRequestSchema = createInsertSchema(dataSubjectRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  completedDate: true,
});

export type InsertDataSubjectRequest = z.infer<typeof insertDataSubjectRequestSchema>;
export type DataSubjectRequest = typeof dataSubjectRequests.$inferSelect;

// Consent Records table (GDPR Art. 7 - Conditions for consent)
export const consentRecords = pgTable("consent_records", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Consent type
  consentType: varchar("consent_type", { length: 50 }).notNull(), // data_processing, marketing, third_party_sharing, analytics
  consentPurpose: text("consent_purpose").notNull(),
  // Consent details
  consentGiven: boolean("consent_given").notNull(),
  consentDate: timestamp("consent_date").notNull().defaultNow(),
  consentMethod: varchar("consent_method", { length: 50 }).notNull(), // explicit_opt_in, checkbox, verbal, written
  consentText: text("consent_text"), // The actual consent text shown to user
  consentVersion: text("consent_version"),
  // Withdrawal
  withdrawnAt: timestamp("withdrawn_at"),
  withdrawalMethod: varchar("withdrawal_method", { length: 50 }),
  // Metadata
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  source: varchar("source", { length: 50 }), // registration, settings, popup, etc.
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_consent_user").on(table.userId),
  index("IDX_consent_type").on(table.consentType),
]);

export const insertConsentRecordSchema = createInsertSchema(consentRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertConsentRecord = z.infer<typeof insertConsentRecordSchema>;
export type ConsentRecord = typeof consentRecords.$inferSelect;

// Compliance Certifications table - Track station/organization compliance status
export const complianceCertifications = pgTable("compliance_certifications", {
  id: serial("id").primaryKey(),
  // Scope
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  stationId: integer("station_id").references(() => weatherStations.id, { onDelete: "cascade" }),
  // Certification details
  standardName: text("standard_name").notNull(), // ISO 17025, ISO 27001, ISO 19115, WMO OSCAR, etc.
  standardVersion: text("standard_version"),
  certificationNumber: text("certification_number"),
  certifyingBody: text("certifying_body"),
  // Validity
  issueDate: timestamp("issue_date").notNull(),
  expiryDate: timestamp("expiry_date"),
  status: varchar("status", { length: 20 }).default("active"), // active, expired, suspended, pending
  // Documentation
  certificateUrl: text("certificate_url"),
  scopeDescription: text("scope_description"),
  // Audit history
  lastAuditDate: timestamp("last_audit_date"),
  nextAuditDate: timestamp("next_audit_date"),
  auditNotes: text("audit_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_certifications_station").on(table.stationId),
  index("IDX_certifications_expiry").on(table.expiryDate),
]);

export const insertComplianceCertificationSchema = createInsertSchema(complianceCertifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertComplianceCertification = z.infer<typeof insertComplianceCertificationSchema>;
export type ComplianceCertification = typeof complianceCertifications.$inferSelect;
