import React, { useEffect, useState } from 'react';
import { fetchWeatherData } from '../../services/api';
import WindRose2D from './WindRose2D';
import WindRose3D from './WindRose3D';
import TimeSeriesChart from '../Charts/TimeSeriesChart';

const Dashboard: React.FC = () => {
    const [weatherData, setWeatherData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const getWeatherData = async () => {
            try {
                const data = await fetchWeatherData();
                setWeatherData(data);
            } catch (err) {
                setError('Failed to fetch weather data');
            } finally {
                setLoading(false);
            }
        };

        getWeatherData();
    }, []);

    if (loading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>{error}</div>;
    }

    return (
        <div>
            <h1>Current Weather Conditions</h1>
            <div>
                <h2>Temperature: {weatherData.temperature} °C</h2>
                <h2>Humidity: {weatherData.humidity} %</h2>
                <h2>Wind Speed: {weatherData.windSpeed} km/h</h2>
                <h2>Wind Direction: {weatherData.windDirection} °</h2>
            </div>
            <WindRose2D windData={weatherData.windData} />
            <WindRose3D windData={weatherData.windData} />
            <TimeSeriesChart data={weatherData.timeSeries} />
        </div>
    );
};

export default Dashboard;