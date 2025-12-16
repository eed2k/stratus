import { Measurement } from '../models/measurement';

export class DataProcessor {
    processRawData(rawData: any): Measurement {
        // Process the raw data and return a Measurement object
        const processedData: Measurement = new Measurement();
        
        // Example processing logic
        processedData.temperature = rawData.temperature;
        processedData.humidity = rawData.humidity;
        processedData.windSpeed = rawData.windSpeed;
        // Add more processing as needed

        return processedData;
    }

    calculateStatistics(data: Measurement[]): any {
        // Calculate statistics from an array of Measurement objects
        const total = data.length;
        const averageTemperature = data.reduce((sum, measurement) => sum + measurement.temperature, 0) / total;
        const averageHumidity = data.reduce((sum, measurement) => sum + measurement.humidity, 0) / total;
        const averageWindSpeed = data.reduce((sum, measurement) => sum + measurement.windSpeed, 0) / total;

        return {
            averageTemperature,
            averageHumidity,
            averageWindSpeed,
            totalMeasurements: total
        };
    }
}