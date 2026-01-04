/**
 * Compliance Routes - Regulatory Compliance API Endpoints
 * 
 * Implements endpoints for:
 * - ISO/IEC 17025: Calibration management and traceability
 * - ISO 19115/19157: Data quality and metadata
 * - GDPR Art. 15-22: Data subject rights
 * - ISO 27001: Audit logging and security
 * 
 * Uses SQLite local database for storage
 */

import { Router, Request, Response } from "express";
import db from "../db";
import { randomUUID } from "crypto";

const router = Router();

// ============================================================================
// DATABASE INITIALIZATION - Create compliance tables if they don't exist
// ============================================================================

function initComplianceTables(): void {
  const database = db.getDatabase();
  if (!database) return;

  // Calibration Records table
  database.run(`
    CREATE TABLE IF NOT EXISTS calibration_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id INTEGER NOT NULL,
      calibration_date TEXT NOT NULL,
      next_calibration_due TEXT,
      calibrating_institution TEXT,
      certificate_number TEXT,
      certificate_file_url TEXT,
      calibration_standard TEXT,
      laboratory_accreditation TEXT,
      accreditation_number TEXT,
      reference_standard_id TEXT,
      reference_standard_traceability TEXT,
      uncertainty_value REAL,
      uncertainty_unit TEXT,
      uncertainty_confidence_level REAL DEFAULT 95,
      uncertainty_coverage_factor REAL DEFAULT 2,
      calibration_status TEXT DEFAULT 'valid',
      performed_by TEXT,
      verified_by TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Data Quality Flags table
  database.run(`
    CREATE TABLE IF NOT EXISTS data_quality_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER NOT NULL,
      sensor_id INTEGER,
      start_time TEXT NOT NULL,
      end_time TEXT,
      flag_type TEXT NOT NULL,
      quality_dimension TEXT,
      qc_level INTEGER DEFAULT 0,
      severity TEXT DEFAULT 'warning',
      affected_parameters TEXT,
      reason TEXT,
      cause_category TEXT,
      correction_applied INTEGER DEFAULT 0,
      review_status TEXT DEFAULT 'pending',
      flagged_by TEXT,
      flagged_method TEXT DEFAULT 'automatic',
      reviewed_by TEXT,
      reviewed_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Audit Log table
  database.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      event_category TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      action TEXT NOT NULL,
      user_id TEXT,
      user_email TEXT,
      ip_address TEXT,
      user_agent TEXT,
      resource_id TEXT,
      resource_name TEXT,
      station_id INTEGER,
      description TEXT,
      request_method TEXT,
      request_path TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    )
  `);

  // Data Subject Requests table (GDPR)
  database.run(`
    CREATE TABLE IF NOT EXISTS data_subject_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_type TEXT NOT NULL,
      request_reference TEXT NOT NULL UNIQUE,
      data_subject_email TEXT NOT NULL,
      data_subject_name TEXT,
      status TEXT DEFAULT 'pending',
      request_details TEXT,
      due_date TEXT NOT NULL,
      completed_date TEXT,
      response_details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Compliance Certifications table
  database.run(`
    CREATE TABLE IF NOT EXISTS compliance_certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station_id INTEGER,
      standard_name TEXT NOT NULL,
      standard_version TEXT,
      certification_number TEXT,
      certifying_body TEXT,
      issue_date TEXT NOT NULL,
      expiry_date TEXT,
      status TEXT DEFAULT 'active',
      scope_description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create indexes
  database.run(`CREATE INDEX IF NOT EXISTS idx_calibration_sensor ON calibration_records(sensor_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_calibration_status ON calibration_records(calibration_status)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_quality_flags_station ON data_quality_flags(station_id)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_dsr_status ON data_subject_requests(status)`);

  db.saveDatabase();
}

// Initialize tables on module load
try {
  initComplianceTables();
} catch (error) {
  console.error("Failed to initialize compliance tables:", error);
}

// ============================================================================
// AUDIT LOGGING HELPER
// ============================================================================

function logAuditEvent(
  eventType: string,
  eventCategory: string,
  resourceType: string,
  action: string,
  req: Request,
  details?: {
    resourceId?: string;
    resourceName?: string;
    stationId?: number;
    description?: string;
  }
): void {
  try {
    const database = db.getDatabase();
    if (!database) return;

    database.run(`
      INSERT INTO audit_log (
        event_type, event_category, resource_type, action,
        user_id, user_email, ip_address, user_agent,
        resource_id, resource_name, station_id, description,
        request_method, request_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      eventType,
      eventCategory,
      resourceType,
      action,
      (req as any).user?.id || null,
      (req as any).user?.email || null,
      req.ip || req.socket.remoteAddress || null,
      req.get('user-agent') || null,
      details?.resourceId || null,
      details?.resourceName || null,
      details?.stationId || null,
      details?.description || null,
      req.method,
      req.path,
    ]);
    db.saveDatabase();
  } catch (error) {
    console.error("Failed to log audit event:", error);
  }
}

