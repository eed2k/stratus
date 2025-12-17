import { Request, Response } from 'express';
import { RikaConnector, RikaStationManager, RikaStationConfig } from '../services/rikaConnector';
import { DataProcessor } from '../services/dataProcessor';

/**
 * Weather Station Configuration Controller
 * Manages setup and configuration of both Campbell and Rika stations
 */

export interface StationSetup {
    id: string;
    name: string;
    type: 'campbell' | 'rika';
    location: {
        latitude: number;
        longitude: number;
        altitude: number;
        description: string;
    };
    enabled: boolean;
    createdAt: Date;
}

export class StationController {
    private rikaManager = new RikaStationManager();
    private dataProcessor = new DataProcessor();
    private measurements: any[] = [];

    /**
     * Setup a new weather station
     */
    setupStation = async (req: Request, res: Response) => {
        try {
            const { id, name, type, location, config } = req.body;

            if (!id || !name || !type || !location) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            if (type === 'rika') {
                const rikaConfig: RikaStationConfig = {
                    id,
                    name,
                    ipAddress: config.ipAddress,
                    port: config.port || 8080,
                    apiKey: config.apiKey,
                    pollIntervalSeconds: config.pollIntervalSeconds || 60,
                    enabled: true,
                };

                const connector = this.rikaManager.addStation(rikaConfig);
                await connector.connect();

                connector.on('data', (data) => {
                    const processed = this.dataProcessor.processRawData(data, 'rika');
                    this.measurements.push(processed);
                    // Emit to WebSocket or store in DB
                });

                return res.status(201).json({
                    status: 'ok',
                    message: `Station ${name} configured successfully`,
                    stationType: 'rika',
                    stationId: id,
                });
            } else if (type === 'campbell') {
                // Campbell Scientific setup guidance
                return res.status(201).json({
                    status: 'ok',
                    message: `Station ${name} configured successfully`,
                    stationType: 'campbell',
                    stationId: id,
                    setupGuide: {
                        description: 'Campbell Scientific Station Setup',
                        methods: ['Serial RS232', 'LoRa Radio', 'GSM'],
                        instructions: {
                            serial: 'Connect CR300 datalogger via RS232 to backend',
                            lora: 'Configure LoRa radio module on CR300',
                            gsm: 'Configure GSM/GPRS connection on CR300',
                        },
                    },
                });
            }

            return res.status(400).json({ error: 'Invalid station type' });
        } catch (error) {
            console.error('Station setup error:', error);
            return res.status(500).json({ error: 'Station setup failed', details: error });
        }
    };

    /**
     * Get list of configured stations
     */
    listStations = (req: Request, res: Response) => {
        const rikaStations = this.rikaManager
            .getAllStations()
            .map((connector) => ({
                ...connector.getConfig(),
                isConnected: connector.isReady(),
                stationType: 'rika',
            }));

        return res.json({
            status: 'ok',
            stations: rikaStations,
            total: rikaStations.length,
        });
    };

    /**
     * Get station details and status
     */
    getStation = (req: Request, res: Response) => {
        const { stationId } = req.params;
        const connector = this.rikaManager.getStation(stationId);

        if (!connector) {
            return res.status(404).json({ error: 'Station not found' });
        }

        return res.json({
            status: 'ok',
            station: {
                ...connector.getConfig(),
                isConnected: connector.isReady(),
            },
        });
    };

    /**
     * Get latest weather data from all stations
     */
    getLatestData = (req: Request, res: Response) => {
        const recentMeasurements = this.measurements
            .slice(-100)
            .reduce(
                (acc, m) => {
                    if (!acc[m.stationId]) acc[m.stationId] = [];
                    acc[m.stationId].push(m);
                    return acc;
                },
                {} as Record<string, any[]>
            );

        const latest: Record<string, any> = {};
        Object.entries(recentMeasurements).forEach(([stationId, data]) => {
            if (data.length > 0) {
                latest[stationId] = data[data.length - 1];
            }
        });

        return res.json({ status: 'ok', data: latest });
    };

