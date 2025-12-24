/**
 * Demo Station Data Generator
 * Creates sample weather data for testing and demonstration
 */

import { storage } from '../localStorage';

/**
 * Initialize a demo station with sample data
 */
export async function initializeDemoStation() {
  // Create a demo station
  const station = await storage.createStation({
    name: 'Demo Campbell CR1000X',
    pakbusAddress: 1,
    connectionType: 'demo',
    connectionConfig: {
      type: 'demo',
      dataTable: 'OneMin'
    },
    securityCode: 0
  });

  // Generate some sample weather data
  const now = new Date();
  const baseTemp = 22; // Base temperature in Celsius
  
  for (let i = 0; i < 100; i++) {
    const timestamp = new Date(now.getTime() - i * 60000); // One record per minute
    
    // Generate realistic variations
    const hourOfDay = timestamp.getHours();
    const tempVariation = Math.sin((hourOfDay - 6) * Math.PI / 12) * 8; // Daily temperature cycle
    const randomVariation = (Math.random() - 0.5) * 2;
    
    await storage.insertWeatherData({
      stationId: station.id,
      tableName: 'OneMin',
      timestamp,
      data: {
        temperature: baseTemp + tempVariation + randomVariation,
        humidity: 50 + Math.random() * 30,
        pressure: 1013.25 + (Math.random() - 0.5) * 10,
        windSpeed: Math.random() * 15,
        windDirection: Math.random() * 360,
        windGust: Math.random() * 20,
        rainfall: Math.random() < 0.1 ? Math.random() * 5 : 0,
        solarRadiation: hourOfDay > 6 && hourOfDay < 18 
          ? Math.sin((hourOfDay - 6) * Math.PI / 12) * 800 
          : 0,
        batteryVoltage: 12.5 + Math.random() * 0.5,
      }
    });
  }

  return station;
}

/**
 * Generate continuous demo data for real-time simulation
 */
export function startDemoDataGeneration(stationId: number, interval: number = 60000) {
  return setInterval(async () => {
    const now = new Date();
    const hourOfDay = now.getHours();
    const baseTemp = 22;
    const tempVariation = Math.sin((hourOfDay - 6) * Math.PI / 12) * 8;
    const randomVariation = (Math.random() - 0.5) * 2;

    await storage.insertWeatherData({
      stationId,
      tableName: 'OneMin',
      timestamp: now,
      data: {
        temperature: baseTemp + tempVariation + randomVariation,
        humidity: 50 + Math.random() * 30,
        pressure: 1013.25 + (Math.random() - 0.5) * 10,
        windSpeed: Math.random() * 15,
        windDirection: Math.random() * 360,
        windGust: Math.random() * 20,
        rainfall: Math.random() < 0.1 ? Math.random() * 5 : 0,
        solarRadiation: hourOfDay > 6 && hourOfDay < 18 
          ? Math.sin((hourOfDay - 6) * Math.PI / 12) * 800 
          : 0,
        batteryVoltage: 12.5 + Math.random() * 0.5,
      }
    });
  }, interval);
}
