/**
 * Demo Station Data Generator
 * Creates sample weather data for testing and demonstration
 */

import { storage } from '../localStorage';

// Potchefstroom coordinates
const POTCHEFSTROOM_LAT = -26.7145;
const POTCHEFSTROOM_LON = 27.0970;
const POTCHEFSTROOM_ALT = 1351;

/**
 * Initialize a demo station with sample data
 * Creates a station named "Elsa" with realistic weather data in Potchefstroom
 */
export async function initializeDemoStation() {
  // Check if demo station already exists
  const existingStations = await storage.getStations();
  const demoStation = existingStations.find(s => s.name === 'Elsa - Demo Station');
  
  if (demoStation) {
    // Update coordinates if they differ (ensures Potchefstroom location)
    if (demoStation.latitude !== POTCHEFSTROOM_LAT || 
        demoStation.longitude !== POTCHEFSTROOM_LON ||
        demoStation.altitude !== POTCHEFSTROOM_ALT) {
      console.log('Updating demo station coordinates to Potchefstroom...');
      await storage.updateStation(demoStation.id, {
        latitude: POTCHEFSTROOM_LAT,
        longitude: POTCHEFSTROOM_LON,
        altitude: POTCHEFSTROOM_ALT,
        location: 'Potchefstroom, South Africa'
      });
      return { ...demoStation, latitude: POTCHEFSTROOM_LAT, longitude: POTCHEFSTROOM_LON, altitude: POTCHEFSTROOM_ALT };
    }
    console.log('Demo station exists with correct coordinates');
    return demoStation;
  }

  // Create the demo station named "Elsa" with Potchefstroom coordinates
  const station = await storage.createStation({
    name: 'Elsa - Demo Station',
    pakbusAddress: 1,
    connectionType: 'demo',
    connectionConfig: {
      type: 'demo',
      dataTable: 'OneMin',
      stationType: 'demo'
    },
    location: 'Potchefstroom, South Africa',
    latitude: POTCHEFSTROOM_LAT,
    longitude: POTCHEFSTROOM_LON,
    altitude: POTCHEFSTROOM_ALT,
    description: 'Demo weather station for testing and visualization - All sensors enabled',
    securityCode: 0,
    isActive: true
  });

  // Generate some sample weather data with ALL data types
  const now = new Date();
  const baseTemp = 24; // Base temperature in Celsius (Potchefstroom is warmer)
  
  for (let i = 0; i < 100; i++) {
    const timestamp = new Date(now.getTime() - i * 60000); // One record per minute
    
    // Generate realistic variations
    const hourOfDay = timestamp.getHours();
    const tempVariation = Math.sin((hourOfDay - 6) * Math.PI / 12) * 10; // Daily temperature cycle
    const randomVariation = (Math.random() - 0.5) * 2;
    
    // Wind direction with realistic patterns (prevailing NE winds in summer)
    const baseWindDir = 45; // NE
    const windDirVariation = (Math.random() - 0.5) * 60;
    
    await storage.insertWeatherData({
      stationId: station.id,
      tableName: 'OneMin',
      timestamp,
      data: {
        // Temperature sensors
        temperature: baseTemp + tempVariation + randomVariation,
        temperatureMax: baseTemp + tempVariation + randomVariation + 2,
        temperatureMin: baseTemp + tempVariation + randomVariation - 2,
        
        // Humidity
        humidity: 45 + Math.random() * 35,
        
        // Pressure
        pressure: 865 + (Math.random() - 0.5) * 5, // Lower pressure at altitude
        
        // Wind sensors
        windSpeed: 2 + Math.random() * 12,
        windDirection: (baseWindDir + windDirVariation + 360) % 360,
        windGust: 5 + Math.random() * 18,
        
        // Precipitation
        rainfall: Math.random() < 0.15 ? Math.random() * 8 : 0,
        
        // Solar radiation
        solarRadiation: hourOfDay > 5 && hourOfDay < 19 
          ? Math.sin((hourOfDay - 5) * Math.PI / 14) * 950 + Math.random() * 50
          : 0,
        uvIndex: hourOfDay > 6 && hourOfDay < 18
          ? Math.sin((hourOfDay - 6) * Math.PI / 12) * 11
          : 0,
        
        // Soil sensors
        soilMoisture: 25 + Math.random() * 20,
        soilTemperature: baseTemp - 5 + tempVariation * 0.3 + randomVariation * 0.5,
        
        // Air quality sensors
        pm25: 8 + Math.random() * 15,
        pm10: 15 + Math.random() * 25,
        co2: 400 + Math.random() * 50,
        
        // Leaf wetness (for agriculture)
        leafWetness: Math.random() < 0.3 ? Math.random() * 100 : 0,
        
        // Evapotranspiration
        evapotranspiration: hourOfDay > 6 && hourOfDay < 18 
          ? Math.sin((hourOfDay - 6) * Math.PI / 12) * 0.5
          : 0,
        
        // Dew point (calculated from temp and humidity)
        dewPoint: baseTemp + tempVariation + randomVariation - 8 - Math.random() * 5,
        
        // Battery and system
        batteryVoltage: 12.8 + Math.random() * 0.4,
        panelVoltage: hourOfDay > 6 && hourOfDay < 18 
          ? 14 + Math.random() * 2
          : 0,
      }
    });
  }

  return station;
}

