// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * LoRa Protocol Adapter
 * Wraps LoRaProtocol with IProtocolAdapter interface
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import { LoRaProtocol, LoRaConfig } from "./lora";

export class LoRaAdapter extends BaseProtocolAdapter {
  private protocol: LoRaProtocol;
  private lastData: NormalizedWeatherData | null = null;

  constructor(config: ProtocolConfig) {
    super(config);
    
    const loraConfig: LoRaConfig = {
      mode: "lorawan", // Only LoRaWAN mode supported in cloud deployment
      networkServer: config.host || "eu1.cloud.thethings.network",
      applicationId: config.apiKey?.split(":")[0],
      applicationKey: config.apiKey?.split(":")[1],
      deviceEUI: config.deviceEUI,
    };

    this.protocol = new LoRaProtocol(loraConfig);
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
      if (msg.rssi) {
        this.status.signalStrength = msg.rssi;
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
    // LoRa is push-based, return last received data
    return this.lastData;
  }
}
