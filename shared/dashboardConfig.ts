/**
 * Dashboard Parameter Configuration
 * Defines all available weather parameters that can be displayed on the dashboard
 * Based on Campbell Scientific datalogger capabilities
 */

export interface DashboardParameter {
  id: string;
  name: string;
  category: string;
  unit: string;
  description: string;
  dataField: string;
  chartType?: 'line' | 'bar' | 'gauge' | 'windrose' | 'none';
  defaultEnabled: boolean;
  precision?: number;
}

export interface DashboardCategory {
  id: string;
  name: string;
  icon: string;
  parameters: DashboardParameter[];
}

export const DASHBOARD_CATEGORIES: DashboardCategory[] = [
  {
    id: 'atmospheric',
    name: 'Atmospheric Pressure',
    icon: 'gauge',
    parameters: [
      {
        id: 'pressure',
        name: 'Barometric Pressure',
        category: 'atmospheric',
        unit: 'hPa',
        description: 'Barometric pressure calibrated to sea level',
        dataField: 'pressure',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'pressureSeaLevel',
        name: 'Sea Level Pressure',
        category: 'atmospheric',
        unit: 'hPa',
        description: 'Pressure adjusted to mean sea level',
        dataField: 'pressureSeaLevel',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      }
    ]
  },
  {
    id: 'temperature',
    name: 'Temperature & Humidity',
    icon: 'thermometer',
    parameters: [
      {
        id: 'temperature',
        name: 'Air Temperature',
        category: 'temperature',
        unit: '°C',
        description: 'Current air temperature',
        dataField: 'temperature',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'temperatureMin',
        name: 'Min Temperature',
        category: 'temperature',
        unit: '°C',
        description: 'Minimum temperature for the period',
        dataField: 'temperatureMin',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'temperatureMax',
        name: 'Max Temperature',
        category: 'temperature',
        unit: '°C',
        description: 'Maximum temperature for the period',
        dataField: 'temperatureMax',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'dewPoint',
        name: 'Dew Point',
        category: 'temperature',
        unit: '°C',
        description: 'Dew point temperature derived from air temperature and humidity',
        dataField: 'dewPoint',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'humidity',
        name: 'Relative Humidity',
        category: 'temperature',
        unit: '%',
        description: 'Relative humidity percentage',
        dataField: 'humidity',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'airDensity',
        name: 'Air Density',
        category: 'temperature',
        unit: 'kg/m³',
        description: 'Derived air density from temperature, pressure, and humidity',
        dataField: 'airDensity',
        chartType: 'line',
        defaultEnabled: true,
        precision: 3
      }
    ]
  },
  {
    id: 'wind',
    name: 'Wind',
    icon: 'wind',
    parameters: [
      {
        id: 'windSpeed',
        name: 'Wind Speed (mean)',
        category: 'wind',
        unit: 'km/h',
        description: '10-minute mean wind speed',
        dataField: 'windSpeed',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'windGust',
        name: 'Wind Gust',
        category: 'wind',
        unit: 'km/h',
        description: 'Maximum wind gust speed',
        dataField: 'windGust',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'windGust10min',
        name: 'Wind Gust (10-min)',
        category: 'wind',
        unit: 'km/h',
        description: '10-minute maximum wind gust',
        dataField: 'windGust10min',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'windDirection',
        name: 'Wind Direction',
        category: 'wind',
        unit: '°',
        description: 'Wind direction in degrees (0-360)',
        dataField: 'windDirection',
        chartType: 'windrose',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'windPower',
        name: 'Wind Power',
        category: 'wind',
        unit: 'W/m²',
        description: 'Wind power density',
        dataField: 'windPower',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      }
    ]
  },
  {
    id: 'precipitation',
    name: 'Precipitation',
    icon: 'cloud-rain',
    parameters: [
      {
        id: 'rainfall',
        name: 'Rain Rate',
        category: 'precipitation',
        unit: 'mm/hr',
        description: 'Current rainfall rate',
        dataField: 'rainfall',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'rainfall10min',
        name: 'Rain (10-min)',
        category: 'precipitation',
        unit: 'mm',
        description: 'Rainfall in last 10 minutes',
        dataField: 'rainfall10min',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'rainfall24h',
        name: 'Rain (today)',
        category: 'precipitation',
        unit: 'mm',
        description: 'Total rainfall today',
        dataField: 'rainfall24h',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'rainfall7d',
        name: 'Rain (7-day)',
        category: 'precipitation',
        unit: 'mm',
        description: 'Total rainfall in last 7 days',
        dataField: 'rainfall7d',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'rainfall30d',
        name: 'Rain (30-day)',
        category: 'precipitation',
        unit: 'mm',
        description: 'Total rainfall in last 30 days',
        dataField: 'rainfall30d',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'rainfallYearly',
        name: 'Rain (yearly)',
        category: 'precipitation',
        unit: 'mm',
        description: 'Total rainfall this year',
        dataField: 'rainfallYearly',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 1
      }
    ]
  },
  {
    id: 'solar',
    name: 'Solar & Radiation',
    icon: 'sun',
    parameters: [
      {
        id: 'solarRadiation',
        name: 'Solar Radiation',
        category: 'solar',
        unit: 'W/m²',
        description: 'Solar irradiance/flux',
        dataField: 'solarRadiation',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'solarRadiationMax',
        name: 'Solar Radiation (max)',
        category: 'solar',
        unit: 'W/m²',
        description: 'Maximum solar radiation for the period',
        dataField: 'solarRadiationMax',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'uvIndex',
        name: 'UV Index',
        category: 'solar',
        unit: '',
        description: 'Ultraviolet radiation index',
        dataField: 'uvIndex',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'sunAzimuth',
        name: 'Sun Azimuth',
        category: 'solar',
        unit: '°',
        description: 'Sun azimuth angle',
        dataField: 'sunAzimuth',
        chartType: 'none',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'sunElevation',
        name: 'Sun Elevation',
        category: 'solar',
        unit: '°',
        description: 'Sun elevation angle',
        dataField: 'sunElevation',
        chartType: 'none',
        defaultEnabled: true,
        precision: 1
      }
    ]
  },
  {
    id: 'evapotranspiration',
    name: 'Evapotranspiration & Irrigation',
    icon: 'droplets',
    parameters: [
      {
        id: 'eto',
        name: 'Reference ET (ETₒ)',
        category: 'evapotranspiration',
        unit: 'mm',
        description: 'Reference evapotranspiration',
        dataField: 'eto',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'eto24h',
        name: 'ET (today)',
        category: 'evapotranspiration',
        unit: 'mm',
        description: 'Total evapotranspiration today',
        dataField: 'eto24h',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'eto7d',
        name: 'ET (7-day)',
        category: 'evapotranspiration',
        unit: 'mm',
        description: 'Total evapotranspiration in last 7 days',
        dataField: 'eto7d',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'eto30d',
        name: 'ET (30-day)',
        category: 'evapotranspiration',
        unit: 'mm',
        description: 'Total evapotranspiration in last 30 days',
        dataField: 'eto30d',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 1
      }
    ]
  },
  {
    id: 'soil',
    name: 'Soil Conditions',
    icon: 'layers',
    parameters: [
      {
        id: 'soilTemperature',
        name: 'Soil Temperature',
        category: 'soil',
        unit: '°C',
        description: 'Soil temperature at sensor depth',
        dataField: 'soilTemperature',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'soilMoisture',
        name: 'Soil Moisture',
        category: 'soil',
        unit: '%',
        description: 'Volumetric soil moisture content',
        dataField: 'soilMoisture',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'leafWetness',
        name: 'Leaf Wetness',
        category: 'soil',
        unit: '',
        description: 'Leaf wetness sensor reading',
        dataField: 'leafWetness',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      }
    ]
  },
  {
    id: 'airquality',
    name: 'Air Quality',
    icon: 'wind',
    parameters: [
      {
        id: 'pm25',
        name: 'PM2.5',
        category: 'airquality',
        unit: 'µg/m³',
        description: 'Particulate matter 2.5 microns',
        dataField: 'pm25',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'pm10',
        name: 'PM10',
        category: 'airquality',
        unit: 'µg/m³',
        description: 'Particulate matter 10 microns',
        dataField: 'pm10',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'pm1',
        name: 'PM1.0',
        category: 'airquality',
        unit: 'µg/m³',
        description: 'Particulate matter 1 micron',
        dataField: 'pm1',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'aqi',
        name: 'Air Quality Index',
        category: 'airquality',
        unit: '',
        description: 'Calculated air quality index',
        dataField: 'aqi',
        chartType: 'gauge',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'co2',
        name: 'CO₂',
        category: 'airquality',
        unit: 'ppm',
        description: 'Carbon dioxide concentration',
        dataField: 'co2',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'tvoc',
        name: 'TVOC',
        category: 'airquality',
        unit: 'ppb',
        description: 'Total volatile organic compounds',
        dataField: 'tvoc',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      }
    ]
  },
  {
    id: 'visibility',
    name: 'Visibility & Clouds',
    icon: 'eye',
    parameters: [
      {
        id: 'visibility',
        name: 'Visibility',
        category: 'visibility',
        unit: 'km',
        description: 'Meteorological visibility',
        dataField: 'visibility',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'atmosphericVisibility',
        name: 'Atmospheric Visibility',
        category: 'visibility',
        unit: 'km',
        description: 'Atmospheric visibility range',
        dataField: 'atmosphericVisibility',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'cloudBase',
        name: 'Cloud Base',
        category: 'visibility',
        unit: 'm',
        description: 'Cloud base height',
        dataField: 'cloudBase',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'cloudCover',
        name: 'Cloud Cover',
        category: 'visibility',
        unit: '%',
        description: 'Cloud cover percentage',
        dataField: 'cloudCover',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      }
    ]
  },
  {
    id: 'system',
    name: 'System & Logger',
    icon: 'cpu',
    parameters: [
      {
        id: 'batteryVoltage',
        name: 'Logger Battery',
        category: 'system',
        unit: 'V',
        description: 'Datalogger battery voltage',
        dataField: 'batteryVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'panelTemperature',
        name: 'Panel Temperature',
        category: 'system',
        unit: '°C',
        description: 'Datalogger panel temperature',
        dataField: 'panelTemperature',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      }
    ]
  }
];

