/**
 * Connection Manager
 * Handles multiple connection types for Campbell Scientific stations
 * Supports Pull (active polling) and Push (passive receive) modes
 * 
 * CLOUD DEPLOYMENT NOTE:
 * This version is designed for Railway/cloud deployment where direct serial
 * connections are not available. All connections use TCP/IP:
 * - TCP: Direct socket connection to station's TCP interface
 * - GSM/4G: Connect to cellular modem's TCP gateway endpoint
 * - LoRa: Connect to LoRaWAN network server via TCP/IP
 */

import { EventEmitter } from "events";
import { Socket } from "net";
import { PakBusProtocol, PakBusConfig } from "./pakbusProtocol";

// Serial type deprecated - kept for backwards compatibility but not functional
export type ConnectionType = "tcp" | "gsm" | "lora" | "http";
export type ConnectionMode = "pull" | "push";

export interface ConnectionConfig {
  type: ConnectionType;
  mode: ConnectionMode;
  
  // TCP/IP settings (used for all connection types in cloud deployment)
  host?: string;
  port?: number;
  
  // PakBus settings
  pakbusAddress: number;
  securityCode?: number;
  neighborAddress?: number;
  
  // Modem gateway settings (GSM/LoRa via TCP gateway)
  modemType?: "gsm" | "lora";
  gatewayHost?: string;
  gatewayPort?: number;
  apn?: string;
  
  // HTTP API settings (for stations with HTTP endpoints)
  apiEndpoint?: string;
  apiKey?: string;
  
  // Connection settings
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  keepAlive?: boolean;
  keepAliveInterval?: number;
}

export interface ConnectionHealth {
  stationId: number;
  isConnected: boolean;
  lastConnected: Date | null;
  lastError: string | null;
  errorCount: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageLatency: number;
  signalStrength?: number;
  batteryVoltage?: number;
}

interface ActiveConnection {
  config: ConnectionConfig;
  transport: Socket | null;
  pakbus: PakBusProtocol;
  health: ConnectionHealth;
  retryTimer: NodeJS.Timeout | null;
  keepAliveTimer: NodeJS.Timeout | null;
}

export class ConnectionManager extends EventEmitter {
  private connections: Map<number, ActiveConnection> = new Map();
  private discoveryInProgress: boolean = false;

  constructor() {
    super();
  }

  /**
   * Add a new station connection
   */
  async addConnection(stationId: number, config: ConnectionConfig): Promise<void> {
    if (this.connections.has(stationId)) {
      await this.removeConnection(stationId);
    }

    const pakbusConfig: PakBusConfig = {
      address: config.pakbusAddress,
      securityCode: config.securityCode,
      neighborAddress: config.neighborAddress,
    };

    const connection: ActiveConnection = {
      config,
      transport: null,
      pakbus: new PakBusProtocol(pakbusConfig),
      health: {
        stationId,
        isConnected: false,
        lastConnected: null,
        lastError: null,
        errorCount: 0,
        successfulTransactions: 0,
        failedTransactions: 0,
        averageLatency: 0,
      },
      retryTimer: null,
      keepAliveTimer: null,
    };

    this.connections.set(stationId, connection);
    this.setupPakBusEvents(stationId, connection);

    // Auto-connect if mode is pull
    if (config.mode === "pull") {
      await this.connect(stationId);
    }
  }

  /**
   * Connect to a station
   */
  async connect(stationId: number): Promise<boolean> {
    const connection = this.connections.get(stationId);
    if (!connection) {
      throw new Error(`Station ${stationId} not found`);
    }

    try {
      const transport = await this.createTransport(connection.config);
      connection.transport = transport;
      
      // Pipe transport to PakBus protocol
      this.pipeTransport(connection);

      // Send hello transaction
      const helloResult = await connection.pakbus.hello();
      if (helloResult.success) {
        connection.health.isConnected = true;
        connection.health.lastConnected = new Date();
        connection.health.lastError = null;
        
        this.emit("connected", stationId);
        
        // Start keep-alive if configured
        if (connection.config.keepAlive) {
          this.startKeepAlive(stationId);
        }
        
        return true;
      } else {
        throw new Error(helloResult.error || "Hello transaction failed");
      }
    } catch (error: any) {
      connection.health.isConnected = false;
      connection.health.lastError = error.message;
      connection.health.errorCount++;
      
      this.emit("error", stationId, error);
      
      // Schedule retry
      this.scheduleRetry(stationId);
      
      return false;
    }
  }

