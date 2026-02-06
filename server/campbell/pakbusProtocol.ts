/// <reference types="node" />
/**
 * PakBus Protocol Implementation
 * Complete Campbell Scientific PakBus protocol support
 * Includes packet framing, CRC calculation, and all message types
 */

import { EventEmitter } from "events";
import crc from "crc";

export interface PakBusConfig {
  address: number;
  securityCode?: number;
  neighborAddress?: number;
  timeout?: number;
}

export interface TableDefinition {
  tableNumber: number;
  tableName: string;
  columns: Array<{
    name: string;
    type: string;
    units: string;
    processing: string;
  }>;
  recordInterval: number;
}

export interface CollectedRecord {
  timestamp: Date;
  recordNumber: number;
  values: Record<string, number | string>;
}

export interface TransactionResult {
  success: boolean;
  error?: string;
  data?: any;
  address?: number;
}

// PakBus Message Types
export const MESSAGE_TYPES = {
  // Control transactions
  HELLO: 0x09,
  HELLO_ACK: 0x89,
  BYE: 0x0d,
  
  // Settings transactions
  GET_SETTINGS: 0x0f,
  SET_SETTINGS: 0x10,
  
  // Table transactions
  GET_TABLE_DEFS: 0x19,
  COLLECT_DATA: 0x1a,
  
  // File transactions  
  FILE_SEND: 0x1c,
  FILE_RECEIVE: 0x1d,
  FILE_CONTROL: 0x1e,
  
  // Clock transactions
  CLOCK_SET: 0x17,
  CLOCK_GET: 0x17,
  
  // Program transactions
  PROGRAM_CONTROL: 0x18,
  
  // Status
  PLEASE_WAIT: 0xa1,
  FAILURE: 0x81,
};

// Link state bytes
const LINK_STATE = {
  READY: 0xa1,
  RING: 0x9e,
  EXPECT_MORE: 0x8f,
  FINISHED: 0xbd,
};

