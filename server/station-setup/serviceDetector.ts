/**
 * Service Type Detection & Auto-Configuration
 * Automatically detects weather station service providers
 */

import { CampbellCloudClient } from "./parsers/campbellCloud";
import { RikaCloudClient } from "./parsers/rikaCloud";

export interface ServiceDetectionResult {
  provider: string;
  confidence: number; // 0-1 scale
  connectionType: string;
  suggestedConfig: Record<string, any>;
  apiEndpoint?: string;
}

export class ServiceDetector {
  /**
   * Detect service provider from API endpoint or host
   */
  static detectFromEndpoint(endpoint: string): ServiceDetectionResult | null {
    const lower = endpoint.toLowerCase();

    const detections: Array<[string, string, string, number]> = [
      ["campbell", "campbellcloud", "http", 0.95],
      ["konect", "campbellcloud", "http", 0.95],
      ["campbellcloud", "campbellcloud", "http", 0.99],
      ["weatherlink", "weatherlink_cloud", "http", 0.95],
      ["davis", "weatherlink_cloud", "http", 0.85],
      ["rika", "rika_cloud", "http", 0.95],
      ["arduino", "arduino_iot", "http", 0.9],
      ["api2.arduino.cc", "arduino_iot", "http", 0.99],
      ["blynk", "blynk", "http", 0.95],
      ["thingspeak", "thingspeak", "http", 0.95],
      ["thenetwork", "lorawan", "lora", 0.9],
      ["ttn.io", "lorawan", "lora", 0.95],
      ["inmarsat", "satellite", "satellite", 0.9],
      ["iridium", "satellite", "satellite", 0.9],
      ["globalstar", "satellite", "satellite", 0.9],
    ];

    for (const [keyword, provider, type, confidence] of detections) {
      if (lower.includes(keyword)) {
        return {
          provider,
          confidence,
          connectionType: type,
          apiEndpoint: endpoint,
          suggestedConfig: this.getProviderConfig(provider),
        };
      }
    }

    return null;
  }

  /**
   * Detect from API response structure
   */
  static detectFromResponse(
    response: any
  ): ServiceDetectionResult | null {
    if (!response || typeof response !== "object") return null;

    // Campbell Cloud pattern
    if (response.data && Array.isArray(response.data)) {
      const record = response.data[0];
      if (record && (record.AirTemp_C !== undefined || record.RH !== undefined)) {
        return {
          provider: "campbellcloud",
          confidence: 0.85,
          connectionType: "http",
          suggestedConfig: this.getProviderConfig("campbellcloud"),
        };
      }
    }

    // Rika pattern
    if (response.temperature !== undefined || response.lastData) {
      return {
        provider: "rika_cloud",
        confidence: 0.8,
        connectionType: "http",
        suggestedConfig: this.getProviderConfig("rika_cloud"),
      };
    }

    // WeatherLink pattern
    if (response.sensors && Array.isArray(response.sensors)) {
      const sensor = response.sensors[0];
      if (sensor && (sensor.data || sensor.sensor_type)) {
        return {
          provider: "weatherlink_cloud",
          confidence: 0.85,
          connectionType: "http",
          suggestedConfig: this.getProviderConfig("weatherlink_cloud"),
        };
      }
    }

    // Arduino IoT pattern
    if (response.properties && Array.isArray(response.properties)) {
      return {
        provider: "arduino_iot",
        confidence: 0.8,
        connectionType: "http",
        suggestedConfig: this.getProviderConfig("arduino_iot"),
      };
    }

    // Blynk pattern
    if (Array.isArray(response) && response.length >= 5) {
      return {
        provider: "blynk",
        confidence: 0.7,
        connectionType: "http",
        suggestedConfig: this.getProviderConfig("blynk"),
      };
    }

    // ThingSpeak pattern
    if (response.feeds && Array.isArray(response.feeds)) {
      return {
        provider: "thingspeak",
        confidence: 0.8,
        connectionType: "http",
        suggestedConfig: this.getProviderConfig("thingspeak"),
      };
    }

    // Generic weather data pattern
    if (
      response.temperature !== undefined ||
      response.humidity !== undefined ||
      response.pressure !== undefined
    ) {
      return {
        provider: "generic_http",
        confidence: 0.6,
        connectionType: "http",
        suggestedConfig: this.getProviderConfig("generic_http"),
      };
    }

    return null;
  }

  /**
   * Test connection to a potential endpoint
   */
  static async testEndpoint(
    endpoint: string,
    apiKey?: string,
    timeout: number = 10000
  ): Promise<{
    success: boolean;
    provider?: string;
    data?: any;
    error?: string;
  }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        "Accept": "application/json",
      };

      if (apiKey) {
        // Try common authorization schemes
        headers["Authorization"] = `Bearer ${apiKey}`;
        headers["X-API-Key"] = apiKey;
        headers["X-Api-Secret"] = apiKey;
      }

      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();
      const detection = this.detectFromResponse(data);

      return {
        success: true,
        provider: detection?.provider,
        data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Connection failed",
      };
    }
  }

  /**
   * Get provider-specific configuration template
   */
  private static getProviderConfig(
    provider: string
  ): Record<string, any> {
    const configs: Record<string, Record<string, any>> = {
      campbellcloud: {
        apiEndpoint: "https://api.campbellcloud.com/v2",
        port: 443,
        timeout: 30000,
        requiredFields: ["apiKey", "stationUid"],
      },
      weatherlink_cloud: {
        apiEndpoint: "https://api.weatherlink.com/v2",
        port: 443,
        timeout: 30000,
        requiredFields: ["apiKey"],
      },
      rika_cloud: {
        apiEndpoint: "https://api.rika.co/v1",
        port: 443,
        timeout: 30000,
        requiredFields: ["apiKey", "stationId"],
      },
      arduino_iot: {
        apiEndpoint: "https://api2.arduino.cc/iot/v2",
        port: 443,
        timeout: 30000,
        requiredFields: ["apiKey"],
      },
      blynk: {
        apiEndpoint: "https://blynk.cloud/external/api",
        port: 443,
        timeout: 30000,
        requiredFields: ["apiKey"],
      },
      thingspeak: {
        apiEndpoint: "https://api.thingspeak.com",
        port: 443,
        timeout: 30000,
        requiredFields: ["apiKey"],
      },
      lorawan: {
        apiEndpoint: "https://api.thethingsnetwork.org/v3",
        port: 443,
        timeout: 30000,
        requiredFields: ["deviceEUI", "apiKey"],
      },
      satellite: {
        port: 9602,
        timeout: 60000,
        requiredFields: ["imei", "apiKey"],
      },
      generic_http: {
        port: 80,
        timeout: 30000,
        requiredFields: ["apiEndpoint"],
      },
    };

    return configs[provider] || { timeout: 30000 };
  }

  /**
   * Auto-configure Campbell Cloud connection
   */
  static async configureCampbellCloud(
    apiKey: string
  ): Promise<{
    success: boolean;
    organizations?: any[];
    error?: string;
  }> {
    try {
      const client = new CampbellCloudClient({ apiKey });
      const organizations = await client.listOrganizations();

      return {
        success: true,
        organizations,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Auto-configure Rika Cloud connection
   */
  static async configureRikaCloud(
    apiKey: string
  ): Promise<{
    success: boolean;
    stations?: any[];
    error?: string;
  }> {
    try {
      const client = new RikaCloudClient({ apiKey });
      const stations = await client.listStations();

      return {
        success: true,
        stations,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
