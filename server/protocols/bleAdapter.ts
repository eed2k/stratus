/**
 * Bluetooth Low Energy (BLE) Protocol Adapter
 * Connects to BLE weather stations and reads sensor data
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";

export class BLEAdapter extends BaseProtocolAdapter {
  private peripheral: any = null;
  private characteristics: Map<string, any> = new Map();
  private lastData: NormalizedWeatherData | null = null;
  private scanTimeout: NodeJS.Timeout | null = null;
  private dataTimeout: NodeJS.Timeout | null = null;

  constructor(config: ProtocolConfig) {
    super(config);
    // Ensure noble is available for BLE operations
    if (!this.isNobleAvailable()) {
      console.warn("[BLE] Noble library not available, BLE adapter will be limited");
    }
  }

  private isNobleAvailable(): boolean {
    try {
      require("noble");
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<boolean> {
    try {
      if (!this.isNobleAvailable()) {
        this.setError(new Error("Noble library required for BLE"));
        return false;
      }

      const noble = require("noble");
      const deviceAddress = ((this.config as any).deviceAddress as string | undefined) || this.config.apiKey;

      if (!deviceAddress) {
        this.setError(new Error("Device address required for BLE"));
        return false;
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.setError(new Error("BLE connection timeout"));
          resolve(false);
        }, this.config.timeout || 30000);

        noble.on("stateChange", async (state: string) => {
          if (state === "poweredOn") {
            noble.startScanning([], true);

            noble.on("discover", async (peripheral: any) => {
              if (
                peripheral.address === deviceAddress ||
                peripheral.id === deviceAddress
              ) {
                clearTimeout(timeout);
                await noble.stopScanning();

                try {
                  await this.connectToPeripheral(peripheral);
                  this.setConnected(true);
                  resolve(true);
                } catch (error) {
                  this.setError(error as Error);
                  resolve(false);
                }
              }
            });
          }
        });
      });
    } catch (error: any) {
      this.setError(error);
      return false;
    }
  }

  private async connectToPeripheral(peripheral: any): Promise<void> {
    this.peripheral = peripheral;

    return new Promise((resolve, reject) => {
      peripheral.connect((error: any) => {
        if (error) {
          reject(new Error(`[BLE] Failed to connect to peripheral: ${error.message}`));
          return;
        }

        peripheral.discoverServices(
          [],
          (error: any, services: any[]) => {
            if (error) {
              reject(new Error(`[BLE] Service discovery failed: ${error.message}`));
              return;
            }

            this.discoverCharacteristics(services, (error) => {
              if (error) {
                reject(new Error(`[BLE] Characteristic discovery failed: ${error.message}`));
              } else {
                resolve();
              }
            });
          }
        );
      });
    });
  }

  private discoverCharacteristics(
    services: any[],
    callback: (error?: Error) => void
  ): void {
    let processed = 0;

    services.forEach((service) => {
      service.discoverCharacteristics([], (error: any, chars: any[]) => {
        if (error) {
          callback(new Error(`[BLE] Failed to discover characteristics for service ${service.uuid}: ${error.message}`));
          return;
        }

        chars.forEach((char) => {
          this.characteristics.set(char.uuid, char);
        });

        processed++;
        if (processed === services.length) {
          callback();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.clearDataTimeout();

    if (this.peripheral) {
      return new Promise((resolve) => {
        this.peripheral.disconnect(() => {
          this.peripheral = null;
          this.characteristics.clear();
          this.setConnected(false);
          resolve();
        });
      });
    }
  }

  async readData(): Promise<NormalizedWeatherData | null> {
    if (!this.isConnected() || !this.peripheral) {
      return null;
    }

    try {
      // Read data from weather station characteristics
      const rawData: Record<string, number | null> = {};

      // Try to read temperature, humidity, pressure from characteristics
      for (const [uuid, char] of this.characteristics.entries()) {
        try {
          const data = await this.readCharacteristic(char);
          const parsed = this.parseCharacteristicData(uuid, data);

          Object.assign(rawData, parsed);
        } catch (error) {
          // Continue with next characteristic
        }
      }

      if (Object.keys(rawData).length === 0) {
        return this.lastData;
      }

      const normalized = this.normalizeData(rawData);
      this.lastData = normalized;
      this.emit("data", normalized);

      return normalized;
    } catch (error: any) {
      this.setError(error);
      return this.lastData;
    }
  }

  private readCharacteristic(characteristic: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      characteristic.read((error: any, data: Buffer) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
  }

  private parseCharacteristicData(
    uuid: string,
    data: Buffer
  ): Record<string, number | null> {
    const result: Record<string, number | null> = {};

    try {
      // Common BLE sensor UUIDs
      const uuidLower = uuid.toLowerCase();

      if (uuidLower.includes("180a")) {
        // Device information service
        return result;
      }

      if (
        uuidLower.includes("181a") ||
        uuidLower.includes("temperature")
      ) {
        // Environmental sensing service - Temperature
        const temp = data.readInt16BE(0) / 100;
        result.temperature = temp;
      }

      if (
        uuidLower.includes("181a") ||
        uuidLower.includes("humidity")
      ) {
        // Humidity
        const humidity = data.readUInt16BE(2) / 100;
        result.humidity = Math.min(humidity, 100);
      }

      if (
        uuidLower.includes("181a") ||
        uuidLower.includes("pressure")
      ) {
        // Pressure
        const pressure = data.readUInt32BE(4) / 1000;
        result.pressure = pressure;
      }
    } catch (error) {
      // Data parsing error, return empty
    }

    return result;
  }

  private clearDataTimeout(): void {
    if (this.dataTimeout) {
      clearTimeout(this.dataTimeout);
      this.dataTimeout = null;
    }
  }
}
