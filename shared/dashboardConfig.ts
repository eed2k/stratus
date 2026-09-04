// Stratus Weather Server
// Created by Lukas Esterhuizen

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
      },
      {
        id: 'temperature8m',
        name: 'Temperature (8m)',
        category: 'temperature',
        unit: '°C',
        description: 'Air temperature at 8m height for airshed monitoring',
        dataField: 'temperature8m',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'deltaTemperature',
        name: 'Delta Temperature',
        category: 'temperature',
        unit: '°C',
        description: 'Temperature differential between measurement heights (atmospheric stability)',
        dataField: 'deltaTemperature',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
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
        unit: 'm/s',
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
        unit: 'm/s',
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
        unit: 'm/s',
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
  },
  {
    id: 'water',
    name: 'Water & Sensors',
    icon: 'droplets',
    parameters: [
      {
        id: 'waterLevel',
        name: 'Water Level',
        category: 'water',
        unit: 'm',
        description: 'Water level measurement',
        dataField: 'waterLevel',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'temperatureSwitch',
        name: 'Temperature Switch',
        category: 'water',
        unit: '°C',
        description: 'Temperature switch sensor reading',
        dataField: 'temperatureSwitch',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'levelSwitch',
        name: 'Level Switch',
        category: 'water',
        unit: '',
        description: 'Level switch on/off status',
        dataField: 'levelSwitch',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'temperatureSwitchOutlet',
        name: 'Temp Switch Outlet',
        category: 'water',
        unit: '°C',
        description: 'Temperature switch outlet reading',
        dataField: 'temperatureSwitchOutlet',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'levelSwitchStatus',
        name: 'Level Switch Status',
        category: 'water',
        unit: '',
        description: 'Level switch status flag',
        dataField: 'levelSwitchStatus',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'lightning',
        name: 'Lightning',
        category: 'water',
        unit: 'strikes',
        description: 'Lightning strike count',
        dataField: 'lightning',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'lightningDistance',
        name: 'Lightning Distance',
        category: 'water',
        unit: 'km',
        description: 'Distance to lightning strike',
        dataField: 'lightningDistance',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'lightningEnergy',
        name: 'Lightning Intensity',
        category: 'water',
        unit: '',
        // The AS3935 register has no physical unit, so this is comparative only.
        description: 'Relative strike intensity from the AS3935 sensor (no physical unit)',
        dataField: 'lightningEnergy',
        chartType: 'bar',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'chargerVoltage',
        name: 'Charger Voltage',
        category: 'water',
        unit: 'V',
        description: 'Solar charger voltage',
        dataField: 'chargerVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      }
    ]
  },
  {
    id: 'mppt',
    name: 'MPPT Solar Charger',
    icon: 'battery-charging',
    parameters: [
      {
        id: 'mpptSolarVoltage',
        name: 'Solar Voltage',
        category: 'mppt',
        unit: 'V',
        description: 'MPPT solar panel input voltage',
        dataField: 'mpptSolarVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'mpptSolarCurrent',
        name: 'Solar Current',
        category: 'mppt',
        unit: 'mA',
        description: 'MPPT solar panel input current',
        dataField: 'mpptSolarCurrent',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'mpptSolarPower',
        name: 'Solar Power',
        category: 'mppt',
        unit: 'W',
        description: 'MPPT solar power output',
        dataField: 'mpptSolarPower',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'mpptLoadVoltage',
        name: 'Load Voltage',
        category: 'mppt',
        unit: 'V',
        description: 'MPPT load output voltage',
        dataField: 'mpptLoadVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'mpptLoadCurrent',
        name: 'Load Current',
        category: 'mppt',
        unit: 'mA',
        description: 'MPPT load output current',
        dataField: 'mpptLoadCurrent',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'mpptBatteryVoltage',
        name: 'Battery Voltage',
        category: 'mppt',
        unit: 'V',
        description: 'MPPT battery voltage',
        dataField: 'mpptBatteryVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'mpptChargerState',
        name: 'Charger State',
        category: 'mppt',
        unit: '',
        description: 'MPPT charger operating state (0=Off, 1=Bulk, 2=Absorption, 3=Float)',
        dataField: 'mpptChargerState',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'mpptAbsiAvg',
        name: 'MPPT Current (Avg)',
        category: 'mppt',
        unit: 'mA',
        description: 'Average absolute current through MPPT controller',
        dataField: 'mpptAbsiAvg',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'mpptBoardTemp',
        name: 'Board Temp',
        category: 'mppt',
        unit: '°C',
        description: 'MPPT controller board temperature',
        dataField: 'mpptBoardTemp',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'mpptMode',
        name: 'Charger Mode',
        category: 'mppt',
        unit: '',
        description: 'MPPT charger operating mode',
        dataField: 'mpptMode',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      }
    ]
  },
  {
    id: 'mppt2',
    name: 'MPPT Charger 2',
    icon: 'battery-charging',
    parameters: [
      {
        id: 'mppt2SolarVoltage',
        name: 'Solar Voltage',
        category: 'mppt2',
        unit: 'V',
        description: 'Charger 2 solar panel input voltage',
        dataField: 'mppt2SolarVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'mppt2SolarCurrent',
        name: 'Solar Current',
        category: 'mppt2',
        unit: 'mA',
        description: 'Charger 2 solar panel input current',
        dataField: 'mppt2SolarCurrent',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'mppt2SolarPower',
        name: 'Solar Power',
        category: 'mppt2',
        unit: 'W',
        description: 'Charger 2 solar power output',
        dataField: 'mppt2SolarPower',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'mppt2LoadVoltage',
        name: 'Load Voltage',
        category: 'mppt2',
        unit: 'V',
        description: 'Charger 2 load output voltage',
        dataField: 'mppt2LoadVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'mppt2LoadCurrent',
        name: 'Load Current',
        category: 'mppt2',
        unit: 'mA',
        description: 'Charger 2 load output current',
        dataField: 'mppt2LoadCurrent',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'mppt2BatteryVoltage',
        name: 'Battery Voltage',
        category: 'mppt2',
        unit: 'V',
        description: 'Charger 2 battery voltage',
        dataField: 'mppt2BatteryVoltage',
        chartType: 'line',
        defaultEnabled: true,
        precision: 2
      },
      {
        id: 'mppt2ChargerState',
        name: 'Charger State',
        category: 'mppt2',
        unit: '',
        description: 'Charger 2 operating state (0=Off, 1=Bulk, 2=Absorption, 3=Float)',
        dataField: 'mppt2ChargerState',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
      },
      {
        id: 'mppt2BoardTemp',
        name: 'Board Temp',
        category: 'mppt2',
        unit: '°C',
        description: 'Charger 2 board temperature',
        dataField: 'mppt2BoardTemp',
        chartType: 'line',
        defaultEnabled: true,
        precision: 1
      },
      {
        id: 'mppt2Mode',
        name: 'Charger Mode',
        category: 'mppt2',
        unit: '',
        description: 'Charger 2 operating mode',
        dataField: 'mppt2Mode',
        chartType: 'line',
        defaultEnabled: true,
        precision: 0
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
export interface SectionVisibility {
  primaryMetrics: boolean;
  barometricPressure: boolean;
  rainfall: boolean;
  historicalCharts: boolean;
  solarEtCards: boolean;
  waterSensors: boolean;
  windAnalysis: boolean;
  windEnergy: boolean;
  solarRadiation: boolean;
  solarPosition: boolean;
  soilEnvironment: boolean;
  fireDanger: boolean;
  visibilityClouds: boolean;
  loggerBattery: boolean;
  mpptCharger: boolean;
  airQuality: boolean;
  atmosphericStability: boolean;
  lightning: boolean;
  aviation: boolean;
}

export const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  primaryMetrics: true,
  barometricPressure: true,
  rainfall: true,
  historicalCharts: true,
  solarEtCards: true,
  waterSensors: true,
  windAnalysis: true,
  windEnergy: true,
  solarRadiation: true,
  solarPosition: true,
  soilEnvironment: true,
  fireDanger: true,
  visibilityClouds: true,
  loggerBattery: true,
  mpptCharger: true,
  airQuality: true,
  atmosphericStability: true,
  lightning: true,
  aviation: true,
};

export interface DashboardConfig {
  enabledParameters: string[];
  updatePeriod: number; // in seconds
  chartTimeRange: number; // in hours
  showTrendCharts: boolean;
  showWindRose: boolean;
  compactMode: boolean;
  sectionVisibility: SectionVisibility;
  /**
   * Which time-range buttons the dashboard offers, in hours.
   *
   * Omit it (the normal case) and every range in ALL_CHART_TIME_RANGES is
   * offered. Set it to restrict a station to a subset, which is what a
   * demonstration station wants: a fixed record has no point offering ranges
   * that fall outside it. Values not present in ALL_CHART_TIME_RANGES are
   * ignored, and an empty or fully invalid list falls back to the full set so a
   * bad config can never leave a dashboard with no way to pick a range.
   */
  allowedChartTimeRanges?: number[];
}

/**
 * Every selectable chart window, in hours. Single source of truth for both the
 * range buttons on the dashboard and the dropdown in the configuration panel,
 * which previously each carried their own copy of this list.
 */
export const ALL_CHART_TIME_RANGES: readonly number[] = [1, 6, 12, 24, 48, 168, 720];

/** Short label for a range, e.g. 1 -> "1h", 168 -> "7d". */
export function chartTimeRangeLabel(hours: number): string {
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
}

/**
 * Resolve the ranges a dashboard should offer.
 *
 * Falls back to the full set when the config says nothing useful, so a station
 * can never end up with an empty range selector.
 */
export function resolveChartTimeRanges(
  allowed?: number[] | null,
): number[] {
  if (!Array.isArray(allowed)) return [...ALL_CHART_TIME_RANGES];
  const valid = ALL_CHART_TIME_RANGES.filter((h) => allowed.includes(h));
  return valid.length > 0 ? valid : [...ALL_CHART_TIME_RANGES];
}

/**
 * Pick a sensible initial range from those on offer: the preferred value when
 * it is available, otherwise the closest one, so a restricted station does not
 * start on a range it cannot show.
 */
export function defaultChartTimeRange(
  allowed?: number[] | null,
  preferred = 24,
): number {
  const ranges = resolveChartTimeRanges(allowed);
  if (ranges.includes(preferred)) return preferred;
  return ranges.reduce(
    (best, h) => (Math.abs(h - preferred) < Math.abs(best - preferred) ? h : best),
    ranges[0],
  );
}

// Get all parameter IDs for full demo experience
function getAllParameterIds(): string[] {
  return DASHBOARD_CATEGORIES.flatMap(cat => cat.parameters.map(p => p.id));
}

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  // Enable ALL 43 parameters by default for demo dashboard
  enabledParameters: getAllParameterIds(),
  updatePeriod: 3600, // 1 hour - matches Dropbox sync interval
  chartTimeRange: 24,
  showTrendCharts: true,
  showWindRose: true,
  compactMode: false,
  sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY },
};

/**
 * Parameters added to the catalog after dashboards were already being saved.
 *
 * A saved dashboard config stores an explicit `enabledParameters` list, so any
 * parameter added later would be treated as "switched off" and silently vanish
 * for existing stations. Fields listed here stay visible when the data is
 * present unless the user explicitly turns them off, which keeps newly
 * supported sensors from being hidden on existing dashboards.
 */
export const LATE_ADDED_PARAMETERS: ReadonlySet<string> = new Set<string>([]);

/**
 * Whether a cataloged parameter should be treated as enabled.
 * `enabledParameters` may be undefined for dashboards that were never configured.
 */
export function isParameterEnabled(dataField: string, enabledParameters?: string[] | null): boolean {
  if (!Array.isArray(enabledParameters)) return true;
  if (enabledParameters.includes(dataField)) return true;
  return LATE_ADDED_PARAMETERS.has(dataField);
}

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
