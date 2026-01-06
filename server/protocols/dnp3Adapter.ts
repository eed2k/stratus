/**
 * DNP3 Protocol Adapter
 * Wraps DNP3Protocol with IProtocolAdapter interface
 * 
 * CLOUD DEPLOYMENT NOTE:
 * DNP3 connections use TCP/IP only in cloud deployment.
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import { DNP3Protocol, WEATHER_DNP3_POINTS, DNP3Config } from "./dnp3";

export class DNP3Adapter extends BaseProtocolAdapter {
  private protocol: DNP3Protocol;

  constructor(config: ProtocolConfig) {
    super(config);
    
    const dnp3Config: DNP3Config = {
      mode: "tcp", // Only TCP mode supported in cloud deployment
      masterAddress: config.masterAddress || 1,
      outstationAddress: config.outstationAddress || 10,
      host: config.host,
      port: config.port || 20000,
      timeout: config.timeout || 5000,
    };

    this.protocol = new DNP3Protocol(dnp3Config);
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
      const rawData = await this.protocol.readWeatherPoints(WEATHER_DNP3_POINTS);
      const normalized = this.normalizeData(rawData);
      this.emit("data", normalized);
      return normalized;
    } catch (error) {
      this.setError(error as Error);
      return null;
    }
  }
}