// ============================================================================
// CALIBRATION MANAGEMENT (ISO/IEC 17025)
// ============================================================================

/**
 * GET /api/compliance/calibrations
 * List all calibration records
 */
router.get("/calibrations", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { stationId, status } = req.query;
    
    let sql = `
      SELECT cr.*, s.sensor_type, s.manufacturer, s.model, s.serial_number,
             ws.name as station_name, ws.id as station_id
      FROM calibration_records cr
      LEFT JOIN sensors s ON cr.sensor_id = s.id
      LEFT JOIN weather_stations ws ON s.station_id = ws.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (stationId) {
      sql += ` AND ws.id = ?`;
      params.push(stationId);
    }
    if (status) {
      sql += ` AND cr.calibration_status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY cr.calibration_date DESC`;

    const stmt = database.prepare(sql);
    stmt.bind(params);
    
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    logAuditEvent('read', 'data_access', 'calibration', 'list_calibrations', req, {
      description: `Listed ${results.length} calibration records`
    });

    res.json(results);
  } catch (error) {
    console.error("Error fetching calibrations:", error);
    res.status(500).json({ error: "Failed to fetch calibration records" });
  }
});

/**
 * POST /api/compliance/calibrations
 * Create a new calibration record
 */
router.post("/calibrations", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const data = req.body;
    
    database.run(`
      INSERT INTO calibration_records (
        sensor_id, calibration_date, next_calibration_due,
        calibrating_institution, certificate_number, certificate_file_url,
        calibration_standard, laboratory_accreditation, accreditation_number,
        reference_standard_id, reference_standard_traceability,
        uncertainty_value, uncertainty_unit, uncertainty_confidence_level,
        uncertainty_coverage_factor, calibration_status, performed_by,
        verified_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.sensorId,
      data.calibrationDate,
      data.nextCalibrationDue || null,
      data.calibratingInstitution || null,
      data.certificateNumber || null,
      data.certificateFileUrl || null,
      data.calibrationStandard || null,
      data.laboratoryAccreditation || null,
      data.accreditationNumber || null,
      data.referenceStandardId || null,
      data.referenceStandardTraceability || null,
      data.uncertaintyValue || null,
      data.uncertaintyUnit || null,
      data.uncertaintyConfidenceLevel || 95,
      data.uncertaintyCoverageFactor || 2,
      data.calibrationStatus || 'valid',
      data.performedBy || null,
      data.verifiedBy || null,
      data.notes || null,
    ]);
    db.saveDatabase();

    // Get the inserted record
    const stmt = database.prepare("SELECT last_insert_rowid() as id");
    stmt.step();
    const { id } = stmt.getAsObject() as { id: number };
    stmt.free();

    logAuditEvent('create', 'data_modification', 'calibration', 'create_calibration', req, {
      resourceId: id.toString(),
      description: `Created calibration record for sensor ${data.sensorId}`
    });

    res.status(201).json({ id, ...data });
  } catch (error) {
    console.error("Error creating calibration:", error);
    res.status(500).json({ error: "Failed to create calibration record" });
  }
});

