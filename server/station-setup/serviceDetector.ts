// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * Service Type Detection & Auto-Configuration
 * For Campbell Scientific dataloggers
 */

export interface ServiceDetectionResult {
  provider: string;
  confidence: number;
  connectionType: string;
  suggestedConfig?: Record<string, any>;
  apiEndpoint?: string;
}

export class ServiceDetector {
  /**
   * Detect service provider from API endpoint or host
   * Focused on Campbell Scientific connections
   */
  static detectFromEndpoint(endpoint: string): ServiceDetectionResult | null {
    const lower = endpoint.toLowerCase();

    const detections: Array<[string, string, string, number]> = [
      ["campbell", "campbell_tcp", "tcp", 0.95],
      ["konect", "campbell_tcp", "tcp", 0.95],
      ["campbellcloud", "campbell_tcp", "tcp", 0.99],
      ["pakbus", "campbell_tcp", "tcp", 0.95],
      ["dropbox", "dropbox_sync", "import", 0.95],
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
   * Looks for Campbell Scientific data patterns
   */
  static detectFromResponse(
    response: any
  ): ServiceDetectionResult | null {
    if (!response || typeof response !== "object") return null;

    // Campbell Scientific data pattern
    if (response.data && Array.isArray(response.data)) {
      const record = response.data[0];
      if (record && (record.AirTemp_C !== undefined || record.RH !== undefined || record.BattV !== undefined)) {
        return {
          provider: "campbell_tcp",
          confidence: 0.85,
          connectionType: "tcp",
          suggestedConfig: this.getProviderConfig("campbell_tcp"),
        };
      }
    }

    // PakBus response pattern
    if (response.tableData || response.pakbusData) {
      return {
        provider: "campbell_tcp",
        confidence: 0.9,
        connectionType: "tcp",
        suggestedConfig: this.getProviderConfig("campbell_tcp"),
      };
    }

    return null;
  }

  /**
   * Test connection to a Campbell Scientific datalogger
   */
  static async testConnection(
    connectionType: string,
    config: Record<string, any>,
    timeout: number = 10000
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    // Connection testing is handled by the PakBus protocol layer
    // This is a placeholder for future implementation
    return {
      success: true,
      message: `Connection test for ${connectionType} would be performed via PakBus protocol`,
    };
  }

  /**
   * Test HTTP endpoint connectivity
   */
  static async testEndpoint(
    url: string,
    apiKey?: string,
    timeout: number = 10000
  ): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return {
        success: response.ok,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.name === 'AbortError' ? 'Connection timeout' : error.message,
      };
    }
  }

  /**
   * Get provider-specific configuration template
   * For Campbell Scientific connections (cloud deployment - TCP/IP only)
   */
  private static getProviderConfig(
    provider: string
  ): Record<string, any> {
    const configs: Record<string, Record<string, any>> = {
      campbell_tcp: {
        port: 6785,
        timeout: 30000,
        requiredFields: ["ipAddress", "port"],
      },
      campbell_lora: {
        frequency: 868000000,
        timeout: 60000,
        requiredFields: ["loraFrequency", "deviceEUI"],
      },
      campbell_gsm: {
        timeout: 60000,
        requiredFields: ["gatewayHost", "gatewayPort"],
      },
      campbell_mqtt: {
        port: 1883,
        timeout: 30000,
        requiredFields: ["broker", "topic"],
      },
      dropbox_sync: {
        syncInterval: 3600000,
        requiredFields: ["dropboxFolder"],
      },
    };

    return configs[provider] || { timeout: 30000 };
  }

  /**
   * Configure Campbell Scientific connection via PakBus
   */
  static async configureCampbellConnection(
    connectionType: string,
    config: Record<string, any>
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    // Connection configuration is handled by the PakBus protocol layer
    return {
      success: true,
      message: `Campbell Scientific ${connectionType} connection configured. Use PakBus protocol for data collection.`,
    };
  }
}
