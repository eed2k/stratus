/**
 * MQTT Protocol Adapter
 * Connects to MQTT brokers and subscribes to weather data topics
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";

export class MQTTAdapter extends BaseProtocolAdapter {
  private client: any = null;
  private lastMessage: any = null;

  async connect(): Promise<boolean> {
    try {
      const mqtt = require("mqtt");

      const broker = this.config.host || "localhost";
      const port = this.config.port || 1883;
      const useTls = port === 8883;
      const protocol = useTls ? "mqtts" : "mqtt";
      const url = `${protocol}://${broker}:${port}`;

      const options: any = {
        clientId: `stratus-${this.config.stationId}-${Date.now()}`,
        clean: true,
        connectTimeout: this.config.timeout || 30000,
        reconnectPeriod: 5000,
      };

      if (this.config.apiKey) {
        const parts = this.config.apiKey.split(":");
        if (parts[0]) options.username = parts[0];
        if (parts[1]) options.password = parts[1];
      }

      return new Promise((resolve, reject) => {
        this.client = mqtt.connect(url, options);

        const timeout = setTimeout(() => {
          this.setError(new Error(`[MQTT] Connection timeout to broker ${broker}:${port}`));
          resolve(false);
        }, this.config.timeout || 30000);

        this.client.on("connect", () => {
          clearTimeout(timeout);
          this.setConnected(true);

          const topic = this.config.apiEndpoint || `weather/station/${this.config.stationId}/#`;
          this.client.subscribe(topic, (err: Error) => {
            if (err) {
              this.setError(err);
              resolve(false);
            } else {
              console.log(`[MQTT] Subscribed to ${topic}`);
              resolve(true);
            }
          });
        });

        this.client.on("message", (topic: string, message: Buffer) => {
          this.handleMessage(topic, message);
        });

        this.client.on("error", (error: any) => {
          clearTimeout(timeout);
          this.setError(new Error(`[MQTT] Connection error: ${error.message}`));
          reject(error);
        });

        this.client.on("close", () => {
          this.setConnected(false);
        });

        this.client.on("offline", () => {
          this.setError(new Error(`[MQTT] Broker ${broker}:${port} is offline`));
          this.setConnected(false);
        });
      });
    } catch (error: any) {
      this.setError(new Error(`[MQTT] Unexpected error: ${error.message}`));
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    
    if (this.client) {
      return new Promise((resolve) => {
        this.client.end(true, {}, () => {
          this.client = null;
          this.setConnected(false);
          resolve();
        });
      });
    }
  }

  async readData(): Promise<NormalizedWeatherData | null> {
    if (!this.lastMessage) return null;
    
    try {
      const data = this.parseWeatherData(this.lastMessage);
      return this.normalizeData(data);
    } catch (error) {
      return null;
    }
  }

  private handleMessage(topic: string, message: Buffer): void {
    try {
      const payload = message.toString();
      let data: any;

      try {
        data = JSON.parse(payload);
      } catch {
        data = this.parseTextPayload(payload);
      }

      this.lastMessage = { topic, data, timestamp: new Date() };
      
      const normalized = this.normalizeData(this.parseWeatherData(data));
      this.emit("data", normalized);
    } catch (error) {
      console.error("[MQTT] Message parse error:", error);
    }
  }

  private parseTextPayload(text: string): Record<string, number> {
    const result: Record<string, number> = {};
    const pairs = text.split(/[,;|\n]/);
    
    for (const pair of pairs) {
      const [key, value] = pair.split(/[=:]/);
      if (key && value) {
        const num = parseFloat(value.trim());
        if (!isNaN(num)) {
          result[key.trim().toLowerCase()] = num;
        }
      }
    }
    return result;
  }

  private parseWeatherData(data: any): Record<string, number | null> {
    const mappings: Record<string, string[]> = {
      temperature: ["temperature", "temp", "t", "air_temp", "airtemp", "temp_c"],
      humidity: ["humidity", "rh", "relative_humidity", "humid", "hum"],
      pressure: ["pressure", "baro", "barometer", "press", "slp", "qnh"],
      windSpeed: ["wind_speed", "windspeed", "ws", "wind", "wspd"],
      windDirection: ["wind_direction", "winddir", "wd", "wdir", "wind_dir"],
      windGust: ["wind_gust", "gust", "wgust", "gustspeed"],
      rainfall: ["rainfall", "rain", "precip", "precipitation", "rain_mm"],
      solarRadiation: ["solar_radiation", "solar", "radiation", "sr", "irradiance"],
      dewPoint: ["dew_point", "dewpoint", "dp", "dew"],
      batteryVoltage: ["battery", "batt", "battery_voltage", "vbatt", "voltage"],
    };

    const result: Record<string, number | null> = {};

    for (const [normalized, aliases] of Object.entries(mappings)) {
      for (const alias of aliases) {
        if (data[alias] !== undefined) {
          result[normalized] = typeof data[alias] === "number" ? data[alias] : parseFloat(data[alias]);
          break;
        }
        const lowerData = Object.keys(data).reduce((acc, k) => {
          acc[k.toLowerCase()] = data[k];
          return acc;
        }, {} as any);
        if (lowerData[alias] !== undefined) {
          result[normalized] = typeof lowerData[alias] === "number" ? lowerData[alias] : parseFloat(lowerData[alias]);
          break;
        }
      }
    }

    return result;
  }
}
