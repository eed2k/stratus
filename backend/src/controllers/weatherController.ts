import { Request, Response } from 'express';
import { StationConnector } from '../services/stationConnector';
import { DataProcessor } from '../services/dataProcessor';

export class WeatherController {
    private stationConnector: StationConnector;
    private dataProcessor: DataProcessor;

    constructor() {
        this.stationConnector = new StationConnector();
        this.dataProcessor = new DataProcessor();
    }

    public async getCurrentWeather(req: Request, res: Response): Promise<void> {
        try {
            const data = await this.stationConnector.fetchData();
            const processedData = this.dataProcessor.processRawData(data);
            res.status(200).json(processedData);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch current weather data' });
        }
    }

    public async getHistoricalData(req: Request, res: Response): Promise<void> {
        const { startDate, endDate } = req.query;

        try {
            const historicalData = await this.stationConnector.fetchHistoricalData(startDate, endDate);
            const processedData = this.dataProcessor.processRawData(historicalData);
            res.status(200).json(processedData);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch historical weather data' });
        }
    }
}