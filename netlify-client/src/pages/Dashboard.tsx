import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { api, RealtimeConnection } from '../lib/api';
import {
  Cloud,
  Thermometer,
  Droplets,
  Wind,
  Gauge,
  Sun,
  CloudRain,
  LogOut,
  Download,
  RefreshCw,
  MapPin,
  Activity,
  Flame,
  const chartData = useMemo(() => {
    if (!showChart) return [];
    if (sparklineData && sparklineData.length > 0) return sparklineData;
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    const data = [];
    const variation = numValue * 0.1 || 5;
    for (let i = 0; i < 12; i++) {
      data.push(numValue + (Math.random() - 0.5) * variation);
    }
    return data;
  }, [sparklineData, value, showChart]);
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  BarChart,
  Bar,
} from 'recharts';
import jsPDF from 'jspdf';

interface WeatherData {
  timestamp: string;
  data: Record<string, number | string | null>;
}

interface StationInfo {
  id: number;
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  isActive: boolean;
}

// ========================
// CALCULATION UTILITIES
// ========================

/**
 * Calculate solar position based on latitude, longitude, and time
 */
function calculateSolarPosition(lat: number, lon: number, date: Date = new Date()) {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const hour = date.getHours() + date.getMinutes() / 60;
  
  // Solar declination
  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
  
  // Hour angle
  const solarNoon = 12 - lon / 15;
  const hourAngle = 15 * (hour - solarNoon);
  
  // Solar elevation
  const latRad = lat * Math.PI / 180;
  const decRad = declination * Math.PI / 180;
  const haRad = hourAngle * Math.PI / 180;
  
  const elevation = Math.asin(
    Math.sin(latRad) * Math.sin(decRad) + 
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad)
  ) * 180 / Math.PI;
  
  // Solar azimuth
  const azimuth = Math.atan2(
    Math.sin(haRad),
    Math.cos(haRad) * Math.sin(latRad) - Math.tan(decRad) * Math.cos(latRad)
  ) * 180 / Math.PI + 180;
  
  // Sunrise/sunset calculations
  const cosHA = -Math.tan(latRad) * Math.tan(decRad);
  const haRise = Math.acos(Math.max(-1, Math.min(1, cosHA))) * 180 / Math.PI;
  const sunriseHour = 12 - haRise / 15 - lon / 15 + date.getTimezoneOffset() / 60;
  const sunsetHour = 12 + haRise / 15 - lon / 15 + date.getTimezoneOffset() / 60;
  
  const sunrise = new Date(date);
  sunrise.setHours(Math.floor(sunriseHour), (sunriseHour % 1) * 60, 0);
  
  const sunset = new Date(date);
  sunset.setHours(Math.floor(sunsetHour), (sunsetHour % 1) * 60, 0);
  
  const solarNoonTime = new Date(date);
  solarNoonTime.setHours(12 - lon / 15 + date.getTimezoneOffset() / 60);
  
  return {
    elevation: Math.max(-90, elevation),
    azimuth: (azimuth + 360) % 360,
    sunrise,
    sunset,
    solarNoon: solarNoonTime,
    dayLength: (sunsetHour - sunriseHour) * 60,
  };
}

/**
 * Calculate air density from temperature, pressure, and humidity
 */
function calculateAirDensity(temp: number, pressure: number, humidity: number): number {
  const Rd = 287.05;  // Gas constant for dry air J/(kg·K)
  const Rv = 461.495; // Gas constant for water vapor J/(kg·K)
  const T = temp + 273.15; // Convert to Kelvin
  const P = pressure * 100; // Convert hPa to Pa
  
  // Saturation vapor pressure (Magnus formula)
  const es = 611.21 * Math.exp((17.502 * temp) / (240.97 + temp));
  const e = (humidity / 100) * es;
  
  // Air density using virtual temperature
  const Tv = T / (1 - (e / P) * (1 - Rd / Rv));
  return P / (Rd * Tv);
}

/**
 * Calculate sea level pressure from station pressure
 */
