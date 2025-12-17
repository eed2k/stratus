import { EventEmitter } from 'events';
import { ConnectionManager, ConnectionConfig, StationStatus } from './connectionManager';
import { storage } from '../storage';
import { InsertWeatherData } from '@shared/schema';

export interface DataCollectionConfig {
  stationId: number;
  enabled: boolean;
  connectionConfig: ConnectionConfig;
}

export class DataCollectionService extends EventEmitter {
  private connectionManager: ConnectionManager;
  private activeStations: Map<number, DataCollectionConfig> = new Map();
  private dataBuffers: Map<number, any[]> = new Map();
  private flushTimers: Map<number, NodeJS.Timeout> = new Map();
  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL = 10000; // 10 seconds

  constructor() {
    super();
    this.connectionManager = new ConnectionManager();
    this.setupConnectionManagerListeners();
  }

  /**
   * Setup listeners for connection manager events
   */
  private setupConnectionManagerListeners(): void {
    this.connectionManager.on('connected', ({ stationId }) => {
      console.log(`Station ${stationId} connected`);
      this.emit('station-connected', stationId);
    });

    this.connectionManager.on('disconnected', ({ stationId }) => {
      console.log(`Station ${stationId} disconnected`);
      this.emit('station-disconnected', stationId);
    });

    this.connectionManager.on('data', async ({ stationId, records, tableName }) => {
      await this.handleIncomingData(stationId, records, tableName);
    });

    this.connectionManager.on('status-update', (status: StationStatus) => {
      this.updateStationStatus(status);
    });

    this.connectionManager.on('error', ({ stationId, error }) => {
      console.error(`Station ${stationId} error:`, error);
      this.emit('station-error', { stationId, error });
    });

    this.connectionManager.on('reconnecting', ({ stationId, attempt }) => {
      console.log(`Station ${stationId} reconnecting (attempt ${attempt})`);
      this.emit('station-reconnecting', { stationId, attempt });
    });

    this.connectionManager.on('reconnect-failed', ({ stationId, attempts }) => {
      console.error(`Station ${stationId} reconnection failed after ${attempts} attempts`);
      this.emit('station-reconnect-failed', { stationId, attempts });
    });
  }

  /**
   * Start data collection for a station
   */
  async startStation(config: DataCollectionConfig): Promise<void> {
    const { stationId, connectionConfig } = config;

    try {
      // Store configuration
      this.activeStations.set(stationId, config);

      // Initialize data buffer
      this.dataBuffers.set(stationId, []);

      // Setup flush timer
      const flushTimer = setInterval(() => {
        this.flushDataBuffer(stationId);
      }, this.FLUSH_INTERVAL);
      this.flushTimers.set(stationId, flushTimer);

      // Connect to station
      await this.connectionManager.connect(connectionConfig);

      console.log(`Data collection started for station ${stationId}`);
    } catch (error) {
      console.error(`Failed to start station ${stationId}:`, error);
      throw error;
    }
  }

