/**
 * Modbus Protocol Adapter
 * Wraps ModbusProtocol with IProtocolAdapter interface
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import { ModbusProtocol, WEATHER_STATION_REGISTERS, ModbusConfig } from "./modbus";

export class ModbusAdapter extends BaseProtocolAdapter {
  private protocol: ModbusProtocol;

  constructor(config: ProtocolConfig) {
    super(config);
    
    const modbusConfig: ModbusConfig = {
      mode: config.connectionType === "serial" ? "rtu" : "tcp",
      slaveId: config.slaveId || 1,
      host: config.host,
      port: config.port || 502,
      serialPort: config.serialPort,
      baudRate: config.baudRate || 9600,
      timeout: config.timeout || 5000,
    };

    this.protocol = new ModbusProtocol(modbusConfig);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.protocol.on("connected", () => {
      this.setConnected(true);
      console.log(`[Modbus] Connected to ${this.config.host || this.config.serialPort}`);
    });

    this.protocol.on("disconnected", () => {
      this.setConnected(false);
      console.warn(`[Modbus] Disconnected from ${this.config.host || this.config.serialPort}`);
    });

    this.protocol.on("error", (error) => {
      this.setError(new Error(`[Modbus] Error: ${error.message}`));
    });
  }

  async connect(): Promise<boolean> {
    try {
      const result = await this.protocol.connect();
      this.setConnected(result);
      return result;
    } catch (error) {
      this.setError(error as Error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    await this.protocol.disconnect();
    this.setConnected(false);
  }

  async readData(): Promise<NormalizedWeatherData | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      const rawData = await this.protocol.readWeatherData(WEATHER_STATION_REGISTERS);
      const normalized = this.normalizeData(rawData);
      this.emit("data", normalized);
      return normalized;
    } catch (error) {
      this.setError(error as Error);
      return null;
    }
  }
}
