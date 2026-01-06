/**
 * Station Manager
 * Device discovery, configuration management, and program handling
 */

import { EventEmitter } from "events";
import { connectionManager, ConnectionConfig, ConnectionHealth } from "./connectionManager";
import { PakBusProtocol, TableDefinition } from "./pakbusProtocol";

export interface StationInfo {
  id: number;
  name: string;
  serialNumber: string;
  model: string;
  osVersion: string;
  pakbusAddress: number;
  connectionType: string;
  connectionConfig: ConnectionConfig;
  status: "online" | "offline" | "connecting" | "error";
  lastSeen?: Date;
  batteryVoltage?: number;
  programName?: string;
  programSignature?: string;
  tables?: TableDefinition[];
}

export interface DiscoveryResult {
  address: number;
  type: string;
  stationType?: string;
  serialNumber?: string;
}

export interface ProgramInfo {
  name: string;
  signature: string;
  compileDate?: Date;
  size: number;
  running: boolean;
}

export class StationManager extends EventEmitter {
  private stations: Map<number, StationInfo> = new Map();
  private discoveryInProgress: boolean = false;

  constructor() {
    super();
    this.setupConnectionEvents();
  }

  /**
   * Setup connection manager events
   */
  private setupConnectionEvents(): void {
    connectionManager.on("connected", async (stationId: number) => {
      await this.updateStationStatus(stationId, "online");
      await this.refreshStationInfo(stationId);
    });

    connectionManager.on("disconnected", (stationId: number) => {
      this.updateStationStatus(stationId, "offline");
    });

    connectionManager.on("error", (stationId: number, error: Error) => {
      this.updateStationStatus(stationId, "error");
      this.emit("station-error", stationId, error);
    });

    connectionManager.on("status", (stationId: number, status: any) => {
      const station = this.stations.get(stationId);
      if (station && status.batteryVoltage !== undefined) {
        station.batteryVoltage = status.batteryVoltage;
        this.emit("station-updated", station);
      }
    });
  }

  /**
   * Add a new station
   */
  async addStation(
    name: string,
    config: ConnectionConfig
  ): Promise<StationInfo> {
    const id = this.generateStationId();
    
    const station: StationInfo = {
      id,
      name,
      serialNumber: "",
      model: "",
      osVersion: "",
      pakbusAddress: config.pakbusAddress,
      connectionType: config.type,
      connectionConfig: config,
      status: "connecting",
    };

    this.stations.set(id, station);
    this.emit("station-added", station);

    // Connect to station
    try {
      await connectionManager.addConnection(id, config);
      await this.refreshStationInfo(id);
    } catch (error) {
      station.status = "error";
      this.emit("station-error", id, error);
    }

    return station;
  }

  /**
   * Remove a station
   */
  async removeStation(stationId: number): Promise<void> {
    await connectionManager.removeConnection(stationId);
    this.stations.delete(stationId);
    this.emit("station-removed", stationId);
  }

  /**
   * Get station by ID
   */
  getStation(stationId: number): StationInfo | null {
    return this.stations.get(stationId) || null;
  }

  /**
   * Get all stations
   */
  getAllStations(): StationInfo[] {
    return Array.from(this.stations.values());
  }

  /**
   * Update station configuration
   */
  async updateStation(
    stationId: number,
    updates: Partial<StationInfo>
  ): Promise<StationInfo | null> {
    const station = this.stations.get(stationId);
    if (!station) return null;

    Object.assign(station, updates);
    
    // If connection config changed, reconnect
    if (updates.connectionConfig) {
      await connectionManager.removeConnection(stationId);
      await connectionManager.addConnection(stationId, updates.connectionConfig);
    }

    this.emit("station-updated", station);
    return station;
  }

  /**
   * Discover stations
   */
  async discoverStations(
    config: Partial<ConnectionConfig>
  ): Promise<DiscoveryResult[]> {
    if (this.discoveryInProgress) {
      throw new Error("Discovery already in progress");
    }

    this.discoveryInProgress = true;
    this.emit("discovery-started");

    try {
      const discovered = await connectionManager.discoverStations(config);
      
      // Get additional info for each discovered station
      const results: DiscoveryResult[] = [];
      
      for (const item of discovered) {
        const result: DiscoveryResult = {
          address: item.address,
          type: item.type,
        };

        // Try to get station info
        try {
          const tempConfig: ConnectionConfig = {
            ...config,
            pakbusAddress: item.address,
            mode: "pull",
          } as ConnectionConfig;

          await connectionManager.addConnection(-1, tempConfig);
          const pakbus = connectionManager.getPakBus(-1);
          
          if (pakbus) {
            const settings = await pakbus.getSettings();
            if (settings.success && settings.data) {
              result.stationType = settings.data.stationName;
              result.serialNumber = settings.data.serialNumber;
            }
          }

          await connectionManager.removeConnection(-1);
        } catch {
          // Continue without additional info
        }

        results.push(result);
        this.emit("station-discovered", result);
      }

      this.emit("discovery-complete", results);
      return results;
    } finally {
      this.discoveryInProgress = false;
    }
  }