  /**
   * Stop data collection for a station
   */
  async stopStation(stationId: number): Promise<void> {
    try {
      // Flush remaining data
      await this.flushDataBuffer(stationId);

      // Clear flush timer
      const flushTimer = this.flushTimers.get(stationId);
      if (flushTimer) {
        clearInterval(flushTimer);
        this.flushTimers.delete(stationId);
      }

      // Disconnect
      await this.connectionManager.disconnect(stationId);

      // Clean up
      this.activeStations.delete(stationId);
      this.dataBuffers.delete(stationId);

      console.log(`Data collection stopped for station ${stationId}`);
    } catch (error) {
      console.error(`Failed to stop station ${stationId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming data from datalogger
   */
  private async handleIncomingData(stationId: number, records: any[], tableName: string): Promise<void> {
    if (!records || records.length === 0) {
      return;
    }

    console.log(`Received ${records.length} records from station ${stationId}, table ${tableName}`);

    // Transform records to weather data format
    const weatherDataRecords: InsertWeatherData[] = records.map(record => 
      this.transformToWeatherData(stationId, record)
    );

    // Add to buffer
    const buffer = this.dataBuffers.get(stationId) || [];
    buffer.push(...weatherDataRecords);
    this.dataBuffers.set(stationId, buffer);

    // Flush if buffer is full
    if (buffer.length >= this.BUFFER_SIZE) {
      await this.flushDataBuffer(stationId);
    }

    // Emit real-time data event
    this.emit('data-received', {
      stationId,
      records: weatherDataRecords,
      tableName,
    });
  }

  /**
   * Transform Campbell Scientific data record to standard weather data format
   */
  private transformToWeatherData(stationId: number, record: any): InsertWeatherData {
    // Map common Campbell Scientific field names to our schema
    const fieldMappings: { [key: string]: string } = {
      'AirTC': 'temperature',
      'AirTC_Avg': 'temperature',
      'Temp_C': 'temperature',
      'RH': 'humidity',
      'RH_Avg': 'humidity',
      'BP_mbar': 'pressure',
      'BP_mbar_Avg': 'pressure',
      'Press_mbar': 'pressure',
      'WS_ms': 'windSpeed',
      'WS_ms_Avg': 'windSpeed',
      'WindSpeed': 'windSpeed',
      'WindDir': 'windDirection',
      'WindDir_D1_WVT': 'windDirection',
      'WS_ms_Max': 'windGust',
      'WindGust': 'windGust',
      'Rain_mm_Tot': 'rainfall',
      'Rain_mm': 'rainfall',
      'SlrW': 'solarRadiation',
      'SlrW_Avg': 'solarRadiation',
      'Solar_Wm2': 'solarRadiation',
      'UV_Index': 'uvIndex',
      'DewPoint': 'dewPoint',
      'DewPt_C': 'dewPoint',
      'AirDensity': 'airDensity',
      'ETo': 'eto',
    };

    const weatherData: InsertWeatherData = {
      stationId,
      timestamp: record.timestamp || new Date(),
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windDirection: null,
      windGust: null,
      rainfall: null,
      solarRadiation: null,
      uvIndex: null,
      dewPoint: null,
      airDensity: null,
      eto: null,
    };

    // Map fields
    for (const [campbellField, standardField] of Object.entries(fieldMappings)) {
      if (record[campbellField] !== undefined && record[campbellField] !== null) {
        (weatherData as any)[standardField] = record[campbellField];
      }
    }

    // Calculate derived parameters if not present
    if (weatherData.temperature !== null && weatherData.humidity !== null && weatherData.dewPoint === null) {
      weatherData.dewPoint = this.calculateDewPoint(weatherData.temperature, weatherData.humidity);
    }

    return weatherData;
  }

  /**
   * Calculate dew point from temperature and humidity
   */
  private calculateDewPoint(temperature: number, humidity: number): number {
    const a = 17.27;
    const b = 237.7;
    const alpha = ((a * temperature) / (b + temperature)) + Math.log(humidity / 100);
    return (b * alpha) / (a - alpha);
  }

  /**
   * Flush data buffer to database
   */
  private async flushDataBuffer(stationId: number): Promise<void> {
    const buffer = this.dataBuffers.get(stationId);
    if (!buffer || buffer.length === 0) {
      return;
    }

    try {
      // Insert data in batches
      const batchSize = 50;
      for (let i = 0; i < buffer.length; i += batchSize) {
        const batch = buffer.slice(i, i + batchSize);
        await Promise.all(batch.map(data => storage.insertWeatherData(data)));
      }

      console.log(`Flushed ${buffer.length} records for station ${stationId}`);

      // Clear buffer
      this.dataBuffers.set(stationId, []);

      // Emit flush event
      this.emit('data-flushed', { stationId, count: buffer.length });
    } catch (error) {
      console.error(`Failed to flush data for station ${stationId}:`, error);
      this.emit('flush-error', { stationId, error });
    }
  }

  /**
   * Update station status in database
   */
  private async updateStationStatus(status: StationStatus): Promise<void> {
    try {
      await storage.updateStation(status.stationId, {
        isConnected: status.isConnected,
        lastConnectionTime: status.lastConnectionTime,
        lastDataTime: status.lastDataTime,
        batteryVoltage: status.batteryVoltage,
        panelTemperature: status.panelTemperature,
        dataloggerProgramName: status.programName,
        dataloggerProgramSignature: status.programSignature?.toString(),
        dataloggerFirmwareVersion: status.osVersion,
      });
    } catch (error) {
      console.error(`Failed to update station status for ${status.stationId}:`, error);
    }
  }

  /**
   * Manually collect data from a station
   */
  async collectDataNow(stationId: number, tableName?: string): Promise<any[]> {
    const config = this.activeStations.get(stationId);
    if (!config) {
      throw new Error(`Station ${stationId} is not active`);
    }

    const table = tableName || config.connectionConfig.dataTable || 'OneMin';
    return await this.connectionManager.collectData(stationId, table);
  }

  /**
   * Get station status
   */
  getStationStatus(stationId: number): StationStatus | undefined {
    return this.connectionManager.getStatus(stationId);
  }

  /**
   * Get all station statuses
   */
  getAllStationStatuses(): StationStatus[] {
    return this.connectionManager.getAllStatuses();
  }

  /**
   * Get table definition from datalogger
   */
  async getTableDefinition(stationId: number, tableName: string): Promise<any> {
    return await this.connectionManager.getTableDefinition(stationId, tableName);
  }

  /**
   * Check if station is active
   */
  isStationActive(stationId: number): boolean {
    return this.activeStations.has(stationId);
  }

  /**
   * Get active station IDs
   */
  getActiveStationIds(): number[] {
    return Array.from(this.activeStations.keys());
  }

  /**
   * Restart a station
   */
  async restartStation(stationId: number): Promise<void> {
    const config = this.activeStations.get(stationId);
    if (!config) {
      throw new Error(`Station ${stationId} is not active`);
    }

    await this.stopStation(stationId);
    await this.startStation(config);
  }

  /**
   * Stop all stations
   */
  async stopAll(): Promise<void> {
    const stationIds = Array.from(this.activeStations.keys());
    await Promise.all(stationIds.map(id => this.stopStation(id)));
  }

  /**
   * Initialize service with stations from database
   */
  async initialize(): Promise<void> {
    try {
      const stations = await storage.getStations();
      
      for (const station of stations) {
        if (station.isActive) {
          const connectionConfig: ConnectionConfig = {
            stationId: station.id,
            connectionType: (station.connectionType as any) || 'tcp',
            protocol: (station.protocol as any) || 'pakbus',
            host: station.ipAddress || undefined,
            port: station.port || 6785,
            serialPort: station.serialPort || undefined,
            baudRate: station.baudRate || 115200,
            pakbusAddress: station.pakbusAddress || 1,
            securityCode: station.securityCode || 0,
            dataTable: station.dataTable || 'OneMin',
            pollInterval: station.pollInterval || 60,
            autoReconnect: true,
            reconnectInterval: 30,
            maxReconnectAttempts: 10,
          };

          const config: DataCollectionConfig = {
            stationId: station.id,
            enabled: true,
            connectionConfig,
          };

          try {
            await this.startStation(config);
          } catch (error) {
            console.error(`Failed to start station ${station.id}:`, error);
          }
        }
      }

      console.log(`Data collection service initialized with ${this.activeStations.size} stations`);
    } catch (error) {
      console.error('Failed to initialize data collection service:', error);
      throw error;
    }
  }
}

// Singleton instance
export const dataCollectionService = new DataCollectionService();
