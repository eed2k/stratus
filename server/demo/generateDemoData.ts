import { db } from "../db";
import { eq } from "drizzle-orm";
import { weatherStations, weatherData, sensors, calibrationRecords, maintenanceEvents, configurationChanges } from "@shared/schema";

/**
 * Generate realistic weather data for demo station
 * Simulates 30 days of weather patterns for Pretoria, South Africa
 */
export async function generateDemoStation() {
  console.log("Creating demo weather station...");

  // 1. Create demo station
  const [station] = await db.insert(weatherStations).values({
    name: "Demo Weather Station - Pretoria",
    location: "Pretoria, Gauteng, South Africa",
    latitude: -25.7479,
    longitude: 28.2293,
    altitude: 1339,
    timezone: "Africa/Johannesburg",
    stationType: "campbell_scientific",
    dataloggerModel: "CR1000X",
    dataloggerSerialNumber: "DEMO-CR1000X-00123",
    dataloggerFirmwareVersion: "CR1000X.Std.03.02",
    dataloggerProgramName: "WeatherStation_v2.1.CR1X",
    dataloggerProgramSignature: "12345",
    connectionType: "tcp",
    protocol: "pakbus",
    ipAddress: "demo.station.local",
    port: 6785,
    pakbusAddress: 1,
    securityCode: 0,
    dataTable: "OneMin",
    pollInterval: 60,
    isActive: true,
    isConnected: true,
    lastConnectionTime: new Date(),
    lastDataTime: new Date(),
    batteryVoltage: 12.8,
    panelTemperature: 25.5,
    siteDescription: "Urban meteorological research site with clear exposure on 10-meter tower",
    installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 6 months ago
  }).returning();

  console.log(`Created demo station: ${station.name} (ID: ${station.id})`);

  // 2. Create sensors
  const sensorData = [
    {
      stationId: station.id,
      sensorType: "Temperature",
      manufacturer: "Campbell Scientific",
      model: "ClimaVue50",
      serialNumber: "AT-DEMO-001",
      measurementType: "temperature",
      installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      installationHeight: 2.0,
      notes: "Air temperature sensor at standard 2m height. Accuracy: ±0.2°C",
    },
    {
      stationId: station.id,
      sensorType: "Humidity",
      manufacturer: "Campbell Scientific",
      model: "ClimaVue50",
      serialNumber: "RH-DEMO-002",
      measurementType: "humidity",
      installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      installationHeight: 2.0,
      notes: "Relative humidity sensor co-located with temperature. Accuracy: ±2%",
    },
    {
      stationId: station.id,
      sensorType: "Pressure",
      manufacturer: "Campbell Scientific",
      model: "ClimaVue50",
      serialNumber: "BP-DEMO-003",
      measurementType: "pressure",
      installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      installationHeight: 1.5,
      notes: "Barometric pressure sensor. Accuracy: ±0.3 hPa",
    },
    {
      stationId: station.id,
      sensorType: "Wind Speed",
      manufacturer: "Campbell Scientific",
      model: "ClimaVue50",
      serialNumber: "WS-DEMO-004",
      measurementType: "wind",
      installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      installationHeight: 10.0,
      notes: "Anemometer at 10m height. Accuracy: ±0.3 m/s",
    },
    {
      stationId: station.id,
      sensorType: "Wind Direction",
      manufacturer: "Campbell Scientific",
      model: "ClimaVue50",
      serialNumber: "WD-DEMO-005",
      measurementType: "wind",
      installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      installationHeight: 10.0,
      orientation: "North",
      notes: "Wind vane at 10m height. Accuracy: ±3°",
    },
    {
      stationId: station.id,
      sensorType: "Solar Radiation",
      manufacturer: "Campbell Scientific",
      model: "ClimaVue50",
      serialNumber: "SR-DEMO-006",
      measurementType: "solar",
      installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      installationHeight: 2.0,
      orientation: "Horizontal, facing up",
      notes: "Pyranometer for solar radiation measurement. Accuracy: ±5%",
    },
    {
      stationId: station.id,
      sensorType: "Precipitation",
      manufacturer: "Campbell Scientific",
      model: "ClimaVue50",
      serialNumber: "PR-DEMO-007",
      measurementType: "precipitation",
      installationDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      installationHeight: 1.2,
      notes: "Tipping bucket rain gauge. Resolution: 0.2mm per tip",
    },
  ];

  const createdSensors = await db.insert(sensors).values(sensorData).returning();
  console.log(`Created ${createdSensors.length} sensors`);

  // 3. Create calibration records (3 months ago)
  const calibrationDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const nextCalibrationDue = new Date(Date.now() + 270 * 24 * 60 * 60 * 1000); // 9 months from now

  const calibrationData = createdSensors.map((sensor) => {
    let uncertaintyUnit = "";
    if (sensor.measurementType === "temperature") uncertaintyUnit = "°C";
    else if (sensor.measurementType === "humidity") uncertaintyUnit = "%";
    else if (sensor.measurementType === "pressure") uncertaintyUnit = "hPa";
    else if (sensor.measurementType === "wind") uncertaintyUnit = sensor.sensorType === "Wind Speed" ? "m/s" : "degrees";
    else if (sensor.measurementType === "solar") uncertaintyUnit = "W/m²";
    else if (sensor.measurementType === "precipitation") uncertaintyUnit = "mm";

    return {
      sensorId: sensor.id,
      calibrationDate,
      nextCalibrationDue,
      calibratingInstitution: "National Metrology Institute of South Africa",
      certificateNumber: `NMISA-2024-${sensor.serialNumber}`,
      calibrationStandard: "NIST traceable reference standards",
      uncertaintyValue: sensor.measurementType === "temperature" ? 0.1 : sensor.measurementType === "humidity" ? 2.0 : 0.3,
      uncertaintyUnit,
      adjustmentFactor: 1.0 + (Math.random() - 0.5) * 0.002, // Small adjustment factor
      calibrationStatus: "valid",
      performedBy: "J. Technician",
      notes: "Annual calibration performed, all parameters within specification",
    };
  });

  await db.insert(calibrationRecords).values(calibrationData);
  console.log(`Created ${calibrationData.length} calibration records`);

  // 4. Create maintenance events
  const maintenanceData = [
    {
      stationId: station.id,
      eventDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      eventType: "installation",
      description: "Initial station setup and commissioning. All sensors installed and tested.",
      performedBy: "J. Technician",
      downtimeMinutes: 0,
      dataQualityImpact: false,
      notes: "Station commissioned successfully",
    },
    {
      stationId: station.id,
      eventDate: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000),
      eventType: "preventive",
      description: "Routine inspection - all systems normal",
      performedBy: "J. Technician",
      downtimeMinutes: 0,
      dataQualityImpact: false,
    },
    {
      stationId: station.id,
      eventDate: calibrationDate,
      eventType: "calibration",
      description: "All sensors calibrated, certificates issued",
      performedBy: "Calibration Lab",
      downtimeMinutes: 120,
      dataQualityImpact: false,
      notes: "New calibration coefficients applied",
    },
    {
      stationId: station.id,
      eventDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      eventType: "preventive",
      description: "Solar panel cleaning, battery check (12.8V)",
      performedBy: "J. Technician",
      downtimeMinutes: 15,
      dataQualityImpact: false,
    },
    {
      stationId: station.id,
      eventDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      eventType: "corrective",
      description: "Rain gauge cleaned (spider web obstruction removed)",
      performedBy: "J. Technician",
      downtimeMinutes: 10,
      dataQualityImpact: true,
      notes: "Precipitation readings may have been affected for past week",
    },
    {
      stationId: station.id,
      eventDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      eventType: "preventive",
      description: "Routine inspection - all systems normal",
      performedBy: "J. Technician",
      downtimeMinutes: 0,
      dataQualityImpact: false,
    },
  ];

  await db.insert(maintenanceEvents).values(maintenanceData);
  console.log(`Created ${maintenanceData.length} maintenance events`);

  // 5. Create configuration changes
  const configChanges = [
    {
      stationId: station.id,
      changeDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      changeType: "initial_setup",
      description: "Station commissioned with default settings",
      changedBy: "J. Technician",
      oldValue: null,
      newValue: "Initial configuration",
    },
    {
      stationId: station.id,
      changeDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
      changeType: "software_update",
      description: "Datalogger program updated to v2.1",
      changedBy: "System Admin",
      oldValue: "WeatherStation_v2.0.CR1X",
      newValue: "WeatherStation_v2.1.CR1X",
    },
    {
      stationId: station.id,
      changeDate: calibrationDate,
      changeType: "calibration_update",
      description: "New calibration coefficients applied",
      changedBy: "J. Technician",
      oldValue: "Previous calibration coefficients",
      newValue: "Updated calibration coefficients from NMISA",
    },
    {
      stationId: station.id,
      changeDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      changeType: "sampling_change",
      description: "Increased sampling rate from 15min to 10min",
      changedBy: "System Admin",
      oldValue: "pollInterval: 900",
      newValue: "pollInterval: 600",
    },
  ];

  await db.insert(configurationChanges).values(configChanges);
  console.log(`Created ${configChanges.length} configuration changes`);

  // 6. Generate 30 days of weather data
  console.log("Generating 30 days of realistic weather data...");
  const weatherRecords = generateRealisticWeatherData(station.id, 30);
  
  // Insert in batches to avoid overwhelming the database
  const batchSize = 500;
  for (let i = 0; i < weatherRecords.length; i += batchSize) {
    const batch = weatherRecords.slice(i, i + batchSize);
    await db.insert(weatherData).values(batch);
    console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(weatherRecords.length / batchSize)}`);
  }

  console.log(`Generated ${weatherRecords.length} weather data records`);
  console.log("Demo station creation complete!");

  return station;
}

/**
 * Generate realistic weather data with proper patterns
 */
function generateRealisticWeatherData(stationId: number, days: number) {
  const records = [];
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  
  // 10-minute intervals
  const intervalMinutes = 10;
  const recordsPerDay = (24 * 60) / intervalMinutes;
  const totalRecords = days * recordsPerDay;

  for (let i = 0; i < totalRecords; i++) {
    const timestamp = new Date(startDate.getTime() + i * intervalMinutes * 60 * 1000);
    const hour = timestamp.getHours();
    const dayOfYear = Math.floor((timestamp.getTime() - new Date(timestamp.getFullYear(), 0, 0).getTime()) / 86400000);
    const dayInPeriod = Math.floor(i / recordsPerDay);

    // Simulate weather patterns
    let weatherPattern = "clear";
    if (dayInPeriod >= 3 && dayInPeriod <= 5) weatherPattern = "frontal"; // Cold front
    if (dayInPeriod >= 10 && dayInPeriod <= 15) weatherPattern = "humid"; // Building to storm
    if (dayInPeriod === 15) weatherPattern = "storm"; // Thunderstorm
    if (dayInPeriod >= 16 && dayInPeriod <= 25) weatherPattern = "variable"; // Variable conditions

    // Temperature with diurnal cycle (Southern Hemisphere summer)
    let baseTemp = 22;
    const diurnalVariation = 8 * Math.sin((hour - 6) * Math.PI / 12); // Peak at ~2 PM
    
    if (weatherPattern === "frontal") baseTemp -= 5;
    if (weatherPattern === "humid") baseTemp += 3;
    if (weatherPattern === "storm") baseTemp -= 8;
    
    const temperature = baseTemp + diurnalVariation + (Math.random() - 0.5) * 1.5;

    // Humidity inverse to temperature
    let baseHumidity = 70 - (temperature - 22) * 2;
    if (weatherPattern === "humid" || weatherPattern === "storm") baseHumidity += 20;
    if (weatherPattern === "frontal") baseHumidity += 10;
    
    const humidity = Math.max(20, Math.min(95, baseHumidity + (Math.random() - 0.5) * 8));

    // Pressure patterns
    let basePressure = 862;
    if (weatherPattern === "frontal") basePressure -= 8;
    if (weatherPattern === "storm") basePressure -= 12;
    if (weatherPattern === "clear") basePressure += 3;
    
    const pressure = basePressure + (Math.random() - 0.5) * 2;

    // Wind speed and direction
    let baseWindSpeed = 3;
    let windDirection = 180; // Default southerly
    
    if (weatherPattern === "frontal") {
      baseWindSpeed = 8;
      windDirection = dayInPeriod === 3 ? 200 : 320; // SW then NW shift
    }
    if (weatherPattern === "storm") {
      baseWindSpeed = 15;
      windDirection = 270 + (Math.random() - 0.5) * 60;
    }
    if (weatherPattern === "clear") {
      baseWindSpeed = 2;
      windDirection = 90 + (Math.random() - 0.5) * 90; // Light easterly
    }
    
    const windSpeed = Math.max(0, baseWindSpeed + 3 * Math.sin(hour * Math.PI / 8) + (Math.random() - 0.5) * 3);
    const windGust = windSpeed * (1.3 + Math.random() * 0.3);
    windDirection = (windDirection + (Math.random() - 0.5) * 30 + 360) % 360;

    // Solar radiation (zero at night)
    let solarRadiation = 0;
    if (hour >= 6 && hour <= 18) {
      const solarAngle = Math.sin((hour - 6) * Math.PI / 12);
      let maxRadiation = 1100;
      
      if (weatherPattern === "storm") maxRadiation = 200;
      if (weatherPattern === "variable") maxRadiation = 800;
      
      solarRadiation = maxRadiation * solarAngle * (0.85 + Math.random() * 0.15);
    }

    // Precipitation
    let rainfall = 0;
    if (weatherPattern === "frontal" && Math.random() > 0.7) rainfall = Math.random() * 3;
    if (weatherPattern === "storm" && Math.random() > 0.5) rainfall = Math.random() * 15;
    if (weatherPattern === "variable" && Math.random() > 0.9) rainfall = Math.random() * 5;

    // Calculate dew point
    const dewPoint = temperature - ((100 - humidity) / 5);

    // Occasional missing data (simulate communication issues)
    if (Math.random() > 0.998) continue; // Skip ~0.2% of records

    records.push({
      stationId,
      timestamp,
      temperature: parseFloat(temperature.toFixed(2)),
      humidity: parseFloat(humidity.toFixed(1)),
      pressure: parseFloat(pressure.toFixed(1)),
      windSpeed: parseFloat(windSpeed.toFixed(2)),
      windDirection: parseFloat(windDirection.toFixed(0)),
      windGust: parseFloat(windGust.toFixed(2)),
      rainfall: parseFloat(rainfall.toFixed(2)),
      solarRadiation: parseFloat(solarRadiation.toFixed(1)),
      dewPoint: parseFloat(dewPoint.toFixed(2)),
    });
  }

  return records;
}

// Export function to be called from API or script
export async function initializeDemoStation() {
  try {
    // Check if demo station already exists
    const existing = await db.select().from(weatherStations).where(eq(weatherStations.name, "Demo Weather Station - Pretoria"));
    
    if (existing.length > 0) {
      console.log("Demo station already exists");
      return existing[0];
    }

    return await generateDemoStation();
  } catch (error) {
    console.error("Error creating demo station:", error);
    throw error;
  }
}
