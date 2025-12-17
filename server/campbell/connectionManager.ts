import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import * as net from 'net';
import { PakBusProtocol, DataTableDefinition } from './pakbus';

export interface ConnectionConfig {
  stationId: number;
  connectionType: 'serial' | 'tcp' | 'http' | 'mqtt';
  protocol: 'pakbus' | 'modbus' | 'http' | 'mqtt';
  
  // Serial configuration
  serialPort?: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  
  // TCP/IP configuration
  host?: string;
  port?: number;
  
  // PakBus configuration
  pakbusAddress?: number;
  securityCode?: number;
  
  // Polling configuration
  pollInterval?: number;
  dataTable?: string;
  
  // Reconnection
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface StationStatus {
  stationId: number;
  isConnected: boolean;
  lastConnectionTime?: Date;
  lastDataTime?: Date;
  batteryVoltage?: number;
  panelTemperature?: number;
  programName?: string;
  programSignature?: number;
  osVersion?: string;
  errorMessage?: string;
}

export class ConnectionManager extends EventEmitter {
  private connections: Map<number, any> = new Map();
  private protocols: Map<number, PakBusProtocol> = new Map();
  private pollTimers: Map<number, NodeJS.Timeout> = new Map();
  private reconnectTimers: Map<number, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<number, number> = new Map();
  private stationStatuses: Map<number, StationStatus> = new Map();
  private tableDefinitions: Map<string, DataTableDefinition> = new Map();

  constructor() {
    super();
  }

  /**
   * Connect to a Campbell Scientific datalogger
   */
  async connect(config: ConnectionConfig): Promise<void> {
    const { stationId, connectionType, protocol } = config;

    // Disconnect if already connected
    if (this.connections.has(stationId)) {
      await this.disconnect(stationId);
    }

    try {
      let connection: any;

      switch (connectionType) {
        case 'serial':
          connection = await this.connectSerial(config);
          break;
        case 'tcp':
          connection = await this.connectTCP(config);
          break;
        case 'http':
          connection = await this.connectHTTP(config);
          break;
        case 'mqtt':
          connection = await this.connectMQTT(config);
          break;
        default:
          throw new Error(`Unsupported connection type: ${connectionType}`);
      }

      this.connections.set(stationId, connection);
      this.reconnectAttempts.set(stationId, 0);

      // Initialize protocol handler
      if (protocol === 'pakbus') {
        const pakbus = new PakBusProtocol({
          address: config.pakbusAddress || 4095,
          securityCode: config.securityCode || 0,
        });
        this.protocols.set(stationId, pakbus);

        // Setup PakBus message handling
        this.setupPakBusHandlers(stationId, connection, pakbus);

        // Send Hello command
        await this.sendPakBusCommand(stationId, pakbus.createHelloCommand());

        // Get program statistics
        await this.updateStationStatus(stationId);
      }

      // Update status
      this.updateConnectionStatus(stationId, true);

      // Start polling if configured
      if (config.pollInterval && config.pollInterval > 0) {
        this.startPolling(stationId, config);
      }

      this.emit('connected', { stationId });
    } catch (error) {
      this.emit('error', { stationId, error });
      
      // Schedule reconnection if enabled
      if (config.autoReconnect) {
        this.scheduleReconnect(stationId, config);
      }
      
      throw error;
    }
  }

  /**
   * Connect via RS-232 serial port
   */
  private async connectSerial(config: ConnectionConfig): Promise<SerialPort> {
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: config.serialPort!,
        baudRate: config.baudRate || 115200,
        dataBits: config.dataBits || 8,
        stopBits: config.stopBits || 1,
        parity: config.parity || 'none',
      });

      port.on('open', () => {
        resolve(port);
      });

      port.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Connect via TCP/IP
   */
  private async connectTCP(config: ConnectionConfig): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      
      socket.connect(config.port || 6785, config.host || 'localhost', () => {
        resolve(socket);
      });

      socket.on('error', (error) => {
        reject(error);
      });

