export interface WeatherMeasurement {
    temperature: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    solarRadiation: number;
    barometricPressure: number;
    rainfall: number;
    timestamp: Date;
    // ISO 19157 Data Quality attributes
    qualityFlag?: DataQualityStatus;
    qcLevel?: QCLevel;
    measurementUncertainty?: MeasurementUncertainty;
}

export interface WindRoseData {
    direction: string;
    speed: number;
    frequency: number;
}

export interface StationConfig {
    id: string;
    name: string;
    location: string;
    protocol: 'RF' | 'LoRa' | 'GSM';
    isActive: boolean;
}

// ============================================================================
// ISO 19157 DATA QUALITY TYPES
// ============================================================================

/**
 * Data quality status flags per ISO 19157
 */
export type DataQualityStatus = 
    | 'valid'           // Data has passed all quality checks
    | 'suspect'         // Data may have quality issues, use with caution
    | 'missing'         // No data available for this period
    | 'estimated'       // Value estimated from nearby observations or models
    | 'interpolated'    // Value interpolated from surrounding data points
    | 'aggregated'      // Value aggregated from multiple observations
    | 'rejected'        // Data failed quality checks and should not be used
    | 'unchecked';      // Data has not undergone quality control

/**
 * WMO Quality Control Levels
 */
export type QCLevel = 0 | 1 | 2 | 3;
// 0 = Raw data, no QC applied
// 1 = Automatic QC (range checks, consistency checks)
// 2 = Manual QC (visual inspection, expert review)
// 3 = Validated data (final quality assured)

/**
 * ISO 19157 Data Quality Dimensions
 */
export type DataQualityDimension = 
    | 'completeness'        // Presence/absence of features, attributes, relationships
    | 'logical_consistency' // Adherence to logical rules of data structure
    | 'positional_accuracy' // Accuracy of position of features
    | 'temporal_accuracy'   // Accuracy of temporal attributes and relationships
    | 'thematic_accuracy';  // Accuracy of quantitative and qualitative attributes

// ============================================================================
// ISO/IEC 17025 CALIBRATION TYPES
// ============================================================================

/**
 * Measurement uncertainty following GUM (Guide to Uncertainty in Measurement)
 */
export interface MeasurementUncertainty {
    value: number;                    // Uncertainty value
    unit: string;                     // Unit of measurement
    confidenceLevel: number;          // Confidence level (typically 95%)
    coverageFactor: number;           // Coverage factor k (typically 2)
    type: 'A' | 'B' | 'combined';     // Type A (statistical), Type B (other means), or combined
}

/**
 * Uncertainty budget component
 */
export interface UncertaintyComponent {
    source: string;                   // Source of uncertainty
    description: string;              // Description of the uncertainty source
    value: number;                    // Standard uncertainty value
    unit: string;                     // Unit of measurement
    type: 'A' | 'B';                  // Type A or Type B evaluation
    distribution: 'normal' | 'rectangular' | 'triangular' | 'u-shaped';
    sensitivityCoefficient?: number;
}

/**
 * Calibration point data
 */
export interface CalibrationPoint {
    referenceValue: number;           // Reference standard value
    measuredValue: number;            // Instrument measured value
    deviation: number;                // Difference (measured - reference)
    uncertainty: number;              // Uncertainty at this point
    unit: string;
}

/**
 * Correction polynomial for multi-point calibration
 */
export interface CorrectionPolynomial {
    degree: number;                   // Polynomial degree
    coefficients: number[];           // Polynomial coefficients [a0, a1, a2, ...]
    validRange: { min: number; max: number };
    rSquared: number;                 // R² goodness of fit
}

/**
 * NIST Traceability chain information
 */
export interface TraceabilityChain {
    referenceStandardId: string;
    referenceStandardName: string;
    calibrationLaboratory: string;
    accreditationNumber: string;
    certificateNumber: string;
    calibrationDate: Date;
    nextLink?: TraceabilityChain;     // Link to higher-level reference
}

// ============================================================================
// ISO 27001 / GDPR COMPLIANCE TYPES
// ============================================================================

/**
 * Audit event types
 */
export type AuditEventType = 
    | 'create'
    | 'read'
    | 'update'
    | 'delete'
    | 'export'
    | 'login'
    | 'logout'
    | 'share'
    | 'calibration'
    | 'maintenance';

/**
 * GDPR Legal basis for data processing (Art. 6)
 */
export type GDPRLegalBasis = 
    | 'consent'            // Art. 6(1)(a) - Consent
    | 'contract'           // Art. 6(1)(b) - Contract performance
    | 'legal_obligation'   // Art. 6(1)(c) - Legal obligation
    | 'vital_interest'     // Art. 6(1)(d) - Vital interests
    | 'public_task'        // Art. 6(1)(e) - Public task
    | 'legitimate_interest'; // Art. 6(1)(f) - Legitimate interests

/**
 * GDPR Data Subject Request types (Art. 15-22)
 */
export type DataSubjectRequestType = 
    | 'access'             // Art. 15 - Right of access
    | 'rectification'      // Art. 16 - Right to rectification
    | 'erasure'            // Art. 17 - Right to erasure
    | 'restriction'        // Art. 18 - Right to restriction
    | 'portability'        // Art. 20 - Right to data portability
    | 'objection';         // Art. 21 - Right to object

// ============================================================================
// COMPLIANCE CERTIFICATION TYPES
// ============================================================================

/**
 * Supported compliance standards
 */
export type ComplianceStandard = 
    | 'ISO_17025'          // Calibration laboratory competence
    | 'ISO_19115'          // Geographic information metadata
    | 'ISO_19157'          // Data quality
    | 'ISO_27001'          // Information security management
    | 'ISO_27701'          // Privacy information management
    | 'GDPR'               // General Data Protection Regulation
    | 'WMO_8'              // WMO Guide to Instruments and Methods
    | 'WMO_OSCAR';         // WMO Observing Systems Capability Analysis

/**
 * Calibration status
 */
export type CalibrationStatus = 
    | 'valid'              // Current calibration is valid
    | 'due_soon'           // Calibration due within 30 days
    | 'expired'            // Calibration has expired
    | 'suspended'          // Calibration suspended pending review
    | 'unknown';           // Calibration status unknown

/**
 * Sensor metadata for ISO 19115 compliance
 */
export interface SensorMetadata {
    manufacturer: string;
    model: string;
    serialNumber: string;
    firmwareVersion?: string;
    measurementRange: { min: number; max: number; unit: string };
    resolution: number;
    accuracy: number;
    uncertainty: MeasurementUncertainty;
    calibrationStatus: CalibrationStatus;
    lastCalibration?: Date;
    nextCalibrationDue?: Date;
    traceabilityChain?: TraceabilityChain;
}