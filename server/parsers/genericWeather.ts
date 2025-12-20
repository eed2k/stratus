/**
 * Generic Weather Data Parser
 * Handles parsing of weather data from various service providers
 */

export interface GenericWeatherData {
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
  [key: string]: any;
}

export interface FieldMapping {
  source: string;
  target: string;
  type?: "number" | "string" | "date";
  multiplier?: number;
  multiplierFn?: (value: number) => number;
  offset?: number;
  transform?: (value: any) => number | null;
}

export class GenericWeatherParser {
  private fieldMappings: FieldMapping[] = [];

  constructor(mappings?: FieldMapping[]) {
    if (mappings) {
      this.fieldMappings = mappings;
    } else {
      this.initializeDefaultMappings();
    }
  }

  private initializeDefaultMappings(): void {
    // Common field name variations
    this.fieldMappings = [
      // Temperature variations
      { source: "temp", target: "temperature" },
      { source: "temperature", target: "temperature" },
      { source: "temp_c", target: "temperature" },
      { source: "temperature_c", target: "temperature" },
      { source: "temp_f", target: "temperature", multiplierFn: (f: number) => (f - 32) * (5 / 9) },
      { source: "temperature_f", target: "temperature", multiplierFn: (f: number) => (f - 32) * (5 / 9) },
      { source: "air_temperature", target: "temperature" },
      { source: "airtemperature", target: "temperature" },

      // Humidity variations
      { source: "humidity", target: "humidity" },
      { source: "rh", target: "humidity" },
      { source: "relative_humidity", target: "humidity" },
      { source: "relative_humidity_percent", target: "humidity" },

      // Pressure variations
      { source: "pressure", target: "pressure" },
      { source: "press", target: "pressure" },
      { source: "barometric_pressure", target: "pressure" },
      { source: "barometer", target: "pressure" },
      { source: "bp_mbar", target: "pressure" },
      { source: "pressure_pa", target: "pressure", multiplier: 0.01 },

      // Wind speed variations
      { source: "wind_speed", target: "windSpeed" },
      { source: "windspeed", target: "windSpeed" },
      { source: "ws", target: "windSpeed" },
      { source: "wind_speed_ms", target: "windSpeed" },
      { source: "wind_speed_kmh", target: "windSpeed", multiplier: 0.27778 },
      { source: "wind_speed_mph", target: "windSpeed", multiplier: 0.44704 },

      // Wind direction variations
      { source: "wind_direction", target: "windDirection" },
      { source: "winddirection", target: "windDirection" },
      { source: "wind_dir", target: "windDirection" },
      { source: "wd", target: "windDirection" },

      // Wind gust variations
      { source: "wind_gust", target: "windGust" },
      { source: "windgust", target: "windGust" },
      { source: "gust", target: "windGust" },
      { source: "wind_gust_ms", target: "windGust" },
      { source: "wind_gust_mph", target: "windGust", multiplier: 0.44704 },

      // Rainfall variations
      { source: "rainfall", target: "rainfall" },
      { source: "rain", target: "rainfall" },
      { source: "precip", target: "rainfall" },
      { source: "precipitation", target: "rainfall" },
      { source: "rain_mm", target: "rainfall" },

      // Solar radiation variations
      { source: "solar_radiation", target: "solarRadiation" },
      { source: "solar_rad", target: "solarRadiation" },
      { source: "radiation", target: "solarRadiation" },
      { source: "sr", target: "solarRadiation" },

      // Dew point variations
      { source: "dew_point", target: "dewPoint" },
      { source: "dewpoint", target: "dewPoint" },
      { source: "dew", target: "dewPoint" },

      // Battery variations
      { source: "battery_voltage", target: "batteryVoltage" },
      { source: "battery_v", target: "batteryVoltage" },
      { source: "batt_v", target: "batteryVoltage" },
      { source: "battery", target: "batteryVoltage" },
    ];
  }

  setMappings(mappings: FieldMapping[]): void {
    this.fieldMappings = mappings;
  }

  addMapping(mapping: FieldMapping): void {
    this.fieldMappings.push(mapping);
  }