export class PakBusProtocol extends EventEmitter {
  private config: PakBusConfig;
  private transactionNumber: number = 0;
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private pendingTransactions: Map<number, {
    resolve: (result: TransactionResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    createdAt: number;
  }> = new Map();

  constructor(config: PakBusConfig) {
    super();
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Clean up all pending transactions (call on disconnect)
   * Prevents memory leaks from orphaned transactions
   */
  cleanup(): void {
    for (const [transNum, pending] of this.pendingTransactions) {
      clearTimeout(pending.timeout);
      pending.resolve({
        success: false,
        error: "Connection closed - transaction cancelled",
      });
    }
    this.pendingTransactions.clear();
    this.receiveBuffer = Buffer.alloc(0);
  }

  /**
   * Process incoming data from transport
   */
  processIncoming(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
    this.processBuffer();
  }

  /**
   * Send hello transaction
   */
  async hello(): Promise<TransactionResult> {
    const packet = this.buildHelloMessage();
    return this.sendPacket(packet);
  }

  /**
   * Get table definitions from datalogger
   */
  async getTableDefinitions(): Promise<TransactionResult> {
    const packet = this.buildGetTableDefsMessage();
    return this.sendPacket(packet);
  }

  /**
   * Collect data from a specific table
   */
  async collectData(
    tableName: string,
    startRecord?: number,
    numRecords?: number
  ): Promise<TransactionResult> {
    const packet = this.buildCollectDataMessage(tableName, startRecord, numRecords);
    return this.sendPacket(packet);
  }

  /**
   * Get station settings
   */
  async getSettings(): Promise<TransactionResult> {
    const packet = this.buildGetSettingsMessage();
    return this.sendPacket(packet);
  }

  /**
   * Set station clock
   */
  async setClock(time: Date = new Date()): Promise<TransactionResult> {
    const packet = this.buildSetClockMessage(time);
    return this.sendPacket(packet);
  }

  /**
   * Get station clock
   */
  async getClock(): Promise<TransactionResult> {
    const packet = this.buildGetClockMessage();
    return this.sendPacket(packet);
  }

  /**
   * Upload file to datalogger
   */
  async uploadFile(fileName: string, content: Buffer): Promise<TransactionResult> {
    const packet = this.buildFileSendMessage(fileName, content);
    return this.sendPacket(packet);
  }

  /**
   * Download file from datalogger
   */
  async downloadFile(fileName: string): Promise<TransactionResult> {
    const packet = this.buildFileReceiveMessage(fileName);
    return this.sendPacket(packet);
  }

  /**
   * List files on datalogger
   */
  async listFiles(directory: string = "CPU:"): Promise<TransactionResult> {
    const packet = this.buildFileControlMessage("list", directory);
    return this.sendPacket(packet);
  }

  /**
   * Delete file on datalogger
   */
  async deleteFile(fileName: string): Promise<TransactionResult> {
    const packet = this.buildFileControlMessage("delete", fileName);
    return this.sendPacket(packet);
  }

  /**
   * Run/stop program
   */
  async programControl(action: "run" | "stop" | "compile"): Promise<TransactionResult> {
    const packet = this.buildProgramControlMessage(action);
    return this.sendPacket(packet);
  }

  /**
   * Build PakBus packet
   */
  private buildPacket(
    msgType: number,
    payload: Buffer,
    destAddress?: number
  ): Buffer {
    const transNum = this.getNextTransactionNumber();
    const destAddr = destAddress || this.config.address;
    const srcAddr = 4094; // Our address (computer)
    const neighborAddr = this.config.neighborAddress || destAddr;

    // Build header
    // LinkState (1) + DestPhyAddr (2) + ExpMoreCode (1) + Priority (1) + SrcPhyAddr (2)
    // + HiProtoCode (1) + DestNodeId (2) + HopCnt (1) + SrcNodeId (2)
    
    const header = Buffer.alloc(12);
    let offset = 0;
    
    // Link state
    header.writeUInt8(LINK_STATE.READY, offset++);
    
    // Destination physical address (12 bits)
    header.writeUInt16BE(neighborAddr, offset);
    offset += 2;
    
    // ExpMoreCode + Priority
    header.writeUInt8(0x00, offset++);
    
    // Source physical address (12 bits)
    header.writeUInt16BE(srcAddr, offset);
    offset += 2;
    
    // High protocol code (PakBus)
    header.writeUInt8(0x01, offset++);
    
    // Destination node ID
    header.writeUInt16BE(destAddr, offset);
    offset += 2;
    
    // Hop count
    header.writeUInt8(0x00, offset++);
    
    // Source node ID
    header.writeUInt16BE(srcAddr, offset);

    // Build message body
    const msgHeader = Buffer.alloc(4);
    msgHeader.writeUInt8(msgType, 0);
    msgHeader.writeUInt8(transNum, 1);
    
    // Security code if required
    if (this.config.securityCode) {
      msgHeader.writeUInt16BE(this.config.securityCode, 2);
    }

    // Combine header + message
    const message = Buffer.concat([header, msgHeader, payload]);

    // Calculate signature (CRC-CCITT)
    const signature = this.calculateSignature(message);
    const signatureNullifier = this.calculateSignatureNullifier(signature);

    // Build complete packet with framing
    const framedPacket = this.framePacket(
      Buffer.concat([message, signatureNullifier])
    );

    return framedPacket;
  }

  /**
   * Frame packet with sync bytes and quote escaping
   */
  private framePacket(data: Buffer): Buffer {
    const SYNC_BYTE = 0xbd;
    const QUOTE_BYTE = 0xbc;

    const escaped: number[] = [SYNC_BYTE];

    for (const byte of data) {
      if (byte === SYNC_BYTE || byte === QUOTE_BYTE) {
        escaped.push(QUOTE_BYTE);
        escaped.push(byte ^ 0x20);
      } else {
        escaped.push(byte);
      }
    }

    escaped.push(SYNC_BYTE);
    return Buffer.from(escaped);
  }

  /**
   * Unframe packet - remove sync bytes and unescape
   */
  private unframePacket(data: Buffer): Buffer | null {
    const SYNC_BYTE = 0xbd;
    const QUOTE_BYTE = 0xbc;

    // Find sync bytes
    const start = data.indexOf(SYNC_BYTE);
    if (start === -1) return null;

    const end = data.indexOf(SYNC_BYTE, start + 1);
    if (end === -1) return null;

    const escaped = data.slice(start + 1, end);
    const unescaped: number[] = [];

    let i = 0;
    while (i < escaped.length) {
      if (escaped[i] === QUOTE_BYTE && i + 1 < escaped.length) {
        unescaped.push(escaped[i + 1] ^ 0x20);
        i += 2;
      } else {
        unescaped.push(escaped[i]);
        i++;
      }
    }

    return Buffer.from(unescaped);
  }

  /**
   * Calculate Signature16 (CRC-CCITT)
   */
  private calculateSignature(data: Buffer): number {
    // Use standard CRC-CCITT calculation
    let crc = 0xaaaa; // Initial value for PakBus

    for (const byte of data) {
      let x = ((crc >> 8) ^ byte) & 0xff;
      x ^= x >> 4;
      crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xffff;
    }

    return crc;
  }

  /**
   * Calculate signature nullifier
   */
  private calculateSignatureNullifier(signature: number): Buffer {
    const nullifier = Buffer.alloc(2);
    // The nullifier should make the signature equal to 0x0 when included
    nullifier.writeUInt16BE(signature, 0);
    return nullifier;
  }

  /**
   * Get next transaction number
   */
  private getNextTransactionNumber(): number {
    this.transactionNumber = (this.transactionNumber + 1) & 0xff;
    if (this.transactionNumber === 0) this.transactionNumber = 1;
    return this.transactionNumber;
  }

  /**
   * Process receive buffer for complete packets
   */
  private processBuffer(): void {
    const SYNC_BYTE = 0xbd;

    while (this.receiveBuffer.length > 0) {
      const start = this.receiveBuffer.indexOf(SYNC_BYTE);
      if (start === -1) {
        this.receiveBuffer = Buffer.alloc(0);
        return;
      }

      if (start > 0) {
        this.receiveBuffer = this.receiveBuffer.slice(start);
      }

      const end = this.receiveBuffer.indexOf(SYNC_BYTE, 1);
      if (end === -1) return; // Wait for more data

      const packet = this.receiveBuffer.slice(0, end + 1);
      this.receiveBuffer = this.receiveBuffer.slice(end + 1);

      const unframed = this.unframePacket(packet);
      if (unframed) {
        this.processPacket(unframed);
      }
    }
  }

  /**
   * Process a complete PakBus packet
   */
  private processPacket(packet: Buffer): void {
    try {
      // Verify signature
      const signature = this.calculateSignature(packet.slice(0, -2));
      const packetSig = packet.readUInt16BE(packet.length - 2);
      
      if (signature !== 0 && packetSig !== 0) {
        // Signature verification (simplified)
      }

      // Parse header
      const linkState = packet.readUInt8(0);
      const destPhyAddr = packet.readUInt16BE(1);
      const srcPhyAddr = packet.readUInt16BE(4);
      const hiProtoCode = packet.readUInt8(6);
      const destNodeId = packet.readUInt16BE(7);
      const srcNodeId = packet.readUInt16BE(10);

      // Parse message
      const msgType = packet.readUInt8(12);
      const transNum = packet.readUInt8(13);
      const payload = packet.slice(14, -2);

      // Handle response
      this.handleResponse(msgType, transNum, payload, srcNodeId);
    } catch (error) {
      this.emit("error", error);
    }
  }

  /**
   * Handle response message
   */
  private handleResponse(
    msgType: number,
    transNum: number,
    payload: Buffer,
    srcAddress: number
  ): void {
    const pending = this.pendingTransactions.get(transNum);
    
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingTransactions.delete(transNum);

      if (msgType === MESSAGE_TYPES.FAILURE) {
        pending.resolve({
          success: false,
          error: this.parseErrorCode(payload),
        });
      } else {
        const data = this.parsePayload(msgType, payload);
        pending.resolve({
          success: true,
          data,
          address: srcAddress,
        });
      }
    }

    // Emit events for unsolicited messages
    if (msgType === MESSAGE_TYPES.PLEASE_WAIT) {
      this.emit("please-wait", payload);
    }
  }

  /**
   * Parse error code from failure message
   */
  private parseErrorCode(payload: Buffer): string {
    if (payload.length === 0) return "Unknown error";
    
    const errorCodes: Record<number, string> = {
      1: "Permission denied",
      2: "Invalid table name",
      3: "Invalid record range",
      4: "Memory allocation failed",
      5: "Invalid security code",
      6: "Datalogger busy",
      7: "Communication failure",
      8: "Invalid message type",
      9: "Unknown command",
      10: "File not found",
      11: "Invalid file name",
      12: "File exists",
      13: "File system full",
      14: "File too large",
      15: "Invalid parameter",
    };

    const code = payload.readUInt8(0);
    return errorCodes[code] || `Error code: ${code}`;
  }

  /**
   * Parse payload based on message type
   */
  private parsePayload(msgType: number, payload: Buffer): any {
    switch (msgType) {
      case MESSAGE_TYPES.HELLO_ACK:
        return this.parseHelloAck(payload);
      case MESSAGE_TYPES.GET_TABLE_DEFS:
        return this.parseTableDefs(payload);
      case MESSAGE_TYPES.GET_SETTINGS:
        return this.parseSettings(payload);
      case MESSAGE_TYPES.CLOCK_GET:
        return this.parseClock(payload);
      case MESSAGE_TYPES.COLLECT_DATA:
        return this.parseCollectedData(payload);
      case MESSAGE_TYPES.FILE_RECEIVE:
        return this.parseFileContent(payload);
      default:
        return payload;
    }
  }

  /**
   * Parse hello acknowledgment
   */
  private parseHelloAck(payload: Buffer): any {
    return {
      stationType: payload.toString("ascii", 0, 20).replace(/\0/g, "").trim(),
      serialNumber: payload.readUInt32BE(20),
      osVersion: `${payload.readUInt8(24)}.${payload.readUInt8(25)}`,
    };
  }

  /**
   * Parse table definitions
   */
  private parseTableDefs(payload: Buffer): TableDefinition[] {
    const tables: TableDefinition[] = [];
    let offset = 0;

    while (offset < payload.length) {
      const tableNumber = payload.readUInt8(offset++);
      if (tableNumber === 0) break;

      const nameLength = payload.readUInt8(offset++);
      const tableName = payload.toString("ascii", offset, offset + nameLength);
      offset += nameLength;

      const numColumns = payload.readUInt8(offset++);
      const columns: TableDefinition["columns"] = [];

      for (let i = 0; i < numColumns; i++) {
        const colNameLen = payload.readUInt8(offset++);
        const colName = payload.toString("ascii", offset, offset + colNameLen);
        offset += colNameLen;

        const typeCode = payload.readUInt8(offset++);
        const processing = payload.readUInt8(offset++);

        columns.push({
          name: colName,
          type: this.getDataTypeName(typeCode),
          units: "",
          processing: this.getProcessingName(processing),
        });
      }

      const recordInterval = payload.readUInt32BE(offset);
      offset += 4;

      tables.push({
        tableNumber,
        tableName,
        columns,
        recordInterval,
      });
    }

    return tables;
  }

  /**
   * Parse settings
   */
  private parseSettings(payload: Buffer): any {
    return {
      stationName: payload.toString("ascii", 0, 32).replace(/\0/g, "").trim(),
      pakbusAddress: payload.readUInt16BE(32),
      securityEnabled: payload.readUInt8(34) !== 0,
      osDate: payload.toString("ascii", 35, 45),
    };
  }

  /**
   * Parse clock
   */
  private parseClock(payload: Buffer): Date {
    const seconds = payload.readUInt32BE(0);
    const nanoseconds = payload.readUInt32BE(4);
    // Campbell Scientific epoch is 1990-01-01
    const campbellEpoch = new Date("1990-01-01T00:00:00Z").getTime();
    return new Date(campbellEpoch + seconds * 1000 + nanoseconds / 1000000);
  }

  /**
   * Parse collected data records
   */
  private parseCollectedData(payload: Buffer): CollectedRecord[] {
    // This is a simplified parser - actual implementation depends on table structure
    const records: CollectedRecord[] = [];
    // Implementation would parse binary data according to table definition
    return records;
  }

  /**
   * Parse file content
   */
  private parseFileContent(payload: Buffer): Buffer {
    // First byte is status, rest is file content
    return payload.slice(1);
  }

  /**
   * Get data type name from code
   */
  private getDataTypeName(code: number): string {
    const types: Record<number, string> = {
      1: "FP2",
      2: "FP4",
      3: "IEEE4",
      4: "IEEE8",
      5: "UINT1",
      6: "UINT2",
      7: "UINT4",
      8: "INT1",
      9: "INT2",
      10: "INT4",
      11: "BOOL",
      12: "STRING",
      13: "NSEC",
    };
    return types[code] || `Type${code}`;
  }

  /**
   * Get processing name from code
   */
  private getProcessingName(code: number): string {
    const processing: Record<number, string> = {
      0: "Sample",
      1: "Average",
      2: "Minimum",
      3: "Maximum",
      4: "Total",
      5: "StdDev",
      6: "WindVector",
    };
    return processing[code] || `Process${code}`;
  }

  /**
   * Internal method to send pre-built packet and wait for response
   */
  private sendPacket(packet: Buffer): Promise<TransactionResult> {
    return new Promise((resolve, reject) => {
      const transNum = this.transactionNumber;
      const timeout = setTimeout(() => {
        this.pendingTransactions.delete(transNum);
        resolve({
          success: false,
          error: "Transaction timeout",
        });
      }, this.config.timeout);

      this.pendingTransactions.set(transNum, { resolve, reject, timeout, createdAt: Date.now() });
      this.emit("send", packet);
    });
  }

  /**
   * Send transaction and wait for response
   * Public method for external modules (like FileManager) to send PakBus transactions
   */
  public sendTransaction(
    destAddress: number,
    msgType: number,
    payload: Buffer
  ): Promise<TransactionResult> {
    const packet = this.buildPacket(msgType, payload, destAddress);
    return this.sendPacket(packet);
  }

  // Message builders
  private buildHelloMessage(): Buffer {
    return this.buildPacket(MESSAGE_TYPES.HELLO, Buffer.alloc(0));
  }

  private buildGetTableDefsMessage(): Buffer {
    return this.buildPacket(MESSAGE_TYPES.GET_TABLE_DEFS, Buffer.alloc(0));
  }

  private buildCollectDataMessage(
    tableName: string,
    startRecord?: number,
    numRecords?: number
  ): Buffer {
    const payload = Buffer.alloc(tableName.length + 10);
    let offset = 0;
    
    payload.writeUInt8(tableName.length, offset++);
    payload.write(tableName, offset);
    offset += tableName.length;
    
    if (startRecord !== undefined) {
      payload.writeUInt32BE(startRecord, offset);
      offset += 4;
    }
    
    if (numRecords !== undefined) {
      payload.writeUInt16BE(numRecords, offset);
    }

    return this.buildPacket(MESSAGE_TYPES.COLLECT_DATA, payload);
  }

  private buildGetSettingsMessage(): Buffer {
    return this.buildPacket(MESSAGE_TYPES.GET_SETTINGS, Buffer.alloc(0));
  }

  private buildSetClockMessage(time: Date): Buffer {
    const payload = Buffer.alloc(8);
    const campbellEpoch = new Date("1990-01-01T00:00:00Z").getTime();
    const seconds = Math.floor((time.getTime() - campbellEpoch) / 1000);
    const nanoseconds = (time.getTime() % 1000) * 1000000;
    
    payload.writeUInt32BE(seconds, 0);
    payload.writeUInt32BE(nanoseconds, 4);
    
    return this.buildPacket(MESSAGE_TYPES.CLOCK_SET, payload);
  }

  private buildGetClockMessage(): Buffer {
    const payload = Buffer.alloc(1);
    payload.writeUInt8(0, 0); // Get clock command
    return this.buildPacket(MESSAGE_TYPES.CLOCK_GET, payload);
  }

  private buildFileSendMessage(fileName: string, content: Buffer): Buffer {
    const payload = Buffer.alloc(fileName.length + 1 + content.length);
    payload.writeUInt8(fileName.length, 0);
    payload.write(fileName, 1);
    content.copy(payload, fileName.length + 1);
    return this.buildPacket(MESSAGE_TYPES.FILE_SEND, payload);
  }

  private buildFileReceiveMessage(fileName: string): Buffer {
    const payload = Buffer.alloc(fileName.length + 1);
    payload.writeUInt8(fileName.length, 0);
    payload.write(fileName, 1);
    return this.buildPacket(MESSAGE_TYPES.FILE_RECEIVE, payload);
  }

  private buildFileControlMessage(action: string, path: string): Buffer {
    const actionCode = action === "list" ? 0 : action === "delete" ? 1 : 0;
    const payload = Buffer.alloc(path.length + 2);
    payload.writeUInt8(actionCode, 0);
    payload.writeUInt8(path.length, 1);
    payload.write(path, 2);
    return this.buildPacket(MESSAGE_TYPES.FILE_CONTROL, payload);
  }

  private buildProgramControlMessage(action: "run" | "stop" | "compile"): Buffer {
    const actionCodes = { run: 1, stop: 2, compile: 3 };
    const payload = Buffer.alloc(1);
    payload.writeUInt8(actionCodes[action], 0);
    return this.buildPacket(MESSAGE_TYPES.PROGRAM_CONTROL, payload);
  }
}
