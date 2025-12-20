/**
 * Campbell Scientific Cloud Data Parser & API Client
 * Handles Campbell Cloud/Konect API responses and data normalization
 */

import axios, { AxiosInstance } from "axios";

export interface CampbellCloudConfig {
  apiKey: string;
  apiEndpoint?: string;
  organizationUid?: string;
  locationUid?: string;
  stationUid?: string;
  timeout?: number;
}

export interface CampbellSensorMapping {
  [key: string]: {
    dataloggerLabel: string;
    fieldName: string;
    unit: string;
    multiplier?: number;
    weatherField:
      | "temperature"
      | "humidity"
      | "pressure"
      | "windSpeed"
      | "windDirection"
      | "windGust"
      | "rainfall"
      | "solarRadiation"
      | "dewPoint"
      | "batteryVoltage"
      | "unknown";
  };
}

export class CampbellCloudClient {
  private httpClient: AxiosInstance;
  private config: CampbellCloudConfig;
  private sensorMappings: CampbellSensorMapping = {};

  constructor(config: CampbellCloudConfig) {
    this.config = {
      apiEndpoint: "https://api.campbellcloud.com/v2",
      timeout: 30000,
      ...config,
    };

    this.httpClient = axios.create({
      baseURL: this.config.apiEndpoint,
      timeout: this.config.timeout,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    this.initializeSensorMappings();
  }

  private initializeSensorMappings(): void {
    // Standard Campbell Scientific sensor mappings
    this.sensorMappings = {
      // Temperature sensors
      temp_c: {
        dataloggerLabel: "AirTemp_C",
        fieldName: "temperature",
        unit: "°C",
        weatherField: "temperature",
      },
      temp_f: {
        dataloggerLabel: "AirTemp_F",
        fieldName: "temperature",
        unit: "°F",
        multiplier: (f: number) => (f - 32) * (5 / 9),
        weatherField: "temperature",
      },

      // Humidity sensors
      humidity: {
        dataloggerLabel: "RH",
        fieldName: "humidity",
        unit: "%",
        weatherField: "humidity",
      },

      // Pressure sensors
      pressure_mbar: {
        dataloggerLabel: "BP_mbar",
        fieldName: "pressure",
        unit: "mbar",
        weatherField: "pressure",
      },
      pressure_pa: {
        dataloggerLabel: "BP_Pa",
        fieldName: "pressure",
        unit: "Pa",
        multiplier: 0.01,
        weatherField: "pressure",
      },

      // Wind sensors
      wind_speed: {
        dataloggerLabel: "WS_ms",
        fieldName: "windSpeed",
        unit: "m/s",
        weatherField: "windSpeed",
      },
      wind_direction: {
        dataloggerLabel: "WD",
        fieldName: "windDirection",
        unit: "°",
        weatherField: "windDirection",
      },
      wind_gust: {
        dataloggerLabel: "WS_max",
        fieldName: "windGust",
        unit: "m/s",
        weatherField: "windGust",
      },

      // Precipitation
      rainfall: {
        dataloggerLabel: "Rain_mm",
        fieldName: "rainfall",
        unit: "mm",
        weatherField: "rainfall",
      },

      // Solar radiation
      solar_radiation: {
        dataloggerLabel: "Solar_Wm2",
        fieldName: "solarRadiation",
        unit: "W/m²",
        weatherField: "solarRadiation",
      },

      // Dew point
      dew_point: {
        dataloggerLabel: "DewPoint_C",
        fieldName: "dewPoint",
        unit: "°C",
        weatherField: "dewPoint",
      },

      // Battery voltage
      battery_voltage: {
        dataloggerLabel: "BattV",
        fieldName: "batteryVoltage",
        unit: "V",
        weatherField: "batteryVoltage",
      },
    };
  }

  async listOrganizations(): Promise<any[]> {
    try {
      const response = await this.httpClient.get("/organizations");
      return response.data?.data || [];
    } catch (error: any) {
      throw new Error(`Failed to list organizations: ${error.message}`);
    }
  }

  async listLocations(organizationUid?: string): Promise<any[]> {
    try {
      const orgUid = organizationUid || this.config.organizationUid;
      if (!orgUid) throw new Error("Organization UID required");

      const response = await this.httpClient.get(
        `/organizations/${orgUid}/locations`
      );
      return response.data?.data || [];
    } catch (error: any) {
      throw new Error(`Failed to list locations: ${error.message}`);
    }
  }

  async listStations(locationUid?: string): Promise<any[]> {
    try {
      const locUid = locationUid || this.config.locationUid;
      if (!locUid) throw new Error("Location UID required");

      const response = await this.httpClient.get(
        `/locations/${locUid}/dataloggers`
      );
      return response.data?.data || [];
    } catch (error: any) {
      throw new Error(`Failed to list stations: ${error.message}`);
    }
  }

  async getLatestData(): Promise<Record<string, number | null>> {
    try {
      const stationUid = this.config.stationUid;
      if (!stationUid) throw new Error("Station UID required");

      const response = await this.httpClient.get(
        `/dataloggers/${stationUid}/data/latest`
      );

      return this.parseCloudResponse(response.data);
    } catch (error: any) {
      throw new Error(`Failed to fetch latest data: ${error.message}`);
    }
  }

  async getHistoricalData(
    startTime: Date,
    endTime: Date,
    limit?: number
  ): Promise<Array<{ timestamp: Date; data: Record<string, number | null> }>> {
    try {
      const stationUid = this.config.stationUid;
      if (!stationUid) throw new Error("Station UID required");

      const response = await this.httpClient.get(
        `/dataloggers/${stationUid}/data`,
        {
          params: {
            start: startTime.toISOString(),
            end: endTime.toISOString(),
            limit: limit || 1000,
          },
        }
      );

      const records = response.data?.data || [];
      return records.map((record: any) => ({
        timestamp: new Date(record.timestamp),
        data: this.parseCloudResponse(record),
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch historical data: ${error.message}`);
    }
  }

  private parseCloudResponse(
    response: any
  ): Record<string, number | null> {
    const data: Record<string, number | null> = {};

    // Handle Campbell Cloud response format
    if (response.data && Array.isArray(response.data)) {
      const record = response.data[0] || {};

      // Map Campbell fields to standard weather fields
      for (const [key, mapping] of Object.entries(this.sensorMappings)) {
        const campbellField =
          mapping.dataloggerLabel ||
          Object.keys(record).find((k) =>
            k.toLowerCase().includes(key.toLowerCase())
          );

        if (campbellField && record[campbellField] !== undefined) {
          let value = parseFloat(record[campbellField]);

          if (!isNaN(value)) {
            if (
              mapping.multiplier &&
              typeof mapping.multiplier === "number"
            ) {
              value *= mapping.multiplier;
            } else if (
              mapping.multiplier &&
              typeof mapping.multiplier === "function"
            ) {
              value = mapping.multiplier(value);
            }

            data[mapping.weatherField] = value;
          }
        }
      }
    }

    // Ensure standard weather fields are present
    const result: Record<string, number | null> = {
      temperature: data.temperature ?? null,
      humidity: data.humidity ?? null,
      pressure: data.pressure ?? null,
      windSpeed: data.windSpeed ?? null,
      windDirection: data.windDirection ?? null,
      windGust: data.windGust ?? null,
      rainfall: data.rainfall ?? null,
      solarRadiation: data.solarRadiation ?? null,
      dewPoint: data.dewPoint ?? null,
      batteryVoltage: data.batteryVoltage ?? null,
    };

    return result;
  }

  async testConnection(): Promise<boolean> {
    try {
      const orgs = await this.listOrganizations();
      return orgs.length > 0;
    } catch (error) {
      return false;
    }
  }
}
