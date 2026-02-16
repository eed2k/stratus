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
  private rikaSession: string | null = null;
  private rikaFarmPk: number | null = null;

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
      // RikaCloud requires session-based login first
      if (this.serviceType === "rikacloud") {
        const loggedIn = await this.rikaCloudLogin();
        if (!loggedIn) {
          this.setError(new Error("RikaCloud login failed — check account/password"));
          return false;
        }
        // Verify we can reach the data endpoint
        const url = this.buildEndpointUrl();
        const response = await this.httpClient.get(url, {
          timeout: 10000,
          headers: { session: this.rikaSession! },
        });
        if (response.status >= 200 && response.status < 300) {
          this.setConnected(true);
          return true;
        }
        this.setError(new Error(`HTTP ${response.status}: ${response.statusText}`));
        return false;
      }

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
      // RikaCloud v2: use session header and handle re-login
      if (this.serviceType === "rikacloud") {
        return await this.readRikaCloudData();
      }

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

  /**
   * Read data from RikaCloud v2 API.
   * Uses session token in header, auto re-logins on 403/HTML response.
   */
  private async readRikaCloudData(): Promise<NormalizedWeatherData | null> {
    if (!this.rikaSession) {
      const loggedIn = await this.rikaCloudLogin();
      if (!loggedIn) throw new Error("RikaCloud login failed");
    }

    const url = this.buildEndpointUrl();
    let response = await this.httpClient.get(url, {
      headers: { session: this.rikaSession! },
      validateStatus: () => true,
    });

    // Session expired? Re-login and retry
    const contentType = response.headers?.["content-type"] || "";
    if (response.status === 403 || contentType.includes("text/html")) {
      console.log("[HTTPAdapter] RikaCloud session expired, re-logging in...");
      this.rikaSession = null;
      const loggedIn = await this.rikaCloudLogin();
      if (!loggedIn) throw new Error("RikaCloud re-login failed");
      response = await this.httpClient.get(url, {
        headers: { session: this.rikaSession! },
      });
    }

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rawData = this.extractDataFromResponse(response.data);
    const normalized = this.normalizeData(rawData);
    this.emit("data", normalized);
    return normalized;
  }

  /**
   * Login to RikaCloud v2 API.
   * POST {account, password} to /rika/api/v2/login/account/
   * Returns a session token used in the 'session' header for all subsequent requests.
   * Also discovers the farm_pk needed for data queries.
   */
  private async rikaCloudLogin(): Promise<boolean> {
    const config = this.config as any;
    const account = config.rikaEmail || config.rikaAccount;
    const password = config.rikaPassword;

    if (!account || !password) {
      console.error("[HTTPAdapter] RikaCloud login requires account and password");
      return false;
    }

    try {
      // Determine base URL from endpoint or default
      const endpoint = this.config.apiEndpoint || "";
      const urlMatch = endpoint.match(/^(https?:\/\/[^/]+)/);
      const baseUrl = urlMatch ? urlMatch[1] : "https://cloud.rikacloud.com";
      const apiBase = `${baseUrl}/rika/api/v2`;
      const loginUrl = `${apiBase}/login/account/`;

      console.log(`[HTTPAdapter] Logging in to RikaCloud v2 at ${loginUrl} as ${account}...`);

      const response = await axios.post(loginUrl, { account, password }, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      });

      if (response.status === 200 && response.data?.session) {
        this.rikaSession = response.data.session;
        console.log(`[HTTPAdapter] RikaCloud login successful for ${account} (session: ${this.rikaSession!.substring(0, 8)}...)`);

        // Discover farm_pk if not yet known
        if (!this.rikaFarmPk) {
          try {
            const farmRes = await axios.get(`${apiBase}/farm/`, {
              headers: { session: this.rikaSession! },
              timeout: 10000,
            });
            if (Array.isArray(farmRes.data) && farmRes.data.length > 0) {
              this.rikaFarmPk = farmRes.data[0].farm.pk;
              console.log(`[HTTPAdapter] RikaCloud farm_pk: ${this.rikaFarmPk}`);
            } else {
              console.warn("[HTTPAdapter] No farms found on RikaCloud account");
            }
          } catch (err: any) {
            console.warn(`[HTTPAdapter] Could not fetch farms: ${err.message}`);
          }
        }
        return true;
      }

      console.error(`[HTTPAdapter] RikaCloud login failed — status ${response.status}`);
      return false;
    } catch (error: any) {
      console.error(`[HTTPAdapter] RikaCloud login error: ${error.message}`);
      return false;
    }
  }

  private buildEndpointUrl(): string {
    // RikaCloud v2: use /farm/{farm_pk}/device/ endpoint (returns all sensors with live data)
    if (this.serviceType === "rikacloud") {
      const endpoint = this.config.apiEndpoint || "";
      const urlMatch = endpoint.match(/^(https?:\/\/[^/]+)/);
      const baseUrl = urlMatch ? urlMatch[1] : "https://cloud.rikacloud.com";
      if (this.rikaFarmPk) {
        return `${baseUrl}/rika/api/v2/farm/${this.rikaFarmPk}/device/`;
      }
      // Fallback: if user provided a full URL, use it as-is
      if (endpoint) return endpoint;
      return `${baseUrl}/rika/api/v2/farm/`;
    }

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
    // RikaCloud v2 /farm/{farm_pk}/device/ returns an array of device objects:
    // [{ pk, name, agri_id, the_type, unit, data: { last_value, t, value, t_display }, is_online }, ...]
    // Map device the_type codes to normalized weather fields:
    //   2001 = temperature (°C), 2002 = humidity (%RH), 2006 = wind speed (m/s),
    //   2007 = wind direction (°), 2008 = rainfall (mm), 2014 = solar radiation (W/m²),
    //   3003 = barometric pressure (hPa), 2081 = PM10 (μg/m³)
    //   3331 = longitude, 3332 = latitude (GPS — skip)

    const typeMap: Record<number, string> = {
      2001: "temperature",
      2002: "humidity",
      2006: "windSpeed",
      2007: "windDirection",
      2008: "rainfall",
      2014: "solarRadiation",
      3003: "pressure",
      2081: "pm10",
    };

    const result: Record<string, number | null> = {
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windDirection: null,
      rainfall: null,
      solarRadiation: null,
    };

    // Handle device array response
    const devices: any[] = Array.isArray(data) ? data : [];

    if (devices.length === 0) {
      console.log("[HTTPAdapter] RikaCloud: no devices returned");
      return result;
    }

    for (const device of devices) {
      const typeCode = device.the_type;
      const fieldName = typeMap[typeCode];
      if (!fieldName) continue; // Skip GPS and unknown types

      const rawVal = device.data?.value ?? device.data?.last_value;
      if (rawVal === undefined || rawVal === null) continue;

      const value = typeof rawVal === "number" ? rawVal : parseFloat(rawVal);
      if (isNaN(value)) continue;

      result[fieldName] = value;

      const displayName = device.name || `type_${typeCode}`;
      console.log(`[HTTPAdapter] RikaCloud device "${displayName}": ${value} ${device.unit || ""}`);
    }

    const populated = Object.entries(result).filter(([, v]) => v !== null).length;
    console.log(`[HTTPAdapter] RikaCloud: populated ${populated}/${Object.keys(result).length} weather fields from ${devices.length} devices`);

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
