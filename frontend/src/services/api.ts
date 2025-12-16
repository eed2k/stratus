import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api'; // Adjust the base URL as needed

export const fetchWeatherData = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/weather`);
        return response.data;
    } catch (error) {
        console.error('Error fetching weather data:', error);
        throw error;
    }
};

export const updateStationConfig = async (config) => {
    try {
        const response = await axios.post(`${API_BASE_URL}/station/config`, config);
        return response.data;
    } catch (error) {
        console.error('Error updating station config:', error);
        throw error;
    }
};

// Add more API functions as needed for other endpoints