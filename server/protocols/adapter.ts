/**
 * Protocol Adapter Interface
 * Common interface for all communication protocols to integrate with the connection manager
 * 
 * CLOUD DEPLOYMENT NOTE:
 * All adapters use TCP/IP based connections for cloud deployment.
 * Serial/RS232 connections are not available in cloud environments.
 */

import { EventEmitter } from "events";
import type { WeatherData } from "../localStorage";

export interface ProtocolConfig {
  stationId: number;
  protocol: "pakbus" | "lora" | "http";
  connectionType: "tcp" | "http" | "lora";
  
  // Connection settings (TCP/IP based)
  host?: string;
  port?: number;
  timeout?: number;
  
  // Gateway settings (for cellular/LoRa via TCP gateway)
  gatewayHost?: string;
  gatewayPort?: number;
  
  // Protocol-specific settings
  pakbusAddress?: number;     // PakBus
  deviceEUI?: string;         // LoRa
  
  // Authentication
  apiKey?: string;
  apiEndpoint?: string;
  securityCode?: number;
}

export interface NormalizedWeatherData {
  stationId: number;
  timestamp: Date;
  temperature?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  windSpeed?: number | null;
  windDirection?: number | null;
  windGust?: number | null;
  rainfall?: number | null;
  solarRadiation?: number | null;
  dewPoint?: number | null;
  batteryVoltage?: number | null;
  [key: string]: number | null | Date | undefined;
}

export interface ConnectionStatus {
  connected: boolean;
  lastConnected?: Date;
  lastError?: string;
  signalStrength?: number;
  latency?: number;
}

export interface IProtocolAdapter extends EventEmitter {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getStatus(): ConnectionStatus;
  readData(): Promise<NormalizedWeatherData | null>;
  
  // Events emitted:
  // 'connected' - Connection established
  // 'disconnected' - Connection lost
  // 'data' - New weather data received
  // 'error' - Error occurred
  // 'status' - Status update
}

/**
 * Base class for protocol adapters with common functionality
 */
export abstract class BaseProtocolAdapter extends EventEmitter implements IProtocolAdapter {
  protected config: ProtocolConfig;
  protected status: ConnectionStatus = { connected: false };
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectAttempts: number = 0;
  protected maxReconnectAttempts: number = 10;
  protected reconnectDelay: number = 5000;

  constructor(config: ProtocolConfig) {
    super();
    this.config = config;
  }

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract readData(): Promise<NormalizedWeatherData | null>;

  isConnected(): boolean {
    return this.status.connected;
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  protected setConnected(connected: boolean): void {
    const wasConnected = this.status.connected;
    this.status.connected = connected;
    
    if (connected) {
      this.status.lastConnected = new Date();
      this.status.lastError = undefined;
      this.reconnectAttempts = 0;
      
      if (!wasConnected) {
        this.emit("connected");
        this.emit("status", this.status);
      }
    } else {
      if (wasConnected) {
        this.emit("disconnected");
        this.emit("status", this.status);
        this.scheduleReconnect();
      }
    }
  }

  protected setError(error: Error): void {
    this.status.lastError = error.message;
    this.emit("error", error);
    this.emit("status", this.status);
  }

  protected scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      60000 // Max 1 minute
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      
      try {
        await this.connect();
      } catch (error) {
        // Will schedule another reconnect via setConnected(false)
      }
    }, delay);
  }

  protected cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  protected normalizeData(raw: Record<string, number | null>): NormalizedWeatherData {
    return {
      stationId: this.config.stationId,
      timestamp: new Date(),
      temperature: raw.temperature ?? null,
      humidity: raw.humidity ?? null,
      pressure: raw.pressure ?? null,
      windSpeed: raw.windSpeed ?? null,
      windDirection: raw.windDirection ?? null,
      windGust: raw.windGust ?? null,
      rainfall: raw.rainfall ?? null,
      solarRadiation: raw.solarRadiation ?? null,
      dewPoint: raw.dewPoint ?? null,
      batteryVoltage: raw.batteryVoltage ?? null,
    };
  }
}

/**
 * Factory function to create appropriate protocol adapter
 * Campbell Scientific stations use HTTP/TCP or LoRa
 */
export function createProtocolAdapter(config: ProtocolConfig): IProtocolAdapter {
  switch (config.protocol) {
    case "lora":
      const { LoRaAdapter } = require("./loraAdapter");
      return new LoRaAdapter(config);
    case "http":
    case "pakbus":
    default:
      const { HTTPAdapter } = require("./httpAdapter");
      return new HTTPAdapter(config);
  }
}
