/**
 * Connection Manager
 * Handles multiple connection types for Campbell Scientific stations
 * Supports Pull (active polling) and Push (passive receive) modes
 */

import { EventEmitter } from "events";
import { SerialPort } from "serialport";
import { Socket } from "net";
import { PakBusProtocol, PakBusConfig } from "./pakbusProtocol";

export type ConnectionType = "serial" | "tcp" | "rf" | "gsm" | "lora" | "ble";
export type ConnectionMode = "pull" | "push";

export interface ConnectionConfig {
  type: ConnectionType;
  mode: ConnectionMode;
  
  // Serial/RF/GSM settings
  serialPort?: string;
  baudRate?: number;
  dataBits?: 8 | 7;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  
  // TCP/IP settings
  host?: string;
  port?: number;
  
  // PakBus settings
  pakbusAddress: number;
  securityCode?: number;
  neighborAddress?: number;
  
  // Modem settings (GSM/LoRa)
  modemType?: "gsm" | "lora" | "rf407";
  phoneNumber?: string;
  apn?: string;
  
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
  transport: SerialPort | Socket | null;
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

    // Close transport
    if (connection.transport) {
      if (connection.transport instanceof SerialPort) {
        await new Promise<void>((resolve) => {
          if (connection.transport instanceof SerialPort && connection.transport.isOpen) {
            connection.transport.close((err) => {
              if (err) console.error('Error closing serial port:', err);
              resolve();
            });
          } else {
            resolve();
          }
        });
      } else if (connection.transport instanceof Socket) {
        connection.transport.destroy();
      }
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
   * Discover stations on the network
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
      if (config.type === "tcp" && config.host) {
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

      // For serial discovery, scan PakBus addresses
      if (config.type === "serial" && config.serialPort) {
        for (let addr = 1; addr <= 4094; addr++) {
          try {
            const exists = await this.probeSerialAddress(config.serialPort, addr);
            if (exists) {
              discovered.push({ address: addr, type: "serial" });
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
   * List available serial ports
   */
  async listSerialPorts(): Promise<Array<{ path: string; manufacturer?: string }>> {
    try {
      const ports = await SerialPort.list();
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
      }));
    } catch (error) {
      console.error("Error listing serial ports:", error);
      return [];
    }
  }

  /**
   * Get PakBus protocol instance for a station
   */
  getPakBus(stationId: number): PakBusProtocol | null {
    return this.connections.get(stationId)?.pakbus || null;
  }

  /**
   * Create transport based on connection type
   */
  private async createTransport(
    config: ConnectionConfig
  ): Promise<SerialPort | Socket> {
    switch (config.type) {
      case "serial":
      case "rf":
        return this.createSerialTransport(config);
      
      case "tcp":
        return this.createTcpTransport(config);
      
      case "gsm":
        return this.createGsmTransport(config);
      
      case "lora":
        return this.createLoRaTransport(config);
      
      case "ble":
        throw new Error("BLE transport not yet implemented");
      
      default:
        throw new Error(`Unknown connection type: ${config.type}`);
    }
  }

  /**
   * Create serial port transport
   */
  private createSerialTransport(config: ConnectionConfig): Promise<SerialPort> {
    return new Promise((resolve, reject) => {
      if (!config.serialPort) {
        reject(new Error("Serial port not specified"));
        return;
      }

      const port = new SerialPort({
        path: config.serialPort,
        baudRate: config.baudRate || 115200,
        dataBits: config.dataBits || 8,
        stopBits: config.stopBits || 1,
        parity: config.parity || "none",
        autoOpen: false,
      });

      port.open((err) => {
        if (err) {
          reject(new Error(`Failed to open serial port: ${err.message}`));
        } else {
          resolve(port);
        }
      });
    });
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
   * Create GSM modem transport (via serial with AT commands)
   */
  private async createGsmTransport(config: ConnectionConfig): Promise<SerialPort> {
    const port = await this.createSerialTransport(config);
    
    // Initialize modem and dial
    if (config.phoneNumber) {
      await this.sendATCommand(port, "ATZ"); // Reset modem
      await this.sendATCommand(port, "ATE0"); // Disable echo
      await this.sendATCommand(port, `ATD${config.phoneNumber}`); // Dial
      
      // Wait for CONNECT response
      await this.waitForResponse(port, "CONNECT", 60000);
    }
    
    return port;
  }

  /**
   * Create LoRa transport (via serial)
   */
  private async createLoRaTransport(config: ConnectionConfig): Promise<SerialPort> {
    const port = await this.createSerialTransport(config);
    
    // Initialize LoRa module
    await this.sendATCommand(port, "sys reset");
    await this.delay(1000);
    await this.sendATCommand(port, "mac pause");
    await this.sendATCommand(port, "radio set mod lora");
    await this.sendATCommand(port, "radio set freq 915000000"); // US frequency
    await this.sendATCommand(port, "radio set sf sf7");
    await this.sendATCommand(port, "radio set bw 125");
    
    return port;
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
   * Send AT command to modem
   */
  private sendATCommand(port: SerialPort, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      port.write(`${command}\r`, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        let response = "";
        const timeout = setTimeout(() => {
          reject(new Error(`AT command timeout: ${command}`));
        }, 5000);

        const handler = (data: Buffer) => {
          response += data.toString();
          if (response.includes("OK") || response.includes("ERROR")) {
            clearTimeout(timeout);
            port.removeListener("data", handler);
            if (response.includes("ERROR")) {
              reject(new Error(`AT command failed: ${command}`));
            } else {
              resolve(response);
            }
          }
        };

        port.on("data", handler);
      });
    });
  }

  /**
   * Wait for specific response from modem
   */
  private waitForResponse(
    port: SerialPort,
    expected: string,
    timeout: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let response = "";
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for: ${expected}`));
      }, timeout);

      const handler = (data: Buffer) => {
        response += data.toString();
        if (response.includes(expected)) {
          clearTimeout(timer);
          port.removeListener("data", handler);
          resolve();
        } else if (response.includes("NO CARRIER") || response.includes("ERROR")) {
          clearTimeout(timer);
          port.removeListener("data", handler);
          reject(new Error("Connection failed"));
        }
      };

      port.on("data", handler);
    });
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
   * Probe serial port for PakBus address
   */
  private async probeSerialAddress(
    portPath: string,
    address: number
  ): Promise<boolean> {
    // Implement serial address probing
    // This would send a hello to a specific address and check for response
    return false;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const connectionManager = new ConnectionManager();
