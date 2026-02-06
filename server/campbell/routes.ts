import type { Express } from "express";
import { dataCollectionService } from "./dataCollectionService";
import { isAuthenticated } from "../localAuth";
import { storage } from "../localStorage";
import { z } from "zod";
import { sendTestEmail, sendAlarmEmail, isEmailConfigured } from "../services/emailService";

// Local schema definitions
const insertSensorSchema = z.object({
  stationId: z.number(),
  name: z.string(),
  type: z.string(),
  unit: z.string(),
  minValue: z.number().optional(),
  maxValue: z.number().optional()
});

const insertCalibrationRecordSchema = z.object({
  sensorId: z.number(),
  calibratedAt: z.coerce.date(),
  values: z.any(),
  notes: z.string().optional()
});

const insertMaintenanceEventSchema = z.object({
  stationId: z.number(),
  eventType: z.string(),
  description: z.string(),
  scheduledAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional()
});

const insertAlarmSchema = z.object({
  stationId: z.number(),
  name: z.string(),
  condition: z.string(),
  threshold: z.number(),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  notificationEmails: z.array(z.string().email()).optional(), // Email recipients
  enabled: z.boolean().optional()
});

const insertDataQualityFlagSchema = z.object({
  weatherDataId: z.number(),
  flagType: z.string(),
  description: z.string().optional()
});