/**
 * GET /api/compliance/calibrations/due
 * Get sensors with upcoming or overdue calibrations
 */
router.get("/calibrations/due", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const now = new Date().toISOString();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get overdue calibrations
    const overdueStmt = database.prepare(`
      SELECT s.*, ws.name as station_name, cr.calibration_date, cr.next_calibration_due
      FROM sensors s
      LEFT JOIN weather_stations ws ON s.station_id = ws.id
      LEFT JOIN calibration_records cr ON s.id = cr.sensor_id
      WHERE s.next_calibration_due < ? AND s.is_active = 1
      ORDER BY s.next_calibration_due
    `);
    overdueStmt.bind([now]);
    const overdue: any[] = [];
    while (overdueStmt.step()) {
      overdue.push(overdueStmt.getAsObject());
    }
    overdueStmt.free();

    // Get due soon calibrations
    const dueSoonStmt = database.prepare(`
      SELECT s.*, ws.name as station_name, cr.calibration_date, cr.next_calibration_due
      FROM sensors s
      LEFT JOIN weather_stations ws ON s.station_id = ws.id
      LEFT JOIN calibration_records cr ON s.id = cr.sensor_id
      WHERE s.next_calibration_due >= ? AND s.next_calibration_due <= ? AND s.is_active = 1
      ORDER BY s.next_calibration_due
    `);
    dueSoonStmt.bind([now, thirtyDaysFromNow]);
    const dueSoon: any[] = [];
    while (dueSoonStmt.step()) {
      dueSoon.push(dueSoonStmt.getAsObject());
    }
    dueSoonStmt.free();

    res.json({
      overdue,
      dueSoon,
      summary: {
        overdueCount: overdue.length,
        dueSoonCount: dueSoon.length,
      }
    });
  } catch (error) {
    console.error("Error fetching calibration due dates:", error);
    res.status(500).json({ error: "Failed to fetch calibration due dates" });
  }
});

// ============================================================================
// DATA QUALITY MANAGEMENT (ISO 19157)
// ============================================================================

/**
 * GET /api/compliance/quality-flags
 * List data quality flags
 */
router.get("/quality-flags", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { stationId, flagType, qcLevel } = req.query;
    
    let sql = `
      SELECT qf.*, ws.name as station_name, s.sensor_type
      FROM data_quality_flags qf
      LEFT JOIN weather_stations ws ON qf.station_id = ws.id
      LEFT JOIN sensors s ON qf.sensor_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (stationId) {
      sql += ` AND qf.station_id = ?`;
      params.push(stationId);
    }
    if (flagType) {
      sql += ` AND qf.flag_type = ?`;
      params.push(flagType);
    }
    if (qcLevel) {
      sql += ` AND qf.qc_level = ?`;
      params.push(qcLevel);
    }

    sql += ` ORDER BY qf.start_time DESC LIMIT 100`;

    const stmt = database.prepare(sql);
    stmt.bind(params);
    
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    res.json(results);
  } catch (error) {
    console.error("Error fetching quality flags:", error);
    res.status(500).json({ error: "Failed to fetch quality flags" });
  }
});

/**
 * POST /api/compliance/quality-flags
 * Create a new data quality flag
 */
router.post("/quality-flags", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const data = req.body;
    const flaggedBy = (req as any).user?.email || 'system';
    
    database.run(`
      INSERT INTO data_quality_flags (
        station_id, sensor_id, start_time, end_time,
        flag_type, quality_dimension, qc_level, severity,
        affected_parameters, reason, cause_category,
        correction_applied, review_status, flagged_by, flagged_method, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.stationId,
      data.sensorId || null,
      data.startTime,
      data.endTime || null,
      data.flagType,
      data.qualityDimension || null,
      data.qcLevel || 0,
      data.severity || 'warning',
      JSON.stringify(data.affectedParameters || []),
      data.reason || null,
      data.causeCategory || null,
      data.correctionApplied ? 1 : 0,
      'pending',
      flaggedBy,
      data.flaggedMethod || 'manual',
      data.notes || null,
    ]);
    db.saveDatabase();

    const stmt = database.prepare("SELECT last_insert_rowid() as id");
    stmt.step();
    const { id } = stmt.getAsObject() as { id: number };
    stmt.free();

    logAuditEvent('create', 'data_modification', 'quality_flag', 'create_flag', req, {
      resourceId: id.toString(),
      stationId: data.stationId,
      description: `Created quality flag: ${data.flagType}`
    });

    res.status(201).json({ id, ...data });
  } catch (error) {
    console.error("Error creating quality flag:", error);
    res.status(500).json({ error: "Failed to create quality flag" });
  }
});