  /**
   * Test connection to a station
   */
  async testConnection(config: ConnectionConfig): Promise<{
    success: boolean;
    latency?: number;
    error?: string;
    stationInfo?: any;
  }> {
    const startTime = Date.now();
    
    try {
      await connectionManager.addConnection(-1, config);
      const pakbus = connectionManager.getPakBus(-1);
      
      if (!pakbus) {
        throw new Error("Failed to create PakBus connection");
      }

      const helloResult = await pakbus.hello();
      await connectionManager.removeConnection(-1);

      if (!helloResult.success) {
        return {
          success: false,
          error: helloResult.error || "Hello transaction failed",
        };
      }

      return {
        success: true,
        latency: Date.now() - startTime,
        stationInfo: helloResult.data,
      };
    } catch (error: any) {
      await connectionManager.removeConnection(-1).catch(() => {});
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Refresh station information
   */
  async refreshStationInfo(stationId: number): Promise<void> {
    const station = this.stations.get(stationId);
    if (!station) return;

    const pakbus = connectionManager.getPakBus(stationId);
    if (!pakbus) return;

    try {
      // Get settings
      const settingsResult = await pakbus.getSettings();
      if (settingsResult.success && settingsResult.data) {
        station.name = station.name || settingsResult.data.stationName;
        station.serialNumber = settingsResult.data.serialNumber;
        station.osVersion = settingsResult.data.osVersion;
      }

      // Get table definitions
      const tablesResult = await pakbus.getTableDefinitions();
      if (tablesResult.success) {
        station.tables = tablesResult.data;
      }

      station.lastSeen = new Date();
      this.emit("station-updated", station);
    } catch (error) {
      console.error(`Error refreshing station ${stationId}:`, error);
    }
  }

  /**
   * Sync station clock
   */
  async syncClock(stationId: number): Promise<{
    success: boolean;
    offset?: number;
    error?: string;
  }> {
    const pakbus = connectionManager.getPakBus(stationId);
    if (!pakbus) {
      return { success: false, error: "Station not connected" };
    }

    try {
      // Get current station time
      const clockResult = await pakbus.getClock();
      if (!clockResult.success) {
        throw new Error(clockResult.error || "Failed to get clock");
      }

      const stationTime = clockResult.data as Date;
      const systemTime = new Date();
      const offset = systemTime.getTime() - stationTime.getTime();

      // Set clock if offset is significant (> 1 second)
      if (Math.abs(offset) > 1000) {
        const setResult = await pakbus.setClock(systemTime);
        if (!setResult.success) {
          throw new Error(setResult.error || "Failed to set clock");
        }
      }

      return {
        success: true,
        offset: Math.round(offset / 1000),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get program information
   */
  async getProgramInfo(stationId: number): Promise<ProgramInfo | null> {
    const pakbus = connectionManager.getPakBus(stationId);
    if (!pakbus) return null;

    try {
      // This would require additional PakBus commands
      // Simplified version
      const settingsResult = await pakbus.getSettings();
      if (settingsResult.success && settingsResult.data) {
        return {
          name: settingsResult.data.programName || "Unknown",
          signature: settingsResult.data.programSignature || "",
          size: 0,
          running: true,
        };
      }
    } catch {
      // Ignore errors
    }

    return null;
  }

  /**
   * Upload program to station
   */
  async uploadProgram(
    stationId: number,
    programContent: Buffer,
    fileName: string = "CPU:program.cr1"
  ): Promise<{ success: boolean; error?: string }> {
    const pakbus = connectionManager.getPakBus(stationId);
    if (!pakbus) {
      return { success: false, error: "Station not connected" };
    }

    try {
      // Stop current program
      await pakbus.programControl("stop");

      // Upload new program
      const uploadResult = await pakbus.uploadFile(fileName, programContent);
      if (!uploadResult.success) {
        throw new Error(uploadResult.error || "Upload failed");
      }

      // Compile and run
      const compileResult = await pakbus.programControl("compile");
      if (!compileResult.success) {
        throw new Error(compileResult.error || "Compile failed");
      }

      const runResult = await pakbus.programControl("run");
      if (!runResult.success) {
        throw new Error(runResult.error || "Failed to start program");
      }

      await this.refreshStationInfo(stationId);

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Download program from station
   */
  async downloadProgram(
    stationId: number,
    fileName: string = "CPU:program.cr1"
  ): Promise<{ success: boolean; content?: Buffer; error?: string }> {
    const pakbus = connectionManager.getPakBus(stationId);
    if (!pakbus) {
      return { success: false, error: "Station not connected" };
    }

    try {
      const result = await pakbus.downloadFile(fileName);
      if (!result.success) {
        throw new Error(result.error || "Download failed");
      }

      return {
        success: true,
        content: result.data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update station status
   */
  private async updateStationStatus(
    stationId: number,
    status: StationInfo["status"]
  ): Promise<void> {
    const station = this.stations.get(stationId);
    if (station) {
      station.status = status;
      if (status === "online") {
        station.lastSeen = new Date();
      }
      this.emit("station-status-changed", stationId, status);
    }
  }

  /**
   * Generate unique station ID
   */
  private generateStationId(): number {
    let id = 1;
    while (this.stations.has(id)) {
      id++;
    }
    return id;
  }

  /**
   * Get connection health for all stations
   */
  getConnectionHealth(): ConnectionHealth[] {
    return connectionManager.getAllHealth();
  }

  /**
   * List available connection endpoints
   * Note: Serial ports not available in cloud deployment
   */
  async listAvailableEndpoints(): Promise<Array<{ type: string; description: string }>> {
    return connectionManager.listAvailableEndpoints();
  }
}

export const stationManager = new StationManager();
