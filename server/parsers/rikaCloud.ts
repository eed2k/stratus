/**
 * Rika Cloud Data Parser & API Client
 * Handles Rika Cloud API responses and data normalization
 */

import axios, { AxiosInstance } from "axios";

export interface RikaCloudConfig {
  apiKey: string;
  apiEndpoint?: string;
  stationId?: string;
  timeout?: number;
}

export interface RikaSensorMapping {
  [key: string]: {
    rikaLabel: string;
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

export class RikaCloudClient {
  private httpClient: AxiosInstance;
  private config: RikaCloudConfig;
  private sensorMappings: RikaSensorMapping = {};

  constructor(config: RikaCloudConfig) {
    this.config = {
      apiEndpoint: "https://api.rika.co/v1",
      timeout: 30000,
      ...config,
    };

    this.httpClient = axios.create({
      baseURL: this.config.apiEndpoint,
      timeout: this.config.timeout,
      headers: {
        "X-API-Key": this.config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    this.initializeSensorMappings();
  }

  private initializeSensorMappings(): void {
    // Rika sensor mappings
    this.sensorMappings = {
      temperature: {
        rikaLabel: "temperature",
        fieldName: "temperature",
        unit: "°C",
        weatherField: "temperature",
      },
      humidity: {
        rikaLabel: "humidity",
        fieldName: "humidity",
        unit: "%",
        weatherField: "humidity",
      },
      pressure: {
        rikaLabel: "pressure",
        fieldName: "pressure",
        unit: "hPa",
        weatherField: "pressure",
      },
      windSpeed: {
        rikaLabel: "windSpeed",
        fieldName: "windSpeed",
        unit: "m/s",
        weatherField: "windSpeed",
      },
      windDirection: {
        rikaLabel: "windDirection",
        fieldName: "windDirection",
        unit: "°",
        weatherField: "windDirection",
      },
      windGust: {
        rikaLabel: "windGust",
        fieldName: "windGust",
        unit: "m/s",
        weatherField: "windGust",
      },
      rainfall: {
        rikaLabel: "rainfall",
        fieldName: "rainfall",
        unit: "mm",
        weatherField: "rainfall",
      },
      radiation: {
        rikaLabel: "solarRadiation",
        fieldName: "solarRadiation",
        unit: "W/m²",
        weatherField: "solarRadiation",
      },
      dewPoint: {
        rikaLabel: "dewPoint",
        fieldName: "dewPoint",
        unit: "°C",
        weatherField: "dewPoint",
      },
      batteryVoltage: {
        rikaLabel: "batteryVoltage",
        fieldName: "batteryVoltage",
        unit: "V",
        weatherField: "batteryVoltage",
      },
    };
  }

  async listStations(): Promise<any[]> {
    try {
      const response = await this.httpClient.get("/stations");
      return response.data?.data || response.data || [];
    } catch (error: any) {
      throw new Error(`Failed to list stations: ${error.message}`);
    }
  }

  async getStationInfo(stationId?: string): Promise<any> {
    try {
      const sid = stationId || this.config.stationId;
      if (!sid) throw new Error("Station ID required");

      const response = await this.httpClient.get(`/stations/${sid}`);
      return response.data?.data || response.data;
    } catch (error: any) {
      throw new Error(`Failed to get station info: ${error.message}`);
    }
  }

  async getLatestData(stationId?: string): Promise<Record<string, number | null>> {
    try {
      const sid = stationId || this.config.stationId;
      if (!sid) throw new Error("Station ID required");

      const response = await this.httpClient.get(`/stations/${sid}/latest`);
      return this.parseRikaResponse(response.data);
    } catch (error: any) {
      throw new Error(`Failed to fetch latest data: ${error.message}`);
    }
  }

  async getHistoricalData(
    startTime: Date,
    endTime: Date,
    stationId?: string,
    limit?: number
  ): Promise<Array<{ timestamp: Date; data: Record<string, number | null> }>> {
    try {
      const sid = stationId || this.config.stationId;
      if (!sid) throw new Error("Station ID required");

      const response = await this.httpClient.get(
        `/stations/${sid}/data`,
        {
          params: {
            start: startTime.toISOString(),
            end: endTime.toISOString(),
            limit: limit || 1000,
            interval: "1h", // Hourly data
          },
        }
      );

      const records = response.data?.data || [];
      return records.map((record: any) => ({
        timestamp: new Date(record.timestamp || record.time),
        data: this.parseRikaResponse(record),
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch historical data: ${error.message}`);
    }
  }

  async getAlerts(stationId?: string): Promise<any[]> {
    try {
      const sid = stationId || this.config.stationId;
      if (!sid) throw new Error("Station ID required");

      const response = await this.httpClient.get(`/stations/${sid}/alerts`);
      return response.data?.data || [];
    } catch (error: any) {
      throw new Error(`Failed to fetch alerts: ${error.message}`);
    }
  }

  async updateAlertThreshold(
    alertName: string,
    threshold: number,
    stationId?: string
  ): Promise<any> {
    try {
      const sid = stationId || this.config.stationId;
      if (!sid) throw new Error("Station ID required");

      const response = await this.httpClient.put(
        `/stations/${sid}/alerts/${alertName}`,
        { threshold }
      );
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to update alert: ${error.message}`);
    }
  }

  private parseRikaResponse(
    response: any
  ): Record<string, number | null> {
    const data: Record<string, number | null> = {
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

    if (typeof response !== "object" || response === null) {
      return data;
    }

    // Handle different Rika response structures
    const rikaData = response.data || response.lastData || response;

    // Map Rika fields to standard weather fields
    for (const [key, mapping] of Object.entries(this.sensorMappings)) {
      const rikaField =
        mapping.rikaLabel ||
        Object.keys(rikaData).find((k) =>
          k.toLowerCase().includes(key.toLowerCase())
        );

      if (rikaField && rikaData[rikaField] !== undefined) {
        let value = parseFloat(rikaData[rikaField]);

        if (!isNaN(value)) {
          if (
            mapping.multiplier &&
            typeof mapping.multiplier === "number"
          ) {
            value *= mapping.multiplier;
          }

          data[mapping.weatherField] = value;
        }
      }
    }

    return data;
  }

  async testConnection(): Promise<boolean> {
    try {
      const stations = await this.listStations();
      return stations.length > 0;
    } catch (error) {
      return false;
    }
  }
}
