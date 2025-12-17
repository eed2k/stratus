import { Measurement } from '../models/measurement';

export interface ProcessedWeatherData {
    stationId: string;
    stationType: 'campbell' | 'rika';
    timestamp: Date;
    temperature: number;
    humidity: number;
    pressure: number;
    windSpeed: number;
    windDirection: number;
    windGust: number;
    rainfall: number;
    solarRadiation: number;
    uvIndex?: number;
    dewPoint: number;
    processed: Date;
}

export class DataProcessor {
    /**
     * Process raw weather data from any station type
     */
    processRawData(rawData: any, stationType: 'campbell' | 'rika'): ProcessedWeatherData {
        if (stationType === 'campbell') {
            return this.processCampbellData(rawData);
        } else if (stationType === 'rika') {
            return this.processRikaData(rawData);
        }
        throw new Error(`Unknown station type: ${stationType}`);
    }

    /**
     * Process Campbell Scientific weather station data
     */
    private processCampbellData(rawData: any): ProcessedWeatherData {
        return {
            stationId: rawData.stationId || 'campbell-default',
            stationType: 'campbell',
            timestamp: new Date(rawData.timestamp),
            temperature: parseFloat(rawData.temperature) || 0,
            humidity: parseFloat(rawData.humidity) || 0,
            pressure: parseFloat(rawData.pressure) || 0,
            windSpeed: parseFloat(rawData.windSpeed) || 0,
            windDirection: parseFloat(rawData.windDirection) || 0,
            windGust: parseFloat(rawData.windGust) || 0,
            rainfall: parseFloat(rawData.rainfall) || 0,
            solarRadiation: parseFloat(rawData.solarRadiation) || 0,
            dewPoint: parseFloat(rawData.dewPoint) || this.calculateDewPoint(
                parseFloat(rawData.temperature),
                parseFloat(rawData.humidity)
            ),
            processed: new Date(),
        };
    }

    /**
     * Process Rika weather station data
     */
    private processRikaData(rawData: any): ProcessedWeatherData {
        return {
            stationId: rawData.stationId,
            stationType: 'rika',
            timestamp: new Date(rawData.timestamp),
            temperature: parseFloat(rawData.temperature) || 0,
            humidity: parseFloat(rawData.humidity) || 0,
            pressure: parseFloat(rawData.pressure) || 0,
            windSpeed: parseFloat(rawData.windSpeed) || 0,
            windDirection: parseFloat(rawData.windDirection) || 0,
            windGust: parseFloat(rawData.windGust) || 0,
            rainfall: parseFloat(rawData.rainfall) || 0,
            solarRadiation: parseFloat(rawData.solarRadiation) || 0,
            uvIndex: parseFloat(rawData.uvIndex) || 0,
            dewPoint: parseFloat(rawData.dewPoint) || this.calculateDewPoint(
                parseFloat(rawData.temperature),
                parseFloat(rawData.humidity)
            ),
            processed: new Date(),
        };
    }

    /**
     * Calculate dew point using Magnus formula
     */
    private calculateDewPoint(temp: number, humidity: number): number {
        if (humidity <= 0 || isNaN(temp) || isNaN(humidity)) return 0;
        const a = 17.27;
        const b = 237.7;
        const alpha = ((a * temp) / (b + temp)) + Math.log(humidity / 100);
        return (b * alpha) / (a - alpha);
    }

    /**
     * Convert to Measurement model for storage
     */
    toMeasurement(processed: ProcessedWeatherData): Measurement {
        const measurement = new Measurement();
        measurement.stationId = processed.stationId;
        measurement.stationType = processed.stationType;
        measurement.timestamp = processed.timestamp;
        measurement.temperature = processed.temperature;
        measurement.humidity = processed.humidity;
        measurement.pressure = processed.pressure;
        measurement.windSpeed = processed.windSpeed;
        measurement.windDirection = processed.windDirection;
        measurement.windGust = processed.windGust;
        measurement.rainfall = processed.rainfall;
        measurement.solarRadiation = processed.solarRadiation;
        measurement.dewPoint = processed.dewPoint;
        return measurement;
    }

    /**
     * Calculate statistics from measurements
     */
    calculateStatistics(data: ProcessedWeatherData[], timeWindowMinutes: number = 60): any {
        if (data.length === 0) return null;

        const total = data.length;
        const temps = data.map(d => d.temperature);
        const humidities = data.map(d => d.humidity);
        const windSpeeds = data.map(d => d.windSpeed);
        const windGusts = data.map(d => d.windGust);
        const rainfall = data.reduce((sum, d) => sum + d.rainfall, 0);

        return {
            timeWindow: `${timeWindowMinutes} minutes`,
            temperature: {
                current: temps[temps.length - 1],
                average: temps.reduce((a, b) => a + b, 0) / total,
                min: Math.min(...temps),
                max: Math.max(...temps),
            },
            humidity: {
                current: humidities[humidities.length - 1],
                average: humidities.reduce((a, b) => a + b, 0) / total,
                min: Math.min(...humidities),
                max: Math.max(...humidities),
            },
            wind: {
                speed: windSpeeds[windSpeeds.length - 1],
                averageSpeed: windSpeeds.reduce((a, b) => a + b, 0) / total,
                maxGust: Math.max(...windGusts),
            },
            rainfall: {
                total: rainfall,
                average: rainfall / total,
            },
            measurements: total,
        };
    }
}