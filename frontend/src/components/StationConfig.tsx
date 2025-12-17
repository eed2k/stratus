import React, { useState, useEffect } from 'react';
import { fetchWeatherStations, updateStationConfig } from '../services/api';

const StationConfig: React.FC = () => {
    const [stations, setStations] = useState([]);
    const [selectedStation, setSelectedStation] = useState(null);
    const [config, setConfig] = useState({});

    useEffect(() => {
        const loadStations = async () => {
            const data = await fetchWeatherStations();
            setStations(data);
        };
        loadStations();
    }, []);

    const handleStationChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const stationId = event.target.value;
        const stationConfig = stations.find(station => station.id === stationId);
        setSelectedStation(stationId);
        setConfig(stationConfig ? stationConfig.config : {});
    };

    const handleConfigChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target;
        setConfig(prevConfig => ({ ...prevConfig, [name]: value }));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        await updateStationConfig(selectedStation, config);
        alert('Station configuration updated successfully!');
    };

    return (
        <div>
            <h2>Weather Station Configuration</h2>
            <form onSubmit={handleSubmit}>
                <label>
                    Select Station:
                    <select value={selectedStation || ''} onChange={handleStationChange}>
                        <option value="" disabled>Select a station</option>
                        {stations.map(station => (
                            <option key={station.id} value={station.id}>{station.name}</option>
                        ))}
                    </select>
                </label>
                <div>
                    <h3>Configuration</h3>
                    {Object.keys(config).map(key => (
                        <div key={key}>
                            <label>
                                {key}:
                                <input
                                    type="text"
                                    name={key}
                                    value={config[key] || ''}
                                    onChange={handleConfigChange}
                                />
                            </label>
                        </div>
                    ))}
                </div>
                <button type="submit">Update Configuration</button>
            </form>
        </div>
    );
};

export default StationConfig;