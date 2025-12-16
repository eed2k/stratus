import { SerialPort } from 'serialport';
import { Lora } from '../utils/lora';
import { Gsm } from '../utils/gsm';

export class StationConnector {
    private serialPort: SerialPort | null = null;
    private lora: Lora;
    private gsm: Gsm;

    constructor() {
        this.lora = new Lora();
        this.gsm = new Gsm();
    }

    connect(protocol: 'RF' | 'LoRa' | 'GSM', config: any): Promise<void> {
        return new Promise((resolve, reject) => {
            switch (protocol) {
                case 'RF':
                    // Implement RF connection logic here
                    break;
                case 'LoRa':
                    this.lora.connect(config)
                        .then(() => resolve())
                        .catch(reject);
                    break;
                case 'GSM':
                    this.gsm.connect(config)
                        .then(() => resolve())
                        .catch(reject);
                    break;
                default:
                    reject(new Error('Unsupported protocol'));
            }
        });
    }

    disconnect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.serialPort) {
                this.serialPort.close((err) => {
                    if (err) {
                        return reject(err);
                    }
                    this.serialPort = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    fetchData(): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.serialPort) {
                // Implement data fetching logic here
            } else {
                reject(new Error('Not connected to any station'));
            }
        });
    }
}