// Update period options in seconds
export const UPDATE_PERIOD_OPTIONS = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' }
];

// Default dashboard configuration - ALL parameters enabled for demo
export interface DashboardConfig {
  enabledParameters: string[];
  updatePeriod: number; // in seconds
  chartTimeRange: number; // in hours
  showTrendCharts: boolean;
  showWindRose: boolean;
  compactMode: boolean;
}

// Get all parameter IDs for full demo experience
function getAllParameterIds(): string[] {
  return DASHBOARD_CATEGORIES.flatMap(cat => cat.parameters.map(p => p.id));
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  // Enable ALL 43 parameters by default for demo dashboard
  enabledParameters: getAllParameterIds(),
  updatePeriod: 60,
  chartTimeRange: 24,
  showTrendCharts: true,
  showWindRose: true,
  compactMode: false
};

// Helper to get all parameters as flat array
export function getAllParameters(): DashboardParameter[] {
  return DASHBOARD_CATEGORIES.flatMap(cat => cat.parameters);
}

// Helper to get parameter by ID
export function getParameterById(id: string): DashboardParameter | undefined {
  return getAllParameters().find(p => p.id === id);
}

// Helper to get parameters by category
export function getParametersByCategory(categoryId: string): DashboardParameter[] {
  const category = DASHBOARD_CATEGORIES.find(c => c.id === categoryId);
  return category?.parameters || [];
}
