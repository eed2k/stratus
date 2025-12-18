/**
 * Modbus RTU/TCP Protocol Implementation
 * Supports reading weather data from Modbus-compatible devices
 */

import { EventEmitter } from "events";

export interface ModbusConfig {
  mode: "rtu" | "tcp";
  slaveId: number;
  // RTU settings
  serialPort?: string;
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  // TCP settings
  host?: string;
  port?: number;
  timeout?: number;
}

export interface ModbusRegister {
  address: number;
  length: number;
  type: "holding" | "input" | "coil" | "discrete";
  dataType: "int16" | "uint16" | "int32" | "uint32" | "float32" | "float64";
  scale?: number;
  offset?: number;
  name: string;
  unit?: string;
}

interface ModbusFrame {
  slaveId: number;
  functionCode: number;
  data: Buffer;
  crc?: number;
}

// Modbus function codes
const FUNCTION_CODES = {
  READ_COILS: 0x01,
  READ_DISCRETE_INPUTS: 0x02,
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_COIL: 0x05,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_COILS: 0x0f,
  WRITE_MULTIPLE_REGISTERS: 0x10,
};

export class ModbusProtocol extends EventEmitter {
  private config: ModbusConfig;
  private connected: boolean = false;
  private socket: any = null;
  private transactionId: number = 0;

  constructor(config: ModbusConfig) {
    super();
    this.config = {
      timeout: 5000,
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      port: 502,
      ...config,
    };
  }

  async connect(): Promise<boolean> {
    try {
      if (this.config.mode === "tcp") {
        return await this.connectTCP();
      } else {
        return await this.connectRTU();
      }
    } catch (error) {
      this.emit("error", error);
      return false;
    }
  }

