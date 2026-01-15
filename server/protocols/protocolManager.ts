/**
 * Protocol Manager
 * Central orchestration layer for all protocol adapters
 * Manages connection lifecycle, polling, and data collection
 */

import { EventEmitter } from "events";
import { IProtocolAdapter, ProtocolConfig, NormalizedWeatherData, ConnectionStatus } from "./adapter";
import { storage } from "../localStorage";

export interface ManagedStation {
  stationId: number;
  adapter: IProtocolAdapter | null;
  config: ProtocolConfig;
  pollInterval: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  isSimulation: boolean;
  lastData: NormalizedWeatherData | null;
}

export interface ProtocolManagerConfig {
  defaultPollInterval: number;
  enableSimulation: boolean;
}

class ProtocolManagerClass extends EventEmitter {
  private stations: Map<number, ManagedStation> = new Map();
  private config: ProtocolManagerConfig;
  private initialized: boolean = false;

  constructor() {
    super();
    this.config = {
      defaultPollInterval: 60000,
      enableSimulation: true,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log("[ProtocolManager] Initializing...");
    
    try {
      const stations = await storage.getStations();
      
      for (const station of stations) {
        // Skip demo stations and stations without valid connection config
        if (station.connectionType === 'demo') continue;
        if (!station.isActive) continue;
        
        // Skip stations that don't have a valid endpoint (import-only stations)
        const hasValidEndpoint = station.ipAddress || station.apiEndpoint || 
          (station.connectionConfig && (station.connectionConfig.host || station.connectionConfig.apiEndpoint || station.connectionConfig.broker));
        
        if (!hasValidEndpoint) {
          console.log(`[ProtocolManager] Skipping station ${station.id} (${station.name}) - no endpoint configured (import-only)`);
          continue;
        }
        
        await this.registerStation(station.id, this.buildConfigFromStation(station));
      }
      
      this.initialized = true;
      console.log(`[ProtocolManager] Initialized with ${this.stations.size} stations`);
    } catch (error) {
      console.error("[ProtocolManager] Initialization error:", error);
    }
  }

  private buildConfigFromStation(station: any): ProtocolConfig {
    if (!station) {
      console.warn(`[ProtocolManager] buildConfigFromStation called with undefined station`);
      return {
        stationId: 0,
        protocol: 'http',
        connectionType: 'http',
        timeout: 30000,
      };
    }
    
    let connectionConfig: any = {};
    
    if (station.connectionConfig) {
      try {
        connectionConfig = typeof station.connectionConfig === 'string' 
          ? JSON.parse(station.connectionConfig) 
          : station.connectionConfig;
      } catch (e) {
        console.warn(`[ProtocolManager] Invalid connectionConfig for station ${station.id}`);
        connectionConfig = {};
      }
    }

    return {
      stationId: station.id,
      protocol: this.mapProtocol(station.connectionType, station.stationType),
      connectionType: this.mapConnectionType(station.connectionType),
      host: station.ipAddress || connectionConfig.broker,
      port: station.port || connectionConfig.port,
      serialPort: station.serialPort,
      baudRate: station.baudRate,
      timeout: 30000,
      apiKey: station.apiKey,
      apiEndpoint: station.apiEndpoint || connectionConfig.topic,
      ...connectionConfig,
    };
  }

  private mapProtocol(connectionType: string, stationType: string): ProtocolConfig['protocol'] {
    // Campbell Scientific stations use PakBus protocol via HTTP/TCP or LoRa
    const mappings: Record<string, ProtocolConfig['protocol']> = {
      'http': 'http',
      'ip': 'http',
      'wifi': 'http',
      'lora': 'lora',
      'tcp': 'http',
      '4g': 'http',
      'pakbus': 'pakbus',
      'campbellcloud': 'http',
    };
    return mappings[connectionType] || 'http';
  }

  private mapConnectionType(connectionType: string): ProtocolConfig['connectionType'] {
    // All Campbell connections are TCP/IP based (4G, WiFi, etc.) or LoRa
    const mappings: Record<string, ProtocolConfig['connectionType']> = {
      'http': 'http',
      'ip': 'http',
      'wifi': 'http',
      'lora': 'lora',
      'tcp': 'tcp',
      '4g': 'http',
    };
    return mappings[connectionType] || 'http';
  }

  async registerStation(stationId: number, config: ProtocolConfig): Promise<void> {
    if (this.stations.has(stationId)) {
      await this.unregisterStation(stationId);
    }

    const isSimulation = this.requiresSimulation(config);
    const adapter = await this.createAdapter(config, isSimulation);
    
    const managedStation: ManagedStation = {
      stationId,
      adapter,
      config,
      pollInterval: this.config.defaultPollInterval,
      pollTimer: null,
      isSimulation,
      lastData: null,
    };

    this.stations.set(stationId, managedStation);
    
    if (adapter) {
      this.setupAdapterEvents(managedStation);
      await this.startPolling(stationId);
    }

    console.log(`[ProtocolManager] Registered station ${stationId} (simulation: ${isSimulation})`);
  }

  async unregisterStation(stationId: number): Promise<void> {
    const station = this.stations.get(stationId);
    if (!station) return;

    this.stopPolling(stationId);
    
    if (station.adapter) {
      await station.adapter.disconnect();
    }

    this.stations.delete(stationId);
    console.log(`[ProtocolManager] Unregistered station ${stationId}`);
  }

  private requiresSimulation(config: ProtocolConfig): boolean {
    // No hardware protocols require simulation in cloud deployment
    return false;
  }

  private async createAdapter(config: ProtocolConfig, isSimulation: boolean): Promise<IProtocolAdapter | null> {
    try {
      // Campbell Scientific setups use HTTP/TCP for 4G/cellular and LoRa for remote
      switch (config.connectionType) {
        case 'http':
          const { HTTPAdapter } = await import("./httpAdapter");
          return new HTTPAdapter(config);
        
        case 'lora':
          const { LoRaAdapter } = await import("./loraAdapter");
          return new LoRaAdapter(config);
        
        case 'tcp':
          // TCP connections use HTTP adapter for Campbell stations
          const { HTTPAdapter: TCPAdapter } = await import("./httpAdapter");
          return new TCPAdapter(config);
        
        default:
          const { HTTPAdapter: DefaultAdapter } = await import("./httpAdapter");
          return new DefaultAdapter(config);
      }
    } catch (error) {
      console.error(`[ProtocolManager] Failed to create adapter for station ${config.stationId}:`, error);
      return null;
    }
  }

  private setupAdapterEvents(station: ManagedStation): void {
    if (!station.adapter) return;

    station.adapter.on('connected', () => {
      console.log(`[ProtocolManager] Station ${station.stationId} connected`);
      this.emit('stationConnected', station.stationId);
    });

    station.adapter.on('disconnected', () => {
      console.log(`[ProtocolManager] Station ${station.stationId} disconnected`);
      this.emit('stationDisconnected', station.stationId);
    });

    station.adapter.on('data', (data: NormalizedWeatherData) => {
      station.lastData = data;
      this.handleIncomingData(station.stationId, data);
    });

    station.adapter.on('error', (error: Error) => {
      console.error(`[ProtocolManager] Station ${station.stationId} error:`, error.message);
      this.emit('stationError', station.stationId, error);
    });
  }

  private async startPolling(stationId: number): Promise<void> {
    const station = this.stations.get(stationId);
    if (!station || !station.adapter) return;

    try {
      const connected = await station.adapter.connect();
      if (!connected) {
        console.warn(`[ProtocolManager] Failed initial connection for station ${stationId}`);
      }
    } catch (error) {
      console.error(`[ProtocolManager] Connection error for station ${stationId}:`, error);
    }

    station.pollTimer = setInterval(async () => {
      await this.pollStation(stationId);
    }, station.pollInterval);

    await this.pollStation(stationId);
  }

  private stopPolling(stationId: number): void {
    const station = this.stations.get(stationId);
    if (station?.pollTimer) {
      clearInterval(station.pollTimer);
      station.pollTimer = null;
    }
  }

  private async pollStation(stationId: number): Promise<void> {
    const station = this.stations.get(stationId);
    if (!station?.adapter) return;

    try {
      const data = await station.adapter.readData();
      if (data) {
        station.lastData = data;
        await this.handleIncomingData(stationId, data);
      }
    } catch (error) {
      console.error(`[ProtocolManager] Poll error for station ${stationId}:`, error);
    }
  }

  private async handleIncomingData(stationId: number, data: NormalizedWeatherData): Promise<void> {
    try {
      await storage.insertWeatherData({
        stationId,
        timestamp: data.timestamp,
        tableName: 'weather',
        data: {
          temperature: data.temperature,
          humidity: data.humidity,
          pressure: data.pressure,
          windSpeed: data.windSpeed,
          windDirection: data.windDirection,
          windGust: data.windGust,
          rainfall: data.rainfall,
          solarRadiation: data.solarRadiation,
          dewPoint: data.dewPoint,
          batteryVoltage: data.batteryVoltage,
        }
      });

      this.emit('dataReceived', stationId, data);
    } catch (error) {
      console.error(`[ProtocolManager] Failed to store data for station ${stationId}:`, error);
    }
  }

  getStationStatus(stationId: number): ConnectionStatus | null {
    const station = this.stations.get(stationId);
    if (!station?.adapter) {
      return { connected: false, lastError: 'No adapter configured' };
    }
    const status = station.adapter.getStatus();
    return { ...status, isSimulation: station.isSimulation } as any;
  }

  getAllStationStatuses(): Map<number, ConnectionStatus> {
    const statuses = new Map<number, ConnectionStatus>();
    for (const [id, station] of this.stations) {
      statuses.set(id, this.getStationStatus(id) || { connected: false });
    }
    return statuses;
  }

  async testConnection(stationId: number): Promise<{ success: boolean; message: string; isSimulation?: boolean }> {
    const station = this.stations.get(stationId);
    if (!station) {
      return { success: false, message: 'Station not registered' };
    }

    if (!station.adapter) {
      return { success: false, message: 'No adapter configured' };
    }

    try {
      const connected = await station.adapter.connect();
      if (connected) {
        const data = await station.adapter.readData();
        return { 
          success: true, 
          message: data ? 'Connected and received data' : 'Connected but no data available',
          isSimulation: station.isSimulation
        };
      }
      return { success: false, message: 'Connection failed' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  getRegisteredStations(): number[] {
    return Array.from(this.stations.keys());
  }

  async shutdown(): Promise<void> {
    console.log("[ProtocolManager] Shutting down...");
    
    for (const stationId of this.stations.keys()) {
      await this.unregisterStation(stationId);
    }
    
    this.initialized = false;
    console.log("[ProtocolManager] Shutdown complete");
  }
}

export const protocolManager = new ProtocolManagerClass();