      socket.setTimeout(30000);
    });
  }

  /**
   * Connect via HTTP (for HTTP-based dataloggers)
   */
  private async connectHTTP(config: ConnectionConfig): Promise<any> {
    // HTTP connection is stateless, return config for later use
    return {
      type: 'http',
      baseUrl: `http://${config.host}:${config.port || 80}`,
      config,
    };
  }

  /**
   * Connect via MQTT
   */
  private async connectMQTT(config: ConnectionConfig): Promise<any> {
    // MQTT implementation would go here
    throw new Error('MQTT connection not yet implemented');
  }

  /**
   * Setup PakBus protocol handlers
   */
  private setupPakBusHandlers(stationId: number, connection: any, pakbus: PakBusProtocol): void {
    let buffer = Buffer.alloc(0);

    const dataHandler = (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      // Try to parse complete frames
      while (buffer.length >= 10) {
        // Look for frame signature
        const sigIndex = buffer.indexOf(0xBD);
        if (sigIndex === -1) {
          buffer = Buffer.alloc(0);
          break;
        }

        if (sigIndex > 0) {
          buffer = buffer.slice(sigIndex);
        }

        // Try to parse frame
        const message = pakbus.parseFrame(buffer);
        if (message) {
          this.emit('pakbus-message', { stationId, message });
          
          // Remove parsed frame from buffer
          // Estimate frame length (this is simplified)
          const frameLength = 10 + message.payload.length;
          buffer = buffer.slice(frameLength);
        } else {
          // Wait for more data
          break;
        }
      }
    };

    if (connection instanceof SerialPort) {
      connection.on('data', dataHandler);
    } else if (connection instanceof net.Socket) {
      connection.on('data', dataHandler);
    }
  }

  /**
   * Send PakBus command
   */
  private async sendPakBusCommand(stationId: number, command: Buffer): Promise<void> {
    const connection = this.connections.get(stationId);
    if (!connection) {
      throw new Error(`No connection for station ${stationId}`);
    }

    return new Promise((resolve, reject) => {
      if (connection instanceof SerialPort || connection instanceof net.Socket) {
        connection.write(command, (error: Error | null | undefined) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      } else {
        reject(new Error('Unsupported connection type for PakBus'));
      }
    });
  }

  /**
   * Update station status (battery, temperature, program info)
   */
  private async updateStationStatus(stationId: number): Promise<void> {
    const pakbus = this.protocols.get(stationId);
    if (!pakbus) return;

    try {
      const command = pakbus.createGetProgStatCommand();
      await this.sendPakBusCommand(stationId, command);

      // Response will be handled by message listener
      this.once('pakbus-message', ({ stationId: sid, message }) => {
        if (sid === stationId && message.messageType === 0x89) {
          const progStat = pakbus.parseProgStatResponse(message.payload);
          if (progStat) {
            const status = this.stationStatuses.get(stationId) || { stationId, isConnected: true };
            status.programName = progStat.powerUpProgramName;
            status.programSignature = progStat.programSignature;
            status.osVersion = progStat.osVersion;
            this.stationStatuses.set(stationId, status);
            this.emit('status-update', status);
          }
        }
      });
    } catch (error) {
      this.emit('error', { stationId, error });
    }
  }

  /**
   * Get table definition from datalogger
   */
  async getTableDefinition(stationId: number, tableName: string): Promise<DataTableDefinition | null> {
    const cacheKey = `${stationId}:${tableName}`;
    
    // Check cache
    if (this.tableDefinitions.has(cacheKey)) {
      return this.tableDefinitions.get(cacheKey)!;
    }

    const pakbus = this.protocols.get(stationId);
    if (!pakbus) {
      throw new Error(`No PakBus protocol for station ${stationId}`);
    }

    return new Promise((resolve, reject) => {
      const command = pakbus.createTableDefCommand(tableName);
      
      const timeout = setTimeout(() => {
        reject(new Error('Table definition request timeout'));
      }, 30000);

      this.once('pakbus-message', ({ stationId: sid, message }) => {
        clearTimeout(timeout);
        
        if (sid === stationId && message.messageType === 0x89) {
          const tableDef = pakbus.parseTableDefResponse(message.payload);
          if (tableDef) {
            this.tableDefinitions.set(cacheKey, tableDef);
            resolve(tableDef);
          } else {
            reject(new Error('Failed to parse table definition'));
          }
        }
      });

      this.sendPakBusCommand(stationId, command).catch(reject);
    });
  }

  /**
   * Collect data from datalogger
   */
  async collectData(stationId: number, tableName: string, mode: number = 0x07): Promise<any[]> {
    const pakbus = this.protocols.get(stationId);
    if (!pakbus) {
      throw new Error(`No PakBus protocol for station ${stationId}`);
    }

    // Get table definition first
    const tableDef = await this.getTableDefinition(stationId, tableName);
    if (!tableDef) {
      throw new Error(`Could not get table definition for ${tableName}`);
    }

    return new Promise((resolve, reject) => {
      const command = pakbus.createCollectDataCommand(tableName, mode);
      
      const timeout = setTimeout(() => {
        reject(new Error('Data collection timeout'));
      }, 60000);

      this.once('pakbus-message', ({ stationId: sid, message }) => {
        clearTimeout(timeout);
        
        if (sid === stationId && message.messageType === 0x89) {
          const records = pakbus.parseCollectDataResponse(message.payload, tableDef);
          resolve(records);
        }
      });

      this.sendPakBusCommand(stationId, command).catch(reject);
    });
  }

  /**
   * Start automatic polling
   */
  private startPolling(stationId: number, config: ConnectionConfig): void {
    // Clear existing timer
    this.stopPolling(stationId);

    const interval = config.pollInterval! * 1000;
    const tableName = config.dataTable || 'OneMin';

    const poll = async () => {
      try {
        const records = await this.collectData(stationId, tableName);
        
        if (records && records.length > 0) {
          this.emit('data', { stationId, records, tableName });
          this.updateConnectionStatus(stationId, true, new Date());
        }
      } catch (error) {
        this.emit('error', { stationId, error });
        
        // Attempt reconnection on error
        if (config.autoReconnect) {
          this.scheduleReconnect(stationId, config);
        }
      }
    };

    // Initial poll
    poll();

    // Setup interval
    const timer = setInterval(poll, interval);
    this.pollTimers.set(stationId, timer);
  }

  /**
   * Stop polling
   */
  private stopPolling(stationId: number): void {
    const timer = this.pollTimers.get(stationId);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(stationId);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(stationId: number, config: ConnectionConfig): void {
    const attempts = this.reconnectAttempts.get(stationId) || 0;
    const maxAttempts = config.maxReconnectAttempts || 10;

    if (attempts >= maxAttempts) {
      this.emit('reconnect-failed', { stationId, attempts });
      return;
    }

    // Clear existing timer
    const existingTimer = this.reconnectTimers.get(stationId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const delay = (config.reconnectInterval || 30) * 1000;
    const timer = setTimeout(async () => {
      this.reconnectAttempts.set(stationId, attempts + 1);
      this.emit('reconnecting', { stationId, attempt: attempts + 1 });
      
      try {
        await this.connect(config);
      } catch (error) {
        // Error handler will schedule next attempt
      }
    }, delay);

    this.reconnectTimers.set(stationId, timer);
  }

  /**
   * Update connection status
   */
  private updateConnectionStatus(stationId: number, isConnected: boolean, lastDataTime?: Date): void {
    const status = this.stationStatuses.get(stationId) || { stationId, isConnected: false };
    
    status.isConnected = isConnected;
    if (isConnected) {
      status.lastConnectionTime = new Date();
    }
    if (lastDataTime) {
      status.lastDataTime = lastDataTime;
    }

    this.stationStatuses.set(stationId, status);
    this.emit('status-update', status);
  }

  /**
   * Disconnect from station
   */
  async disconnect(stationId: number): Promise<void> {
    // Stop polling
    this.stopPolling(stationId);

    // Clear reconnect timer
    const reconnectTimer = this.reconnectTimers.get(stationId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(stationId);
    }

    // Close connection
    const connection = this.connections.get(stationId);
    if (connection) {
      if (connection instanceof SerialPort) {
        await new Promise<void>((resolve) => {
          connection.close(() => resolve());
        });
      } else if (connection instanceof net.Socket) {
        connection.destroy();
      }
      this.connections.delete(stationId);
    }

    // Clean up
    this.protocols.delete(stationId);
    this.reconnectAttempts.delete(stationId);
    this.updateConnectionStatus(stationId, false);

    this.emit('disconnected', { stationId });
  }

  /**
   * Get station status
   */
  getStatus(stationId: number): StationStatus | undefined {
    return this.stationStatuses.get(stationId);
  }

  /**
   * Get all station statuses
   */
  getAllStatuses(): StationStatus[] {
    return Array.from(this.stationStatuses.values());
  }

  /**
   * Disconnect all stations
   */
  async disconnectAll(): Promise<void> {
    const stationIds = Array.from(this.connections.keys());
    await Promise.all(stationIds.map(id => this.disconnect(id)));
  }
}
