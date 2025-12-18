/**
 * DNP3 (Distributed Network Protocol 3) Implementation
 * Used for SCADA systems and utility communications
 */

import { EventEmitter } from "events";

export interface DNP3Config {
  mode: "tcp" | "serial";
  masterAddress: number;
  outstationAddress: number;
  // TCP settings
  host?: string;
  port?: number;
  // Serial settings
  serialPort?: string;
  baudRate?: number;
  timeout?: number;
}

export interface DNP3Point {
  group: number;
  variation: number;
  index: number;
  name: string;
  unit?: string;
  scale?: number;
}

// DNP3 Data Link Layer constants
const DL_START = 0x0564;
const DL_FUNC_PRI_UNCONFIRMED = 0x44;
const DL_FUNC_PRI_CONFIRMED = 0x53;
const DL_FUNC_SEC_ACK = 0x00;

// DNP3 Application Layer function codes
const APP_FUNC = {
  CONFIRM: 0x00,
  READ: 0x01,
  WRITE: 0x02,
  DIRECT_OPERATE: 0x03,
  COLD_RESTART: 0x0d,
  WARM_RESTART: 0x0e,
  RESPONSE: 0x81,
  UNSOLICITED_RESPONSE: 0x82,
};

// DNP3 Object Groups relevant to weather monitoring
const OBJECT_GROUPS = {
  BINARY_INPUT: 1,
  BINARY_OUTPUT: 10,
  COUNTER: 20,
  ANALOG_INPUT: 30,
  ANALOG_OUTPUT: 40,
  TIME: 50,
};

export class DNP3Protocol extends EventEmitter {
  private config: DNP3Config;
  private connected: boolean = false;
  private socket: any = null;
  private sequenceNumber: number = 0;

  constructor(config: DNP3Config) {
    super();
    this.config = {
      timeout: 5000,
      port: 20000,
      baudRate: 9600,
      ...config,
    };
  }