export function registerCampbellRoutes(app: Express): void {
  
  // ========== Station Management ==========
  
  /**
   * Start data collection for a station
   */
  app.post("/api/campbell/stations/:stationId/start", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const station = await storage.getStation(stationId);
      
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }

      const connectionConfig = {
        stationId: station.id,
        connectionType: (station.connectionType as any) || 'tcp',
        protocol: (station.protocol as any) || 'pakbus',
        host: station.ipAddress || undefined,
        port: station.port || 6785,
        serialPort: station.serialPort || undefined,
        baudRate: station.baudRate || 115200,
        pakbusAddress: station.pakbusAddress || 1,
        securityCode: station.securityCode || 0,
        dataTable: station.dataTable || 'OneMin',
        pollInterval: station.pollInterval || 60,
        autoReconnect: true,
        reconnectInterval: 30,
        maxReconnectAttempts: 10,
      };

      await dataCollectionService.startStation({
        stationId: station.id,
        enabled: true,
        connectionConfig,
      });

      res.json({ message: "Data collection started", stationId });
    } catch (error: any) {
      console.error("Error starting station:", error);
      res.status(500).json({ message: error.message || "Failed to start station" });
    }
  });

  /**
   * Stop data collection for a station
   */
  app.post("/api/campbell/stations/:stationId/stop", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      await dataCollectionService.stopStation(stationId);
      res.json({ message: "Data collection stopped", stationId });
    } catch (error: any) {
      console.error("Error stopping station:", error);
      res.status(500).json({ message: error.message || "Failed to stop station" });
    }
  });

  /**
   * Restart data collection for a station
   */
  app.post("/api/campbell/stations/:stationId/restart", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      await dataCollectionService.restartStation(stationId);
      res.json({ message: "Data collection restarted", stationId });
    } catch (error: any) {
      console.error("Error restarting station:", error);
      res.status(500).json({ message: error.message || "Failed to restart station" });
    }
  });

  /**
   * Get station connection status
   */
  app.get("/api/campbell/stations/:stationId/status", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const status = dataCollectionService.getStationStatus(stationId);
      
      if (!status) {
        return res.status(404).json({ message: "Station status not found" });
      }

      res.json(status);
    } catch (error: any) {
      console.error("Error getting station status:", error);
      res.status(500).json({ message: error.message || "Failed to get station status" });
    }
  });

  /**
   * Get all station statuses
   */
  app.get("/api/campbell/stations/status", async (req, res) => {
    try {
      const statuses = dataCollectionService.getAllStationStatuses();
      res.json(statuses);
    } catch (error: any) {
      console.error("Error getting station statuses:", error);
      res.status(500).json({ message: error.message || "Failed to get station statuses" });
    }
  });

  /**
   * Manually collect data from a station
   */
  app.post("/api/campbell/stations/:stationId/collect", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const { tableName } = req.body;
      
      const records = await dataCollectionService.collectDataNow(stationId, tableName);
      res.json({ records, count: records.length });
    } catch (error: any) {
      console.error("Error collecting data:", error);
      res.status(500).json({ message: error.message || "Failed to collect data" });
    }
  });

  /**
   * Get table definition from datalogger
   */
  app.get("/api/campbell/stations/:stationId/tables/:tableName", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const tableName = req.params.tableName;
      
      const tableDef = await dataCollectionService.getTableDefinition(stationId, tableName);
      res.json(tableDef);
    } catch (error: any) {
      console.error("Error getting table definition:", error);
      res.status(500).json({ message: error.message || "Failed to get table definition" });
    }
  });

  // ========== Sensor Management ==========

  /**
   * Get all sensors for a station
   */
  app.get("/api/stations/:stationId/sensors", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const sensors = await storage.getSensors(stationId);
      res.json(sensors);
    } catch (error: any) {
      console.error("Error fetching sensors:", error);
      res.status(500).json({ message: "Failed to fetch sensors" });
    }
  });

  /**
   * Create a new sensor
   */
  app.post("/api/stations/:stationId/sensors", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const parsed = insertSensorSchema.safeParse({ ...req.body, stationId });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid sensor data", errors: parsed.error.errors });
      }

      const sensor = await storage.createSensor(parsed.data);
      res.status(201).json(sensor);
    } catch (error: any) {
      console.error("Error creating sensor:", error);
      res.status(500).json({ message: "Failed to create sensor" });
    }
  });

  /**
   * Update a sensor
   */
  app.patch("/api/sensors/:sensorId", isAuthenticated, async (req, res) => {
    try {
      const sensorId = parseInt(req.params.sensorId);
      const sensor = await storage.updateSensor(sensorId, req.body);
      
      if (!sensor) {
        return res.status(404).json({ message: "Sensor not found" });
      }

      res.json(sensor);
    } catch (error: any) {
      console.error("Error updating sensor:", error);
      res.status(500).json({ message: "Failed to update sensor" });
    }
  });

  /**
   * Delete a sensor
   */
  app.delete("/api/sensors/:sensorId", isAuthenticated, async (req, res) => {
    try {
      const sensorId = parseInt(req.params.sensorId);
      const deleted = await storage.deleteSensor(sensorId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Sensor not found" });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting sensor:", error);
      res.status(500).json({ message: "Failed to delete sensor" });
    }
  });

  // ========== Calibration Management ==========

  /**
   * Get calibration records for a sensor
   */
  app.get("/api/sensors/:sensorId/calibrations", async (req, res) => {
    try {
      const sensorId = parseInt(req.params.sensorId);
      const calibrations = await storage.getCalibrationRecords(sensorId);
      res.json(calibrations);
    } catch (error: any) {
      console.error("Error fetching calibrations:", error);
      res.status(500).json({ message: "Failed to fetch calibrations" });
    }
  });

  /**
   * Get calibrations due soon (within specified days)
   */
  app.get("/api/stations/:stationId/calibrations/due", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const daysAhead = parseInt(req.query.days as string) || 90;
      
      const calibrations = await storage.getCalibrationsDue(stationId, daysAhead);
      res.json(calibrations);
    } catch (error: any) {
      console.error("Error fetching due calibrations:", error);
      res.status(500).json({ message: "Failed to fetch due calibrations" });
    }
  });

  /**
   * Create a calibration record
   */
  app.post("/api/sensors/:sensorId/calibrations", isAuthenticated, async (req, res) => {
    try {
      const sensorId = parseInt(req.params.sensorId);
      const parsed = insertCalibrationRecordSchema.safeParse({ ...req.body, sensorId });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid calibration data", errors: parsed.error.errors });
      }

      const calibration = await storage.createCalibrationRecord(parsed.data);
      res.status(201).json(calibration);
    } catch (error: any) {
      console.error("Error creating calibration:", error);
      res.status(500).json({ message: "Failed to create calibration" });
    }
  });

  // ========== Maintenance Management ==========

  /**
   * Get maintenance events for a station
   */
  app.get("/api/stations/:stationId/maintenance", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const { type, startDate, endDate } = req.query;
      
      const events = await storage.getMaintenanceEvents(
        stationId,
        type as string | undefined,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      
      res.json(events);
    } catch (error: any) {
      console.error("Error fetching maintenance events:", error);
      res.status(500).json({ message: "Failed to fetch maintenance events" });
    }
  });

  /**
   * Create a maintenance event
   */
  app.post("/api/stations/:stationId/maintenance", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const parsed = insertMaintenanceEventSchema.safeParse({ ...req.body, stationId });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid maintenance data", errors: parsed.error.errors });
      }

      const event = await storage.createMaintenanceEvent(parsed.data);
      res.status(201).json(event);
    } catch (error: any) {
      console.error("Error creating maintenance event:", error);
      res.status(500).json({ message: "Failed to create maintenance event" });
    }
  });

  // ========== Alarm Management ==========

  /**
   * Get alarms for a station
   */
  app.get("/api/stations/:stationId/alarms", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const alarms = await storage.getAlarms(stationId);
      res.json(alarms);
    } catch (error: any) {
      console.error("Error fetching alarms:", error);
      res.status(500).json({ message: "Failed to fetch alarms" });
    }
  });

  /**
   * Create an alarm
   */
  app.post("/api/stations/:stationId/alarms", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const parsed = insertAlarmSchema.safeParse({ ...req.body, stationId });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid alarm data", errors: parsed.error.errors });
      }

      const alarm = await storage.createAlarm(parsed.data);
      res.status(201).json(alarm);
    } catch (error: any) {
      console.error("Error creating alarm:", error);
      res.status(500).json({ message: "Failed to create alarm" });
    }
  });

  /**
   * Update an alarm
   */
  app.patch("/api/alarms/:alarmId", isAuthenticated, async (req, res) => {
    try {
      const alarmId = parseInt(req.params.alarmId);
      const alarm = await storage.updateAlarm(alarmId, req.body);
      
      if (!alarm) {
        return res.status(404).json({ message: "Alarm not found" });
      }

      res.json(alarm);
    } catch (error: any) {
      console.error("Error updating alarm:", error);
      res.status(500).json({ message: "Failed to update alarm" });
    }
  });

  /**
   * Delete an alarm
   */
  app.delete("/api/alarms/:alarmId", isAuthenticated, async (req, res) => {
    try {
      const alarmId = parseInt(req.params.alarmId);
      const deleted = await storage.deleteAlarm(alarmId);
      
      if (!deleted) {
        return res.status(404).json({ message: "Alarm not found" });
      }

      res.status(204).send();
    } catch (error: any) {
      console.error("Error deleting alarm:", error);
      res.status(500).json({ message: "Failed to delete alarm" });
    }
  });

  /**
   * Get active alarm events
   */
  app.get("/api/stations/:stationId/alarms/events/active", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const events = await storage.getActiveAlarmEvents(stationId);
      res.json(events);
    } catch (error: any) {
      console.error("Error fetching active alarm events:", error);
      res.status(500).json({ message: "Failed to fetch active alarm events" });
    }
  });

  /**
   * Acknowledge an alarm event
   */
  app.post("/api/alarms/events/:eventId/acknowledge", isAuthenticated, async (req, res) => {
    try {
      const eventId = parseInt(req.params.eventId);
      const { acknowledgedBy, notes } = req.body;
      
      const event = await storage.acknowledgeAlarmEvent(eventId, acknowledgedBy, notes);
      res.json(event);
    } catch (error: any) {
      console.error("Error acknowledging alarm:", error);
      res.status(500).json({ message: "Failed to acknowledge alarm" });
    }
  });

  // ========== Data Quality Management ==========

  /**
   * Get data quality flags for a station
   */
  app.get("/api/stations/:stationId/quality-flags", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const { startTime, endTime } = req.query;
      
      const flags = await storage.getDataQualityFlags(
        stationId,
        startTime ? new Date(startTime as string) : undefined,
        endTime ? new Date(endTime as string) : undefined
      );
      
      res.json(flags);
    } catch (error: any) {
      console.error("Error fetching quality flags:", error);
      res.status(500).json({ message: "Failed to fetch quality flags" });
    }
  });

  /**
   * Create a data quality flag
   */
  app.post("/api/stations/:stationId/quality-flags", isAuthenticated, async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const parsed = insertDataQualityFlagSchema.safeParse({ ...req.body, stationId });
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid quality flag data", errors: parsed.error.errors });
      }

      const flag = await storage.createDataQualityFlag(parsed.data);
      res.status(201).json(flag);
    } catch (error: any) {
      console.error("Error creating quality flag:", error);
      res.status(500).json({ message: "Failed to create quality flag" });
    }
  });

  // ========== Configuration History ==========

  /**
   * Get configuration change history for a station
   */
  app.get("/api/stations/:stationId/config-history", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const history = await storage.getConfigurationHistory(stationId);
      res.json(history);
    } catch (error: any) {
      console.error("Error fetching config history:", error);
      res.status(500).json({ message: "Failed to fetch configuration history" });
    }
  });

  // ========== Station Groups ==========

  /**
   * Get all station groups
   */
  app.get("/api/station-groups", async (req, res) => {
    try {
      const groups = await storage.getStationGroups();
      res.json(groups);
    } catch (error: any) {
      console.error("Error fetching station groups:", error);
      res.status(500).json({ message: "Failed to fetch station groups" });
    }
  });

  /**
   * Create a station group
   */
  app.post("/api/station-groups", isAuthenticated, async (req, res) => {
    try {
      const group = await storage.createStationGroup(req.body);
      res.status(201).json(group);
    } catch (error: any) {
      console.error("Error creating station group:", error);
      res.status(500).json({ message: "Failed to create station group" });
    }
  });

  /**
   * Add station to group
   */
  app.post("/api/station-groups/:groupId/stations/:stationId", isAuthenticated, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId);
      const stationId = parseInt(req.params.stationId);
      
      await storage.addStationToGroup(groupId, stationId);
      res.json({ message: "Station added to group" });
    } catch (error: any) {
      console.error("Error adding station to group:", error);
      res.status(500).json({ message: "Failed to add station to group" });
    }
  });

  /**
   * Remove station from group
   */
  app.delete("/api/station-groups/:groupId/stations/:stationId", isAuthenticated, async (req, res) => {
    try {
      const groupId = parseInt(req.params.groupId);
      const stationId = parseInt(req.params.stationId);
      
      await storage.removeStationFromGroup(groupId, stationId);
      res.status(204).send();
    } catch (error: any) {
      console.error("Error removing station from group:", error);
      res.status(500).json({ message: "Failed to remove station from group" });
    }
  });

  // ========== Email Notification Routes ==========

  /**
   * Check email configuration status
   */
  app.get("/api/email/status", async (req, res) => {
    res.json({
      configured: isEmailConfigured(),
      provider: 'MailerSend',
    });
  });

  /**
   * Send test email to verify configuration
   */
  app.post("/api/email/test", isAuthenticated, async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ message: "Valid email address required" });
      }

      if (!isEmailConfigured()) {
        return res.status(503).json({ 
          message: "Email not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL environment variables.",
          configured: false
        });
      }

      const success = await sendTestEmail(email);
      
      if (success) {
        res.json({ message: "Test email sent successfully", email });
      } else {
        res.status(500).json({ message: "Failed to send test email" });
      }
    } catch (error: any) {
      console.error("Error sending test email:", error);
      res.status(500).json({ message: "Failed to send test email" });
    }
  });

  /**
   * Manually trigger an alarm email notification (for testing)
   */
  app.post("/api/alarms/:alarmId/notify", isAuthenticated, async (req, res) => {
    try {
      const alarmId = parseInt(req.params.alarmId);
      const { emails, currentValue } = req.body;

      if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ message: "At least one email recipient required" });
      }

      // Get alarm details
      const alarm = await storage.getAlarm(alarmId);
      if (!alarm) {
        return res.status(404).json({ message: "Alarm not found" });
      }

      // Get station details
      const station = await storage.getStation(alarm.stationId);
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }

      const success = await sendAlarmEmail(emails, {
        stationName: station.name,
        stationId: station.id,
        alarmName: alarm.name,
        severity: alarm.severity as any,
        condition: alarm.condition,
        threshold: alarm.threshold,
        currentValue: currentValue ?? alarm.threshold,
        unit: '', // Would come from sensor config
        triggeredAt: new Date(),
      });

      if (success) {
        res.json({ message: "Alarm notification sent", recipients: emails });
      } else {
        res.status(500).json({ message: "Failed to send alarm notification" });
      }
    } catch (error: any) {
      console.error("Error sending alarm notification:", error);
      res.status(500).json({ message: "Failed to send alarm notification" });
    }
  });
}
