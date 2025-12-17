import axios, { AxiosInstance } from "axios";
import { EventEmitter } from "events";

/**
 * Rika Weather Station Connector
 * Integrates with Rika weather stations via HTTP/REST API
 * Supports Rika sensors with IP-based communication
 */

export interface RikaStationConfig {
  id: string;
  name: string;
  ipAddress: string;
  port: number;
  apiKey?: string;
  pollIntervalSeconds: number;
  enabled: boolean;
}

export interface RikaWeatherData {
  timestamp: string;
  temperature: number; // °C
  humidity: number; // %
  pressure: number; // hPa
  windSpeed: number; // m/s
  windDirection: number; // degrees (0-360)
  windGust: number; // m/s
  rainfall: number; // mm
  solarRadiation: number; // W/m²
  uvIndex: number;
  dewPoint: number; // °C
  stationId: string;
  stationType: "rika";
}

export class RikaConnector extends EventEmitter {
  private config: RikaStationConfig;
  private client: AxiosInstance;
  private pollTimer: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(config: RikaStationConfig) {
    super();
    this.config = config;
    this.client = axios.create({
      baseURL: `http://${config.ipAddress}:${config.port}`,
      timeout: 10000,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });
  }

  /**
   * Initialize and start polling the Rika station
   */
  async connect(): Promise<void> {
    try {
      const response = await this.client.get("/api/status");
      this.isConnected = true;
      console.log(`[Rika] Connected to station ${this.config.name} at ${this.config.ipAddress}`);
      this.emit("connected", { stationId: this.config.id, name: this.config.name });
      this.startPolling();
    } catch (error) {
      this.isConnected = false;
      console.error(`[Rika] Failed to connect to ${this.config.name}:`, error);
      this.emit("error", { stationId: this.config.id, error });
    }
  }

  /**
   * Disconnect and stop polling
   */
  disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isConnected = false;
    console.log(`[Rika] Disconnected from ${this.config.name}`);
  }

  /**
   * Start polling Rika station for data
   */
  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      if (!this.isConnected) return;
      try {
        const data = await this.fetchWeatherData();
        this.emit("data", data);
      } catch (error) {
        console.error(`[Rika] Poll error for ${this.config.name}:`, error);
        this.emit("error", { stationId: this.config.id, error });
      }
    }, this.config.pollIntervalSeconds * 1000);
  }

  /**
   * Fetch current weather data from Rika station
   */
  private async fetchWeatherData(): Promise<RikaWeatherData> {
    const response = await this.client.get("/api/data/current");
    const raw = response.data;

    // Parse Rika API response and map to standard format
    const data: RikaWeatherData = {
      timestamp: new Date().toISOString(),
      temperature: parseFloat(raw.temp) || 0,
      humidity: parseFloat(raw.humidity) || 0,
      pressure: parseFloat(raw.pressure) || 0,
      windSpeed: parseFloat(raw.wind_speed) || 0,
      windDirection: parseFloat(raw.wind_direction) || 0,
      windGust: parseFloat(raw.wind_gust) || 0,
      rainfall: parseFloat(raw.rain) || 0,
      solarRadiation: parseFloat(raw.solar_rad) || 0,
      uvIndex: parseFloat(raw.uv_index) || 0,
      dewPoint: this.calculateDewPoint(
        parseFloat(raw.temp),
        parseFloat(raw.humidity)
      ),
      stationId: this.config.id,
      stationType: "rika",
    };

    return data;
  }

  /**
   * Calculate dew point using Magnus formula
   */
  private calculateDewPoint(temp: number, humidity: number): number {
    const a = 17.27;
    const b = 237.7;
    const alpha =
      ((a * temp) / (b + temp)) +
      Math.log(humidity / 100);
    return (b * alpha) / (a - alpha);
  }

  /**
   * Get historical data from Rika station
   */
  async getHistoricalData(
    startTime: Date,
    endTime: Date
  ): Promise<RikaWeatherData[]> {
    try {
      const response = await this.client.get("/api/data/history", {
        params: {
          start: startTime.toISOString(),
          end: endTime.toISOString(),
        },
      });

      return response.data.map((raw: any) => ({
        timestamp: raw.timestamp,
        temperature: parseFloat(raw.temp),
        humidity: parseFloat(raw.humidity),
        pressure: parseFloat(raw.pressure),
        windSpeed: parseFloat(raw.wind_speed),
        windDirection: parseFloat(raw.wind_direction),
        windGust: parseFloat(raw.wind_gust),
        rainfall: parseFloat(raw.rain),
        solarRadiation: parseFloat(raw.solar_rad),
        uvIndex: parseFloat(raw.uv_index),
        dewPoint: this.calculateDewPoint(
          parseFloat(raw.temp),
          parseFloat(raw.humidity)
        ),
        stationId: this.config.id,
        stationType: "rika",
      }));
    } catch (error) {
      console.error(`[Rika] Failed to fetch historical data:`, error);
      throw error;
    }
  }

  /**
   * Update Rika station configuration
   */
  updateConfig(config: Partial<RikaStationConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.isConnected) {
      this.disconnect();
      this.connect();
    }
  }

  getConfig(): RikaStationConfig {
    return this.config;
  }

  isReady(): boolean {
    return this.isConnected;
  }
}

/**
 * Factory to manage multiple Rika stations
 */
export class RikaStationManager extends EventEmitter {
  private stations: Map<string, RikaConnector> = new Map();

  addStation(config: RikaStationConfig): RikaConnector {
    const connector = new RikaConnector(config);
    this.stations.set(config.id, connector);

    connector.on("data", (data) => this.emit("data", data));
    connector.on("connected", (info) => this.emit("station-connected", info));
    connector.on("error", (error) => this.emit("station-error", error));

    return connector;
  }

  async connectAll(): Promise<void> {
    const promises = Array.from(this.stations.values()).map((station) =>
      station.connect()
    );
    await Promise.all(promises);
  }

  disconnectAll(): void {
    this.stations.forEach((station) => station.disconnect());
  }

  getStation(stationId: string): RikaConnector | undefined {
    return this.stations.get(stationId);
  }

  getAllStations(): RikaConnector[] {
    return Array.from(this.stations.values());
  }

  removeStation(stationId: string): void {
    const station = this.stations.get(stationId);
    if (station) {
      station.disconnect();
      this.stations.delete(stationId);
    }
  }
}