function calculateSeaLevelPressure(stationPressure: number, altitude: number, temp: number): number {
  const L = 0.0065; // Temperature lapse rate K/m
  const T = temp + 273.15;
  const g = 9.80665; // Gravity m/s²
  const M = 0.0289644; // Molar mass of air kg/mol
  const R = 8.31447; // Gas constant J/(mol·K)
  
  return stationPressure * Math.pow((1 - (L * altitude) / T), -(g * M) / (R * L));
}

/**
 * Calculate McArthur Forest Fire Danger Index
 */
function calculateFireDanger(temp: number, humidity: number, windSpeed: number) {
  // FFDI = 2 * exp(-0.45 + 0.987 * ln(DF) - 0.0345 * RH + 0.0338 * T + 0.0234 * V)
  // Using simplified drought factor of 10 for demo
  const DF = 10;
  const V = windSpeed; // km/h
  
  const ffdi = 2 * Math.exp(
    -0.45 + 
    0.987 * Math.log(DF) - 
    0.0345 * humidity + 
    0.0338 * temp + 
    0.0234 * V
  );
  
  // Grassland Fire Danger Index (Mark 5)
  const gfdi = Math.pow(temp / 25, 1.3) * Math.pow((100 - humidity) / 50, 1.2) * Math.pow(windSpeed / 25, 0.5) * 10;
  
  // Determine danger level
  let level: string, color: string;
  if (ffdi < 12) { level = 'Low-Moderate'; color = '#22c55e'; }
  else if (ffdi < 25) { level = 'High'; color = '#eab308'; }
  else if (ffdi < 50) { level = 'Very High'; color = '#f97316'; }
  else if (ffdi < 75) { level = 'Severe'; color = '#ef4444'; }
  else if (ffdi < 100) { level = 'Extreme'; color = '#dc2626'; }
  else { level = 'Catastrophic'; color = '#7f1d1d'; }
  
  return { ffdi, gfdi, level, color };
}

/**
 * Calculate wind power density (W/m²)
 */
function calculateWindPower(windSpeed: number, airDensity: number = 1.225): number {
  const v = windSpeed / 3.6; // Convert km/h to m/s
  return 0.5 * airDensity * Math.pow(v, 3);
}

/**
 * Get wind direction cardinal name
 */
function getWindDirectionName(degrees: number): string {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(((degrees % 360) / 22.5)) % 16;
  return directions[index];
}

/**
 * Calculate Reference Evapotranspiration (ETo) - Simplified Penman-Monteith
 */
function calculateETo(temp: number, humidity: number, windSpeed: number, solarRadiation: number): number {
  // Simplified calculation for demo purposes
  const gamma = 0.067; // Psychrometric constant
  const delta = 4098 * (0.6108 * Math.exp((17.27 * temp) / (temp + 237.3))) / Math.pow(temp + 237.3, 2);
  const es = 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3));
  const ea = es * (humidity / 100);
  const u2 = windSpeed / 3.6; // m/s at 2m height
  const Rn = solarRadiation * 0.0036; // MJ/m²/day approximation
  
  const eto = (0.408 * delta * Rn + gamma * (900 / (temp + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2));
  return Math.max(0, eto);
}

// ========================
// CHART DATA GENERATORS
// ========================

function generateChartData(hours: number) {
  const data = [];
  const now = new Date();
  for (let i = hours; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hourOfDay = time.getHours();
    data.push({
      time: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      timestamp: time.toISOString(),
      temperature: 22 + Math.sin((hourOfDay - 6) * Math.PI / 12) * 8 + (Math.random() - 0.5) * 2,
      humidity: 55 + Math.cos((hourOfDay - 6) * Math.PI / 12) * 20 + (Math.random() - 0.5) * 5,
      pressure: 865 + Math.sin(i / 12) * 3 + (Math.random() - 0.5),
      windSpeed: 8 + Math.random() * 12,
      windGust: 15 + Math.random() * 15,
      windDirection: 45 + (Math.random() - 0.5) * 40,
      solar: hourOfDay > 5 && hourOfDay < 19 ? Math.sin((hourOfDay - 5) * Math.PI / 14) * 950 + Math.random() * 50 : 0,
      rain: Math.random() > 0.92 ? Math.random() * 3 : 0,
    });
  }
  return data;
}

