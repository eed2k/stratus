export interface WeatherMeasurement {
    temperature: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    solarRadiation: number;
    barometricPressure: number;
    rainfall: number;
    dewPoint: number;
    eto: number; // Evapotranspiration
}

export interface StationConfig {
    id: string;
    name: string;
    location: {
        latitude: number;
        longitude: number;
    };
    protocols: string[]; // e.g., ['RF', 'LoRa', 'GSM']
}

export interface WindRoseData {
    direction: string; // e.g., 'N', 'NE', 'E', etc.
    speed: number; // Average speed for this direction
    frequency: number; // Number of occurrences
}

export interface TimeSeriesData {
    timestamp: string; // ISO date string
    measurements: WeatherMeasurement;
}