  /**
   * Disconnect from a station
   */
  async disconnect(stationId: number): Promise<void> {
    const connection = this.connections.get(stationId);
    if (!connection) return;

    // Clear timers
    if (connection.retryTimer) {
      clearTimeout(connection.retryTimer);
      connection.retryTimer = null;
    }
    if (connection.keepAliveTimer) {
      clearInterval(connection.keepAliveTimer);
      connection.keepAliveTimer = null;
    }

    // Close transport (TCP socket)
    if (connection.transport) {
      connection.transport.destroy();
      connection.transport = null;
    }

    connection.health.isConnected = false;
    this.emit("disconnected", stationId);
  }

  /**
   * Remove a station connection
   */
  async removeConnection(stationId: number): Promise<void> {
    await this.disconnect(stationId);
    this.connections.delete(stationId);
  }

  /**
   * Get connection health for a station
   */
  getHealth(stationId: number): ConnectionHealth | null {
    return this.connections.get(stationId)?.health || null;
  }

  /**
   * Get all connection health statuses
   */
  getAllHealth(): ConnectionHealth[] {
    return Array.from(this.connections.values()).map((c) => c.health);
  }

  /**
   * Discover stations on the network (TCP only in cloud deployment)
   */
  async discoverStations(
    config: Partial<ConnectionConfig>
  ): Promise<Array<{ address: number; type: string }>> {
    if (this.discoveryInProgress) {
      throw new Error("Discovery already in progress");
    }

    this.discoveryInProgress = true;
    const discovered: Array<{ address: number; type: string }> = [];

    try {
      // For TCP discovery, scan common ports
      if (config.host) {
        const ports = [6785, 6786, 6787, 6788]; // Common PakBus ports
        for (const port of ports) {
          try {
            const result = await this.probeAddress(config.host, port);
            if (result) {
              discovered.push({ address: result, type: "tcp" });
            }
          } catch {
            // Continue scanning
          }
        }
      }

      this.emit("discovery-complete", discovered);
      return discovered;
    } finally {
      this.discoveryInProgress = false;
    }
  }

  /**
   * List available connection endpoints
   * Note: Serial ports not available in cloud deployment
   */
  async listAvailableEndpoints(): Promise<Array<{ type: string; description: string }>> {
    return [
      { type: "tcp", description: "Direct TCP/IP connection to station" },
      { type: "gsm", description: "Cellular modem via TCP gateway" },
      { type: "lora", description: "LoRaWAN network server via TCP/IP" },
      { type: "http", description: "HTTP API endpoint" },
    ];
  }

  /**
   * Get PakBus protocol instance for a station
   */
  getPakBus(stationId: number): PakBusProtocol | null {
    return this.connections.get(stationId)?.pakbus || null;
  }

  /**
   * Create transport based on connection type
   * All transports use TCP/IP in cloud deployment
   */
  private async createTransport(
    config: ConnectionConfig
  ): Promise<Socket> {
    switch (config.type) {
      case "tcp":
        return this.createTcpTransport(config);
      
      case "gsm":
        return this.createGsmGatewayTransport(config);
      
      case "lora":
        return this.createLoRaGatewayTransport(config);
      
      case "http":
        // HTTP connections don't use sockets directly
        // Return a dummy socket that will be replaced with HTTP fetch
        throw new Error("HTTP connections use direct API calls, not socket transport");
      
      default:
        throw new Error(`Unknown connection type: ${config.type}`);
    }
  }
      
      case "ble":
        throw new Error("BLE transport not yet implemented");
      