    /**
     * Get historical data for a station
     */
    getHistoricalData = async (req: Request, res: Response) => {
        const { stationId } = req.params;
        const { startTime, endTime, limit = 1440 } = req.query;

        try {
            const connector = this.rikaManager.getStation(stationId as string);
            if (!connector) {
                return res.status(404).json({ error: 'Station not found' });
            }

            const start = startTime ? new Date(startTime as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
            const end = endTime ? new Date(endTime as string) : new Date();

            const data = await connector.getHistoricalData(start, end);

            return res.json({
                status: 'ok',
                stationId,
                dataPoints: data.slice(0, parseInt(limit as string)),
                count: data.length,
            });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to fetch historical data', details: error });
        }
    };

    /**
     * Get wind rose data for wind visualization
     */
    getWindRoseData = (req: Request, res: Response) => {
        const { stationId } = req.params;
        const { windSpeedBins = 6, directionBins = 16 } = req.query;

        const stationData = this.measurements.filter((m) => m.stationId === stationId);

        if (stationData.length === 0) {
            return res.status(404).json({ error: 'No data for station' });
        }

        // Build wind rose frequency table
        const windRose: Record<string, number> = {};

        stationData.forEach((data) => {
            const direction = Math.round(data.windDirection / (360 / parseInt(directionBins as string))) * (360 / parseInt(directionBins as string));
            const speedBin = Math.min(
                Math.floor(data.windSpeed / (parseInt(windSpeedBins as string) / 10)),
                parseInt(windSpeedBins as string) - 1
            );
            const key = `${direction}_${speedBin}`;
            windRose[key] = (windRose[key] || 0) + 1;
        });

        return res.json({
            status: 'ok',
            stationId,
            windRose,
            dataPoints: stationData.length,
            bins: {
                direction: parseInt(directionBins as string),
                speed: parseInt(windSpeedBins as string),
            },
        });
    };

    /**
     * Get weather statistics for a time period
     */
    getStatistics = (req: Request, res: Response) => {
        const { stationId } = req.params;
        const { timeWindowMinutes = 60 } = req.query;

        const stationData = this.measurements.filter((m) => m.stationId === stationId);

        if (stationData.length === 0) {
            return res.status(404).json({ error: 'No data for station' });
        }

        const stats = this.dataProcessor.calculateStatistics(
            stationData,
            parseInt(timeWindowMinutes as string)
        );

        return res.json({ status: 'ok', stationId, statistics: stats });
    };

    /**
     * Update station configuration
     */
    updateStation = (req: Request, res: Response) => {
        const { stationId } = req.params;
        const { name, config } = req.body;

        const connector = this.rikaManager.getStation(stationId);
        if (!connector) {
            return res.status(404).json({ error: 'Station not found' });
        }

        connector.updateConfig({
            name: name || connector.getConfig().name,
            ...config,
        });

        return res.json({
            status: 'ok',
            message: 'Station updated',
            station: connector.getConfig(),
        });
    };

    /**
     * Disconnect a station
     */
    disconnectStation = (req: Request, res: Response) => {
        const { stationId } = req.params;
        const connector = this.rikaManager.getStation(stationId);

        if (!connector) {
            return res.status(404).json({ error: 'Station not found' });
        }

        connector.disconnect();
        this.rikaManager.removeStation(stationId);

        return res.json({ status: 'ok', message: `Station ${stationId} disconnected` });
    };

    /**
     * Initialize all configured stations
     */
    initializeAll = async (req: Request, res: Response) => {
        try {
            await this.rikaManager.connectAll();
            return res.json({
                status: 'ok',
                message: 'All stations initialized',
                stationCount: this.rikaManager.getAllStations().length,
            });
        } catch (error) {
            return res.status(500).json({ error: 'Failed to initialize stations', details: error });
        }
    };

    /**
     * Shutdown all stations
     */
    shutdownAll = (req: Request, res: Response) => {
        this.rikaManager.disconnectAll();
        return res.json({ status: 'ok', message: 'All stations shut down' });
    };
}