function generateWindRoseData() {
  const data = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    dirName: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][i],
    speed: Math.random() * 20 + 5,
    frequency: Math.random() * 15 + 2,
  }));
  // Bias toward NE (Potchefstroom prevailing wind)
  data[2].frequency = 18;
  data[2].speed = 14;
  data[3].frequency = 15;
  data[3].speed = 12;
  return data;
}

// ========================
// COMPONENTS
// ========================

function MetricCard({ icon, label, value, unit, trend, subMetrics, color = 'primary' }: { 
  title,
  value,
  unit,
  trend,
  subMetrics,
  sparklineData,
  isFaulty = false,
  chartColor = "#3b82f6",
  showChart = true,
}) {
  // Generate sparkline data if showing chart and not provided
  const chartData = useMemo(() => {
    if (!showChart) return [];
    if (sparklineData && sparklineData.length > 0) return sparklineData;
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    const data = [];
    const variation = numValue * 0.1 || 5;
    for (let i = 0; i < 12; i++) {
      data.push(numValue + (Math.random() - 0.5) * variation);
    }
    return data;
  }, [sparklineData, value, showChart]);

  if (isFaulty) {
    return (
      <div className="bg-yellow-500 border-yellow-400 rounded-xl p-4 shadow-sm border hover:shadow-md transition-shadow">
        <div className="pb-2">
          <div className="text-sm font-normal text-white" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{title}</div>
        </div>
        <div className="flex items-center justify-center py-4">
          <span className="text-xl font-normal text-white">SENSOR FAULTY</span>
        </div>
      </div>
    );
  }

  return (
    <div className="hover-elevate transition-shadow duration-200 border border-gray-300 bg-white rounded-xl p-4 shadow-sm">
      <div className="pb-2">
        <div className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{title}</div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-normal tracking-tight text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{value}</span>
        <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{unit}</span>
      </div>
      {trend && (
        <p className={`mt-1 text-xs font-normal ${trend.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          {trend.value >= 0 ? '+' : ''}{trend.value} {trend.label}
        </p>
      )}
      {showChart && chartData.length > 0 && (
        <div className="mt-3 h-12 flex items-end gap-0.5">
          {chartData.map((val, i) => {
            const max = Math.max(...chartData);
            const min = Math.min(...chartData);
            const range = max - min || 1;
            const height = ((val - min) / range) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{ height: `${Math.max(height, 5)}%`, backgroundColor: chartColor }}
              />
            );
          })}
        </div>
      )}
      {subMetrics && subMetrics.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-300 pt-3">
          {subMetrics.map((sub, i) => (
            <div key={i} className="text-xs" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <span className="font-normal text-black">{sub.label}: </span>
              <span className="font-normal text-black">{sub.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WindCompass({ direction, speed, gust }: { direction: number; speed: number; gust?: number }) {
  const directionName = getWindDirectionName(direction);
  
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-base font-semibold text-gray-900 mb-4">Wind Compass</h3>
      <div className="relative w-48 h-48 mx-auto">
        {/* Compass background */}
        <div className="absolute inset-0 rounded-full border-4 border-gray-200 bg-gradient-to-br from-blue-50 to-teal-50">
          {/* Cardinal directions */}
          {['N', 'E', 'S', 'W'].map((dir, i) => (
            <div
              key={dir}
              className="absolute text-sm font-bold text-gray-600"
              style={{
                top: i === 0 ? '4px' : i === 2 ? 'auto' : '50%',
                bottom: i === 2 ? '4px' : 'auto',
                left: i === 3 ? '8px' : i === 1 ? 'auto' : '50%',
                right: i === 1 ? '8px' : 'auto',
                transform: i === 0 || i === 2 ? 'translateX(-50%)' : 'translateY(-50%)',
              }}
            >
              {dir}
            </div>
          ))}
          {/* Wind arrow */}
          <div
            className="absolute inset-4 flex items-center justify-center"
            style={{ transform: `rotate(${direction}deg)` }}
          >
            <div className="w-1 h-16 bg-gradient-to-t from-teal-500 to-teal-300 rounded-full origin-bottom transform -translate-y-4">
              <div className="w-3 h-3 bg-teal-500 transform rotate-45 -translate-x-1 -translate-y-1"></div>
            </div>
          </div>
        </div>
      </div>
      <div className="text-center mt-4 space-y-1">
        <div className="text-2xl font-bold text-gray-900">{direction.toFixed(0)}° {directionName}</div>
        <div className="text-lg text-teal-600">{speed.toFixed(1)} km/h</div>
        {gust && <div className="text-sm text-orange-500">Gust: {gust.toFixed(1)} km/h</div>}
      </div>
    </div>
  );
}

function SolarPositionCard({ solarPosition, currentRadiation }: { 
  solarPosition: ReturnType<typeof calculateSolarPosition>; 
  currentRadiation: number;
}) {
  const formatTime = (date: Date) => date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Sun className="h-5 w-5 text-yellow-500" />
        Solar Position
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Elevation</div>
          <div className="text-lg font-semibold">{solarPosition.elevation.toFixed(1)}°</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Azimuth</div>
          <div className="text-lg font-semibold">{solarPosition.azimuth.toFixed(1)}°</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1"><Sunrise className="h-3 w-3" /> Sunrise</div>
          <div className="text-sm font-medium">{formatTime(solarPosition.sunrise)}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500 flex items-center gap-1"><Sunset className="h-3 w-3" /> Sunset</div>
          <div className="text-sm font-medium">{formatTime(solarPosition.sunset)}</div>
        </div>
        <div className="col-span-2 space-y-1">
          <div className="text-xs text-gray-500">Day Length</div>
          <div className="text-sm font-medium">
            {Math.floor(solarPosition.dayLength / 60)}h {Math.round(solarPosition.dayLength % 60)}m
          </div>
        </div>
        <div className="col-span-2 space-y-1">
          <div className="text-xs text-gray-500">Current Radiation</div>
          <div className="text-lg font-semibold text-yellow-600">{currentRadiation.toFixed(0)} W/m²</div>
        </div>
      </div>
    </div>
  );
}

function FireDangerCard({ temp, humidity, windSpeed }: { temp: number; humidity: number; windSpeed: number }) {
  const fireDanger = calculateFireDanger(temp, humidity, windSpeed);
  
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Flame className="h-5 w-5 text-orange-500" />
        Fire Danger Index
      </h3>
      <div className="text-center mb-4">
        <div 
          className="text-4xl font-bold mb-1" 
          style={{ color: fireDanger.color }}
        >
          {fireDanger.ffdi.toFixed(1)}
        </div>
        <div 
          className="text-sm font-semibold px-3 py-1 rounded-full inline-block"
          style={{ backgroundColor: fireDanger.color + '20', color: fireDanger.color }}
        >
          {fireDanger.level}
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Forest FDI (FFDI)</span>
          <span className="font-medium">{fireDanger.ffdi.toFixed(1)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Grassland FDI</span>
          <span className="font-medium">{fireDanger.gfdi.toFixed(1)}</span>
        </div>
      </div>
      <div className="mt-4 pt-4 border-t border-gray-100">
        {/* Fire danger scale */}
        <div className="flex h-2 rounded-full overflow-hidden">
          <div className="flex-1 bg-green-500" title="Low"></div>
          <div className="flex-1 bg-yellow-500" title="High"></div>
          <div className="flex-1 bg-orange-500" title="Very High"></div>
          <div className="flex-1 bg-red-500" title="Severe"></div>
          <div className="flex-1 bg-red-700" title="Extreme"></div>
          <div className="flex-1 bg-red-900" title="Catastrophic"></div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>Low</span>
          <span>Catastrophic</span>
        </div>
      </div>
    </div>
  );
}

function WindEnergyCard({ windSpeed, airDensity }: { windSpeed: number; airDensity: number }) {
  const power = calculateWindPower(windSpeed, airDensity);
  
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Zap className="h-5 w-5 text-teal-500" />
        Wind Energy Potential
      </h3>
      <div className="text-center mb-4">
        <div className="text-3xl font-bold text-teal-600">{power.toFixed(1)}</div>
        <div className="text-sm text-gray-500">W/m² power density</div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Wind Speed</span>
          <span className="font-medium">{windSpeed.toFixed(1)} km/h</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Air Density</span>
          <span className="font-medium">{airDensity.toFixed(3)} kg/m³</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Beaufort Scale</span>
          <span className="font-medium">
            {windSpeed < 1 ? '0 - Calm' : 
             windSpeed < 6 ? '1 - Light Air' : 
             windSpeed < 12 ? '2 - Light Breeze' : 
             windSpeed < 20 ? '3 - Gentle Breeze' : 
             windSpeed < 29 ? '4 - Moderate Breeze' : '5+ - Fresh Breeze'}
          </span>
        </div>
      </div>
    </div>
  );
}

function AirDensityCard({ airDensity, temp, pressure, humidity }: { 
  airDensity: number; 
  temp: number; 
  pressure: number; 
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Solar Position</h3>
        <Wind className="h-5 w-5 text-blue-500" />
        Air Density
      </h3>
      <div className="text-center mb-4">
        <div className="text-3xl font-bold text-blue-600">{airDensity.toFixed(4)}</div>
        <div className="text-sm text-gray-500">kg/m³</div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Temperature</span>
          <span className="font-medium">{temp.toFixed(1)}°C</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Pressure</span>
          <span className="font-medium">{pressure.toFixed(1)} hPa</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Humidity</span>
          <span className="font-medium">{humidity.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

function EToCard({ eto }: { eto: number }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Leaf className="h-5 w-5 text-green-500" />
        Evapotranspiration (ETo)
      </h3>
      <div className="text-center mb-4">
        <div className="text-3xl font-bold text-green-600">{eto.toFixed(2)}</div>
        <div className="text-sm text-gray-500">mm/day</div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Weekly Est.</span>
          <span className="font-medium">{(eto * 7).toFixed(1)} mm</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Monthly Est.</span>
          <span className="font-medium">{(eto * 30).toFixed(1)} mm</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Irrigation Need</span>
          <span className="font-medium">{eto > 5 ? 'High' : eto > 3 ? 'Moderate' : 'Low'}</span>
        </div>
      </div>
    </div>
  );
}

function StationInfoCard({ station }: { station: StationInfo }) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Info className="h-5 w-5 text-gray-500" />
        Station Information
      </h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Station Name</div>
          <div className="font-medium">{station.name}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Location</div>
          <div className="font-medium">{station.location || 'Not set'}</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Latitude</div>
          <div className="font-medium">{station.latitude?.toFixed(6) || 'Not set'}°</div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Longitude</div>
          <div className="font-medium">{station.longitude?.toFixed(6) || 'Not set'}°</div>
        </div>
        <div className="space-y-1 col-span-2">
          <div className="text-xs text-gray-500">Altitude</div>
          <div className="font-medium">{station.altitude ? `${station.altitude} m` : 'Not set'}</div>
        </div>
      </div>
    </div>
  );
}

// ========================
// MAIN DASHBOARD
// ========================

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [realtimeData, setRealtimeData] = useState<WeatherData | null>(null);

  // Fetch station info
  const { data: station } = useQuery({
    queryKey: ['station'],
    queryFn: () => api.getStation(),
  });

  // Fetch latest data
  const { data: latestData, refetch: refetchLatest } = useQuery({
    queryKey: ['latestData'],
    queryFn: () => api.getLatestData(),
    refetchInterval: 60000,
  });

  // Fetch historical data for charts
  const { data: historicalData } = useQuery({
    queryKey: ['historicalData'],
    queryFn: () => api.getHistoricalData(24),
    refetchInterval: 300000,
  });

  // Setup realtime connection
  useEffect(() => {
    const connection = new RealtimeConnection();
    connection.connect();
    
    const unsubscribe = connection.onData((data) => {
      setRealtimeData(data);
    });

    return () => {
      unsubscribe();
      connection.disconnect();
    };
  }, []);

  // Use realtime data if available, otherwise latest from API, with demo fallback
  const currentData = realtimeData || latestData;
  const values = currentData?.data || {};

  // Demo default values for Potchefstroom (when no data)
  const demoValues = {
    temperature: 26.4,
    humidity: 52,
    pressure: 865.2,
    windSpeed: 14.5,
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Fire Danger Index</h3>
    uvIndex: 9.8,
    batteryVoltage: 13.1,
    soilTemperature: 22.5,
    soilMoisture: 28.4,
    pm25: 11.2,
    pm10: 22.8,
  };

  // Get value with demo fallback
  const getValue = (key: string, decimals: number = 1): number => {
    const val = values[key];
    if (val !== null && val !== undefined) {
      const num = typeof val === 'number' ? val : parseFloat(String(val));
      if (!isNaN(num)) return num;
    }
    return (demoValues as any)[key] || 0;
  };

  const formatValue = (value: any, decimals: number = 1): string => {
    if (value === null || value === undefined) return '--';
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    return isNaN(num) ? '--' : num.toFixed(decimals);
  };

  // Calculate derived values
  const temp = getValue('temperature');
  const humidity = getValue('humidity');
  const pressure = getValue('pressure');
  const windSpeed = getValue('windSpeed');
  const solarRadiation = getValue('solarRadiation');

  // Use station coordinates or Potchefstroom defaults
  const lat = station?.latitude || -26.7145;
  const lon = station?.longitude || 27.0970;
  const altitude = station?.altitude || 1351;

  const solarPosition = useMemo(() => calculateSolarPosition(lat, lon), [lat, lon]);
  const airDensity = useMemo(() => calculateAirDensity(temp, pressure, humidity), [temp, pressure, humidity]);
  const seaLevelPressure = useMemo(() => calculateSeaLevelPressure(pressure, altitude, temp), [pressure, altitude, temp]);
  const eto = useMemo(() => calculateETo(temp, humidity, windSpeed, solarRadiation), [temp, humidity, windSpeed, solarRadiation]);

  // Generate chart data
  const chartData = useMemo(() => {
    if (historicalData && historicalData.length > 0) {
      return historicalData.map((d: WeatherData) => ({
        time: new Date(d.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        temperature: d.data.temperature || 0,
        humidity: d.data.humidity || 0,
        pressure: d.data.pressure || 0,
        windSpeed: d.data.windSpeed || 0,
        solar: d.data.solarRadiation || 0,
        rain: d.data.rainfall || 0,
      })).reverse();
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Wind Energy Potential</h3>

  const handleExportCSV = async () => {
    try {
      const blob = await api.exportCSV();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `weather_data_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export CSV');
    }
  };

  const handleExportPDF = async () => {
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = 210;
      const margin = 20;

      // Header
      pdf.setFontSize(20);
      pdf.setTextColor(30, 41, 59);
      pdf.text(station?.name || 'Weather Station', margin, 25);

        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Air Density</h3>
      pdf.setDrawColor(226, 232, 240);
      pdf.line(margin, 45, pageWidth - margin, 45);

      // Current Conditions
      pdf.setFontSize(14);
      pdf.setTextColor(30, 41, 59);
      pdf.text('Current Conditions', margin, 55);

      const metrics = [
        { label: 'Temperature', value: `${formatValue(getValue('temperature'))} °C` },
        { label: 'Humidity', value: `${formatValue(getValue('humidity'))} %` },
        { label: 'Pressure', value: `${formatValue(getValue('pressure'))} hPa` },
        { label: 'Sea Level Pressure', value: `${formatValue(seaLevelPressure)} hPa` },
        { label: 'Wind Speed', value: `${formatValue(getValue('windSpeed'))} km/h` },
        { label: 'Wind Direction', value: `${formatValue(getValue('windDirection'), 0)}° ${getWindDirectionName(getValue('windDirection'))}` },
        { label: 'Solar Radiation', value: `${formatValue(getValue('solarRadiation'))} W/m²` },
        { label: 'UV Index', value: formatValue(getValue('uvIndex')) },
        { label: 'Rainfall', value: `${formatValue(getValue('rainfall'))} mm` },
        { label: 'Air Density', value: `${formatValue(airDensity, 4)} kg/m³` },
        { label: 'Reference ETo', value: `${formatValue(eto, 2)} mm/day` },
        { label: 'Fire Danger Index', value: `${formatValue(calculateFireDanger(temp, humidity, windSpeed).ffdi)}` },
      ];
        <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Evapotranspiration (ETo)</h3>
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = margin + col * 85;
        const yPos = y + row * 12;

        pdf.setTextColor(100, 116, 139);
        pdf.text(metric.label, x, yPos);
        pdf.setTextColor(30, 41, 59);
        pdf.text(metric.value, x + 50, yPos);
      });

      // Solar Position
      pdf.setFontSize(14);
      pdf.text('Solar Position', margin, y + 85);
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.text(`Elevation: ${solarPosition.elevation.toFixed(1)}°   Azimuth: ${solarPosition.azimuth.toFixed(1)}°`, margin, y + 95);
      pdf.text(`Sunrise: ${solarPosition.sunrise.toLocaleTimeString()}   Sunset: ${solarPosition.sunset.toLocaleTimeString()}`, margin, y + 103);

      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text('Stratus Weather Server • Client Dashboard', pageWidth / 2, 285, { align: 'center' });

      pdf.save(`${station?.name || 'weather'}_report_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('Failed to generate PDF');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <Cloud className="h-8 w-8 text-primary-600" />
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{station?.name || 'Elsa - Demo Station'}</h1>
                <p className="text-sm text-gray-500 flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {station?.location || 'Potchefstroom, South Africa'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600 hidden sm:block">{user?.email}</span>
              <button
                onClick={logout}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <LogOut className="h-5 w-5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-green-500" />
            <span className="text-sm text-gray-600">
              Last update: {currentData?.timestamp ? new Date(currentData.timestamp).toLocaleString() : 'Demo data'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => refetchLatest()}
              className="btn btn-secondary flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={handleExportCSV}
              className="btn btn-secondary flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
            <button
              onClick={handleExportPDF}
              className="btn btn-primary flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >
              <Download className="h-4 w-4" />
              PDF Report
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <h3 className="text-base font-semibold text-gray-900 mb-4">Station Information</h3>
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Current Conditions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              title="Temperature"
              value={formatValue(getValue('temperature'))}
              unit="°C"
              trend={{ value: 1.2, label: 'vs yesterday' }}
              chartColor="#ef4444"
            />
            <MetricCard
              title="Humidity"
              value={formatValue(getValue('humidity'))}
              unit="%"
              trend={{ value: -3, label: 'vs yesterday' }}
              chartColor="#3b82f6"
            />
            <MetricCard
              title="Pressure"
              value={formatValue(getValue('pressure'))}
              unit="hPa"
              subMetrics={[{ label: 'Sea Level', value: `${seaLevelPressure.toFixed(1)} hPa` }]}
              chartColor="#8b5cf6"
            />
            <MetricCard
              title="Wind Speed"
              value={formatValue(getValue('windSpeed'))}
              unit="km/h"
              subMetrics={[
                { label: 'Gust', value: `${formatValue(getValue('windGust'))} km/h` },
                { label: 'Direction', value: `${formatValue(getValue('windDirection'), 0)}° ${getWindDirectionName(getValue('windDirection'))}` }
              ]}
              chartColor="#14b8a6"
            />
            <MetricCard
              title="Solar Radiation"
              value={formatValue(getValue('solarRadiation'))}
              unit="W/m²"
              chartColor="#f59e0b"
            />
            <MetricCard
              title="UV Index"
              value={formatValue(getValue('uvIndex'))}
              unit=""
              subMetrics={[{ label: 'Risk', value: getValue('uvIndex') > 8 ? 'Very High' : getValue('uvIndex') > 5 ? 'High' : 'Moderate' }]}
              chartColor="#dc2626"
            />
            <MetricCard
              title="Rainfall"
              value={formatValue(getValue('rainfall'))}
              unit="mm"
              chartColor="#0ea5e9"
            />
            <MetricCard
              title="Battery"
              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <h3 className="text-base font-semibold text-gray-900 mb-4">Wind Compass</h3>
              subMetrics={[{ label: 'Status', value: getValue('batteryVoltage') > 12.5 ? 'Good' : 'Low' }]}
              chartColor="#22c55e"
            />
          </div>
        </section>

        {/* Solar & Atmosphere Section */}
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Solar Position & Atmosphere</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <SolarPositionCard solarPosition={solarPosition} currentRadiation={getValue('solarRadiation')} />
            <AirDensityCard airDensity={airDensity} temp={temp} pressure={pressure} humidity={humidity} />
            <EToCard eto={eto} />
            {station && <StationInfoCard station={station} />}
          </div>
        </section>

        {/* Wind Analysis Section */}
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Wind Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <WindCompass 
              direction={getValue('windDirection')} 
              speed={getValue('windSpeed')} 
              gust={getValue('windGust')} 
            />
            <WindEnergyCard windSpeed={getValue('windSpeed')} airDensity={airDensity} />
            <FireDangerCard temp={temp} humidity={humidity} windSpeed={windSpeed} />
          </div>
        </section>

        {/* Wind Rose Chart */}
        <section className="mb-8">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Wind Rose (Today)</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={windRoseData}>
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="dirName" tick={{ fontSize: 12 }} stroke="#64748b" />
                  <PolarRadiusAxis angle={90} domain={[0, 'auto']} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <Radar 
                    name="Frequency %" 
                    dataKey="frequency" 
                    stroke="#14b8a6" 
                    fill="#14b8a6" 
                    fillOpacity={0.5} 
                  />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Charts Section */}
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Historical Data (24h)</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Temperature Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Temperature</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit="°C" />
                    <Tooltip />
                    <Area type="monotone" dataKey="temperature" stroke="#ef4444" fill="url(#tempGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Humidity Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Humidity</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="humidGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit="%" />
                    <Tooltip />
                    <Area type="monotone" dataKey="humidity" stroke="#3b82f6" fill="url(#humidGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Pressure Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Barometric Pressure</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit=" hPa" domain={['dataMin - 2', 'dataMax + 2']} />
                    <Tooltip />
                    <Line type="monotone" dataKey="pressure" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Solar Radiation Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Solar Radiation</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="solarGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit=" W/m²" />
                    <Tooltip />
                    <Area type="monotone" dataKey="solar" stroke="#f59e0b" fill="url(#solarGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Wind Speed Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Wind Speed</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="windGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit=" km/h" />
                    <Tooltip />
                    <Area type="monotone" dataKey="windSpeed" stroke="#14b8a6" fill="url(#windGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Rainfall Chart */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4">Rainfall</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" unit=" mm" />
                    <Tooltip />
                    <Bar dataKey="rain" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>

        {/* Soil & Environment Section */}
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Soil & Air Quality</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              title="Soil Temperature"
              value={formatValue(getValue('soilTemperature'))}
              unit="°C"
              chartColor="#a16207"
            />
            <MetricCard
              title="Soil Moisture"
              value={formatValue(getValue('soilMoisture'))}
              unit="%"
              subMetrics={[{ label: 'Status', value: getValue('soilMoisture') < 20 ? 'Dry' : getValue('soilMoisture') < 40 ? 'Optimal' : 'Wet' }]}
              chartColor="#15803d"
            />
            <MetricCard
              title="PM2.5"
              value={formatValue(getValue('pm25'))}
              unit="µg/m³"
              subMetrics={[{ label: 'AQI', value: getValue('pm25') < 12 ? 'Good' : getValue('pm25') < 35 ? 'Moderate' : 'Unhealthy' }]}
              chartColor="#6b7280"
            />
            <MetricCard
              title="PM10"
              value={formatValue(getValue('pm10'))}
              unit="µg/m³"
              chartColor="#9ca3af"
            />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-sm text-gray-500">
            Stratus Weather Server v1.0.0 • Client Dashboard • © 2026 Lukas Esterhuizen
          </p>
        </div>
      </footer>
    </div>
  );
}