  async connect(): Promise<boolean> {
    try {
      if (this.config.mode === "tcp") {
        return await this.connectTCP();
      } else {
        return await this.connectSerial();
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

      this.socket.connect(this.config.port || 20000, this.config.host, () => {
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

  private async connectSerial(): Promise<boolean> {
    this.emit("serial-connect-request", this.config);
    return true;
  }

  async readAnalogInputs(startIndex: number, count: number): Promise<number[]> {
    const request = this.buildReadRequest(OBJECT_GROUPS.ANALOG_INPUT, 0, startIndex, count);
    return this.sendRequest(request);
  }

  async readClass0Data(): Promise<Record<string, number>> {
    // Class 0 - static data (current values)
    const request = this.buildClassRequest(0);
    const response = await this.sendRequestRaw(request);
    return this.parseClassResponse(response);
  }

  async readClass123Data(): Promise<Record<string, any>> {
    // Class 1, 2, 3 - event data
    const results: Record<string, any> = {};
    
    for (const classNum of [1, 2, 3]) {
      const request = this.buildClassRequest(classNum);
      try {
        const response = await this.sendRequestRaw(request);
        results[`class${classNum}`] = this.parseClassResponse(response);
      } catch (error) {
        results[`class${classNum}`] = null;
      }
    }
    
    return results;
  }

  async readWeatherPoints(points: DNP3Point[]): Promise<Record<string, number | null>> {
    const result: Record<string, number | null> = {};
    
    for (const point of points) {
      try {
        const request = this.buildReadRequest(point.group, point.variation, point.index, 1);
        const values = await this.sendRequest(request);
        if (values.length > 0) {
          result[point.name] = values[0] * (point.scale || 1);
        } else {
          result[point.name] = null;
        }
      } catch (error) {
        result[point.name] = null;
      }
    }
    
    return result;
  }

  private buildReadRequest(group: number, variation: number, startIndex: number, count: number): Buffer {
    const appLayer = this.buildApplicationLayer(APP_FUNC.READ, group, variation, startIndex, count);
    const transportLayer = this.buildTransportLayer(appLayer);
    return this.buildDataLinkLayer(transportLayer);
  }

  private buildClassRequest(classNum: number): Buffer {
    // Class objects: 60.1 = class 0, 60.2 = class 1, 60.3 = class 2, 60.4 = class 3
    const group = 60;
    const variation = classNum + 1;
    const appLayer = this.buildApplicationLayerSimple(APP_FUNC.READ, group, variation);
    const transportLayer = this.buildTransportLayer(appLayer);
    return this.buildDataLinkLayer(transportLayer);
  }

  private buildApplicationLayer(
    funcCode: number,
    group: number,
    variation: number,
    startIndex: number,
    count: number
  ): Buffer {
    const buffer = Buffer.alloc(10);
    
    buffer.writeUInt8(0xc0 | (this.sequenceNumber & 0x0f), 0); // Control (FIR, FIN, SEQ)
    buffer.writeUInt8(funcCode, 1);                            // Function code
    buffer.writeUInt8(group, 2);                               // Object group
    buffer.writeUInt8(variation, 3);                           // Object variation
    buffer.writeUInt8(0x00, 4);                                // Qualifier (start-stop)
    buffer.writeUInt8(startIndex, 5);                          // Start index
    buffer.writeUInt8(startIndex + count - 1, 6);              // Stop index
    
    this.sequenceNumber = (this.sequenceNumber + 1) & 0x0f;
    
    return buffer.slice(0, 7);
  }

  private buildApplicationLayerSimple(funcCode: number, group: number, variation: number): Buffer {
    const buffer = Buffer.alloc(5);
    
    buffer.writeUInt8(0xc0 | (this.sequenceNumber & 0x0f), 0);
    buffer.writeUInt8(funcCode, 1);
    buffer.writeUInt8(group, 2);
    buffer.writeUInt8(variation, 3);
    buffer.writeUInt8(0x06, 4); // Qualifier: all objects
    
    this.sequenceNumber = (this.sequenceNumber + 1) & 0x0f;
    
    return buffer;
  }

  private buildTransportLayer(appData: Buffer): Buffer {
    // Single segment transport header (FIR=1, FIN=1)
    const buffer = Buffer.alloc(appData.length + 1);
    buffer.writeUInt8(0xc0, 0); // Transport header
    appData.copy(buffer, 1);
    return buffer;
  }

  private buildDataLinkLayer(transportData: Buffer): Buffer {
    const dataLength = transportData.length;
    const headerLength = 10;
    const buffer = Buffer.alloc(headerLength + dataLength + 2); // +2 for CRC
    
    // Start bytes
    buffer.writeUInt16LE(DL_START, 0);
    
    // Length
    buffer.writeUInt8(dataLength + 5, 2);
    
    // Control
    buffer.writeUInt8(DL_FUNC_PRI_UNCONFIRMED, 3);
    
    // Destination address
    buffer.writeUInt16LE(this.config.outstationAddress, 4);
    
    // Source address
    buffer.writeUInt16LE(this.config.masterAddress, 6);
    
    // Header CRC
    const headerCRC = this.calculateCRC(buffer.slice(0, 8));
    buffer.writeUInt16LE(headerCRC, 8);
    
    // User data
    transportData.copy(buffer, 10);
    
    // Data CRC
    const dataCRC = this.calculateCRC(transportData);
    buffer.writeUInt16LE(dataCRC, 10 + dataLength);
    
    return buffer;
  }

  private calculateCRC(data: Buffer): number {
    const CRC_TABLE = this.getCRCTable();
    let crc = 0;
    
    for (let i = 0; i < data.length; i++) {
      const index = (crc ^ data[i]) & 0xff;
      crc = (crc >> 8) ^ CRC_TABLE[index];
    }
    
    return (~crc) & 0xffff;
  }

  private getCRCTable(): number[] {
    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) {
        if (crc & 1) {
          crc = (crc >> 1) ^ 0xa6bc;
        } else {
          crc >>= 1;
        }
      }
      table.push(crc);
    }
    return table;
  }

  private async sendRequest(frame: Buffer): Promise<number[]> {
    const response = await this.sendRequestRaw(frame);
    return this.parseAnalogResponse(response);
  }

  private async sendRequestRaw(frame: Buffer): Promise<Buffer> {
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
        resolve(data);
      };

      this.once("response", responseHandler);
      this.socket.write(frame);
    });
  }

  private handleResponse(data: Buffer): void {
    this.emit("response", data);
  }

  private parseAnalogResponse(data: Buffer): number[] {
    const values: number[] = [];
    
    // Skip data link and transport headers
    let offset = 12; // Approximate header size
    
    while (offset + 4 <= data.length) {
      try {
        const value = data.readFloatLE(offset);
        if (!isNaN(value) && isFinite(value)) {
          values.push(value);
        }
        offset += 4;
      } catch {
        break;
      }
    }
    
    return values;
  }

  private parseClassResponse(data: Buffer): Record<string, number> {
    const result: Record<string, number> = {};
    // Simplified parsing - would need full DNP3 object parsing in production
    return result;
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

// Standard weather point mappings for DNP3
export const WEATHER_DNP3_POINTS: DNP3Point[] = [
  { group: 30, variation: 5, index: 0, name: "temperature", unit: "°C", scale: 0.01 },
  { group: 30, variation: 5, index: 1, name: "humidity", unit: "%", scale: 0.01 },
  { group: 30, variation: 5, index: 2, name: "pressure", unit: "hPa", scale: 0.1 },
  { group: 30, variation: 5, index: 3, name: "windSpeed", unit: "m/s", scale: 0.01 },
  { group: 30, variation: 5, index: 4, name: "windDirection", unit: "°", scale: 1 },
  { group: 30, variation: 5, index: 5, name: "rainfall", unit: "mm", scale: 0.1 },
  { group: 30, variation: 5, index: 6, name: "solarRadiation", unit: "W/m²", scale: 1 },
];