      default:
        throw new Error(`Unknown connection type: ${config.type}`);
    }
  }

  /**
   * Create TCP socket transport
   */
  private createTcpTransport(config: ConnectionConfig): Promise<Socket> {
    return new Promise((resolve, reject) => {
      if (!config.host) {
        reject(new Error("Host not specified"));
        return;
      }

      const socket = new Socket();
      const timeout = config.timeout || 10000;

      socket.setTimeout(timeout);

      socket.connect(config.port || 6785, config.host, () => {
        socket.setTimeout(0);
        resolve(socket);
      });

      socket.on("error", (err) => {
        reject(new Error(`TCP connection failed: ${err.message}`));
      });

      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("TCP connection timeout"));
      });
    });
  }

  /**
   * Create GSM/4G gateway transport (via TCP to modem gateway)
   * Connects to cellular modem's TCP endpoint instead of serial
   */
  private async createGsmGatewayTransport(config: ConnectionConfig): Promise<Socket> {
    const host = config.gatewayHost || config.host;
    const port = config.gatewayPort || config.port || 6785;
    
    if (!host) {
      throw new Error("GSM gateway host not specified");
    }
    
    console.log(`[GSM] Connecting to cellular gateway at ${host}:${port}`);
    
    return this.createTcpTransport({
      ...config,
      host,
      port,
      type: "tcp",
    });
  }

  /**
   * Create LoRa gateway transport (via TCP to LoRaWAN network server)
   */
  private async createLoRaGatewayTransport(config: ConnectionConfig): Promise<Socket> {
    const host = config.gatewayHost || config.host;
    const port = config.gatewayPort || config.port || 1700;
    
    if (!host) {
      throw new Error("LoRa network server host not specified");
    }
    
    console.log(`[LoRa] Connecting to LoRaWAN network server at ${host}:${port}`);
    
    return this.createTcpTransport({
      ...config,
      host,
      port,
      type: "tcp",
    });
  }

  /**
   * Pipe transport to PakBus protocol
   */
  private pipeTransport(connection: ActiveConnection): void {
    if (!connection.transport) return;

    connection.transport.on("data", (data: Buffer) => {
      connection.pakbus.processIncoming(data);
    });

    connection.pakbus.on("send", (data: Buffer) => {
      if (connection.transport) {
        connection.transport.write(data);
      }
    });
  }

  /**
   * Setup PakBus event handlers
   */
  private setupPakBusEvents(stationId: number, connection: ActiveConnection): void {
    connection.pakbus.on("data", (data: any) => {
      connection.health.successfulTransactions++;
      this.emit("data", stationId, data);
    });

    connection.pakbus.on("error", (error: Error) => {
      connection.health.failedTransactions++;
      connection.health.lastError = error.message;
      this.emit("pakbus-error", stationId, error);
    });

    connection.pakbus.on("status", (status: any) => {
      if (status.batteryVoltage !== undefined) {
        connection.health.batteryVoltage = status.batteryVoltage;
      }
      this.emit("status", stationId, status);
    });
  }

  /**
   * Schedule connection retry
   */
  private scheduleRetry(stationId: number): void {
    const connection = this.connections.get(stationId);
    if (!connection) return;

    const { retryAttempts = 3, retryDelay = 5000 } = connection.config;
    
    if (connection.health.errorCount <= retryAttempts) {
      connection.retryTimer = setTimeout(() => {
        this.connect(stationId);
      }, retryDelay);
    } else {
      this.emit("max-retries", stationId);
    }
  }

  /**
   * Start keep-alive timer
   */
  private startKeepAlive(stationId: number): void {
    const connection = this.connections.get(stationId);
    if (!connection) return;

    const interval = connection.config.keepAliveInterval || 60000;
    
    connection.keepAliveTimer = setInterval(async () => {
      try {
        await connection.pakbus.hello();
      } catch (error) {
        console.error(`Keep-alive failed for station ${stationId}`);
        await this.disconnect(stationId);
        await this.connect(stationId);
      }
    }, interval);
  }

  /**
   * Probe TCP address for PakBus device
   */
  private async probeAddress(host: string, port: number): Promise<number | null> {
    try {
      const socket = await this.createTcpTransport({ type: "tcp", host, port, pakbusAddress: 1, mode: "pull" });
      
      const pakbus = new PakBusProtocol({ address: 1 });
      let foundAddress: number | null = null;

      socket.on("data", (data: Buffer) => {
        pakbus.processIncoming(data);
      });

      pakbus.on("send", (data: Buffer) => {
        socket.write(data);
      });

      const result = await pakbus.hello();
      if (result.success) {
        foundAddress = result.address || 1;
      }

      socket.destroy();
      return foundAddress;
    } catch {
      return null;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const connectionManager = new ConnectionManager();
