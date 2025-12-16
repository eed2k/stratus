import { SerialPort } from 'serialport';

export class SerialCommunication {
    private port: SerialPort;

    constructor(portName: string, baudRate: number = 9600) {
        this.port = new SerialPort({
            path: portName,
            baudRate: baudRate,
        });
    }

    public open(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.port.open((err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    public close(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.port.close((err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    public write(data: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.port.write(data, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });
    }

    public read(): Promise<string> {
        return new Promise((resolve, reject) => {
            this.port.on('data', (data) => {
                resolve(data.toString());
            });

            this.port.on('error', (err) => {
                reject(err);
            });
        });
    }
}