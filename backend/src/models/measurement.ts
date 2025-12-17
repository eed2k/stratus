export class Measurement {
    stationId?: string;
    stationType?: 'campbell' | 'rika';
    temperature: number = 0;
    humidity: number = 0;
    windSpeed: number = 0;
    windDirection: number = 0;
    windGust?: number;
    solarRadiation: number = 0;
    pressure: number = 0;
    barometricPressure?: number;
    rainfall: number = 0;
    dewPoint?: number;
    uvIndex?: number;
    timestamp: Date = new Date();

    constructor(
        temperature?: number,
        humidity?: number,
        windSpeed?: number,
        windDirection?: number,
        solarRadiation?: number,
        barometricPressure?: number,
        rainfall?: number,
        timestamp?: Date,
        stationId?: string,
        stationType?: 'campbell' | 'rika'
    ) {
        this.temperature = temperature || 0;
        this.humidity = humidity || 0;
        this.windSpeed = windSpeed || 0;
        this.windDirection = windDirection || 0;
        this.solarRadiation = solarRadiation || 0;
        this.barometricPressure = barometricPressure || 0;
        this.pressure = barometricPressure || 0;
        this.rainfall = rainfall || 0;
        this.timestamp = timestamp || new Date();
        this.stationId = stationId;
        this.stationType = stationType;
    }

    validate(): boolean {
        return (
            this.temperature >= -50 && this.temperature <= 60 &&
            this.humidity >= 0 && this.humidity <= 100 &&
            this.windSpeed >= 0 &&
            this.windDirection >= 0 && this.windDirection < 360 &&
            this.solarRadiation >= 0 &&
            this.barometricPressure >= 0 &&
            this.rainfall >= 0
        );
    }
}