/**
 * PATCH /api/compliance/quality-flags/:id/review
 * Review a data quality flag
 */
router.patch("/quality-flags/:id/review", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { id } = req.params;
    const { reviewStatus, notes } = req.body;
    const reviewedBy = (req as any).user?.email || 'unknown';
    
    database.run(`
      UPDATE data_quality_flags
      SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now'), notes = COALESCE(?, notes)
      WHERE id = ?
    `, [reviewStatus, reviewedBy, notes, id]);
    db.saveDatabase();

    logAuditEvent('update', 'data_modification', 'quality_flag', 'review_flag', req, {
      resourceId: id,
      description: `Reviewed quality flag ${id}: ${reviewStatus}`
    });

    res.json({ success: true, id, reviewStatus });
  } catch (error) {
    console.error("Error reviewing quality flag:", error);
    res.status(500).json({ error: "Failed to review quality flag" });
  }
});

// ============================================================================
// GDPR DATA SUBJECT RIGHTS (Art. 15-22)
// ============================================================================

/**
 * POST /api/compliance/dsr
 * Submit a Data Subject Request
 */
router.post("/dsr", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { requestType, dataSubjectEmail, dataSubjectName, requestDetails } = req.body;
    
    // Calculate due date (30 days from now per GDPR)
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const requestReference = `DSR-${Date.now()}-${randomUUID().substring(0, 8).toUpperCase()}`;

    database.run(`
      INSERT INTO data_subject_requests (
        request_type, request_reference, data_subject_email,
        data_subject_name, request_details, due_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `, [requestType, requestReference, dataSubjectEmail, dataSubjectName || null, requestDetails || null, dueDate]);
    db.saveDatabase();

    const stmt = database.prepare("SELECT last_insert_rowid() as id");
    stmt.step();
    const { id } = stmt.getAsObject() as { id: number };
    stmt.free();

    logAuditEvent('create', 'data_modification', 'data_subject_request', 'create_dsr', req, {
      resourceId: id.toString(),
      description: `Data Subject Request created: ${requestType}`
    });

    res.status(201).json({
      id,
      requestReference,
      message: `Your request has been submitted. Reference: ${requestReference}. We will respond within 30 days.`
    });
  } catch (error) {
    console.error("Error creating DSR:", error);
    res.status(500).json({ error: "Failed to submit data subject request" });
  }
});

/**
 * GET /api/compliance/dsr
 * List data subject requests
 */
router.get("/dsr", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { status, requestType } = req.query;
    
    let sql = `SELECT * FROM data_subject_requests WHERE 1=1`;
    const params: any[] = [];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    if (requestType) {
      sql += ` AND request_type = ?`;
      params.push(requestType);
    }

    sql += ` ORDER BY created_at DESC`;

    const stmt = database.prepare(sql);
    stmt.bind(params);
    
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    logAuditEvent('read', 'data_access', 'data_subject_request', 'list_dsr', req, {
      description: `Listed ${results.length} data subject requests`
    });

    res.json(results);
  } catch (error) {
    console.error("Error fetching DSRs:", error);
    res.status(500).json({ error: "Failed to fetch data subject requests" });
  }
});

/**
 * PATCH /api/compliance/dsr/:id
 * Update a data subject request status
 */
