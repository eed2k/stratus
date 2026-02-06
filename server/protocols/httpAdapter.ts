/**
 * HTTP Protocol Adapter
 * Fetches weather data from REST APIs, cloud services, and direct IP endpoints
 * Supports: CampbellCloud, WeatherLink Cloud, RikaCloud, Arduino IoT, Blynk, direct HTTP
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import axios, { AxiosInstance } from "axios";

export class HTTPAdapter extends BaseProtocolAdapter {
  private httpClient: AxiosInstance;
  private serviceType: string = "generic";

  constructor(config: ProtocolConfig) {
    super(config);
    
    this.serviceType = this.detectServiceType();
    this.httpClient = axios.create({
      timeout: config.timeout || 30000,
      headers: this.buildHeaders(),
    });
  }

  private detectServiceType(): string {
    const endpoint = this.config.apiEndpoint?.toLowerCase() || "";
    const host = this.config.host?.toLowerCase() || "";

    if (endpoint.includes("campbellcloud") || endpoint.includes("konect")) return "campbellcloud";
    if (endpoint.includes("weatherlink") || host.includes("weatherlink")) return "weatherlink";
    if (endpoint.includes("rika") || host.includes("rika")) return "rikacloud";
    if (endpoint.includes("arduino") || endpoint.includes("api2.arduino.cc")) return "arduino_iot";
    if (endpoint.includes("blynk")) return "blynk";
    if (endpoint.includes("thingspeak")) return "thingspeak";
    if (endpoint.includes("openweather")) return "openweathermap";
    
    return "generic";
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      switch (this.serviceType) {
        case "campbellcloud":
          headers["Authorization"] = `Bearer ${this.config.apiKey}`;
          break;
        case "weatherlink":
          headers["X-Api-Secret"] = this.config.apiKey;
          break;
        case "arduino_iot":
          headers["Authorization"] = `Bearer ${this.config.apiKey}`;
          break;
        case "blynk":
          break;
        default:
          headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }
    }

    return headers;
  }

  async connect(): Promise<boolean> {
    try {
      const url = this.buildEndpointUrl();
      const response = await this.httpClient.get(url, { timeout: 10000 });
      
      if (response.status >= 200 && response.status < 300) {
        this.setConnected(true);
        return true;
      }
      
      this.setError(new Error(`HTTP ${response.status}: ${response.statusText}`));
      return false;
    } catch (error: any) {
      this.setError(new Error(error.message || "Connection failed"));
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.setConnected(false);
  }

  async readData(): Promise<NormalizedWeatherData | null> {
    try {
      const url = this.buildEndpointUrl();
      const response = await this.httpClient.get(url);
      
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawData = this.extractDataFromResponse(response.data);
      const normalized = this.normalizeData(rawData);
      
      this.emit("data", normalized);
      return normalized;
    } catch (error: any) {
      this.setError(error);
      return null;
    }
  }

  private buildEndpointUrl(): string {
    if (this.config.apiEndpoint) {
      let url = this.config.apiEndpoint;
      
      if (this.serviceType === "blynk" && this.config.apiKey) {
        const baseUrl = url.includes("blynk.cloud") ? url : "https://blynk.cloud/external/api";
        return `${baseUrl}/get?token=${this.config.apiKey}&pin=V0,V1,V2,V3,V4,V5`;
      }
      
      if (this.serviceType === "weatherlink" && this.config.apiKey) {
        const apiKeyId = this.config.apiKey.split(":")[0];
        url += url.includes("?") ? "&" : "?";
        url += `api-key=${apiKeyId}&t=${Date.now()}`;
      }
      
      return url;
    }

    if (this.config.host) {
      const port = this.config.port || 80;
      const protocol = port === 443 ? "https" : "http";
      return `${protocol}://${this.config.host}:${port}/api/data`;
    }

    throw new Error("No endpoint configured");
  }

  private extractDataFromResponse(response: any): Record<string, number | null> {
    switch (this.serviceType) {
      case "campbellcloud":
        return this.parseCampbellCloudResponse(response);
      case "weatherlink":
        return this.parseWeatherLinkResponse(response);
      case "rikacloud":
        return this.parseRikaCloudResponse(response);
      case "arduino_iot":
        return this.parseArduinoIoTResponse(response);
      case "blynk":
        return this.parseBlynkResponse(response);
      case "thingspeak":
        return this.parseThingSpeakResponse(response);
      default:
        return this.parseGenericResponse(response);
    }
  }

  private parseCampbellCloudResponse(data: any): Record<string, number | null> {
    const record = data?.data?.[0] || data;
    return {
      temperature: record.AirTemp_C ?? record.temperature ?? null,
      humidity: record.RH ?? record.humidity ?? null,
      pressure: record.BP_mbar ?? record.pressure ?? null,
      windSpeed: record.WS_ms ?? record.windSpeed ?? null,
      windDirection: record.WD ?? record.windDirection ?? null,
      windGust: record.WS_max ?? record.windGust ?? null,
      rainfall: record.Rain_mm ?? record.rainfall ?? null,
      solarRadiation: record.Solar_Wm2 ?? record.solarRadiation ?? null,
      batteryVoltage: record.BattV ?? record.batteryVoltage ?? null,
    };
  }

  private parseWeatherLinkResponse(data: any): Record<string, number | null> {
    const sensors = data?.sensors || [];
    const result: Record<string, number | null> = {};

    for (const sensor of sensors) {
      const sensorData = sensor.data?.[0] || {};
      
      if (sensorData.temp !== undefined) result.temperature = this.fahrenheitToCelsius(sensorData.temp);
      if (sensorData.hum !== undefined) result.humidity = sensorData.hum;
      if (sensorData.bar !== undefined) result.pressure = sensorData.bar * 33.8639;
      if (sensorData.wind_speed_last !== undefined) result.windSpeed = sensorData.wind_speed_last * 0.44704;
      if (sensorData.wind_dir_last !== undefined) result.windDirection = sensorData.wind_dir_last;
      if (sensorData.wind_speed_hi_last_10_min !== undefined) result.windGust = sensorData.wind_speed_hi_last_10_min * 0.44704;
      if (sensorData.rain_day_mm !== undefined) result.rainfall = sensorData.rain_day_mm;
      if (sensorData.solar_rad !== undefined) result.solarRadiation = sensorData.solar_rad;
    }

    return result;
  }

  private parseRikaCloudResponse(data: any): Record<string, number | null> {
    // RikaCloud API returns array of sensor readings:
    // [{ device_id, sensor_id, time, agri_name, value, unit }, ...]
    // Or a single device response with lastData
    
    const result: Record<string, number | null> = {
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windDirection: null,
      rainfall: null,
      solarRadiation: null,
    };
    
    // Handle array of sensor readings from getDeviceData API
    if (Array.isArray(data)) {
      for (const sensor of data) {
        const name = (sensor.agri_name || '').toLowerCase();
        const value = typeof sensor.value === 'number' ? sensor.value : parseFloat(sensor.value);
        
        if (isNaN(value)) continue;
        
        // Map sensor names to normalized fields
        if (name.includes('temp') || name.includes('温度')) {
          result.temperature = value;
        } else if (name.includes('humid') || name.includes('湿度')) {
          result.humidity = value;
        } else if (name.includes('press') || name.includes('气压') || name.includes('baro')) {
          result.pressure = value;
        } else if (name.includes('wind') && (name.includes('speed') || name.includes('速'))) {
          result.windSpeed = value;
        } else if (name.includes('wind') && (name.includes('dir') || name.includes('向'))) {
          result.windDirection = value;
        } else if (name.includes('rain') || name.includes('precip') || name.includes('降')) {
          result.rainfall = value;
        } else if (name.includes('solar') || name.includes('radiation') || name.includes('辐射')) {
          result.solarRadiation = value;
        }
      }
      return result;
    }
    
    // Handle object response with lastData or direct sensor data
    const record = data?.lastData || data?.data || data;
    
    if (record) {
      // Try direct field mapping
      result.temperature = record.temperature ?? record.temp ?? null;
      result.humidity = record.humidity ?? record.rh ?? null;
      result.pressure = record.pressure ?? record.baro ?? null;
      result.windSpeed = record.windSpeed ?? record.wind_speed ?? null;
      result.windDirection = record.windDirection ?? record.wind_dir ?? null;
      result.rainfall = record.rainfall ?? record.rain ?? null;
      result.solarRadiation = record.radiation ?? record.solar ?? null;
    }
    
    return result;
  }

  private parseArduinoIoTResponse(data: any): Record<string, number | null> {
    const properties = data?.properties || data;
    const result: Record<string, number | null> = {};

    for (const prop of (Array.isArray(properties) ? properties : [])) {
      const name = prop.name?.toLowerCase() || "";
      const value = prop.last_value;
      
      if (name.includes("temp")) result.temperature = value;
      if (name.includes("humid")) result.humidity = value;
      if (name.includes("press")) result.pressure = value;
      if (name.includes("wind") && name.includes("speed")) result.windSpeed = value;
      if (name.includes("wind") && name.includes("dir")) result.windDirection = value;
      if (name.includes("rain")) result.rainfall = value;
    }

    return result;
  }

  private parseBlynkResponse(data: any): Record<string, number | null> {
    if (Array.isArray(data)) {
      return {
        temperature: data[0] ?? null,
        humidity: data[1] ?? null,
        pressure: data[2] ?? null,
        windSpeed: data[3] ?? null,
        windDirection: data[4] ?? null,
        rainfall: data[5] ?? null,
      };
    }
    return this.parseGenericResponse(data);
  }

  private parseThingSpeakResponse(data: any): Record<string, number | null> {
    const feed = data?.feeds?.[0] || {};
    return {
      temperature: feed.field1 ? parseFloat(feed.field1) : null,
      humidity: feed.field2 ? parseFloat(feed.field2) : null,
      pressure: feed.field3 ? parseFloat(feed.field3) : null,
      windSpeed: feed.field4 ? parseFloat(feed.field4) : null,
      windDirection: feed.field5 ? parseFloat(feed.field5) : null,
      rainfall: feed.field6 ? parseFloat(feed.field6) : null,
      solarRadiation: feed.field7 ? parseFloat(feed.field7) : null,
      batteryVoltage: feed.field8 ? parseFloat(feed.field8) : null,
    };
  }

  private parseGenericResponse(data: any): Record<string, number | null> {
    const flatten = (obj: any, prefix = ""): Record<string, any> => {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj || {})) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          Object.assign(result, flatten(value, newKey));
        } else {
          result[newKey] = value;
        }
      }
      return result;
    };

    const flat = flatten(data);
    
    const mappings: Record<string, string[]> = {
      temperature: ["temperature", "temp", "air_temp", "t", "temp_c", "temperature_c"],
      humidity: ["humidity", "rh", "relative_humidity", "hum"],
      pressure: ["pressure", "baro", "barometer", "slp", "qnh", "bp"],
      windSpeed: ["wind_speed", "windspeed", "ws", "wind", "wspd"],
      windDirection: ["wind_direction", "winddir", "wd", "wdir"],
      windGust: ["wind_gust", "gust", "wgust"],
      rainfall: ["rainfall", "rain", "precip", "precipitation"],
      solarRadiation: ["solar_radiation", "solar", "radiation", "sr"],
      dewPoint: ["dew_point", "dewpoint", "dp"],
      batteryVoltage: ["battery", "batt", "battery_voltage", "vbatt"],
    };

    const result: Record<string, number | null> = {};

    for (const [normalized, aliases] of Object.entries(mappings)) {
      for (const alias of aliases) {
        for (const [key, value] of Object.entries(flat)) {
          if (key.toLowerCase().includes(alias)) {
            const num = typeof value === "number" ? value : parseFloat(value);
            if (!isNaN(num)) {
              result[normalized] = num;
              break;
            }
          }
        }
        if (result[normalized] !== undefined) break;
      }
    }

    return result;
  }

  private fahrenheitToCelsius(f: number): number {
    return (f - 32) * 5 / 9;
  }
}
