export interface WeatherMeasurement {
    temperature: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    solarRadiation: number;
    barometricPressure: number;
    rainfall: number;
    timestamp: Date;
}

export interface WindRoseData {
    direction: string;
    speed: number;
    frequency: number;
}

export interface StationConfig {
    id: string;
    name: string;
    location: string;
    protocol: 'RF' | 'LoRa' | 'GSM';
    isActive: boolean;
}