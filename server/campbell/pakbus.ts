import { EventEmitter } from 'events';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const crcLib = require('crc');
const crc16ccitt = crcLib.crc16ccitt as (data: Buffer) => number;

/**
 * PakBus Protocol Implementation for Campbell Scientific Dataloggers
 * Supports PakBus protocol versions 3.x and 4.x
 */

export interface PakBusConfig {
  address: number;
  securityCode?: number;
  maxPacketSize?: number;
  timeout?: number;
}

export interface PakBusMessage {
  signature: number;
  sourceAddress: number;
  destAddress: number;
  expectMore: number;
  priority: number;
  messageType: number;
  transactionNumber: number;
  payload: Buffer;
}

export interface DataTableDefinition {
  tableName: string;
  fieldNames: string[];
  fieldTypes: string[];
  fieldUnits: string[];
  fieldProcessing: string[];
}

export class PakBusProtocol extends EventEmitter {
  private config: Required<PakBusConfig>;
  private transactionNumber: number = 0;
  private pendingTransactions: Map<number, (response: PakBusMessage) => void> = new Map();

  constructor(config: PakBusConfig) {
    super();
    this.config = {
      address: config.address,
      securityCode: config.securityCode || 0,
      maxPacketSize: config.maxPacketSize || 1024,
      timeout: config.timeout || 30000,
    };
  }

  /**
   * Create a PakBus frame with proper framing and CRC
   */
  createFrame(message: Partial<PakBusMessage>): Buffer {
    const signature = message.signature || 0xBD;
    const sourceAddress = this.config.address;
    const destAddress = message.destAddress || 1;
    const expectMore = message.expectMore || 0;
    const priority = message.priority || 1;
    const messageType = message.messageType || 0;
    const transactionNumber = message.transactionNumber || this.getNextTransactionNumber();
    const payload = message.payload || Buffer.alloc(0);

    // Build header
    const header = Buffer.alloc(8);
    header.writeUInt8(signature, 0);
    header.writeUInt16BE(sourceAddress, 1);
    header.writeUInt16BE(destAddress, 3);
    header.writeUInt8((expectMore << 2) | priority, 5);
    header.writeUInt8(messageType, 6);
    header.writeUInt8(transactionNumber, 7);

    // Combine header and payload
    const message_data = Buffer.concat([header, payload]);

    // Calculate signature nullifier and CRC
    const nullifier = this.calculateNullifier(signature, message_data.slice(1));
    const crc = crc16ccitt(message_data);

    // Build complete frame
    const frame = Buffer.alloc(message_data.length + 3);
    frame.writeUInt8(signature, 0);
    frame.writeUInt8(nullifier, 1);
    message_data.copy(frame, 2, 1);
    frame.writeUInt16BE(crc, frame.length - 2);

    return frame;
  }