/**
 * Generate continuous demo data for real-time simulation
 * Includes all sensor types for full dashboard demonstration
 */
export function startDemoDataGeneration(stationId: number, interval: number = 60000) {
  return setInterval(async () => {
    const now = new Date();
    const hourOfDay = now.getHours();
    const baseTemp = 24; // Potchefstroom base temp
    const tempVariation = Math.sin((hourOfDay - 6) * Math.PI / 12) * 10;
    const randomVariation = (Math.random() - 0.5) * 2;
    
    // Wind direction with realistic patterns (prevailing NE winds)
    const baseWindDir = 45;
    const windDirVariation = (Math.random() - 0.5) * 60;

    await storage.insertWeatherData({
      stationId,
      tableName: 'OneMin',
      timestamp: now,
      data: {
        // Temperature sensors
        temperature: baseTemp + tempVariation + randomVariation,
        temperatureMax: baseTemp + tempVariation + randomVariation + 2,
        temperatureMin: baseTemp + tempVariation + randomVariation - 2,
        
        // Humidity
        humidity: 45 + Math.random() * 35,
        
        // Pressure
        pressure: 865 + (Math.random() - 0.5) * 5,
        
        // Wind sensors
        windSpeed: 2 + Math.random() * 12,
        windDirection: (baseWindDir + windDirVariation + 360) % 360,
        windGust: 5 + Math.random() * 18,
        
        // Precipitation
        rainfall: Math.random() < 0.15 ? Math.random() * 8 : 0,
        
        // Solar radiation
        solarRadiation: hourOfDay > 5 && hourOfDay < 19 
          ? Math.sin((hourOfDay - 5) * Math.PI / 14) * 950 + Math.random() * 50
          : 0,
        uvIndex: hourOfDay > 6 && hourOfDay < 18
          ? Math.sin((hourOfDay - 6) * Math.PI / 12) * 11
          : 0,
        
        // Soil sensors
        soilMoisture: 25 + Math.random() * 20,
        soilTemperature: baseTemp - 5 + tempVariation * 0.3 + randomVariation * 0.5,
        
        // Air quality sensors
        pm25: 8 + Math.random() * 15,
        pm10: 15 + Math.random() * 25,
        co2: 400 + Math.random() * 50,
        
        // Leaf wetness
        leafWetness: Math.random() < 0.3 ? Math.random() * 100 : 0,
        
        // Evapotranspiration
        evapotranspiration: hourOfDay > 6 && hourOfDay < 18 
          ? Math.sin((hourOfDay - 6) * Math.PI / 12) * 0.5
          : 0,
        
        // Dew point
        dewPoint: baseTemp + tempVariation + randomVariation - 8 - Math.random() * 5,
        
        // Battery and system
        batteryVoltage: 12.8 + Math.random() * 0.4,
        panelVoltage: hourOfDay > 6 && hourOfDay < 18 
          ? 14 + Math.random() * 2
          : 0,
      }
    });
  }, interval);
}
