/**
 * Serial Monitor Service
 * Provides real-time serial port monitoring for Campbell Scientific datalogger communication
 */

import { SerialPort } from "serialport";
import { WebSocket } from "ws";
import { EventEmitter } from "events";

export interface SerialMonitorConfig {
  port: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  stopBits?: 1 | 1.5 | 2;
  flowControl?: boolean;
}

export interface SerialMessage {
  timestamp: Date;
  direction: 'tx' | 'rx' | 'info' | 'error';
  data: string;
  hex?: string;
  raw?: Buffer;
}

class SerialMonitorService extends EventEmitter {
  private activePort: SerialPort | null = null;
  private connectedClients: Set<WebSocket> = new Set();
  private messageHistory: SerialMessage[] = [];
  private maxHistorySize = 1000;
  private isConnected = false;
  private currentConfig: SerialMonitorConfig | null = null;

  async listPorts(): Promise<Array<{ path: string; manufacturer?: string; serialNumber?: string; vendorId?: string; productId?: string }>> {
    try {
      const ports = await SerialPort.list();
      return ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        vendorId: p.vendorId,
        productId: p.productId
      }));
    } catch (error) {
      console.error("Failed to list serial ports:", error);
      return [];
    }
  }

  async connect(config: SerialMonitorConfig): Promise<{ success: boolean; message: string }> {
    // Close existing connection if any
    if (this.activePort && this.activePort.isOpen) {
      await this.disconnect();
    }

    return new Promise((resolve) => {
      try {
        this.activePort = new SerialPort({
          path: config.port,
          baudRate: config.baudRate,
          dataBits: config.dataBits || 8,
          parity: config.parity || 'none',
          stopBits: config.stopBits || 1,
          rtscts: config.flowControl || false,
          autoOpen: false
        });

        this.activePort.open((err) => {
          if (err) {
            this.addMessage({
              timestamp: new Date(),
              direction: 'error',
              data: `Failed to open port: ${err.message}`
            });
            resolve({ success: false, message: err.message });
            return;
          }

          this.isConnected = true;
          this.currentConfig = config;
          
          this.addMessage({
            timestamp: new Date(),
            direction: 'info',
            data: `Connected to ${config.port} at ${config.baudRate} baud`
          });

          // Set up data handler
          this.activePort!.on('data', (data: Buffer) => {
            this.handleIncomingData(data);
          });

          this.activePort!.on('error', (err) => {
            this.addMessage({
              timestamp: new Date(),
              direction: 'error',
              data: `Port error: ${err.message}`
            });
          });

          this.activePort!.on('close', () => {
            this.isConnected = false;
            this.addMessage({
              timestamp: new Date(),
              direction: 'info',
              data: 'Port closed'
            });
            this.broadcastToClients({ type: 'status', connected: false });
          });

          this.broadcastToClients({ type: 'status', connected: true, config });
          resolve({ success: true, message: `Connected to ${config.port}` });
        });
      } catch (error: any) {
        resolve({ success: false, message: error.message });
      }
    });
  }

  async disconnect(): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      if (!this.activePort) {
        resolve({ success: true, message: 'No active connection' });
        return;
      }

      if (!this.activePort.isOpen) {
        this.activePort = null;
        this.isConnected = false;
        resolve({ success: true, message: 'Port already closed' });
        return;
      }

      this.activePort.close((err) => {
        if (err) {
          resolve({ success: false, message: err.message });
          return;
        }
        
        this.activePort = null;
        this.isConnected = false;
        this.currentConfig = null;
        this.addMessage({
          timestamp: new Date(),
          direction: 'info',
          data: 'Disconnected'
        });
        resolve({ success: true, message: 'Disconnected' });
      });
    });
  }

  async send(data: string, format: 'ascii' | 'hex' = 'ascii'): Promise<{ success: boolean; message: string }> {
    if (!this.activePort || !this.activePort.isOpen) {
      return { success: false, message: 'Not connected' };
    }

    return new Promise((resolve) => {
      let buffer: Buffer;
      
      if (format === 'hex') {
        // Parse hex string (e.g., "BD 00 01 00 00")
        const hexBytes = data.replace(/\s+/g, '').match(/.{2}/g);
        if (!hexBytes) {
          resolve({ success: false, message: 'Invalid hex format' });
          return;
        }
        buffer = Buffer.from(hexBytes.map(h => parseInt(h, 16)));
      } else {
        buffer = Buffer.from(data);
      }

      this.activePort!.write(buffer, (err) => {
        if (err) {
          resolve({ success: false, message: err.message });
          return;
        }

        this.addMessage({
          timestamp: new Date(),
          direction: 'tx',
          data: format === 'hex' ? this.bufferToHexString(buffer) : data,
          hex: this.bufferToHexString(buffer),
          raw: buffer
        });

        resolve({ success: true, message: 'Data sent' });
      });
    });
  }

  private handleIncomingData(data: Buffer) {
    const message: SerialMessage = {
      timestamp: new Date(),
      direction: 'rx',
      data: this.formatData(data),
      hex: this.bufferToHexString(data),
      raw: data
    };

    this.addMessage(message);
  }

  private formatData(data: Buffer): string {
    // Try to display as ASCII if all characters are printable
    const ascii = data.toString('ascii');
    const isPrintable = data.every(byte => 
      (byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9
    );
    
    if (isPrintable) {
      return ascii.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    }
    
    // Otherwise show as hex
    return this.bufferToHexString(data);
  }

  private bufferToHexString(buffer: Buffer): string {
    return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  }

  private addMessage(message: SerialMessage) {
    this.messageHistory.push(message);
    
    // Trim history if needed
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }

    // Broadcast to all connected WebSocket clients
    this.broadcastToClients({ type: 'message', ...message });
    this.emit('message', message);
  }

  addClient(ws: WebSocket) {
    this.connectedClients.add(ws);
    
    // Send current status and history to new client
    ws.send(JSON.stringify({
      type: 'init',
      connected: this.isConnected,
      config: this.currentConfig,
      history: this.messageHistory.slice(-100) // Send last 100 messages
    }));

    ws.on('close', () => {
      this.connectedClients.delete(ws);
    });
  }

  private broadcastToClients(message: any) {
    const data = JSON.stringify(message);
    this.connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  getStatus(): { connected: boolean; config: SerialMonitorConfig | null; clientCount: number } {
    return {
      connected: this.isConnected,
      config: this.currentConfig,
      clientCount: this.connectedClients.size
    };
  }

  clearHistory() {
    this.messageHistory = [];
    this.broadcastToClients({ type: 'clear' });
  }
}

export const serialMonitorService = new SerialMonitorService();
