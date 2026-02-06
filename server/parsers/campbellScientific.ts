/**
 * Campbell Scientific Data File Parser
 * Supports TOA5 (ASCII Table) and TOB1 (Binary) formats
 */

export interface ParsedRecord {
  timestamp: Date;
  recordNumber: number;
  data: Record<string, number | string | null>;
}

export interface ParsedFile {
  format: "TOA5" | "TOB1" | "UNKNOWN";
  stationName: string;
  loggerModel: string;
  loggerSerial: string;
  loggerOS: string;
  programName: string;
  programSignature: string;
  tableName: string;
  headers: string[];
  units: string[];
  processingTypes: string[];
  records: ParsedRecord[];
  errors: string[];
}

/**
 * Parse TOA5 format files (ASCII table-based)
 * TOA5 files have 4 header lines:
 * 1. File format info (format, station, logger, table, etc.)
 * 2. Column names
 * 3. Units
 * 4. Processing types (Smp, Avg, Min, Max, etc.)
 */
export function parseTOA5(content: string): ParsedFile {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  const errors: string[] = [];

  if (lines.length < 4) {
    return {
      format: "TOA5",
      stationName: "",
      loggerModel: "",
      loggerSerial: "",
      loggerOS: "",
      programName: "",
      programSignature: "",
      tableName: "",
      headers: [],
      units: [],
      processingTypes: [],
      records: [],
      errors: ["File has fewer than 4 lines - invalid TOA5 format"],
    };
  }

  // Parse header line 1: file info
  const infoLine = parseCSVLine(lines[0]);
  const [format, stationName, loggerModel, loggerSerial, loggerOS, programName, programSignature, tableName] = infoLine;

  // Parse header line 2: column names
  const headers = parseCSVLine(lines[1]);

  // Parse header line 3: units
  const units = parseCSVLine(lines[2]);

  // Parse header line 4: processing types
  const processingTypes = parseCSVLine(lines[3]);

  // Parse data records
  const records: ParsedRecord[] = [];
  for (let i = 4; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);
      if (values.length === 0) continue;

      const rawTimestamp = values[0].replace(/"/g, "").trim();
      // Campbell Scientific TOA5 timestamps are in station local time (SAST = UTC+2)
      // without timezone markers. Append +02:00 so JS Date parses them correctly.
      const hasTimezone = /[Z+-]\d{2}:?\d{2}$/.test(rawTimestamp) || rawTimestamp.endsWith('Z');
      const timestampStr = hasTimezone ? rawTimestamp : rawTimestamp.replace(' ', 'T') + '+02:00';
      const timestamp = new Date(timestampStr);
      const recordNumber = parseInt(values[1]) || i - 3;

      const data: Record<string, number | string | null> = {};
      for (let j = 2; j < headers.length && j < values.length; j++) {
        const header = headers[j].replace(/"/g, "");
        const value = values[j].replace(/"/g, "");
        
        if (value === "NAN" || value === "" || value === "NaN") {
          data[header] = null;
        } else {
          const numValue = parseFloat(value);
          data[header] = isNaN(numValue) ? value : numValue;
        }
      }

      records.push({ timestamp, recordNumber, data });
    } catch (err) {
      errors.push(`Error parsing line ${i + 1}: ${err}`);
    }
  }

  return {
    format: "TOA5",
    stationName: stationName?.replace(/"/g, "") || "",
    loggerModel: loggerModel?.replace(/"/g, "") || "",
    loggerSerial: loggerSerial?.replace(/"/g, "") || "",
    loggerOS: loggerOS?.replace(/"/g, "") || "",
    programName: programName?.replace(/"/g, "") || "",
    programSignature: programSignature?.replace(/"/g, "") || "",
    tableName: tableName?.replace(/"/g, "") || "",
    headers: headers.map(h => h.replace(/"/g, "")),
    units: units.map(u => u.replace(/"/g, "")),
    processingTypes: processingTypes.map(p => p.replace(/"/g, "")),
    records,
    errors,
  };
}

/**
 * Parse CSV line handling quoted values with commas
 * Preserves empty trailing fields for proper column alignment
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  
  // Always push the last field, even if empty (preserves trailing empty fields)
  result.push(current.trim());

  return result;
}

/**
 * Parse TOB1 binary format (simplified - header only)
 * TOB1 is a binary format with ASCII header
 */
export function parseTOB1Header(content: Buffer): Partial<ParsedFile> {
  // TOB1 has ASCII header followed by binary data
  // Find the header section (ends with binary data start marker)
  
  const headerEnd = content.indexOf(0x00); // Null byte often marks header end
  const headerStr = content.slice(0, headerEnd > 0 ? headerEnd : 512).toString("ascii");
  
  const lines = headerStr.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) {
    return {
      format: "TOB1",
      errors: ["Could not parse TOB1 header"],
    };
  }

  const infoLine = parseCSVLine(lines[0]);
  const headers = lines.length > 1 ? parseCSVLine(lines[1]) : [];

  return {
    format: "TOB1",
    stationName: infoLine[1]?.replace(/"/g, "") || "",
    loggerModel: infoLine[2]?.replace(/"/g, "") || "",
    tableName: infoLine[7]?.replace(/"/g, "") || "",
    headers: headers.map(h => h.replace(/"/g, "")),
    errors: ["TOB1 binary data parsing not fully implemented - header only"],
  };
}

/**
 * Auto-detect file format and parse accordingly
 */
export function parseDataFile(content: string | Buffer): ParsedFile {
  // Check if it's a Buffer (binary) or string
  const textContent = Buffer.isBuffer(content) 
    ? content.toString("utf-8", 0, 1000) 
    : content.substring(0, 1000);

  // Detect format from first line
  if (textContent.startsWith('"TOA5"') || textContent.startsWith("TOA5")) {
    return parseTOA5(Buffer.isBuffer(content) ? content.toString("utf-8") : content);
  }
  
  if (textContent.startsWith('"TOB1"') || textContent.startsWith("TOB1")) {
    const header = parseTOB1Header(Buffer.isBuffer(content) ? content : Buffer.from(content));
    return {
      format: "TOB1",
      stationName: header.stationName || "",
      loggerModel: header.loggerModel || "",
      loggerSerial: "",
      loggerOS: "",
      programName: "",
      programSignature: "",
      tableName: header.tableName || "",
      headers: header.headers || [],
      units: [],
      processingTypes: [],
      records: [],
      errors: header.errors || [],
    };
  }

  // Try generic CSV parsing for array-based files
  if (textContent.includes(",")) {
    try {
      return parseGenericCSV(Buffer.isBuffer(content) ? content.toString("utf-8") : content);
    } catch {
      // Fall through to unknown
    }
  }

  return {
    format: "UNKNOWN",
    stationName: "",
    loggerModel: "",
    loggerSerial: "",
    loggerOS: "",
    programName: "",
    programSignature: "",
    tableName: "",
    headers: [],
    units: [],
    processingTypes: [],
    records: [],
    errors: ["Unknown file format - could not detect TOA5 or TOB1"],
  };
}

/**
 * Parse generic CSV weather data files
 */
function parseGenericCSV(content: string): ParsedFile {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length < 2) {
    throw new Error("File has fewer than 2 lines");
  }

  const headers = parseCSVLine(lines[0]);
  const records: ParsedRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;

    // Try to find timestamp column
    let timestamp = new Date();
    let recordNumber = i;
    const data: Record<string, number | string | null> = {};

    for (let j = 0; j < headers.length && j < values.length; j++) {
      const header = headers[j].replace(/"/g, "").trim();
      const value = values[j].replace(/"/g, "").trim();

      // Check for timestamp columns
      if (header.toLowerCase().includes("time") || header.toLowerCase().includes("date")) {
        // Assume station local time (SAST = UTC+2) if no timezone marker
        const hasTimezone = /[Z+-]\d{2}:?\d{2}$/.test(value) || value.endsWith('Z');
        const tsStr = hasTimezone ? value : value.replace(' ', 'T') + '+02:00';
        const parsed = new Date(tsStr);
        if (!isNaN(parsed.getTime())) {
          timestamp = parsed;
          continue;
        }
      }

      // Check for record number
      if (header.toLowerCase().includes("record") || header.toLowerCase() === "rn") {
        recordNumber = parseInt(value) || i;
        continue;
      }

      if (value === "NAN" || value === "" || value === "NaN") {
        data[header] = null;
      } else {
        const numValue = parseFloat(value);
        data[header] = isNaN(numValue) ? value : numValue;
      }
    }

    records.push({ timestamp, recordNumber, data });
  }

  return {
    format: "UNKNOWN",
    stationName: "Imported Data",
    loggerModel: "",
    loggerSerial: "",
    loggerOS: "",
    programName: "",
    programSignature: "",
    tableName: "Data",
    headers: headers.map(h => h.replace(/"/g, "")),
    units: [],
    processingTypes: [],
    records,
    errors: [],
  };
}

/**
 * Map Campbell Scientific field names to standard weather data fields
 * Includes comprehensive null safety checks for all field lookups
 */
export function mapToWeatherData(record: ParsedRecord): Record<string, number | null> {
  // Early return if record or data is null/undefined
  if (!record || !record.data) {
    return {};
  }

  const fieldMappings: Record<string, string[]> = {
    temperature: ["AirTC", "AirTC_Avg", "Temp_C", "Temperature", "T_Avg", "Air_Temp"],
    humidity: ["RH", "RH_Avg", "Humidity", "RelHumidity", "RH_pct"],
    pressure: ["BP_mbar", "BP_Avg", "Pressure", "BaroPres", "Baro_mbar"],
    windSpeed: ["WS_ms", "WS_Avg", "WindSpd", "Wind_Speed", "WS_kph"],
    windDirection: ["WD_Deg", "WD_Avg", "WindDir", "Wind_Dir"],
    windGust: ["WS_Max", "WindGust", "Gust_ms"],
    solarRadiation: ["SlrW", "SR_Avg", "Solar_W", "Radiation", "SlrkW"],
    rainfall: ["Rain_mm", "Rain_Tot", "Precip", "Rain_mm_Tot"],
    dewPoint: ["DewPt", "DewPoint", "Dew_C"],
    soilTemperature: ["SoilTC", "Soil_Temp", "T_Soil"],
    soilMoisture: ["VWC", "Soil_VWC", "VWC_Avg"],
    batteryVoltage: ["BattV", "Batt_V", "Battery"],
    panelTemperature: ["PTemp", "PTemp_C", "Panel_Temp"],
  };

  const result: Record<string, number | null> = {};

  for (const [standardField, possibleNames] of Object.entries(fieldMappings)) {
    if (!Array.isArray(possibleNames)) continue;
    
    for (const name of possibleNames) {
      if (!name) continue;
      
      const value = record.data[name];
      if (value !== undefined && value !== null) {
        // Safely convert to number with validation
        if (typeof value === "number" && !isNaN(value) && isFinite(value)) {
          result[standardField] = value;
          break;
        } else if (typeof value === "string") {
          const parsed = parseFloat(value);
          if (!isNaN(parsed) && isFinite(parsed)) {
            result[standardField] = parsed;
            break;
          }
        }
      }
    }
    
    // Initialize to null if not found
    if (result[standardField] === undefined) {
      result[standardField] = null;
    }
  }

  return result;
}
