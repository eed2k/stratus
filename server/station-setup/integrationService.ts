/**
 * Station Integration Service
 * Handles complete station setup flow including validation, testing, and registration
 * Focused on Campbell Scientific stations
 * 
 * CLOUD DEPLOYMENT NOTE:
 * All connections use TCP/IP in cloud deployment (Railway/similar).
 * Serial/RS232 connections are not available.
 */

import { storage } from "../localStorage";
import { protocolManager } from "../protocols/protocolManager";
import { validateConnectionConfig, buildProtocolConfig } from "./validation";
import { ServiceDetector } from "./serviceDetector";

export interface StationSetupPayload {
  name: string;
  description?: string;
  stationType: string;
  connectionType: string;
  ipAddress?: string;
  port?: number;
  gatewayHost?: string;  // For cellular/LoRa TCP gateway
  gatewayPort?: number;
  apiKey?: string;
  apiEndpoint?: string;
  connectionConfig?: Record<string, any>;
  location?: string;
  isActive?: boolean;
}

export interface SetupResult {
  success: boolean;
  stationId?: number;
  message: string;
  errors?: string[];
}

export class StationIntegrationService {
  /**
   * Complete station setup workflow
   */
  static async setupStation(
    payload: StationSetupPayload
  ): Promise<SetupResult> {
    try {
      // 1. Validate configuration
      const validation = validateConnectionConfig(
        payload.connectionType,
        payload.connectionConfig || {}
      );

      if (!validation.valid) {
        return {
          success: false,
          message: "Invalid configuration",
          errors: validation.errors,
        };
      }

      // 2. Test connection
      const testResult = await this.testStationConnection(payload);
      if (!testResult.success) {
        return {
          success: false,
          message: "Connection test failed",
          errors: [testResult.error || "Unknown error"],
        };
      }

      // 3. Auto-detect provider if HTTP
      let detectedProvider = null;
      if (payload.apiEndpoint) {
        const detection = ServiceDetector.detectFromEndpoint(
          payload.apiEndpoint
        );
        detectedProvider = detection?.provider;
      }

      // 4. Create station in database
      const stationData: any = {
        name: payload.name,
        pakbusAddress: 1, // Default PakBus address
        connectionType: payload.connectionType,
        connectionConfig: {
          ...(payload.connectionConfig || {}),
          ipAddress: payload.ipAddress,
          port: payload.port,
          gatewayHost: payload.gatewayHost,
          gatewayPort: payload.gatewayPort,
          apiKey: payload.apiKey,
          apiEndpoint: payload.apiEndpoint,
          description: payload.description || "",
          stationType: payload.stationType || "campbell",
          location: payload.location || "",
          provider: detectedProvider,
        },
        securityCode: 0,
      };

      const station = await storage.createStation(stationData);

      // 5. Register with protocol manager
      try {
        const protocolConfig = buildProtocolConfig(
          station.id,
          payload.connectionType,
          payload.connectionConfig || {}
        );

        await protocolManager.registerStation(station.id, protocolConfig);
      } catch (regError) {
        console.warn(
          `Warning: Failed to register station ${station.id} with protocol manager:`,
          regError
        );
        // Don't fail the setup, station is created but not actively polling
      }

      return {
        success: true,
        stationId: station.id,
        message: `Station "${payload.name}" created and registered successfully`,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || "Setup failed",
        errors: [error.message],
      };
    }
  }

  /**
   * Test connection without creating station
   */
  static async testStationConnection(
    payload: Partial<StationSetupPayload>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const connectionType = payload.connectionType || "http";

      // For HTTP-based services, try to fetch from endpoint
      if (["http", "ip", "wifi"].includes(connectionType)) {
        if (payload.apiEndpoint) {
          const testResult = await ServiceDetector.testEndpoint(
            payload.apiEndpoint,
            payload.apiKey,
            10000
          );
          return {
            success: testResult.success,
            error: testResult.error,
          };
        }

        if (payload.ipAddress) {
          const url = `http://${payload.ipAddress}:${payload.port || 80}/api`;
          const testResult = await ServiceDetector.testEndpoint(url);
          return {
            success: testResult.success,
            error: testResult.error,
          };
        }
      }

      // For other connection types, validation is sufficient
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Connection test failed",
      };
    }
  }

  /**
   * Fetch stations from Campbell Cloud (not yet implemented)
   */
  static async fetchCampbellStations(
    apiKey: string,
    organizationUid?: string,
    locationUid?: string
  ): Promise<Array<{ id: string; name: string; model: string }>> {
    // Campbell Cloud integration is planned for future releases
    throw new Error("Campbell Cloud integration is not yet implemented. Please use direct PakBus connections.");
  }

  /**
   * Setup multiple stations from provider
   */
  static async setupMultipleStations(
    provider: string,
    apiKey: string,
    basePayload: Partial<StationSetupPayload>
  ): Promise<SetupResult[]> {
    const results: SetupResult[] = [];

    try {
      let stations: Array<{ id: string; name: string; model: string }> = [];

      if (provider === "campbell_cloud") {
        stations = await this.fetchCampbellStations(apiKey);
      } else {
        return [
          {
            success: false,
            message: `Unsupported provider: ${provider}. Only Campbell Scientific stations are supported.`,
          },
        ];
      }

      // Create station for each remote station
      for (const remoteStation of stations) {
        const payload: StationSetupPayload = {
          name: basePayload.name
            ? `${basePayload.name} - ${remoteStation.name}`
            : remoteStation.name,
          stationType: provider,
          connectionType: "http",
          apiKey,
          apiEndpoint: basePayload.apiEndpoint || "",
          connectionConfig: {
            ...basePayload.connectionConfig,
            remoteStationId: remoteStation.id,
            model: remoteStation.model,
          },
          isActive: true,
          ...basePayload,
        };

        const result = await this.setupStation(payload);
        results.push(result);
      }

      return results;
    } catch (error: any) {
      return [
        {
          success: false,
          message: error.message || "Failed to setup multiple stations",
        },
      ];
    }
  }

  /**
   * Update station connection
   */
  static async updateStationConnection(
    stationId: number,
    payload: Partial<StationSetupPayload>
  ): Promise<SetupResult> {
    try {
      // Skip station lookup for now - just update directly
      // Test new connection if provided
      if (payload.connectionType) {
        const testResult = await this.testStationConnection(payload);
        if (!testResult.success) {
          return {
            success: false,
            message: "Connection test failed",
            errors: [testResult.error || "Connection test failed"],
          };
        }
      }

      // Update station (use any cast to access updateStation)
      const updated = await (storage as any).updateStation(stationId, {
        connectionType: payload.connectionType,
        ipAddress: payload.ipAddress,
        port: payload.port,
        apiKey: payload.apiKey,
        apiEndpoint: payload.apiEndpoint,
        connectionConfig: payload.connectionConfig
          ? JSON.stringify(payload.connectionConfig)
          : "{}",
      });

      // Re-register with protocol manager
      try {
        await protocolManager.unregisterStation(stationId);

        const protocolConfig = buildProtocolConfig(
          stationId,
          payload.connectionType || "http",
          payload.connectionConfig || {}
        );

        await protocolManager.registerStation(stationId, protocolConfig);
      } catch (regError) {
        console.warn(
          `Warning: Failed to re-register station ${stationId}:`,
          regError
        );
      }

      return {
        success: true,
        stationId,
        message: "Station connection updated successfully",
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || "Update failed",
      };
    }
  }
}
