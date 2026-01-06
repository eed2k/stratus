/**
 * GSM/4G Cellular Protocol Adapter
 * Connects to cellular modems via TCP/IP for weather data transmission
 * 
 * CLOUD DEPLOYMENT NOTE:
 * This adapter is designed for Railway/cloud deployment where direct serial
 * connections are not available. It connects to cellular modems that expose
 * a TCP/IP interface (either directly or via a gateway/bridge).
 * 
 * Supported modem configurations:
 * - Campbell Scientific CELL210/CELL220 with TCP/IP mode
 * - Sierra Wireless RV50/RV55 with Aleos gateway
 * - Any cellular modem with TCP-to-Serial bridge
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import { Socket } from "net";

interface CellularConfig {
  host: string;
  port: number;
  apn?: string;
  apiEndpoint?: string;
  timeout?: number;
  keepAlive?: boolean;
  keepAliveInterval?: number;
}

export class GSMAdapter extends BaseProtocolAdapter {
  private socket: Socket | null = null;
  private cellularConfig: CellularConfig;
  private lastData: NormalizedWeatherData | null = null;
  private receiveBuffer: string = "";
  private keepAliveTimer: NodeJS.Timeout | null = null;

  constructor(config: ProtocolConfig) {
    super(config);

    this.cellularConfig = {
      host: config.host || "localhost",
      port: config.port || 6785,
      apn: config.apiKey?.split(":")[1],
      apiEndpoint: config.apiEndpoint,
      timeout: config.timeout || 30000,
      keepAlive: true,
      keepAliveInterval: 30000,
    };
  }

  async connect(): Promise<boolean> {
    try {
      return await this.initializeConnection();
    } catch (error: any) {
      this.setError(error);
      return false;
    }
  }

  private async initializeConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.socket = new Socket();
        this.socket.setTimeout(this.cellularConfig.timeout || 30000);

        this.socket.on("error", (error) => {
          console.error("[GSM] Socket error:", error.message);
          this.setError(error);
          this.handleDisconnection();
        });

        this.socket.on("timeout", () => {
          console.warn("[GSM] Socket timeout");
          this.setError(new Error("Connection timeout"));
          this.socket?.destroy();
        });

        this.socket.on("close", () => {
          console.log("[GSM] Socket closed");
          this.handleDisconnection();
        });

        this.socket.on("data", (data: Buffer) => {
          this.handleIncomingData(data);
        });

        console.log(`[GSM] Connecting to ${this.cellularConfig.host}:${this.cellularConfig.port}`);
        
        this.socket.connect(this.cellularConfig.port, this.cellularConfig.host, () => {
          console.log("[GSM] Connected successfully");
          this.socket?.setTimeout(0); // Clear connection timeout
          this.setConnected(true);
          this.startKeepAlive();
          resolve(true);
        });

        // Connection timeout
        setTimeout(() => {
          if (!this.status.connected) {
            console.error("[GSM] Connection timeout");
            this.setError(new Error("Connection timeout"));
            this.socket?.destroy();
            resolve(false);
          }
        }, this.cellularConfig.timeout);
      } catch (error: any) {
        console.error("[GSM] Connection error:", error.message);
        this.setError(error);
        resolve(false);
      }
    });
  }

  private startKeepAlive(): void {
    if (this.cellularConfig.keepAlive && this.cellularConfig.keepAliveInterval) {
      this.keepAliveTimer = setInterval(() => {
        if (this.socket && this.status.connected) {
          // Send TCP keepalive ping
          this.socket.write(Buffer.from([0x00]));
        }
      }, this.cellularConfig.keepAliveInterval);
    }
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private handleIncomingData(data: Buffer): void {
    // Accumulate data in receive buffer
    this.receiveBuffer += data.toString();

    // Check for complete messages
    this.processReceivedData();
  }

  private processReceivedData(): void {
    // Parse modem status messages if present
    const lines = this.receiveBuffer.split("\r\n");
    
    for (const line of lines) {
      if (line.includes("+CREG:") || line.includes("+CEREG:")) {
        // Network registration status
        const registered = line.includes("1") || line.includes("5");
        if (registered && !this.status.connected) {
          this.setConnected(true);
        }
      }

      if (line.includes("+CSQ:")) {
        // Signal quality (0-31 scale, 99 = unknown)
        const match = line.match(/\+CSQ:\s*(\d+),/);
        if (match) {
          const rssi = parseInt(match[1], 10);
          if (rssi !== 99) {
            // Convert to dBm: dBm = -113 + (2 * rssi)
            this.status.signalStrength = rssi;
            this.emit("status", this.status);
          }
        }
      }

      // Handle data payload
      if (line.startsWith("+IPD,") || line.startsWith("+RECEIVE,")) {
        // TCP data received - extract payload
        const dataMatch = line.match(/[+](?:IPD|RECEIVE),(\d+):(.*)/);
        if (dataMatch) {
          const payloadData = dataMatch[2];
          this.parseWeatherData(payloadData);
        }
      }
    }

    // Keep only incomplete last line in buffer
    const lastNewline = this.receiveBuffer.lastIndexOf("\r\n");
    if (lastNewline >= 0) {
      this.receiveBuffer = this.receiveBuffer.substring(lastNewline + 2);
    }
  }

  private parseWeatherData(data: string): void {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(data);
      this.lastData = this.normalizeData(parsed);
      this.emit("data", this.lastData);
    } catch {
      // Try to parse as CSV or other format
      console.log("[GSM] Received non-JSON data:", data.substring(0, 100));
    }
  }

  private handleDisconnection(): void {
    this.stopKeepAlive();
    this.setConnected(false);
    this.socket = null;
    
    // Trigger reconnection if auto-reconnect is enabled
    this.scheduleReconnect();
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.stopKeepAlive();

    if (this.socket) {
      return new Promise((resolve) => {
        if (this.socket) {
          this.socket.end(() => {
            this.socket?.destroy();
            this.socket = null;
            this.setConnected(false);
            resolve();
          });
        } else {
          resolve();
        }
      });
    }
  }

  async readData(): Promise<NormalizedWeatherData | null> {
    if (!this.isConnected()) {
      return null;
    }

    try {
      // If HTTP endpoint configured, fetch data via HTTP
      if (this.cellularConfig.apiEndpoint) {
        return await this.fetchViaHTTP();
      }

      // Otherwise return last cached data
      return this.lastData;
    } catch (error: any) {
      this.setError(error);
      return this.lastData;
    }
  }

  private async fetchViaHTTP(): Promise<NormalizedWeatherData | null> {
    try {
      const endpoint = this.cellularConfig.apiEndpoint || "";
      
      // Use fetch API for HTTP requests
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(this.cellularConfig.timeout || 30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data = await response.json() as Record<string, number | null>;
      this.lastData = this.normalizeData(data);
      return this.lastData;
    } catch (error) {
      console.error("[GSM] HTTP fetch error:", error);
      throw error;
    }
  }

  /**
   * Send raw data through the cellular connection
   */
  async sendData(data: Buffer): Promise<boolean> {
    if (!this.socket || !this.status.connected) {
      return false;
    }

    return new Promise((resolve) => {
      this.socket!.write(data, (err) => {
        if (err) {
          console.error("[GSM] Send error:", err.message);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Get current signal strength
   */
  getSignalStrength(): number | undefined {
    return this.status.signalStrength;
  }

  /**
   * Check if connected via LTE/4G
   */
  isLTEConnected(): boolean {
    return this.status.connected && (this.status.signalStrength || 0) > 10;
  }
}

/**
 * 4G/LTE Protocol Adapter
 * Extended GSM adapter with LTE-specific features
 */
export class CellularAdapter extends GSMAdapter {
  private connectionQuality: "unknown" | "2G" | "3G" | "4G" | "LTE" = "unknown";

  async connect(): Promise<boolean> {
    try {
      const result = await super.connect();

      if (result) {
        // Determine connection quality based on signal
        const signal = this.getSignalStrength();
        if (signal !== undefined) {
          if (signal >= 20) {
            this.connectionQuality = "LTE";
          } else if (signal >= 15) {
            this.connectionQuality = "4G";
          } else if (signal >= 10) {
            this.connectionQuality = "3G";
          } else {
            this.connectionQuality = "2G";
          }
        }
        console.log(`[Cellular] Connected with ${this.connectionQuality} quality`);
      }

      return result;
    } catch (error: any) {
      this.setError(error);
      return false;
    }
  }

  getConnectionQuality(): string {
    return this.connectionQuality;
  }
}
