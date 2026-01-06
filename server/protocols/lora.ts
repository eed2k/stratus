/**
 * LoRa/LoRaWAN Protocol Implementation
 * Long Range, Low Power wireless communication for IoT weather stations
 * 
 * CLOUD DEPLOYMENT NOTE:
 * This implementation connects to LoRaWAN network servers via MQTT over TCP/IP.
 * P2P mode is NOT supported in cloud deployment as it requires direct serial
 * connection to a local LoRa radio module.
 * 
 * Supported modes:
 * - LoRaWAN: Connect to TTN, ChirpStack, or other network servers via MQTT
 */

import { EventEmitter } from "events";

export interface LoRaConfig {
  mode: "lorawan" | "lora-p2p";
  // LoRaWAN settings (TCP/IP via MQTT)
  networkServer?: string;
  applicationId?: string;
  applicationKey?: string;
  deviceEUI?: string;
  appEUI?: string;
  appKey?: string;
  // P2P settings (NOT supported in cloud deployment)
  frequency?: number;
  spreadingFactor?: number;
  bandwidth?: number;
  codingRate?: string;
}

export interface LoRaMessage {
  deviceEUI: string;
  timestamp: Date;
  rssi: number;
  snr: number;
  port: number;
  payload: Buffer;
  decoded?: Record<string, number>;
}

// Common LoRaWAN network server endpoints
const NETWORK_SERVERS = {
  TTN_EU: "eu1.cloud.thethings.network",
  TTN_US: "nam1.cloud.thethings.network",
  TTN_AU: "au1.cloud.thethings.network",
  CHIRPSTACK: "localhost:8080",
};

export class LoRaProtocol extends EventEmitter {
  private config: LoRaConfig;
  private connected: boolean = false;
  private websocket: any = null;
  private mqttClient: any = null;

  constructor(config: LoRaConfig) {
    super();
    this.config = {
      frequency: 868100000, // EU868 default
      spreadingFactor: 7,
      bandwidth: 125000,
      codingRate: "4/5",
      ...config,
    };
  }

  async connect(): Promise<boolean> {
    try {
      if (this.config.mode === "lorawan") {
        return await this.connectLoRaWAN();
      } else {
        return await this.connectP2P();
      }
    } catch (error) {
      this.emit("error", error);
      return false;
    }
  }

