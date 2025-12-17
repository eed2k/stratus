import express from 'express';
import bodyParser from 'body-parser';
import { WeatherController } from './controllers/weatherController';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
const weatherController = new WeatherController();
app.get('/api/weather/current', weatherController.getCurrentWeather.bind(weatherController));
app.get('/api/weather/historical', weatherController.getHistoricalData.bind(weatherController));

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});