  parse(data: any): GenericWeatherData {
    if (!data || typeof data !== "object") {
      return {
        temperature: null,
        humidity: null,
        pressure: null,
        windSpeed: null,
        windDirection: null,
        windGust: null,
        rainfall: null,
        solarRadiation: null,
        dewPoint: null,
        batteryVoltage: null,
      };
    }

    const result: GenericWeatherData = {
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windDirection: null,
      windGust: null,
      rainfall: null,
      solarRadiation: null,
      dewPoint: null,
      batteryVoltage: null,
    };

    // Apply field mappings
    for (const mapping of this.fieldMappings) {
      const sourceValue = this.getNestedProperty(data, mapping.source);

      if (sourceValue !== undefined && sourceValue !== null) {
        let value: any = sourceValue;

        // Type conversion
        if (mapping.type === "number") {
          value = parseFloat(value);
        }

        // Apply multiplier
        if (mapping.multiplier !== undefined && typeof value === "number") {
          value *= mapping.multiplier;
        }

        // Apply multiplier function
        if (mapping.multiplierFn && typeof value === "number") {
          value = mapping.multiplierFn(value);
        }

        // Apply offset
        if (mapping.offset !== undefined && typeof value === "number") {
          value += mapping.offset;
        }

        // Apply transform
        if (mapping.transform && typeof mapping.transform === "function") {
          value = mapping.transform(value);
        }

        // Validate number
        if (typeof value === "number" && !isNaN(value)) {
          (result as any)[mapping.target] = value;
        }
      }
    }

    // Validate ranges
    this.validateRanges(result);

    return result;
  }

  private getNestedProperty(obj: any, path: string): any {
    const parts = path.split(".");
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }

    return current;
  }

  private validateRanges(data: GenericWeatherData): void {
    const checkRange = (value: number | null | undefined, min: number, max: number): number | null => {
      if (value === null || value === undefined) return null;
      if (value < min || value > max) return null;
      return value;
    };

    // Validate temperature range (-60°C to 60°C)
    data.temperature = checkRange(data.temperature, -60, 60);
    // Validate humidity range (0-100%)
    data.humidity = checkRange(data.humidity, 0, 100);
    // Validate pressure range (800-1100 hPa)
    data.pressure = checkRange(data.pressure, 800, 1100);
    // Validate wind speed (0-100 m/s)
    data.windSpeed = checkRange(data.windSpeed, 0, 100);
    // Validate wind direction (0-360°)
    data.windDirection = checkRange(data.windDirection, 0, 360);
    // Validate wind gust (0-150 m/s)
    data.windGust = checkRange(data.windGust, 0, 150);
    // Validate rainfall (0-1000 mm)
    data.rainfall = checkRange(data.rainfall, 0, 1000);
    // Validate solar radiation (0-2000 W/m²)
    data.solarRadiation = checkRange(data.solarRadiation, 0, 2000);
    // Validate dew point (-100 to 50°C)
    data.dewPoint = checkRange(data.dewPoint, -100, 50);
    // Validate battery voltage (0-15V)
    data.batteryVoltage = checkRange(data.batteryVoltage, 0, 15);
  }

  parseArray(dataArray: any[]): GenericWeatherData[] {
    if (!Array.isArray(dataArray)) return [];
    return dataArray.map((item) => this.parse(item));
  }
}

/**
 * Service-specific parsers
 */

export class WeatherLinkParser extends GenericWeatherParser {
  constructor() {
    super();
    this.setMappings([
      { source: "temp", target: "temperature", multiplierFn: (f: number) => (f - 32) * (5 / 9) },
      { source: "hum", target: "humidity" },
      { source: "bar", target: "pressure", multiplier: 33.8639 },
      { source: "wind_speed_last", target: "windSpeed", multiplier: 0.44704 },
      { source: "wind_dir_last", target: "windDirection" },
      { source: "wind_speed_hi_last_10_min", target: "windGust", multiplier: 0.44704 },
      { source: "rain_day_mm", target: "rainfall" },
      { source: "solar_rad", target: "solarRadiation" },
    ]);
  }
}

export class BlynkParser extends GenericWeatherParser {
  constructor() {
    super();
    this.setMappings([
      { source: "V0", target: "temperature" },
      { source: "V1", target: "humidity" },
      { source: "V2", target: "pressure" },
      { source: "V3", target: "windSpeed" },
      { source: "V4", target: "windDirection" },
      { source: "V5", target: "rainfall" },
    ]);
  }
}

export class ThingSpeakParser extends GenericWeatherParser {
  constructor() {
    super();
    this.setMappings([
      { source: "field1", target: "temperature" },
      { source: "field2", target: "humidity" },
      { source: "field3", target: "pressure" },
      { source: "field4", target: "windSpeed" },
      { source: "field5", target: "windDirection" },
      { source: "field6", target: "windGust" },
      { source: "field7", target: "rainfall" },
      { source: "field8", target: "solarRadiation" },
    ]);
  }
}