router.patch("/dsr/:id", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { id } = req.params;
    const { status, responseDetails } = req.body;
    
    const completedDate = status === 'completed' ? new Date().toISOString() : null;

    database.run(`
      UPDATE data_subject_requests
      SET status = ?, response_details = COALESCE(?, response_details),
          completed_date = COALESCE(?, completed_date), updated_at = datetime('now')
      WHERE id = ?
    `, [status, responseDetails, completedDate, id]);
    db.saveDatabase();

    logAuditEvent('update', 'data_modification', 'data_subject_request', 'update_dsr', req, {
      resourceId: id,
      description: `Updated DSR ${id}: status=${status}`
    });

    res.json({ success: true, id, status });
  } catch (error) {
    console.error("Error updating DSR:", error);
    res.status(500).json({ error: "Failed to update data subject request" });
  }
});

// ============================================================================
// COMPLIANCE CERTIFICATIONS
// ============================================================================

/**
 * GET /api/compliance/certifications
 * List compliance certifications
 */
router.get("/certifications", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { stationId, standardName, status } = req.query;
    
    let sql = `
      SELECT cc.*, ws.name as station_name
      FROM compliance_certifications cc
      LEFT JOIN weather_stations ws ON cc.station_id = ws.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (stationId) {
      sql += ` AND cc.station_id = ?`;
      params.push(stationId);
    }
    if (standardName) {
      sql += ` AND cc.standard_name = ?`;
      params.push(standardName);
    }
    if (status) {
      sql += ` AND cc.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY cc.issue_date DESC`;

    const stmt = database.prepare(sql);
    stmt.bind(params);
    
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    res.json(results);
  } catch (error) {
    console.error("Error fetching certifications:", error);
    res.status(500).json({ error: "Failed to fetch certifications" });
  }
});

/**
 * POST /api/compliance/certifications
 * Add a compliance certification
 */
router.post("/certifications", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const data = req.body;
    
    database.run(`
      INSERT INTO compliance_certifications (
        station_id, standard_name, standard_version, certification_number,
        certifying_body, issue_date, expiry_date, status, scope_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.stationId || null,
      data.standardName,
      data.standardVersion || null,
      data.certificationNumber || null,
      data.certifyingBody || null,
      data.issueDate,
      data.expiryDate || null,
      data.status || 'active',
      data.scopeDescription || null,
    ]);
    db.saveDatabase();

    const stmt = database.prepare("SELECT last_insert_rowid() as id");
    stmt.step();
    const { id } = stmt.getAsObject() as { id: number };
    stmt.free();

    logAuditEvent('create', 'data_modification', 'certification', 'add_certification', req, {
      resourceId: id.toString(),
      stationId: data.stationId,
      description: `Added certification: ${data.standardName}`
    });

    res.status(201).json({ id, ...data });
  } catch (error) {
    console.error("Error creating certification:", error);
    res.status(500).json({ error: "Failed to create certification" });
  }
});

// ============================================================================
// AUDIT LOG ACCESS
// ============================================================================

/**
 * GET /api/compliance/audit-log
 * Query audit log entries
 */