  private async connectLoRaWAN(): Promise<boolean> {
    // Connect to LoRaWAN network server via MQTT
    return new Promise((resolve, reject) => {
      try {
        const mqtt = require("mqtt");
        
        const options = {
          clientId: `stratus-${Date.now()}`,
          username: this.config.applicationId,
          password: this.config.applicationKey,
          clean: true,
          reconnectPeriod: 5000,
        };

        const url = `mqtts://${this.config.networkServer}:8883`;
        this.mqttClient = mqtt.connect(url, options);

        this.mqttClient.on("connect", () => {
          this.connected = true;
          
          // Subscribe to uplink messages
          const topic = `v3/${this.config.applicationId}/devices/+/up`;
          this.mqttClient.subscribe(topic, (err: Error) => {
            if (err) {
              reject(err);
            } else {
              this.emit("connected");
              resolve(true);
            }
          });
        });

        this.mqttClient.on("message", (topic: string, message: Buffer) => {
          this.handleLoRaWANMessage(topic, message);
        });

        this.mqttClient.on("error", (err: Error) => {
          this.emit("error", err);
          reject(err);
        });

        this.mqttClient.on("close", () => {
          this.connected = false;
          this.emit("disconnected");
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async connectP2P(): Promise<boolean> {
    // P2P mode NOT supported in cloud deployment
    // Requires direct serial connection to local LoRa radio module
    throw new Error(
      "LoRa P2P mode is not supported in cloud deployment. " +
      "Use LoRaWAN mode to connect via a network server instead."
    );
  }

  private handleLoRaWANMessage(topic: string, message: Buffer): void {
    try {
      const data = JSON.parse(message.toString());
      
      const loraMessage: LoRaMessage = {
        deviceEUI: data.end_device_ids?.dev_eui || "",
        timestamp: new Date(data.received_at),
        rssi: data.uplink_message?.rx_metadata?.[0]?.rssi || 0,
        snr: data.uplink_message?.rx_metadata?.[0]?.snr || 0,
        port: data.uplink_message?.f_port || 1,
        payload: Buffer.from(data.uplink_message?.frm_payload || "", "base64"),
      };

      // Decode the payload
      loraMessage.decoded = this.decodePayload(loraMessage.payload, loraMessage.port);

      this.emit("message", loraMessage);
      this.emit("data", loraMessage.decoded);
    } catch (error) {
      this.emit("error", error);
    }
  }

  handleSerialData(data: Buffer): void {
    // Parse P2P LoRa message
    try {
      const message: LoRaMessage = {
        deviceEUI: "local",
        timestamp: new Date(),
        rssi: 0,
        snr: 0,
        port: 1,
        payload: data,
        decoded: this.decodePayload(data, 1),
      };

      this.emit("message", message);
      this.emit("data", message.decoded);
    } catch (error) {
      this.emit("error", error);
    }
  }

  private decodePayload(payload: Buffer, port: number): Record<string, number> {
    const decoded: Record<string, number> = {};

    // Common Cayenne LPP format (port 1) decoding
    if (port === 1 && payload.length >= 2) {
      let offset = 0;
      
      while (offset < payload.length - 1) {
        const channel = payload[offset++];
        const type = payload[offset++];

        switch (type) {
          case 0x67: // Temperature (0.1 °C signed MSB)
            if (offset + 2 <= payload.length) {
              const temp = payload.readInt16BE(offset);
              decoded.temperature = temp / 10;
              offset += 2;
            }
            break;
          case 0x68: // Humidity (0.5 % unsigned)
            if (offset + 1 <= payload.length) {
              decoded.humidity = payload[offset++] / 2;
            }
            break;
          case 0x73: // Barometric Pressure (0.1 hPa unsigned MSB)
            if (offset + 2 <= payload.length) {
              decoded.pressure = payload.readUInt16BE(offset) / 10;
              offset += 2;
            }
            break;
          case 0x02: // Analog Input (0.01 signed MSB)
            if (offset + 2 <= payload.length) {
              const value = payload.readInt16BE(offset);
              decoded[`analog_${channel}`] = value / 100;
              offset += 2;
            }
            break;
          case 0x65: // Illuminance (1 lux unsigned MSB)
            if (offset + 2 <= payload.length) {
              decoded.solarRadiation = payload.readUInt16BE(offset);
              offset += 2;
            }
            break;
          default:
            // Unknown type, skip
            offset++;
            break;
        }
      }
    } else if (port === 2) {
      // Custom binary format for weather station
      if (payload.length >= 14) {
        decoded.temperature = payload.readInt16BE(0) / 100;
        decoded.humidity = payload.readUInt16BE(2) / 100;
        decoded.pressure = payload.readUInt16BE(4) / 10;
        decoded.windSpeed = payload.readUInt16BE(6) / 100;
        decoded.windDirection = payload.readUInt16BE(8);
        decoded.rainfall = payload.readUInt16BE(10) / 10;
        decoded.solarRadiation = payload.readUInt16BE(12);
      }
    }

    return decoded;
  }

  async sendDownlink(deviceEUI: string, payload: Buffer, port: number = 1): Promise<boolean> {
    if (!this.connected || !this.mqttClient) {
      throw new Error("Not connected");
    }

    return new Promise((resolve, reject) => {
      const topic = `v3/${this.config.applicationId}/devices/${deviceEUI}/down/push`;
      
      const message = {
        downlinks: [{
          f_port: port,
          frm_payload: payload.toString("base64"),
          priority: "NORMAL",
        }],
      };

      this.mqttClient.publish(topic, JSON.stringify(message), (err: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.mqttClient) {
      this.mqttClient.end();
      this.mqttClient = null;
    }
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.connected = false;
    this.emit("disconnected");
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Configure LoRa radio parameters (for P2P mode)
  getRadioConfig(): Record<string, any> {
    return {
      frequency: this.config.frequency,
      spreadingFactor: this.config.spreadingFactor,
      bandwidth: this.config.bandwidth,
      codingRate: this.config.codingRate,
    };
  }
}

// Supported frequency plans
export const LORA_FREQUENCY_PLANS = {
  EU868: {
    name: "EU868",
    frequencies: [868100000, 868300000, 868500000],
    defaultFrequency: 868100000,
  },
  US915: {
    name: "US915",
    frequencies: [902300000, 902500000, 902700000],
    defaultFrequency: 902300000,
  },
  AU915: {
    name: "AU915",
    frequencies: [916800000, 917000000, 917200000],
    defaultFrequency: 916800000,
  },
  AS923: {
    name: "AS923",
    frequencies: [923200000, 923400000, 923600000],
    defaultFrequency: 923200000,
  },
};