  /**
   * Parse a received PakBus frame
   */
  parseFrame(data: Buffer): PakBusMessage | null {
    if (data.length < 10) {
      return null;
    }

    try {
      const signature = data.readUInt8(0);
      const nullifier = data.readUInt8(1);

      // Verify signature
      const calculatedNullifier = this.calculateNullifier(signature, data.slice(2, -2));
      if (nullifier !== calculatedNullifier) {
        throw new Error('Invalid signature nullifier');
      }

      // Verify CRC
      const receivedCrc = data.readUInt16BE(data.length - 2);
      const calculatedCrc = crc16ccitt(Buffer.concat([Buffer.from([signature]), data.slice(2, -2)]));
      if (receivedCrc !== calculatedCrc) {
        throw new Error('CRC mismatch');
      }

      // Parse message
      const sourceAddress = data.readUInt16BE(2);
      const destAddress = data.readUInt16BE(4);
      const expectMorePriority = data.readUInt8(6);
      const expectMore = (expectMorePriority >> 2) & 0x03;
      const priority = expectMorePriority & 0x03;
      const messageType = data.readUInt8(7);
      const transactionNumber = data.readUInt8(8);
      const payload = data.slice(9, -2);

      return {
        signature,
        sourceAddress,
        destAddress,
        expectMore,
        priority,
        messageType,
        transactionNumber,
        payload,
      };
    } catch (error) {
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Calculate signature nullifier for PakBus protocol
   */
  private calculateNullifier(signature: number, data: Buffer): number {
    let sum = signature;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    return (0x100 - (sum & 0xFF)) & 0xFF;
  }

  /**
   * Get next transaction number (0-255)
   */
  private getNextTransactionNumber(): number {
    this.transactionNumber = (this.transactionNumber + 1) & 0xFF;
    return this.transactionNumber;
  }

  /**
   * Send Hello command to establish communication
   */
  createHelloCommand(): Buffer {
    const payload = Buffer.alloc(4);
    payload.writeUInt8(0x09, 0); // Hello message type
    payload.writeUInt8(0x01, 1); // Is router
    payload.writeUInt16BE(this.config.address, 2); // Our address

    return this.createFrame({
      messageType: 0x09,
      payload,
    });
  }

  /**
   * Create GetProgStat command (get program statistics)
   */
  createGetProgStatCommand(securityCode?: number): Buffer {
    const code = securityCode !== undefined ? securityCode : this.config.securityCode;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);

    return this.createFrame({
      messageType: 0x17,
      payload,
    });
  }

  /**
   * Create Clock command to read/set datalogger time
   */
  createClockCommand(setTime?: Date): Buffer {
    let payload: Buffer;

    if (setTime) {
      // Set clock command
      payload = Buffer.alloc(9);
      payload.writeUInt8(0x01, 0); // Set clock flag
      const timestamp = Math.floor(setTime.getTime() / 1000);
      payload.writeUInt32BE(timestamp, 1);
      payload.writeInt32BE(0, 5); // Nanoseconds offset
    } else {
      // Get clock command
      payload = Buffer.alloc(1);
      payload.writeUInt8(0x00, 0);
    }

    return this.createFrame({
      messageType: 0x17,
      payload: Buffer.concat([Buffer.from([0x07]), payload]),
    });
  }

  /**
   * Create TableDef command to get table definitions
   */
  createTableDefCommand(tableName?: string): Buffer {
    let payload: Buffer;

    if (tableName) {
      const nameBuffer = Buffer.from(tableName, 'ascii');
      payload = Buffer.alloc(nameBuffer.length + 1);
      nameBuffer.copy(payload, 0);
      payload.writeUInt8(0, nameBuffer.length);
    } else {
      payload = Buffer.alloc(0);
    }

    return this.createFrame({
      messageType: 0x17,
      payload: Buffer.concat([Buffer.from([0x03]), payload]),
    });
  }

  /**
   * Create CollectData command to retrieve data records
   */
  createCollectDataCommand(
    tableName: string,
    mode: number = 0x07,
    p1?: number,
    p2?: number
  ): Buffer {
    const nameBuffer = Buffer.from(tableName, 'ascii');
    const payload = Buffer.alloc(nameBuffer.length + 10);

    let offset = 0;
    nameBuffer.copy(payload, offset);
    offset += nameBuffer.length;
    payload.writeUInt8(0, offset++); // Null terminator

    payload.writeUInt8(mode, offset++); // Collection mode
    payload.writeUInt32BE(p1 || 0, offset); // P1 parameter
    offset += 4;
    payload.writeUInt32BE(p2 || 0, offset); // P2 parameter

    return this.createFrame({
      messageType: 0x17,
      payload: Buffer.concat([Buffer.from([0x04]), payload]),
    });
  }

  /**
   * Parse GetProgStat response
   */
  parseProgStatResponse(payload: Buffer): any {
    if (payload.length < 20) {
      return null;
    }

    return {
      osVersion: payload.toString('ascii', 0, 8).replace(/\0/g, ''),
      osSignature: payload.readUInt16BE(8),
      serialNumber: payload.toString('ascii', 10, 18).replace(/\0/g, ''),
      powerUpProgramName: payload.toString('ascii', 18, 26).replace(/\0/g, ''),
      programSignature: payload.readUInt16BE(26),
      compilationResults: payload.toString('ascii', 28).replace(/\0/g, ''),
    };
  }

  /**
   * Parse table definition response
   */
  parseTableDefResponse(payload: Buffer): DataTableDefinition | null {
    try {
      let offset = 0;

      // Read table name
      const tableNameEnd = payload.indexOf(0, offset);
      const tableName = payload.toString('ascii', offset, tableNameEnd);
      offset = tableNameEnd + 1;

      // Read field count
      const fieldCount = payload.readUInt16BE(offset);
      offset += 2;

      const fieldNames: string[] = [];
      const fieldTypes: string[] = [];
      const fieldUnits: string[] = [];
      const fieldProcessing: string[] = [];

      // Parse each field
      for (let i = 0; i < fieldCount; i++) {
        // Field name
        const nameEnd = payload.indexOf(0, offset);
        fieldNames.push(payload.toString('ascii', offset, nameEnd));
        offset = nameEnd + 1;

        // Field type
        const typeEnd = payload.indexOf(0, offset);
        fieldTypes.push(payload.toString('ascii', offset, typeEnd));
        offset = typeEnd + 1;

        // Field units
        const unitsEnd = payload.indexOf(0, offset);
        fieldUnits.push(payload.toString('ascii', offset, unitsEnd));
        offset = unitsEnd + 1;

        // Field processing
        const procEnd = payload.indexOf(0, offset);
        fieldProcessing.push(payload.toString('ascii', offset, procEnd));
        offset = procEnd + 1;
      }

      return {
        tableName,
        fieldNames,
        fieldTypes,
        fieldUnits,
        fieldProcessing,
      };
    } catch (error) {
      this.emit('error', error);
      return null;
    }
  }

  /**
   * Parse collected data records
   */
  parseCollectDataResponse(payload: Buffer, tableDef: DataTableDefinition): any[] {
    const records: any[] = [];

    try {
      let offset = 0;

      // Skip table name
      const tableNameEnd = payload.indexOf(0, offset);
      offset = tableNameEnd + 1;

      // Read record count
      const recordCount = payload.readUInt32BE(offset);
      offset += 4;

      // Parse each record
      for (let i = 0; i < recordCount; i++) {
        const record: any = {};

        // Timestamp (seconds since 1990-01-01)
        const timestamp = payload.readUInt32BE(offset);
        offset += 4;
        const nanoseconds = payload.readUInt32BE(offset);
        offset += 4;

        const baseDate = new Date('1990-01-01T00:00:00Z');
        record.timestamp = new Date(baseDate.getTime() + timestamp * 1000 + nanoseconds / 1000000);

        // Parse field values based on type
        for (let j = 0; j < tableDef.fieldNames.length; j++) {
          const fieldName = tableDef.fieldNames[j];
          const fieldType = tableDef.fieldTypes[j];

          switch (fieldType.toLowerCase()) {
            case 'fp2':
            case 'ieee4':
              record[fieldName] = payload.readFloatBE(offset);
              offset += 4;
              break;
            case 'ieee8':
              record[fieldName] = payload.readDoubleBE(offset);
              offset += 8;
              break;
            case 'uint2':
              record[fieldName] = payload.readUInt16BE(offset);
              offset += 2;
              break;
            case 'uint4':
              record[fieldName] = payload.readUInt32BE(offset);
              offset += 4;
              break;
            case 'long':
              record[fieldName] = payload.readInt32BE(offset);
              offset += 4;
              break;
            case 'bool':
              record[fieldName] = payload.readUInt8(offset) !== 0;
              offset += 1;
              break;
            case 'ascii':
              const strEnd = payload.indexOf(0, offset);
              record[fieldName] = payload.toString('ascii', offset, strEnd);
              offset = strEnd + 1;
              break;
            default:
              // Skip unknown types
              offset += 4;
          }
        }

        records.push(record);
      }
    } catch (error) {
      this.emit('error', error);
    }

    return records;
  }
}
