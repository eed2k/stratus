export class Measurement {
    temperature: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    solarRadiation: number;
    barometricPressure: number;
    rainfall: number;
    timestamp: Date;

    constructor(
        temperature: number,
        humidity: number,
        windSpeed: number,
        windDirection: number,
        solarRadiation: number,
        barometricPressure: number,
        rainfall: number,
        timestamp: Date
    ) {
        this.temperature = temperature;
        this.humidity = humidity;
        this.windSpeed = windSpeed;
        this.windDirection = windDirection;
        this.solarRadiation = solarRadiation;
        this.barometricPressure = barometricPressure;
        this.rainfall = rainfall;
        this.timestamp = timestamp;
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