  private async connectTCP(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const net = require("net");
      this.socket = new net.Socket();
      this.socket.setTimeout(this.config.timeout || 5000);

      this.socket.connect(this.config.port || 502, this.config.host, () => {
        this.connected = true;
        this.emit("connected");
        resolve(true);
      });

      this.socket.on("error", (err: Error) => {
        this.connected = false;
        this.emit("error", err);
        reject(err);
      });

      this.socket.on("close", () => {
        this.connected = false;
        this.emit("disconnected");
      });

      this.socket.on("data", (data: Buffer) => {
        this.handleResponse(data);
      });
    });
  }

  private async connectRTU(): Promise<boolean> {
    // RTU requires serialport package - emit event for external handling
    this.emit("rtu-connect-request", this.config);
    return true;
  }

  async readHoldingRegisters(startAddress: number, quantity: number): Promise<number[]> {
    const frame = this.buildReadRequest(
      FUNCTION_CODES.READ_HOLDING_REGISTERS,
      startAddress,
      quantity
    );
    return this.sendRequest(frame, quantity);
  }

  async readInputRegisters(startAddress: number, quantity: number): Promise<number[]> {
    const frame = this.buildReadRequest(
      FUNCTION_CODES.READ_INPUT_REGISTERS,
      startAddress,
      quantity
    );
    return this.sendRequest(frame, quantity);
  }

  async readRegister(register: ModbusRegister): Promise<number | null> {
    try {
      let values: number[];
      
      if (register.type === "holding") {
        values = await this.readHoldingRegisters(register.address, register.length);
      } else if (register.type === "input") {
        values = await this.readInputRegisters(register.address, register.length);
      } else {
        return null;
      }

      const rawValue = this.parseValue(values, register.dataType);
      const scaledValue = (rawValue * (register.scale || 1)) + (register.offset || 0);
      
      return scaledValue;
    } catch (error) {
      this.emit("error", error);
      return null;
    }
  }

  async readWeatherData(registers: ModbusRegister[]): Promise<Record<string, number | null>> {
    const result: Record<string, number | null> = {};
    
    for (const register of registers) {
      result[register.name] = await this.readRegister(register);
    }
    
    return result;
  }

  private buildReadRequest(functionCode: number, startAddress: number, quantity: number): Buffer {
    if (this.config.mode === "tcp") {
      return this.buildTCPFrame(functionCode, startAddress, quantity);
    } else {
      return this.buildRTUFrame(functionCode, startAddress, quantity);
    }
  }

  private buildTCPFrame(functionCode: number, startAddress: number, quantity: number): Buffer {
    const buffer = Buffer.alloc(12);
    this.transactionId = (this.transactionId + 1) & 0xffff;
    
    buffer.writeUInt16BE(this.transactionId, 0);  // Transaction ID
    buffer.writeUInt16BE(0, 2);                    // Protocol ID (0 = Modbus)
    buffer.writeUInt16BE(6, 4);                    // Length
    buffer.writeUInt8(this.config.slaveId, 6);     // Unit ID
    buffer.writeUInt8(functionCode, 7);            // Function code
    buffer.writeUInt16BE(startAddress, 8);         // Start address
    buffer.writeUInt16BE(quantity, 10);            // Quantity
    
    return buffer;
  }

  private buildRTUFrame(functionCode: number, startAddress: number, quantity: number): Buffer {
    const buffer = Buffer.alloc(8);
    
    buffer.writeUInt8(this.config.slaveId, 0);     // Slave ID
    buffer.writeUInt8(functionCode, 1);            // Function code
    buffer.writeUInt16BE(startAddress, 2);         // Start address
    buffer.writeUInt16BE(quantity, 4);             // Quantity
    
    const crc = this.calculateCRC(buffer.slice(0, 6));
    buffer.writeUInt16LE(crc, 6);
    
    return buffer;
  }

  private calculateCRC(buffer: Buffer): number {
    let crc = 0xffff;
    
    for (let i = 0; i < buffer.length; i++) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 0x0001) {
          crc = (crc >> 1) ^ 0xa001;
        } else {
          crc >>= 1;
        }
      }
    }
    
    return crc;
  }

  private async sendRequest(frame: Buffer, expectedRegisters: number): Promise<number[]> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.socket) {
        reject(new Error("Not connected"));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Request timeout"));
      }, this.config.timeout || 5000);

      const responseHandler = (data: Buffer) => {
        clearTimeout(timeout);
        try {
          const values = this.parseResponse(data, expectedRegisters);
          resolve(values);
        } catch (error) {
          reject(error);
        }
      };

      this.once("response", responseHandler);
      this.socket.write(frame);
    });
  }

  private handleResponse(data: Buffer): void {
    this.emit("response", data);
  }

  private parseResponse(data: Buffer, expectedRegisters: number): number[] {
    const offset = this.config.mode === "tcp" ? 9 : 3;
    const byteCount = data[offset - 1];
    const values: number[] = [];
    
    for (let i = 0; i < expectedRegisters; i++) {
      const value = data.readUInt16BE(offset + i * 2);
      values.push(value);
    }
    
    return values;
  }

  private parseValue(registers: number[], dataType: string): number {
    if (registers.length === 0) return 0;
    
    switch (dataType) {
      case "int16":
        return registers[0] > 32767 ? registers[0] - 65536 : registers[0];
      case "uint16":
        return registers[0];
      case "int32":
        const int32 = (registers[0] << 16) | registers[1];
        return int32 > 2147483647 ? int32 - 4294967296 : int32;
      case "uint32":
        return (registers[0] << 16) | registers[1];
      case "float32":
        const buffer = Buffer.alloc(4);
        buffer.writeUInt16BE(registers[0], 0);
        buffer.writeUInt16BE(registers[1], 2);
        return buffer.readFloatBE(0);
      case "float64":
        const buffer64 = Buffer.alloc(8);
        for (let i = 0; i < 4 && i < registers.length; i++) {
          buffer64.writeUInt16BE(registers[i], i * 2);
        }
        return buffer64.readDoubleBE(0);
      default:
        return registers[0];
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.emit("disconnected");
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Standard weather station register mappings
export const WEATHER_STATION_REGISTERS: ModbusRegister[] = [
  { address: 0, length: 1, type: "input", dataType: "int16", scale: 0.1, name: "temperature", unit: "°C" },
  { address: 1, length: 1, type: "input", dataType: "uint16", scale: 0.1, name: "humidity", unit: "%" },
  { address: 2, length: 1, type: "input", dataType: "uint16", scale: 0.1, name: "pressure", unit: "hPa" },
  { address: 3, length: 1, type: "input", dataType: "uint16", scale: 0.1, name: "windSpeed", unit: "m/s" },
  { address: 4, length: 1, type: "input", dataType: "uint16", scale: 1, name: "windDirection", unit: "°" },
  { address: 5, length: 1, type: "input", dataType: "uint16", scale: 0.1, name: "rainfall", unit: "mm" },
  { address: 6, length: 1, type: "input", dataType: "uint16", scale: 1, name: "solarRadiation", unit: "W/m²" },
];