router.get("/audit-log", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { userId, stationId, eventType, resourceType, limit = '100' } = req.query;
    
    let sql = `SELECT * FROM audit_log WHERE 1=1`;
    const params: any[] = [];

    if (userId) {
      sql += ` AND user_id = ?`;
      params.push(userId);
    }
    if (stationId) {
      sql += ` AND station_id = ?`;
      params.push(stationId);
    }
    if (eventType) {
      sql += ` AND event_type = ?`;
      params.push(eventType);
    }
    if (resourceType) {
      sql += ` AND resource_type = ?`;
      params.push(resourceType);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(parseInt(limit as string));

    const stmt = database.prepare(sql);
    stmt.bind(params);
    
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    res.json(results);
  } catch (error) {
    console.error("Error fetching audit log:", error);
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

/**
 * GET /api/compliance/audit-log/export
 * Export audit log for compliance reporting
 */
router.get("/audit-log/export", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const { format = 'json' } = req.query;
    
    const stmt = database.prepare(`SELECT * FROM audit_log ORDER BY timestamp DESC`);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();

    logAuditEvent('export', 'data_access', 'audit_log', 'export_audit_log', req, {
      description: `Exported ${results.length} audit log entries`
    });

    if (format === 'csv') {
      const headers = ['timestamp', 'event_type', 'event_category', 'user_id', 'user_email', 'resource_type', 'resource_id', 'action', 'description', 'ip_address'];
      const csv = [
        headers.join(','),
        ...results.map(r => headers.map(h => JSON.stringify(r[h] || '')).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audit-log-export-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csv);
    }

    res.json(results);
  } catch (error) {
    console.error("Error exporting audit log:", error);
    res.status(500).json({ error: "Failed to export audit log" });
  }
});

// ============================================================================
// COMPLIANCE DASHBOARD SUMMARY
// ============================================================================

/**
 * GET /api/compliance/summary
 * Get compliance status summary
 */
router.get("/summary", (req: Request, res: Response) => {
  try {
    const database = db.getDatabase();
    if (!database) {
      return res.status(500).json({ error: "Database not initialized" });
    }

    const now = new Date().toISOString();
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Calibration status (checking sensors table if it exists)
    let calibrationStats = { total: 0, valid: 0, expired: 0, dueSoon: 0 };
    try {
      const calStmt = database.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN calibration_status = 'valid' THEN 1 ELSE 0 END) as valid,
          SUM(CASE WHEN next_calibration_due < ? THEN 1 ELSE 0 END) as expired,
          SUM(CASE WHEN next_calibration_due >= ? AND next_calibration_due <= ? THEN 1 ELSE 0 END) as due_soon
        FROM sensors WHERE is_active = 1
      `);
      calStmt.bind([now, now, thirtyDaysFromNow]);
      if (calStmt.step()) {
        const row = calStmt.getAsObject() as any;
        calibrationStats = {
          total: row.total || 0,
          valid: row.valid || 0,
          expired: row.expired || 0,
          dueSoon: row.due_soon || 0,
        };
      }
      calStmt.free();
    } catch {
      // sensors table may not exist yet
    }

    // Quality flags
    let qualityStats = { totalFlags: 0, pendingReview: 0 };
    try {
      const qfStmt = database.prepare(`
        SELECT 
          COUNT(*) as total_flags,
          SUM(CASE WHEN review_status = 'pending' THEN 1 ELSE 0 END) as pending_review
        FROM data_quality_flags
      `);
      if (qfStmt.step()) {
        const row = qfStmt.getAsObject() as any;
        qualityStats = {
          totalFlags: row.total_flags || 0,
          pendingReview: row.pending_review || 0,
        };
      }
      qfStmt.free();
    } catch {
      // table may not exist
    }

    // Data subject requests
    let dsrStats = { total: 0, pending: 0, overdue: 0 };
    try {
      const dsrStmt = database.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'pending' AND due_date < ? THEN 1 ELSE 0 END) as overdue
        FROM data_subject_requests
      `);
      dsrStmt.bind([now]);
      if (dsrStmt.step()) {
        const row = dsrStmt.getAsObject() as any;
        dsrStats = {
          total: row.total || 0,
          pending: row.pending || 0,
          overdue: row.overdue || 0,
        };
      }
      dsrStmt.free();
    } catch {
      // table may not exist
    }

    // Certifications
    let certStats = { total: 0, active: 0, expiringSoon: 0 };
    try {
      const certStmt = database.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN expiry_date <= ? THEN 1 ELSE 0 END) as expiring_soon
        FROM compliance_certifications
      `);
      certStmt.bind([thirtyDaysFromNow]);
      if (certStmt.step()) {
        const row = certStmt.getAsObject() as any;
        certStats = {
          total: row.total || 0,
          active: row.active || 0,
          expiringSoon: row.expiring_soon || 0,
        };
      }
      certStmt.free();
    } catch {
      // table may not exist
    }

    res.json({
      calibration: calibrationStats,
      dataQuality: qualityStats,
      dataSubjectRequests: dsrStats,
      certifications: certStats,
      lastUpdated: now,
    });
  } catch (error) {
    console.error("Error fetching compliance summary:", error);
    res.status(500).json({ error: "Failed to fetch compliance summary" });
  }
});

export default router;
