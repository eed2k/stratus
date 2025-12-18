/**
 * Satellite Protocol Adapter
 * Wraps SatelliteProtocol with IProtocolAdapter interface
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import { SatelliteProtocol, SatelliteConfig } from "./satellite";

export class SatelliteAdapter extends BaseProtocolAdapter {
  private protocol: SatelliteProtocol;
  private lastData: NormalizedWeatherData | null = null;

  constructor(config: ProtocolConfig) {
    super(config);
    
    // Determine provider from connection type or config
    let provider: SatelliteConfig["provider"] = "iridium";
    if (config.apiEndpoint?.includes("goes") || config.apiEndpoint?.includes("noaa")) {
      provider = "goes";
    } else if (config.apiEndpoint?.includes("globalstar")) {
      provider = "globalstar";
    } else if (config.apiEndpoint?.includes("inmarsat")) {
      provider = "inmarsat";
    }

    const satConfig: SatelliteConfig = {
      provider,
      imei: config.imei,
      serialPort: config.serialPort,
      baudRate: config.baudRate || 19200,
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
    };

    this.protocol = new SatelliteProtocol(satConfig);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.protocol.on("connected", () => {
      this.setConnected(true);
    });

    this.protocol.on("disconnected", () => {
      this.setConnected(false);
    });

    this.protocol.on("error", (error) => {
      this.setError(error);
    });

    this.protocol.on("data", (data: Record<string, number>) => {
      this.lastData = this.normalizeData(data);
      this.emit("data", this.lastData);
    });

    this.protocol.on("message", (msg) => {
      // Update signal strength from message metadata
      if (msg.signalStrength) {
        this.status.signalStrength = msg.signalStrength;
        this.emit("status", this.status);
      }
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
    // Satellite is push-based, return last received data
    return this.lastData;
  }
}
