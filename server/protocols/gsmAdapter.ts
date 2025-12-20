/**
 * GSM/4G Cellular Protocol Adapter
 * Connects to cellular modems (GSM, LTE, 4G) for weather data transmission
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

interface CellularConfig {
  serialPort: string;
  baudRate: number;
  phoneNumber?: string;
  apn?: string;
  apiEndpoint?: string;
  timeout?: number;
}

export class GSMAdapter extends BaseProtocolAdapter {
  private serialPort: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private cellularConfig: CellularConfig;
  private lastData: NormalizedWeatherData | null = null;
  private commandQueue: string[] = [];
  private isExecutingCommand: boolean = false;

  constructor(config: ProtocolConfig) {
    super(config);

    this.cellularConfig = {
      serialPort: config.serialPort || "/dev/ttyUSB0",
      baudRate: config.baudRate || 9600,
      phoneNumber: config.apiKey?.split(":")[0],
      apn: config.apiKey?.split(":")[1],
      apiEndpoint: config.apiEndpoint,
      timeout: config.timeout || 30000,
    };
  }

  async connect(): Promise<boolean> {
    try {
      return await this.initializeModem();
    } catch (error: any) {
      this.setError(error);
      return false;
    }
  }

  private async initializeModem(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.serialPort = new SerialPort({
          path: this.cellularConfig.serialPort,
          baudRate: this.cellularConfig.baudRate,
          autoOpen: false,
        });

        this.parser = this.serialPort.pipe(new ReadlineParser({ delimiter: "\r\n" }));

        this.serialPort.on("error", (error) => {
          this.setError(error);
          resolve(false);
        });

        this.parser.on("data", (line: string) => {
          this.handleModemResponse(line);
        });

        this.serialPort.open((error) => {
          if (error) {
            this.setError(error);
            resolve(false);
            return;
          }

          // Initialize modem with AT commands
          setTimeout(() => this.initializeATCommands(resolve), 500);
        });

        // Connection timeout
        setTimeout(() => {
          if (!this.status.connected) {
            this.setError(new Error("Modem initialization timeout"));
            resolve(false);
          }
        }, this.cellularConfig.timeout);
      } catch (error: any) {
        this.setError(error);
        resolve(false);
      }
    });
  }

  private initializeATCommands(resolve: (value: boolean) => void): void {
    // Send AT commands to initialize modem
    const commands = [
      "AT", // Check connection
      "ATE0", // Echo off
      "AT+CMGF=1", // Text mode
      "AT+CREG?", // Check network registration
    ];

    let commandIndex = 0;
    const executeNext = () => {
      if (commandIndex >= commands.length) {
        this.setConnected(true);
        resolve(true);
        return;
      }

      this.sendATCommand(commands[commandIndex], () => {
        commandIndex++;
        executeNext();
      });
    };

    executeNext();
  }

  private sendATCommand(
    command: string,
    callback: (response: string) => void
  ): void {
    if (!this.serialPort || !this.serialPort.isOpen) {
      callback("ERROR");
      return;
    }

    let response = "";
    let isWaiting = true;

    const responseHandler = (line: string) => {
      response += line + "\n";

      if (line === "OK" || line === "ERROR" || response.includes("+")) {
        isWaiting = false;
        if (this.parser) {
          this.parser.removeListener("data", responseHandler);
        }
        callback(response);
      }
    };

    if (this.parser) {
      this.parser.once("data", responseHandler);
    }

    this.serialPort.write(`${command}\r`, (error) => {
      if (error) {
        isWaiting = false;
        if (this.parser) {
          this.parser.removeListener("data", responseHandler);
        }
        callback("ERROR");
      }
    });

    // Command timeout
    setTimeout(() => {
      if (isWaiting) {
        isWaiting = false;
        if (this.parser) {
          this.parser.removeListener("data", responseHandler);
        }
        callback("TIMEOUT");
      }
    }, 5000);
  }

  private handleModemResponse(line: string): void {
    // Parse modem responses and update status
    if (line.includes("+CREG:") || line.includes("+CEREG:")) {
      // Network registration status
      const registered = line.includes("1") || line.includes("5");
      if (registered && !this.status.connected) {
        this.setConnected(true);
      }
    }

    if (line.includes("+CSQ:")) {
      // Signal quality
      const match = line.match(/\+CSQ: (\d+),/);
      if (match) {
        const rssi = parseInt(match[1], 10);
        this.status.signalStrength = rssi; // 0-31 scale
        this.emit("status", this.status);
      }
    }

    if (line.includes("+CIEV:")) {
      // Signal strength change
      const match = line.match(/\+CIEV: 2,(\d+)/);
      if (match) {
        this.status.signalStrength = parseInt(match[1], 10);
        this.emit("status", this.status);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();

    if (this.serialPort && this.serialPort.isOpen) {
      return new Promise((resolve) => {
        if (this.serialPort) {
          this.sendATCommand("AT+CFUN=0", () => {
            if (this.serialPort) {
              this.serialPort.close(() => {
                this.serialPort = null;
                this.parser = null;
                this.setConnected(false);
                resolve();
              });
            } else {
              resolve();
            }
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
      // If HTTP endpoint configured, fetch data via cellular
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
    // This would typically use GPRS/LTE to fetch data
    // For now, implement a basic HTTP over GSM simulation
    try {
      const endpoint = this.cellularConfig.apiEndpoint || "";

      // AT command to establish HTTP connection and fetch data
      // This is simplified - actual implementation would use AT+HTTP commands

      return this.lastData;
    } catch (error) {
      throw error;
    }
  }
}

/**
 * 4G/LTE Protocol Adapter
 * Extended GSM adapter with LTE-specific features
 */
export class CellularAdapter extends GSMAdapter {
  async connect(): Promise<boolean> {
    try {
      const result = await super.connect();

      if (result) {
        // Configure for LTE/4G
        await new Promise<void>((resolve) => {
          this.sendATCommand("AT+CNMP=38", () => resolve()); // Set to LTE preferred
        });
      }

      return result;
    } catch (error: any) {
      this.setError(error);
      return false;
    }
  }
}
