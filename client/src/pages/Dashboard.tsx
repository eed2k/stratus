// Stratus Weather System
// Created by Lukas Esterhuizen

﻿import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { CurrentConditions } from "@/components/dashboard/CurrentConditions";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { WindCompass } from "@/components/dashboard/WindCompass";
import { WindPowerCard } from "@/components/dashboard/WindPowerCard";
import { StatisticsCard } from "@/components/dashboard/StatisticsCard";
import { SolarRadiationCard } from "@/components/dashboard/SolarRadiationCard";
import { EToCard } from "@/components/dashboard/EToCard";
import { StationSelector } from "@/components/dashboard/StationSelector";
import { DataImport } from "@/components/dashboard/DataImport";
import { DashboardConfigPanel } from "@/components/dashboard/DashboardConfigPanel";
import { ShareDashboard } from "@/components/dashboard/ShareDashboard";
import { StationInfoPanel } from "@/components/dashboard/StationInfoPanel";
import { AirDensityCard } from "@/components/dashboard/AirDensityCard";
import { BatteryVoltageCard } from "@/components/dashboard/BatteryVoltageCard";
import { MpptChargerCard } from "@/components/dashboard/MpptChargerCard";
import { BarometricPressureCard } from "@/components/dashboard/BarometricPressureCard";
import { SolarPowerHarvestCard } from "@/components/dashboard/SolarPowerHarvestCard";
import { FireDangerCard } from "@/components/dashboard/FireDangerCard";
import { NoDataWrapper, hasValidData } from "@/components/dashboard/NoDataWrapper";
import { safeFixed } from "@/lib/utils";

// Lazy-load heavy chart and visualization components for faster initial render
const WindRose = lazy(() => import("@/components/charts/WindRose").then(m => ({ default: m.WindRose })));
const WindRoseScatter = lazy(() => import("@/components/charts/WindRoseScatter").then(m => ({ default: m.WindRoseScatter })));
const WeatherChart = lazy(() => import("@/components/charts/WeatherChart").then(m => ({ default: m.WeatherChart })));
const DataBlockChart = lazy(() => import("@/components/charts/DataBlockChart").then(m => ({ default: m.DataBlockChart })));
const FireDangerChart = lazy(() => import("@/components/charts/FireDangerChart").then(m => ({ default: m.FireDangerChart })));
const StationMapWithErrorBoundary = lazy(() => import("@/components/dashboard/StationMap").then(m => ({ default: m.StationMapWithErrorBoundary })));
const SolarPositionCard = lazy(() => import("@/components/dashboard/SolarPositionCard").then(m => ({ default: m.SolarPositionCard })));

// Chart loading placeholder
const ChartFallback = () => (
  <div className="flex items-center justify-center h-48 bg-muted/20 rounded-lg animate-pulse">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Radio,
  Plus,
  Loader2,
  RefreshCw,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import type { WeatherStation, WeatherData } from "@shared/schema";
import { 
  calculateSolarPosition, 
  calculateAirDensity, 
  calculateSeaLevelPressure,
  calculateStationPressure,
  calculateETo,
  getDayOfYear,
  kmhToMs,
  wattsToMJPerDay,
  calculateFireDanger
} from "@shared/utils/calc";
import { DEFAULT_DASHBOARD_CONFIG, type DashboardConfig } from "../../../shared/dashboardConfig";
import { getSimplifiedClasses, getWindUnitLabel, getWindDirectionLabel, type WindSpeedUnit } from "@/lib/windConstants";
import {
  STANDARD_SEA_LEVEL_PRESSURE_HPA,
  STANDARD_AIR_DENSITY_KGM3,
  DEFAULT_TEMPERATURE_C,
  DEFAULT_HUMIDITY_PERCENT,
  ASSUMED_DAYLIGHT_HOURS,
} from "@shared/utils/weatherConstants";

/**
 * Helper function to safely convert to number and format to fixed decimals
 * Handles strings, nulls, and undefined values
 */
const safeNumber = (value: number | string | null | undefined): number => {
  if (value == null) return 0;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? 0 : num;
};

/**
 * Convert any value to a number or null (handles pg driver string-typed REAL columns)
 */
const toNum = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

/**
 * Helper function to format numbers to a maximum of 3 decimal places
 * Removes trailing zeros for cleaner display
 */
const formatValue = (value: number | string | null | undefined, maxDecimals: number = 3): string => {
  const num = safeNumber(value);
  return parseFloat(num.toFixed(maxDecimals)).toString();
};

/**
 * Process historical data into wind rose format
 * Bins wind observations by direction and speed class
 */
const processWindRoseData = (historicalData: WeatherData[], windUnit: WindSpeedUnit = 'ms') => {
  // 16 direction bins (N, NNE, NE, etc.)
  const windRoseData = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    speeds: [0, 0, 0, 0, 0, 0], // 6 speed classes
  }));

  const classes = getSimplifiedClasses(windUnit);

  historicalData.forEach(data => {
    if (data.windDirection == null || data.windSpeed == null) return;
    
    // Determine direction bin (0-15)
    const dirBin = Math.round(data.windDirection / 22.5) % 16;
    
    // Determine speed class using unit-appropriate thresholds
    const speed = data.windSpeed;
    let speedClass = 0;
    for (let i = classes.length - 1; i >= 0; i--) {
      if (speed >= classes[i].min) { speedClass = i; break; }
    }
    
    windRoseData[dirBin].speeds[speedClass]++;
  });

  return windRoseData;
};

/**
 * Process historical data into wind scatter format
 */
const processWindScatterData = (historicalData: WeatherData[]) => {
  return historicalData
    .filter(d => d.windDirection != null && d.windSpeed != null)
    .map(d => ({
      direction: d.windDirection!,
      speed: d.windSpeed!,
      timestamp: new Date(d.timestamp),
    }));
};

/**
 * Process historical data into chart format
 * Adapts timestamp display based on the data time range
 * Samples data for large datasets to prevent chart overload
 */
// Helper: aggregate an array of numbers (non-null) into avg, rounding to 1 decimal
const avgNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
};
const sumNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};
const minNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round(Math.min(...nums) * 10) / 10 : null;
};
const maxNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round(Math.max(...nums) * 10) / 10 : null;
};

const processChartData = (historicalData: WeatherData[], timeRangeHours?: number, stationLat?: number, stationAltitude?: number, windUnit: WindSpeedUnit = 'ms') => {
  if (historicalData.length === 0) return [];
  
  // Server already limits to ~500 points, so no client-side sampling needed
  const sampledData = historicalData;
  
  // Determine the time span of the data
  const timestamps = sampledData.map(d => new Date(d.timestamp).getTime());
  const dataSpanHours = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60);
  const effectiveRange = timeRangeHours || dataSpanHours;

  // For ranges beyond 7d, aggregate data by day (daily averages)
  if (effectiveRange > 168) {
    const dayBuckets = new Map<string, WeatherData[]>();
    sampledData.forEach(d => {
      const dt = new Date(d.timestamp);
      const key = dt.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!dayBuckets.has(key)) dayBuckets.set(key, []);
      dayBuckets.get(key)!.push(d);
    });

    const sortedDays = [...dayBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    return sortedDays.map(([dateKey, dayData]) => {
      const date = new Date(dateKey + 'T12:00:00');
      const label = date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });

      // Rainfall: sum of incremental rain for the day
      const rainfallVals = dayData.map(d => d.rainfall).filter((v): v is number => v != null);
      const dayRain = rainfallVals.length >= 2 ? Math.max(0, rainfallVals[rainfallVals.length - 1] - rainfallVals[0]) : 0;

      return {
        timestamp: label,
        fullTimestamp: date.toISOString(),
        temperature: avgNonNull(dayData.map(d => d.temperature ?? null)),
        temperatureMin: minNonNull(dayData.map(d => d.temperature ?? null)),
        temperatureMax: maxNonNull(dayData.map(d => d.temperature ?? null)),
        humidity: avgNonNull(dayData.map(d => d.humidity ?? null)),
        humidityMin: minNonNull(dayData.map(d => d.humidity ?? null)),
        humidityMax: maxNonNull(dayData.map(d => d.humidity ?? null)),
        pressure: avgNonNull(dayData.map(d => d.pressure ?? null)),
        windSpeed: avgNonNull(dayData.map(d => d.windSpeed ?? null)),
        windSpeedMax: maxNonNull(dayData.map(d => d.windSpeed ?? null)),
        solar: avgNonNull(dayData.map(d => d.solarRadiation != null ? Math.max(d.solarRadiation, 0) : null)),
        solarMax: maxNonNull(dayData.map(d => d.solarRadiation != null ? Math.max(d.solarRadiation, 0) : null)),
        rain: Math.round(dayRain * 100) / 100,
        soilTemperature: avgNonNull(dayData.map(d => d.soilTemperature ?? null)),
        soilMoisture: avgNonNull(dayData.map(d => d.soilMoisture ?? null)),
        pm10: avgNonNull(dayData.map(d => d.pm10 ?? null)),
        pm25: avgNonNull(dayData.map(d => d.pm25 ?? null)),
        batteryVoltage: avgNonNull(dayData.map(d => d.batteryVoltage ?? null)),
        batteryVoltageMin: minNonNull(dayData.map(d => d.batteryVoltage ?? null)),
        batteryVoltageMax: maxNonNull(dayData.map(d => d.batteryVoltage ?? null)),
        waterLevel: avgNonNull(dayData.map(d => d.waterLevel ?? null)),
        temperatureSwitch: avgNonNull(dayData.map(d => d.temperatureSwitch ?? null)),
        levelSwitch: avgNonNull(dayData.map(d => d.levelSwitch ?? null)),
        temperatureSwitchOutlet: avgNonNull(dayData.map(d => d.temperatureSwitchOutlet ?? null)),
        levelSwitchStatus: avgNonNull(dayData.map(d => d.levelSwitchStatus ?? null)),
        lightning: sumNonNull(dayData.map(d => d.lightning ?? null)),
        chargerVoltage: avgNonNull(dayData.map(d => d.chargerVoltage ?? null)),
        windDirStdDev: avgNonNull(dayData.map(d => d.windDirStdDev ?? null)),
        sdi12WindVector: avgNonNull(dayData.map(d => d.sdi12WindVector ?? null)),
        pumpSelectWell: avgNonNull(dayData.map(d => d.pumpSelectWell ?? null)),
        pumpSelectBore: avgNonNull(dayData.map(d => d.pumpSelectBore ?? null)),
        portStatusC1: avgNonNull(dayData.map(d => d.portStatusC1 ?? null)),
        portStatusC2: avgNonNull(dayData.map(d => d.portStatusC2 ?? null)),
        mpptSolarVoltage: avgNonNull(dayData.map(d => toNum(d.mpptSolarVoltage))),
        mpptSolarCurrent: avgNonNull(dayData.map(d => toNum(d.mpptSolarCurrent))),
        mpptSolarPower: avgNonNull(dayData.map(d => toNum(d.mpptSolarPower))),
        mpptLoadVoltage: avgNonNull(dayData.map(d => toNum(d.mpptLoadVoltage))),
        mpptLoadCurrent: avgNonNull(dayData.map(d => toNum(d.mpptLoadCurrent))),
        mpptBatteryVoltage: avgNonNull(dayData.map(d => toNum(d.mpptBatteryVoltage))),
        mpptChargerState: avgNonNull(dayData.map(d => toNum(d.mpptChargerState))),
        mpptAbsiAvg: avgNonNull(dayData.map(d => toNum(d.mpptAbsiAvg))),
        mpptBoardTemp: avgNonNull(dayData.map(d => toNum(d.mpptBoardTemp))),
        mpptMode: avgNonNull(dayData.map(d => toNum(d.mpptMode))),
        mppt2SolarVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2SolarVoltage))),
        mppt2SolarCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2SolarCurrent))),
        mppt2SolarPower: avgNonNull(dayData.map(d => toNum(d.mppt2SolarPower))),
        mppt2LoadVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2LoadVoltage))),
        mppt2LoadCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2LoadCurrent))),
        mppt2BatteryVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2BatteryVoltage))),
        mppt2ChargerState: avgNonNull(dayData.map(d => toNum(d.mppt2ChargerState))),
        mppt2BoardTemp: avgNonNull(dayData.map(d => toNum(d.mppt2BoardTemp))),
        mppt2Mode: avgNonNull(dayData.map(d => toNum(d.mppt2Mode))),
        dewPoint: (() => {
          const t = avgNonNull(dayData.map(d => d.temperature ?? null));
          const rh = avgNonNull(dayData.map(d => d.humidity ?? null));
          if (t == null || rh == null || rh <= 0) return null;
          const a = 17.625;
          const b = 243.04;
          const alpha = Math.log(rh / 100) + (a * t) / (b + t);
          return Math.round(((b * alpha) / (a - alpha)) * 10) / 10;
        })(),
        eto: (() => {
          const temp = avgNonNull(dayData.map(d => d.temperature ?? null));
          const hum = avgNonNull(dayData.map(d => d.humidity ?? null));
          const ws = avgNonNull(dayData.map(d => d.windSpeed ?? null));
          const sr = avgNonNull(dayData.map(d => d.solarRadiation ?? null));
          if (temp == null || hum == null || ws == null || sr == null) return null;
          const lat = stationLat || 0;
          const alt = stationAltitude || 0;
          const ts = new Date(dateKey + 'T12:00:00');
          const dayOfYear = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / 86400000);
          const solarMJ = wattsToMJPerDay(sr, ASSUMED_DAYLIGHT_HOURS);
          const windMs = windUnit === 'kmh' ? kmhToMs(ws) : ws;
          return calculateETo(temp, hum, windMs, solarMJ, alt, lat, dayOfYear);
        })(),
        _readings: dayData.length,
      };
    });
  }
  
  // Format timestamp based on time range
  const formatTimestamp = (date: Date) => {
    if (effectiveRange <= 2) {
      // Under 2 hours: show HH:MM
      return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    } else if (effectiveRange <= 24) {
      // 2-24 hours: show HH:MM
      return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    } else if (effectiveRange <= 72) {
      // 1-3 days: show Day HH:MM
      return date.toLocaleDateString("en-ZA", { weekday: "short" }) + " " +
             date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    } else {
      // 3-7 days: show Day DD HH:00
      return date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric" }) + " " +
             date.toLocaleTimeString("en-ZA", { hour: "2-digit", hour12: false });
    }
  };
  
  return sampledData.map((d, i, arr) => {
    // Convert cumulative rainfall to incremental (difference from previous reading)
    const rawRain = d.rainfall ?? 0;
    let incrementalRain = rawRain;
    if (i > 0) {
      const prevRain = arr[i - 1].rainfall ?? 0;
      const diff = rawRain - prevRain;
      // Only show positive increments (negative means counter reset)
      incrementalRain = diff > 0 && diff < 50 ? diff : 0;
    } else {
      incrementalRain = 0; // First reading has no baseline
    }
    
    return {
      timestamp: formatTimestamp(new Date(d.timestamp)),
      fullTimestamp: new Date(d.timestamp).toISOString(),
      temperature: d.temperature ?? null,
      humidity: d.humidity ?? null,
      pressure: d.pressure ?? null,
      windSpeed: d.windSpeed ?? null,
      solar: d.solarRadiation != null ? Math.max(d.solarRadiation, 0) : null,
      rain: incrementalRain,
      soilTemperature: d.soilTemperature ?? null,
      soilMoisture: d.soilMoisture ?? null,
      pm10: d.pm10 ?? null,
      pm25: d.pm25 ?? null,
      batteryVoltage: d.batteryVoltage ?? null,
      waterLevel: d.waterLevel ?? null,
      temperatureSwitch: d.temperatureSwitch ?? null,
      levelSwitch: d.levelSwitch ?? null,
      temperatureSwitchOutlet: d.temperatureSwitchOutlet ?? null,
      levelSwitchStatus: d.levelSwitchStatus ?? null,
      lightning: d.lightning ?? null,
      chargerVoltage: d.chargerVoltage ?? null,
      windDirStdDev: d.windDirStdDev ?? null,
      sdi12WindVector: d.sdi12WindVector ?? null,
      pumpSelectWell: d.pumpSelectWell ?? null,
      pumpSelectBore: d.pumpSelectBore ?? null,
      portStatusC1: d.portStatusC1 ?? null,
      portStatusC2: d.portStatusC2 ?? null,
      mpptSolarVoltage: toNum(d.mpptSolarVoltage),
      mpptSolarCurrent: toNum(d.mpptSolarCurrent),
      mpptSolarPower: toNum(d.mpptSolarPower),
      mpptLoadVoltage: toNum(d.mpptLoadVoltage),
      mpptLoadCurrent: toNum(d.mpptLoadCurrent),
      mpptBatteryVoltage: toNum(d.mpptBatteryVoltage),
      mpptChargerState: toNum(d.mpptChargerState),
      mpptAbsiAvg: toNum(d.mpptAbsiAvg),
      mpptBoardTemp: toNum(d.mpptBoardTemp),
      mpptMode: toNum(d.mpptMode),
      // Charger 2
      mppt2SolarVoltage: toNum(d.mppt2SolarVoltage),
      mppt2SolarCurrent: toNum(d.mppt2SolarCurrent),
      mppt2SolarPower: toNum(d.mppt2SolarPower),
      mppt2LoadVoltage: toNum(d.mppt2LoadVoltage),
      mppt2LoadCurrent: toNum(d.mppt2LoadCurrent),
      mppt2BatteryVoltage: toNum(d.mppt2BatteryVoltage),
      mppt2ChargerState: toNum(d.mppt2ChargerState),
      mppt2BoardTemp: toNum(d.mppt2BoardTemp),
      mppt2Mode: toNum(d.mppt2Mode),
      // Calculate dew point per data point using Magnus formula
      dewPoint: (() => {
        const t = d.temperature;
        const rh = d.humidity;
        if (t == null || rh == null || rh <= 0) return d.dewPoint ?? null;
        const a = 17.625;
        const b = 243.04;
        const alpha = Math.log(rh / 100) + (a * t) / (b + t);
        return Math.round(((b * alpha) / (a - alpha)) * 10) / 10;
      })(),
      // Calculate ETo per data point using FAO Penman-Monteith
      eto: (() => {
        const temp = d.temperature;
        const hum = d.humidity;
        const ws = d.windSpeed;
        const sr = d.solarRadiation;
        if (temp == null || hum == null || ws == null || sr == null) return null;
        const lat = stationLat || 0;
        const alt = stationAltitude || 0;
        const ts = new Date(d.timestamp);
        const dayOfYear = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / 86400000);
        const solarMJ = wattsToMJPerDay(sr, ASSUMED_DAYLIGHT_HOURS);
        const windMs = windUnit === 'kmh' ? kmhToMs(ws) : ws;
        return calculateETo(temp, hum, windMs, solarMJ, alt, lat, dayOfYear);
      })(),
    };
  });
};

/**
 * Process historical data into wind energy format
 * Calculates wind power density using P = 0.5 * rho * v³
 */
const processWindEnergyData = (historicalData: WeatherData[], density: number = STANDARD_AIR_DENSITY_KGM3, windUnit: WindSpeedUnit = 'ms', timeRangeHours?: number) => {
  const toMs = (v: number) => windUnit === 'kmh' ? v / 3.6 : v;
  
  // Determine effective range
  const timestamps = historicalData.map(d => new Date(d.timestamp).getTime());
  const dataSpanHours = timestamps.length > 1 ? (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60) : 24;
  const effectiveRange = timeRangeHours || dataSpanHours;

  // For 7d+ ranges, aggregate by day
  if (effectiveRange >= 168 && historicalData.length > 0) {
    const dayBuckets = new Map<string, WeatherData[]>();
    historicalData.forEach(d => {
      const key = new Date(d.timestamp).toISOString().slice(0, 10);
      if (!dayBuckets.has(key)) dayBuckets.set(key, []);
      dayBuckets.get(key)!.push(d);
    });
    let cumulativeEnergy = 0;
    return [...dayBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dateKey, dayData]) => {
      const date = new Date(dateKey + 'T12:00:00');
      const avgSpeed = dayData.reduce((s, d) => s + (d.windSpeed ?? 0), 0) / dayData.length;
      const avgGust = dayData.reduce((s, d) => s + (d.windGust ?? d.windSpeed ?? 0), 0) / dayData.length;
      const speedMs = toMs(avgSpeed);
      const gustMs = toMs(avgGust);
      const windPower = 0.5 * density * Math.pow(speedMs, 3);
      const gustPower = 0.5 * density * Math.pow(gustMs, 3);
      cumulativeEnergy += (windPower * 24) / 1000; // Assume 24h per day bucket
      return {
        timestamp: date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" }),
        windSpeed: Math.round(avgSpeed * 10) / 10,
        windGust: Math.round(avgGust * 10) / 10,
        windPower: Math.round(windPower * 10) / 10,
        gustPower: Math.round(gustPower * 10) / 10,
        cumulativeEnergy,
        _readings: dayData.length,
      };
    });
  }

  let cumulativeEnergy = 0;
  
  // Format timestamp based on range
  const formatTs = (date: Date) => {
    if (effectiveRange <= 72) {
      return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric" }) + " " +
           date.toLocaleTimeString("en-ZA", { hour: "2-digit", hour12: false });
  };

  return historicalData.map((d, i) => {
    const windSpeed = d.windSpeed ?? 0;
    const windGust = d.windGust ?? windSpeed;
    const speedMs = toMs(windSpeed);
    const gustMs = toMs(windGust);
    const windPower = 0.5 * density * Math.pow(speedMs, 3);
    const gustPower = 0.5 * density * Math.pow(gustMs, 3);
    
    let intervalHours = 1;
    if (i > 0 && d.timestamp && historicalData[i - 1].timestamp) {
      const dtMs = new Date(d.timestamp).getTime() - new Date(historicalData[i - 1].timestamp).getTime();
      intervalHours = Math.max(dtMs / 3_600_000, 0);
    } else if (historicalData.length > 1) {
      const first = new Date(historicalData[0].timestamp).getTime();
      const last = new Date(historicalData[historicalData.length - 1].timestamp).getTime();
      intervalHours = (last - first) / 3_600_000 / Math.max(historicalData.length - 1, 1);
    }
    
    cumulativeEnergy += (windPower * intervalHours) / 1000;
    
    return {
      timestamp: formatTs(new Date(d.timestamp)),
      windSpeed,
      windGust,
      windPower,
      gustPower,
      cumulativeEnergy,
    };
  });
};

/**
 * Calculate wind power density using P = 0.5 * rho * v³
 * windSpeed: Wind speed (in station's native unit)
 * airDensity: Air density in kg/m³ (default STANDARD_AIR_DENSITY_KGM3)
 * windUnit: Wind speed unit ('ms' or 'kmh')
 * Returns Power density in W/m²
 */
const calculateWindPower = (windSpeed: number, airDensity: number = STANDARD_AIR_DENSITY_KGM3, windUnit: WindSpeedUnit = 'ms'): number => {
  const speedMs = windUnit === 'kmh' ? windSpeed / 3.6 : windSpeed;
  return 0.5 * airDensity * Math.pow(speedMs, 3);
};

interface DashboardProps {
  isAdmin?: boolean;
  canAccessStation?: (stationId: number) => boolean;
  stationId?: number;  // If provided, use this station directly
  onBackToStations?: () => void;
}

export default function Dashboard({ isAdmin = true, canAccessStation, stationId, onBackToStations }: DashboardProps) {
  const [selectedStationId, setSelectedStationId] = useState<number | null>(stationId || null);
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>(() => {
    // Load station-specific config only. each dashboard is independent
    if (stationId) {
      const stationSaved = localStorage.getItem(`dashboardConfig_${stationId}`);
      if (stationSaved) {
        const parsed = JSON.parse(stationSaved);
        if (parsed.chartTimeRange > 168) parsed.chartTimeRange = 168;
        return parsed;
      }
    }
    return DEFAULT_DASHBOARD_CONFIG;
  });
  // Local time range for historical charts section (independent of global dashboard time range)
  const [historicalChartRange, setHistoricalChartRange] = useState(24);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allStations = [], isLoading: stationsLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  // Filter stations based on user access and sort by ID (numerical order)
  const stations = useMemo(() => {
    const filtered = isAdmin ? allStations : (!canAccessStation ? allStations : allStations.filter(s => canAccessStation(s.id)));
    return [...filtered].sort((a, b) => a.id - b.id);
  }, [allStations, isAdmin, canAccessStation]);

  const activeStationId = selectedStationId || (stations.length > 0 ? stations[0].id : null);
  const selectedStation = stations.find(s => s.id === activeStationId);
  const windSpeedUnit: WindSpeedUnit = ((selectedStation as any)?.windSpeedUnit === 'kmh') ? 'kmh' : 'ms';
  const windUnitLabel = getWindUnitLabel(windSpeedUnit);

  // Reload per-station config when active station changes. each station is independent
  useEffect(() => {
    if (!activeStationId) return;
    const stationSaved = localStorage.getItem(`dashboardConfig_${activeStationId}`);
    if (stationSaved) {
      const parsed = JSON.parse(stationSaved);
      if (parsed.chartTimeRange > 168) parsed.chartTimeRange = 168;
      setDashboardConfig(parsed);
    } else {
      // No config saved for this station. use clean defaults (not another station's config)
      setDashboardConfig(DEFAULT_DASHBOARD_CONFIG);
    }
  }, [activeStationId]);

  const { data: latestData, isLoading: dataLoading, refetch } = useQuery<WeatherData>({
    queryKey: ["/api/stations", activeStationId, "data", "latest"],
    enabled: !!activeStationId,
    refetchInterval: dashboardConfig.updatePeriod * 1000, // Auto-refresh based on config
  });

  // Fetch the actual data time range for this station (used for historical-only stations)
  const { data: dataRange } = useQuery<{ earliest: string; latest: string; count: number }>({
    queryKey: ["/api/stations", activeStationId, "data", "range"],
    queryFn: async () => {
      if (!activeStationId) return null;
      const res = await authFetch(`/api/stations/${activeStationId}/data/range`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!activeStationId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch historical data for charts and wind roses (based on configured time range)
  // Auto-expands to 30 days, then falls back to station's actual data range
  const { data: historicalData = [], refetch: refetchHistorical } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "history", dashboardConfig.chartTimeRange, dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - dashboardConfig.chartTimeRange * 60 * 60 * 1000);
      // Request more data points for longer time ranges to avoid gaps
      const limit = dashboardConfig.chartTimeRange > 72 ? 2000 : 1000;
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`
      );
      if (!response.ok) return [];
      const data = await response.json();
      // If no data in requested range, auto-expand to 30 days to find most recent data
      if (Array.isArray(data) && data.length === 0) {
        const expandedStart = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${expandedStart.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`
        );
        if (!fallback.ok) return [];
        const fallbackData = await fallback.json();
        if (Array.isArray(fallbackData) && fallbackData.length > 0) return fallbackData;
        // Final fallback: use station's actual data range (for historical-only stations)
        if (dataRange?.latest) {
          const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000); // +1min buffer
          const rangeStart = new Date(rangeEnd.getTime() - dashboardConfig.chartTimeRange * 60 * 60 * 1000);
          const rangeFallback = await authFetch(
            `/api/stations/${activeStationId}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=${limit}`
          );
          if (!rangeFallback.ok) return [];
          return rangeFallback.json();
        }
        return [];
      }
      return data;
    },
    enabled: !!activeStationId,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 120) * 1000, // Min 2min for historical charts
    staleTime: 60 * 1000, // Consider data fresh for 60 seconds to prevent rapid re-fetches
    placeholderData: keepPreviousData, // Show previous data while new range loads
  });

  // Separate query for 7-day stats data (always fetches 7 days regardless of chart time range)
  const statsTimeRangeHours = 7 * 24; // 168 hours = 7 days
  const { data: statsData = [] } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "stats-7d", dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - statsTimeRangeHours * 60 * 60 * 1000);
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=500`
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - statsTimeRangeHours * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=500`
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!activeStationId,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 300) * 1000, // Min 5min for stats refresh
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes (stats data changes slowly)
  });

  // Separate 7-day query for dew point chart (always fetches 7 days regardless of dashboard time range)
  const { data: dewPointData7d = [] } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "dewpoint-7d", dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=1500`
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=1500`
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!activeStationId,
    refetchInterval: 30 * 60 * 1000, // Refresh every 30 minutes
    staleTime: 15 * 60 * 1000,
  });

  // Process 7-day dew point chart data
  const dewPointChartData = useMemo(() => {
    if (dewPointData7d.length === 0) return [];
    const sorted = [...dewPointData7d].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return processChartData(sorted, 168, selectedStation?.latitude ?? undefined, selectedStation?.altitude ?? undefined, windSpeedUnit);
  }, [dewPointData7d, selectedStation?.latitude, selectedStation?.altitude]);

  // Separate query for historical charts section (uses its own independent time range)
  // Auto-expands to 30 days, then falls back to station's actual data range
  const { data: historicalSectionData = [], isLoading: historicalSectionLoading } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "historical-section", historicalChartRange, dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - historicalChartRange * 60 * 60 * 1000);
      const limit = historicalChartRange > 72 ? 2000 : 1000;
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data) && data.length === 0) {
        const expandedStart = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${expandedStart.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`
        );
        if (!fallback.ok) return [];
        const fallbackData = await fallback.json();
        if (Array.isArray(fallbackData) && fallbackData.length > 0) return fallbackData;
        // Final fallback: use station's actual data range
        if (dataRange?.latest) {
          const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
          const rangeStart = new Date(rangeEnd.getTime() - historicalChartRange * 60 * 60 * 1000);
          const rangeFallback = await authFetch(
            `/api/stations/${activeStationId}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=${limit}`
          );
          if (!rangeFallback.ok) return [];
          return rangeFallback.json();
        }
        return [];
      }
      return data;
    },
    enabled: !!activeStationId,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 120) * 1000,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });

  // Process historical section chart data
  const historicalChartData = useMemo(() => {
    if (historicalSectionData.length === 0) return [];
    const sorted = [...historicalSectionData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return processChartData(sorted, historicalChartRange, selectedStation?.latitude ?? undefined, selectedStation?.altitude ?? undefined, windSpeedUnit);
  }, [historicalSectionData, historicalChartRange, selectedStation?.latitude, selectedStation?.altitude]);

  // Sort stats data by timestamp ascending
  const sortedStatsData = useMemo(() => {
    if (statsData.length === 0) return [];
    return [...statsData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [statsData]);

  // Calculate actual data time range for display
  const dataTimeRange = useMemo(() => {
    if (historicalData.length === 0) return null;
    const timestamps = historicalData.map(d => new Date(d.timestamp).getTime());
    const earliest = new Date(Math.min(...timestamps));
    const latest = new Date(Math.max(...timestamps));
    const hoursAvailable = (latest.getTime() - earliest.getTime()) / (1000 * 60 * 60);
    return {
      earliest,
      latest,
      hoursAvailable: Math.round(hoursAvailable * 10) / 10,
      recordCount: historicalData.length
    };
  }, [historicalData]);

  // Detect which data fields have valid data
  const availableFields = useMemo(() => {
    // Check if field has at least some non-null, meaningful values
    // Fields that are always 0 (disconnected sensors) are treated as unavailable
    // allowZero: rainfall can be 0 and still mean the sensor exists
    const hasData = (field: keyof WeatherData, allowZero = false) => {
      // First check historical data
      if (historicalData.length > 0) {
        return historicalData.some(d => {
          const v = d[field];
          return allowZero ? (v !== null && v !== undefined) : (v !== null && v !== undefined && v !== 0);
        });
      }
      // Fallback: check latestData when no historical data in time range
      // This prevents blank dashboards when data exists but is outside the chart window
      if (latestData) {
        const v = latestData[field];
        return allowZero ? (v !== null && v !== undefined) : (v !== null && v !== undefined && v !== 0);
      }
      return false;
    };
    
    return {
      temperature: hasData('temperature'),
      humidity: hasData('humidity'),
      pressure: hasData('pressure'),
      windSpeed: hasData('windSpeed'),
      windDirection: hasData('windDirection'),
      solarRadiation: hasData('solarRadiation'),
      rainfall: hasData('rainfall', true),
      dewPoint: hasData('dewPoint'),
      airDensity: hasData('airDensity'),
      uvIndex: hasData('uvIndex'),
      pm25: hasData('pm25'),
      pm10: hasData('pm10'),
      soilTemperature: hasData('soilTemperature'),
      soilMoisture: hasData('soilMoisture'),
      batteryVoltage: hasData('batteryVoltage'),
      waterLevel: hasData('waterLevel'),
      temperatureSwitch: hasData('temperatureSwitch'),
      levelSwitch: hasData('levelSwitch'),
      temperatureSwitchOutlet: hasData('temperatureSwitchOutlet'),
      levelSwitchStatus: hasData('levelSwitchStatus'),
      lightning: hasData('lightning'),
      chargerVoltage: hasData('chargerVoltage'),
      windDirStdDev: hasData('windDirStdDev'),
      sdi12WindVector: hasData('sdi12WindVector'),
      pumpSelectWell: hasData('pumpSelectWell'),
      pumpSelectBore: hasData('pumpSelectBore'),
      portStatusC1: hasData('portStatusC1'),
      portStatusC2: hasData('portStatusC2'),
      mpptSolarVoltage: hasData('mpptSolarVoltage'),
      mpptSolarCurrent: hasData('mpptSolarCurrent'),
      mpptSolarPower: hasData('mpptSolarPower'),
      mpptLoadVoltage: hasData('mpptLoadVoltage'),
      mpptLoadCurrent: hasData('mpptLoadCurrent'),
      mpptBatteryVoltage: hasData('mpptBatteryVoltage'),
      mpptChargerState: hasData('mpptChargerState'),
      mpptAbsiAvg: hasData('mpptAbsiAvg'),
      mpptBoardTemp: hasData('mpptBoardTemp'),
      mpptMode: hasData('mpptMode'),
      // Charger 2
      mppt2SolarVoltage: hasData('mppt2SolarVoltage'),
      mppt2SolarCurrent: hasData('mppt2SolarCurrent'),
      mppt2SolarPower: hasData('mppt2SolarPower'),
      mppt2LoadVoltage: hasData('mppt2LoadVoltage'),
      mppt2LoadCurrent: hasData('mppt2LoadCurrent'),
      mppt2BatteryVoltage: hasData('mppt2BatteryVoltage'),
      mppt2ChargerState: hasData('mppt2ChargerState'),
      mppt2BoardTemp: hasData('mppt2BoardTemp'),
      mppt2Mode: hasData('mppt2Mode'),
    };
  }, [historicalData, latestData]);

  // Sort historical data by timestamp ascending (oldest to newest) for charts to display correctly
  const sortedHistoricalData = useMemo(() => {
    if (historicalData.length === 0) return [];
    return [...historicalData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [historicalData]);

  // For historical-only stations (data not from today), use the data's latest timestamp as time reference
  // This ensures wind roses, temp stats, etc. show data relative to the station's actual time range
  const referenceNow = useMemo(() => {
    const realNow = Date.now();
    if (sortedHistoricalData.length === 0) return realNow;
    const latestTs = new Date(sortedHistoricalData[sortedHistoricalData.length - 1].timestamp).getTime();
    return (realNow - latestTs) > 24 * 60 * 60 * 1000 ? latestTs : realNow;
  }, [sortedHistoricalData]);

  // Process historical data into chart format (pass time range for proper axis formatting)
  const chartData = useMemo(() => processChartData(sortedHistoricalData, dashboardConfig.chartTimeRange, selectedStation?.latitude ?? undefined, selectedStation?.altitude ?? undefined, windSpeedUnit), [sortedHistoricalData, dashboardConfig.chartTimeRange, selectedStation?.latitude, selectedStation?.altitude, windSpeedUnit]);
  
  // Average daytime solar radiation from historical data (for Solar Power Harvesting card)
  const avgDaytimeRadiation = useMemo(() => {
    const nonZero = sortedHistoricalData
      .map(d => d.solarRadiation)
      .filter((v): v is number => v != null && v > 0);
    if (nonZero.length === 0) return null;
    return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  }, [sortedHistoricalData]);

  // Process wind rose data from historical data
  const windRoseData = useMemo(() => processWindRoseData(sortedHistoricalData, windSpeedUnit), [sortedHistoricalData, windSpeedUnit]);
  
  // Process wind scatter data from historical data
  const windScatterData = useMemo(() => processWindScatterData(sortedHistoricalData), [sortedHistoricalData]);

  // Process wind data for different time periods (60min, 24h, 48h, 7d, 31d)
  // Optimization: only compute counts upfront; rose/scatter are lazy-computed on first access
  // For historical-only stations (data not from today), uses referenceNow from data's latest timestamp
  const windDataByPeriod = useMemo(() => {
    const now = referenceNow;
    const thirtyMinAgo = now - 30 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const fortyEightHoursAgo = now - 48 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
    
    const last30Min = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > thirtyMinAgo);
    const last60Min = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > oneHourAgo);
    const last24h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last48h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > fortyEightHoursAgo);
    const windDataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const last7d = windDataSource.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last31d = windDataSource.filter(d => new Date(d.timestamp).getTime() > thirtyOneDaysAgo);
    
    // Helper: create a lazy wind period object that defers heavy processing until accessed
    const makeLazyPeriod = (data: typeof sortedHistoricalData) => {
      let cachedRose: ReturnType<typeof processWindRoseData> | null = null;
      let cachedScatter: ReturnType<typeof processWindScatterData> | null = null;
      return {
        get rose() { return cachedRose ?? (cachedRose = processWindRoseData(data, windSpeedUnit)); },
        get scatter() { return cachedScatter ?? (cachedScatter = processWindScatterData(data)); },
        count: data.length,
      };
    };
    
    return {
      '30min': makeLazyPeriod(last30Min),
      '60min': makeLazyPeriod(last60Min),
      '24h': makeLazyPeriod(last24h),
      '48h': makeLazyPeriod(last48h),
      '7d': makeLazyPeriod(last7d),
      '31d': makeLazyPeriod(last31d),
      'configured': {
        rose: windRoseData,
        scatter: windScatterData,
        count: sortedHistoricalData.length
      }
    };
  }, [sortedHistoricalData, sortedStatsData, windRoseData, windScatterData, referenceNow]);

  // Calculate temperature statistics for 24h and 7d periods (uses 7-day stats data)
  const temperatureStats = useMemo(() => {
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Use sortedStatsData (7-day dataset) so 7d stats are accurate
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const last24h = dataSource.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last7d = dataSource.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);

    const calculateStats = (data: WeatherData[]) => {
      const temps = data
        .map(d => d.temperature)
        .filter((t): t is number => t !== null && t !== undefined && !isNaN(t));
      
      if (temps.length === 0) {
        return { min: null, max: null, avg: null, range: null };
      }

      const min = Math.min(...temps);
      const max = Math.max(...temps);
      const avg = temps.reduce((sum, t) => sum + t, 0) / temps.length;
      const range = max - min;

      return {
        min: Math.round(min * 10) / 10,
        max: Math.round(max * 10) / 10,
        avg: Math.round(avg * 10) / 10,
        range: Math.round(range * 10) / 10,
      };
    };

    return {
      '24h': calculateStats(last24h),
      '7d': calculateStats(last7d),
    };
  }, [sortedStatsData, sortedHistoricalData, referenceNow]);

  // Calculate solar radiation statistics from historical data
  const solarStats = useMemo(() => {
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    const last24h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);

    // Get valid solar radiation values
    const radiationValues = last24h
      .map(d => d.solarRadiation)
      .filter((r): r is number => r !== null && r !== undefined && !isNaN(r));

    if (radiationValues.length === 0) {
      return { peak: null, avg: null, dailyEnergy: null };
    }

    const peak = Math.max(...radiationValues);
    const avg = radiationValues.reduce((sum, r) => sum + r, 0) / radiationValues.length;
    
    // Estimate daily energy in MJ/m² (rough approximation: avg W/m² * hours * 0.0036)
    // This assumes data points are roughly evenly distributed
    const hoursOfData = last24h.length > 1 
      ? (new Date(last24h[last24h.length - 1].timestamp).getTime() - new Date(last24h[0].timestamp).getTime()) / (1000 * 60 * 60)
      : 0;
    const dailyEnergy = avg * hoursOfData * 0.0036;

    return {
      peak: Math.round(peak),
      avg: Math.round(avg),
      dailyEnergy: Math.round(dailyEnergy * 10) / 10,
    };
  }, [sortedHistoricalData, referenceNow]);

  // Calculate ETo statistics from historical data using FAO Penman-Monteith per data point
  const etoStats = useMemo(() => {
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const lat = selectedStation?.latitude || 0;
    const alt = selectedStation?.altitude || 0;

    // Use sortedStatsData (7-day dataset) for more accurate period stats
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const last24h = dataSource.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last7d = dataSource.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last30d = dataSource.filter(d => new Date(d.timestamp).getTime() > thirtyDaysAgo);

    // Calculate ETo per point using FAO formula, then average to get daily rate
    const calculatePeriodETo = (data: WeatherData[]) => {
      const etoValues = data
        .map(d => {
          const temp = d.temperature;
          const hum = d.humidity;
          const ws = d.windSpeed;
          const sr = d.solarRadiation;
          if (temp == null || hum == null || ws == null || sr == null) return null;
          const ts = new Date(d.timestamp);
          const dayOfYear = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / 86400000);
          return calculateETo(temp, hum, windSpeedUnit === 'kmh' ? kmhToMs(ws) : ws, wattsToMJPerDay(sr, ASSUMED_DAYLIGHT_HOURS), alt, lat, dayOfYear);
        })
        .filter((e): e is number => e !== null && e !== undefined && !isNaN(e) && e > 0);
      
      if (etoValues.length === 0) return null;
      
      // Average ETo rate (mm/day) across points in the period
      const avgETo = etoValues.reduce((sum, e) => sum + e, 0) / etoValues.length;
      return Math.round(avgETo * 10) / 10;
    };

    // For daily: average ETo rate (mm/day)
    // For weekly/monthly: average daily rate * number of days in the period
    const dailyETo = calculatePeriodETo(last24h);
    const weeklyETo = calculatePeriodETo(last7d);
    const monthlyETo = calculatePeriodETo(last30d);

    return {
      daily: dailyETo,
      weekly: weeklyETo != null ? Math.round(weeklyETo * 7 * 10) / 10 : null,
      monthly: monthlyETo != null ? Math.round(monthlyETo * 30 * 10) / 10 : null,
    };
  }, [sortedStatsData, sortedHistoricalData, selectedStation?.latitude, selectedStation?.altitude, referenceNow]);

  // Save config to localStorage (per-station only) and invalidate queries when it changes
  const handleConfigChange = useCallback((newConfig: DashboardConfig) => {
    setDashboardConfig(newConfig);
    // Save only for this station. never write to global key
    if (activeStationId) {
      localStorage.setItem(`dashboardConfig_${activeStationId}`, JSON.stringify(newConfig));
    }
    // Invalidate historical data queries to force refresh with new time range
    queryClient.invalidateQueries({ 
      queryKey: ["/api/stations", activeStationId, "data", "history"],
      refetchType: 'active' // Force immediate refetch of active queries
    });
    // Also directly refetch after state update to ensure fresh data
    setTimeout(() => refetchHistorical(), 100);
  }, [queryClient, activeStationId, refetchHistorical]);

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    refetch();
    refetchHistorical();
  }, [refetch, refetchHistorical]);


  const stationOptions = [...stations]
    .sort((a, b) => a.id - b.id)
    .map(s => ({
      id: String(s.id),
      name: s.name,
      location: s.location || "",
      isOnline: s.isActive || false,
    }));

  // Check if viewing demo station (hide admin panels for demo)
  const isDemoStation = selectedStation?.connectionType === 'demo';
  // Check if this is the MPPT-only demo station. hide all non-MPPT sections
  const isMpptOnlyStation = selectedStation?.name?.toUpperCase().includes('MPPT TEST');
  // RIKA stations report SLP as pressure. need to handle differently
  const isRikaStation = selectedStation?.connectionType === 'rikacloud';

  // Use actual data, with sensible defaults for missing fields
  const currentData = latestData
    ? {
        ...latestData,
      }
    : {
        timestamp: null as Date | null,
        temperature: null,
        humidity: null,
        pressure: null,
        windSpeed: null,
        windGust: null,
        windDirection: null,
        solarRadiation: null,
        rainfall: null,
        dewPoint: null,
        airDensity: null,
        eto: null,
        batteryVoltage: null,
        particulateCount: null,
        pm25: null,
        pm10: null,
        atmosphericVisibility: null,
        panelTemperature: null,
        soilTemperature: null,
        soilMoisture: null,
        uvIndex: null,
        co2: null,
        leafWetness: null,
        evapotranspiration: null,
        panelVoltage: null,
        waterLevel: null,
        temperatureSwitch: null,
        levelSwitch: null,
        temperatureSwitchOutlet: null,
        levelSwitchStatus: null,
        lightning: null,
        chargerVoltage: null,
        windDirStdDev: null,
        sdi12WindVector: null,
        pumpSelectWell: null,
        pumpSelectBore: null,
        portStatusC1: null,
        portStatusC2: null,
        mpptSolarVoltage: null,
        mpptSolarCurrent: null,
        mpptSolarPower: null,
        mpptLoadVoltage: null,
        mpptLoadCurrent: null,
        mpptBatteryVoltage: null,
        mpptChargerState: null,
        mpptAbsiAvg: null,
        mpptBoardTemp: null,
        mpptMode: null,
        mppt2SolarVoltage: null,
        mppt2SolarCurrent: null,
        mppt2SolarPower: null,
        mppt2LoadVoltage: null,
        mppt2LoadCurrent: null,
        mppt2BatteryVoltage: null,
        mppt2ChargerState: null,
        mppt2BoardTemp: null,
        mppt2Mode: null,
      };

  // Check if station has valid GPS coordinates
  const hasStationCoordinates = selectedStation?.latitude != null && selectedStation?.longitude != null;

  // Calculate solar position based on station coordinates
  const solarPosition = useMemo(() => {
    const lat = selectedStation?.latitude ?? null;
    const lon = selectedStation?.longitude ?? null;
    if (lat === null || lon === null) {
      // No coordinates set - return null values so UI shows "--" instead of fake data
      return {
        elevation: 0,
        azimuth: 0,
        sunrise: undefined,
        sunset: undefined,
        nauticalDawn: undefined,
        nauticalDusk: undefined,
        solarNoon: undefined,
        dayLength: undefined,
      };
    }
    return calculateSolarPosition(lat, lon);
  }, [selectedStation?.latitude, selectedStation?.longitude]);

  // Calculate air density from current conditions (needs actual station pressure, not SLP)
  const calculatedAirDensity = useMemo(() => {
    const rawPressure = currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA;
    // For RIKA, pressure is SLP. convert to station pressure for density calc
    const stationPressure = isRikaStation
      ? calculateStationPressure(rawPressure, selectedStation?.altitude || 0, currentData.temperature || DEFAULT_TEMPERATURE_C)
      : rawPressure;
    return calculateAirDensity(
      currentData.temperature || DEFAULT_TEMPERATURE_C,
      stationPressure,
      currentData.humidity || DEFAULT_HUMIDITY_PERCENT
    );
  }, [currentData.temperature, currentData.pressure, currentData.humidity, isRikaStation, selectedStation?.altitude]);

  // Process wind energy data from historical data (must be after calculatedAirDensity)
  const windEnergyData = useMemo(() => processWindEnergyData(sortedHistoricalData, calculatedAirDensity, windSpeedUnit, dashboardConfig.chartTimeRange), [sortedHistoricalData, calculatedAirDensity, windSpeedUnit, dashboardConfig.chartTimeRange]);

  // Calculate dew point from temperature and humidity using Magnus formula
  // when the station doesn't report it directly
  const calculatedDewPoint = useMemo(() => {
    const t = currentData.temperature;
    const rh = currentData.humidity;
    if (t == null || rh == null || rh <= 0) return null;
    const a = 17.625;
    const b = 243.04;
    const alpha = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * alpha) / (a - alpha);
  }, [currentData.temperature, currentData.humidity]);

  // Use station-reported dew point, or calculated fallback
  // Only produce a value when there's actual data. never fall back to 0
  const effectiveDewPoint = currentData.dewPoint ?? calculatedDewPoint ?? null;

  // Calculate sea level pressure
  // RIKA stations report SLP (sea-level corrected pressure) as type_code 3003,
  // so we use it directly as SLP and reverse-calculate station pressure
  const seaLevelPressure = useMemo(() => {
    const altitude = selectedStation?.altitude || 0;
    if (isRikaStation) {
      // RIKA pressure IS already SLP. use it directly
      return currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA;
    }
    return calculateSeaLevelPressure(
      currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA,
      altitude,
      currentData.temperature || DEFAULT_TEMPERATURE_C
    );
  }, [currentData.pressure, currentData.temperature, selectedStation?.altitude, isRikaStation]);

  // For RIKA stations, derive station pressure from SLP
  const effectiveStationPressure = useMemo(() => {
    if (isRikaStation) {
      const altitude = selectedStation?.altitude || 0;
      return calculateStationPressure(
        currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA,
        altitude,
        currentData.temperature || DEFAULT_TEMPERATURE_C
      );
    }
    return currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA;
  }, [currentData.pressure, currentData.temperature, selectedStation?.altitude, isRikaStation]);

  // Calculate reference evapotranspiration
  const calculatedETo = useMemo(() => {
    const lat = selectedStation?.latitude || 0;
    const altitude = selectedStation?.altitude || 0;
    const dayOfYear = getDayOfYear();
    // Convert solar radiation from W/m² to MJ/m²/day (assuming 12hr daylight average)
    const solarMJ = wattsToMJPerDay(currentData.solarRadiation || 0, ASSUMED_DAYLIGHT_HOURS);
    // Wind speed is already in m/s
    const windMs = currentData.windSpeed || 0;
    
    return calculateETo(
      currentData.temperature || DEFAULT_TEMPERATURE_C,
      currentData.humidity || DEFAULT_HUMIDITY_PERCENT,
      windMs,
      solarMJ,
      altitude,
      lat,
      dayOfYear
    );
  }, [
    currentData.temperature, 
    currentData.humidity, 
    currentData.windSpeed, 
    currentData.solarRadiation,
    selectedStation?.latitude,
    selectedStation?.altitude
  ]);

  // Generate fire danger chart data from historical data
  const fireDangerChartData = useMemo(() => {
    return chartData.map((d) => {
      const fd = calculateFireDanger(d.temperature ?? 20, d.humidity ?? 50, d.windSpeed ?? 0);
      return {
        timestamp: d.timestamp,
        ffdi: fd.ffdi,
        temperature: d.temperature ?? 0,
        humidity: d.humidity ?? 0,
        windSpeed: d.windSpeed ?? 0,
      };
    });
  }, [chartData]);

  // Calculate trends by comparing latest vs historical average
  const trends = useMemo(() => {
    if (historicalData.length < 2) {
      return { temperature: null, humidity: null, pressure: null };
    }
    
    // Get average of first half vs last value
    const halfLen = Math.floor(historicalData.length / 2);
    const olderData = historicalData.slice(0, halfLen);
    
    const avgOldTemp = olderData.reduce((sum, d) => sum + (d.temperature ?? 0), 0) / halfLen;
    const avgOldHumidity = olderData.reduce((sum, d) => sum + (d.humidity ?? 0), 0) / halfLen;
    const avgOldPressure = olderData.reduce((sum, d) => sum + (d.pressure ?? 0), 0) / halfLen;
    
    const currentTemp = currentData.temperature ?? 0;
    const currentHum = currentData.humidity ?? 0;
    const currentPress = currentData.pressure ?? 0;
    
    return {
      temperature: avgOldTemp !== 0 ? currentTemp - avgOldTemp : null,
      humidity: avgOldHumidity !== 0 ? currentHum - avgOldHumidity : null,
      pressure: avgOldPressure !== 0 ? currentPress - avgOldPressure : null,
    };
  }, [historicalData, currentData]);

  // Calculate accumulated rainfall from historical data (always uses 24h window)
  // Uses statsData (7-day) to ensure coverage even if chart time range is short
  // This is historical-data-dependent, not VPS-uptime-dependent
  const { accumulatedRainfall, isRainfallStale, effectiveRainfall } = useMemo(() => {
    // Use statsData (7-day) if available, ensuring we always have data even after VPS restarts
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    
    // Filter to last 24 hours from the data's own timestamps (not system uptime)
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const last24hData = dataSource.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    
    const rainfallReadings = last24hData
      .map(d => d.rainfall)
      .filter((v): v is number => v !== null && v !== undefined);
    
    if (rainfallReadings.length < 2) {
      const currentRain = currentData.rainfall ?? 0;
      if (rainfallReadings.length === 1 && currentRain > 0 && Math.abs(currentRain - rainfallReadings[0]) < 0.1) {
        return { accumulatedRainfall: 0, isRainfallStale: true, effectiveRainfall: 0 };
      }
      return { accumulatedRainfall: 0, isRainfallStale: false, effectiveRainfall: currentRain };
    }
    
    const minVal = Math.min(...rainfallReadings);
    const maxVal = Math.max(...rainfallReadings);
    const range = maxVal - minVal;
    
    // If all rainfall values within 24h are essentially the same (< 0.1mm variation),
    // the station is likely sending cumulative rainfall that hasn't changed. treat as no rain
    const isStale = range < 0.1;
    const rainfallChange = isStale ? 0 : range;
    
    return {
      accumulatedRainfall: rainfallChange,
      isRainfallStale: isStale,
      effectiveRainfall: isStale ? 0 : rainfallChange,
    };
  }, [sortedStatsData, sortedHistoricalData, currentData.rainfall]);

  // Extract battery voltage from historical data for proper charting
  const batteryChartData = useMemo(() => {
    const effectiveRange = dashboardConfig.chartTimeRange || 24;
    if (effectiveRange >= 168 && sortedHistoricalData.length > 0) {
      // Daily aggregation for 7d+ ranges
      const dayBuckets = new Map<string, number[]>();
      sortedHistoricalData.forEach(d => {
        if (d.batteryVoltage == null) return;
        const key = new Date(d.timestamp).toISOString().slice(0, 10);
        if (!dayBuckets.has(key)) dayBuckets.set(key, []);
        dayBuckets.get(key)!.push(d.batteryVoltage);
      });
      return [...dayBuckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dateKey, voltages]) => {
          const date = new Date(dateKey + 'T12:00:00');
          return {
            timestamp: date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" }),
            batteryVoltage: Math.round((voltages.reduce((a, b) => a + b, 0) / voltages.length) * 100) / 100,
            batteryVoltageMin: Math.round(Math.min(...voltages) * 100) / 100,
            batteryVoltageMax: Math.round(Math.max(...voltages) * 100) / 100,
          };
        });
    }
    return sortedHistoricalData.map(d => ({
      timestamp: new Date(d.timestamp).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
      batteryVoltage: d.batteryVoltage ?? 0,
    }));
  }, [sortedHistoricalData, dashboardConfig.chartTimeRange]);

  // Battery charging daily check. detect if battery charged in the last 24h
  const batteryChargingStatus = useMemo(() => {
    const batteryReadings = sortedHistoricalData
      .filter(d => d.batteryVoltage != null && d.batteryVoltage > 0);
    if (batteryReadings.length < 2) return { hasData: false, didCharge: true, maxVoltage: 0, minVoltage: 0 };
    
    const voltages = batteryReadings.map(d => d.batteryVoltage!);
    const maxV = Math.max(...voltages);
    const minV = Math.min(...voltages);
    // Battery charges when voltage rises above 13.0V (solar panel active)
    // A voltage swing of at least 0.3V also indicates charging activity
    const didCharge = maxV > 13.0 || (maxV - minV) > 0.3;
    return { hasData: true, didCharge, maxVoltage: maxV, minVoltage: minV };
  }, [sortedHistoricalData]);

  const sparkline = chartData.slice(-12).map(d => d.temperature).filter((v): v is number => v != null);
  
  // Calculate max wind speed from actual observations, not from wind rose bin counts
  const maxWindSpeed = useMemo(() => {
    const speeds = historicalData
      .map(d => Math.max(d.windSpeed ?? 0, d.windGust ?? 0))
      .filter(s => s > 0);
    return Math.max(currentData.windGust ?? 0, currentData.windSpeed ?? 0, ...speeds);
  }, [historicalData, currentData.windGust, currentData.windSpeed]);

  // === Early returns (MUST be after all hooks to avoid React Error #310) ===

  // Show message if user has no stations assigned
  if (!isAdmin && stations.length === 0 && !stationsLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center space-y-4">
          <Radio className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
          <h2 className="text-base font-normal text-foreground">No Stations Assigned</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            You don't have any weather stations assigned to your account yet.
            Please contact your administrator to get access to station dashboards.
          </p>
        </div>
      </div>
    );
  }

  if (stationsLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 px-8">
            <Radio className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-base font-normal text-foreground mb-2">No Weather Stations</h2>
            <p className="text-sm text-muted-foreground text-center mb-4 max-w-sm">
              {isAdmin 
                ? "Add a weather station to start monitoring weather data on your dashboard."
                : "No stations have been assigned to your account yet."}
            </p>
            {isAdmin && (
              <Link href="/stations">
                <Button data-testid="button-add-station-dashboard">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Station
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8">
      {/* Header Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between no-print">
        <div className="flex items-center gap-3">
          {onBackToStations && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onBackToStations}
              className="flex items-center gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Stations</span>
            </Button>
          )}
          <StationSelector
            stations={stationOptions}
            selectedId={String(activeStationId)}
            onSelect={(id) => setSelectedStationId(parseInt(id))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updates every {dashboardConfig.updatePeriod < 60 
              ? `${dashboardConfig.updatePeriod}s` 
              : `${Math.floor(dashboardConfig.updatePeriod / 60)}m`}
          </Badge>
          {dataTimeRange && (
            <Badge 
              variant={dataTimeRange.hoursAvailable < dashboardConfig.chartTimeRange ? "secondary" : "outline"} 
              className="text-xs"
              title={`Data from ${dataTimeRange.earliest.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false })} to ${dataTimeRange.latest.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false })}`}
            >
              {dataTimeRange.hoursAvailable < dashboardConfig.chartTimeRange 
                ? `${safeFixed(dataTimeRange.hoursAvailable, 1)}h of ${dashboardConfig.chartTimeRange}h data`
                : `${dashboardConfig.chartTimeRange}h data`
              } ({dataTimeRange.recordCount} records)
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={dataLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${dataLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <DashboardConfigPanel
            config={dashboardConfig}
            onConfigChange={handleConfigChange}
            onRefresh={handleRefresh}
            availableFields={availableFields}
          />
          {activeStationId && !isDemoStation && (
            <DataImport 
              stationId={activeStationId} 
              stationName={selectedStation?.name || "Weather Station"} 
            />
          )}
          {activeStationId && selectedStation && !isDemoStation && (
            <ShareDashboard 
              stationId={activeStationId} 
              stationName={selectedStation.name} 
            />
          )}
        </div>
      </div>

      <div id="dashboard-content" className="space-y-6">
        {/* Current Conditions Header */}
        {!isMpptOnlyStation && (
        <CurrentConditions
          stationName={selectedStation?.name || "Weather Station"}
          lastUpdate={(currentData as any).collectedAt || currentData.timestamp || "No data"}
          temperature={availableFields.temperature ? (currentData.temperature ?? undefined) : undefined}
          humidity={availableFields.humidity ? (currentData.humidity ?? undefined) : undefined}
          pressure={availableFields.pressure ? (currentData.pressure ?? undefined) : undefined}
          windSpeed={availableFields.windSpeed ? (currentData.windSpeed ?? undefined) : undefined}
          windGust={availableFields.windSpeed ? (currentData.windGust ?? undefined) : undefined}
          windDirection={availableFields.windDirection ? (currentData.windDirection ?? undefined) : undefined}
          solarRadiation={availableFields.solarRadiation ? (currentData.solarRadiation ?? undefined) : undefined}
          rainfall={availableFields.rainfall ? (currentData.rainfall ?? undefined) : undefined}
          dewPoint={effectiveDewPoint != null && effectiveDewPoint !== 0 ? effectiveDewPoint : undefined}
          isOnline={selectedStation?.isActive || false}
          connectionType={selectedStation?.connectionType ?? undefined}
          syncInterval={3600000} // 1 hour Dropbox sync interval
          latitude={selectedStation?.latitude ?? undefined}
          longitude={selectedStation?.longitude ?? undefined}
        />
        )}

        {/* Station Location Map */}
        {!isMpptOnlyStation && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Station Location</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Suspense fallback={<ChartFallback />}>
            <StationMapWithErrorBoundary
              key={`map-${selectedStation?.id || 'default'}-${selectedStation?.latitude ?? 'nolat'}-${selectedStation?.longitude ?? 'nolng'}`}
              latitude={selectedStation?.latitude ?? undefined}
              longitude={selectedStation?.longitude ?? undefined}
              stationName={selectedStation?.name || "Weather Station"}
              altitude={selectedStation?.altitude ?? undefined}
            />
            </Suspense>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-normal">Station Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Latitude</p>
                    <p className="text-sm font-normal">{safeFixed(selectedStation?.latitude, 6, "Not set")}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Longitude</p>
                    <p className="text-sm font-normal">{safeFixed(selectedStation?.longitude, 6, "Not set")}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Altitude</p>
                    <p className="text-sm font-normal">{selectedStation?.altitude ? `${selectedStation.altitude} m` : "Not set"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Location</p>
                    <p className="text-sm font-normal">{selectedStation?.location || "Not specified"}</p>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-muted-foreground">Station Type</p>
                    <p className="text-sm font-normal">{selectedStation?.dataloggerModel || selectedStation?.stationType || "Weather Station"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
        )}

        {/* Primary Metrics - Only show cards with data (use availableFields which excludes all-zero sensors) */}
        {!isMpptOnlyStation && (availableFields.temperature || availableFields.humidity || availableFields.pressure || availableFields.windSpeed || availableFields.rainfall) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Primary Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {availableFields.temperature && (
            <MetricCard
              title="Temperature"
              value={formatValue(currentData.temperature || 0, 1)}
              unit="°C"
              trend={trends.temperature !== null ? { value: parseFloat(safeFixed(trends.temperature, 1, "0")), label: "vs avg" } : undefined}
              subMetrics={effectiveDewPoint != null ? [{ label: "Dew Point", value: `${formatValue(effectiveDewPoint, 1)} °C` }] : undefined}
              sparklineData={sparkline}
              chartColor="#ef4444"
            />
            )}
            {availableFields.humidity && (
            <MetricCard
              title="Relative Humidity"
              value={formatValue(currentData.humidity || 0, 1)}
              unit="%"
              trend={trends.humidity !== null ? { value: parseFloat(safeFixed(trends.humidity, 1, "0")), label: "vs avg" } : undefined}
              sparklineData={chartData.slice(-12).map(d => d.humidity).filter((v): v is number => v != null)}
              chartColor="#3b82f6"
            />
            )}
            {availableFields.windDirection && currentData.windDirection != null && (
              <MetricCard
                title="Wind Direction"
                value={getWindDirectionLabel(currentData.windDirection)}
                unit={`${Math.round(currentData.windDirection)}°`}
                chartColor="#22c55e"
              />
            )}
            {availableFields.pressure && (
            <MetricCard
              title="Pressure"
              value={formatValue(currentData.pressure || 0, 1)}
              unit="hPa"
              trend={trends.pressure !== null ? { value: parseFloat(safeFixed(trends.pressure, 1, "0")), label: "vs avg" } : undefined}
              sparklineData={chartData.slice(-12).map(d => d.pressure).filter((v): v is number => v != null)}
              chartColor="#3b82f6"
            />
            )}
            {availableFields.windSpeed && (
            <MetricCard
              title="Wind Speed"
              value={formatValue(currentData.windSpeed || 0, 1)}
              unit={windUnitLabel}
              subMetrics={[
                { label: "Gust", value: `${formatValue(currentData.windGust || 0, 1)} ${windUnitLabel}` },
              ]}
              sparklineData={chartData.slice(-12).map(d => d.windSpeed).filter((v): v is number => v != null)}
              chartColor="#22c55e"
            />
            )}
            {availableFields.rainfall && (
            <MetricCard
              title="Rainfall (24h)"
              value={formatValue(effectiveRainfall, 2)}
              unit="mm"
              subMetrics={[
                { label: "Period Total", value: `${formatValue(accumulatedRainfall, 1)} mm` },
                ...(isRainfallStale ? [{ label: "Status", value: "No change detected" }] : []),
              ]}
              sparklineData={chartData.slice(-12).map(d => d.rain)}
              chartColor="#3b82f6"
            />
            )}
          </div>
          
          {/* Primary Metrics Dedicated Charts - Grid Layout */}
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.temperature && (
              <DataBlockChart
                title="Temperature"
                data={chartData}
                series={[
                  { dataKey: "temperature", name: "Temperature", color: "#ef4444", unit: "°C" },
                ]}
                chartType="area"
                xAxisLabel="Time"
                yAxisLabel="Temperature"
                showAverage={true}
                showMinMax={true}
                currentValue={currentData.temperature || 0}
                trend={trends.temperature !== null ? { value: parseFloat(safeFixed(trends.temperature, 1, "0")), label: "vs avg" } : undefined}
              />
            )}
            {availableFields.humidity && (
              <DataBlockChart
                title="Relative Humidity"
                data={chartData}
              series={[
                { dataKey: "humidity", name: "Relative Humidity", color: "#3b82f6", unit: "%" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Relative Humidity"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.humidity || 0}
              trend={trends.humidity !== null ? { value: parseFloat(safeFixed(trends.humidity, 1, "0")), label: "vs avg" } : undefined}
            />
            )}
          </div>
          </Suspense>
          
          {/* Barometric Pressure Section with Sea Level and Station Level */}
          {availableFields.pressure && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarometricPressureCard
              stationPressure={effectiveStationPressure}
              seaLevelPressure={seaLevelPressure}
              altitude={selectedStation?.altitude || 0}
              temperature={currentData.temperature || DEFAULT_TEMPERATURE_C}
              trend={trends.pressure !== null ? parseFloat(safeFixed(trends.pressure, 1, "0")) : 0}
              sparklineDataStation={chartData.slice(-24).map(d => isRikaStation ? calculateStationPressure(d.pressure ?? 0, selectedStation?.altitude || 0, d.temperature ?? 20) : (d.pressure ?? 0)).filter((v): v is number => v != null)}
              sparklineDataSeaLevel={chartData.slice(-24).map(d => isRikaStation ? (d.pressure ?? 0) : calculateSeaLevelPressure(d.pressure ?? 0, selectedStation?.altitude || 0, d.temperature ?? 20)).filter((v): v is number => v != null)}
            />
            <DataBlockChart
              title="Barometric Pressure History"
              data={chartData}
              series={[
                { dataKey: "pressure", name: "Station Pressure", color: "#3b82f6", unit: "hPa" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Pressure"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.pressure || 0}
            />
          </div>
          )}
        </section>
        )}

        {/* Logger Battery Section - Only show if battery data exists */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.loggerBattery !== false && availableFields.batteryVoltage && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Logger Battery Status</h2>
          {/* Battery Not Charging Warning */}
          {batteryChargingStatus.hasData && !batteryChargingStatus.didCharge && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-medium">Battery Not Charging</p>
                <p className="text-xs text-amber-600">
                  No charging activity detected in the last 24 hours. Voltage range: {batteryChargingStatus.minVoltage.toFixed(2)}V – {batteryChargingStatus.maxVoltage.toFixed(2)}V. 
                  Check solar panel, wiring, or charge controller.
                </p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BatteryVoltageCard
              voltage={currentData.batteryVoltage || 0}
              minVoltage={11.5}
              maxVoltage={14.5}
              isCharging={currentData.batteryVoltage ? currentData.batteryVoltage > 13.5 && ((currentData.solarRadiation ?? 0) > 0 || (currentData.mpptSolarPower != null ? Number(currentData.mpptSolarPower) > 0 : false)) : false}
              sparklineData={batteryChartData.slice(-24).map(d => d.batteryVoltage)}
            />
            <DataBlockChart
              title="Battery Voltage History"
              data={batteryChartData}
              series={[
                { dataKey: "batteryVoltage", name: "Battery Voltage", color: "#22c55e", unit: "V" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Voltage"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.batteryVoltage || 0}
              defaultExpanded={false}
            />
            {hasValidData(currentData.panelTemperature) && currentData.panelTemperature !== 0 && (
            <MetricCard
              title="Panel Temperature"
              value={formatValue(currentData.panelTemperature || 0, 1)}
              unit="°C"
              chartColor="#ef4444"
            />
            )}
          </div>
        </section>
        )}

        {/* MPPT Solar Charge Controller Section */}
        {dashboardConfig.sectionVisibility?.mpptCharger !== false && (availableFields.mpptSolarVoltage || availableFields.mpptSolarCurrent || availableFields.mpptSolarPower || availableFields.mpptLoadVoltage || availableFields.mpptLoadCurrent || availableFields.mpptBatteryVoltage || availableFields.mpptChargerState || availableFields.mpptAbsiAvg || availableFields.mppt2SolarVoltage) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">MPPT Solar Charge Controller</h2>
          {isMpptOnlyStation && (
          <div className="rounded-md border border-gray-300 px-4 py-2 text-sm text-black">
            Test Data – MPPT values shown below are simulated for demonstration purposes and do not represent real-world measurements.
          </div>
          )}
          {/* Charger Cards */}
          <div className={`grid grid-cols-1 ${availableFields.mppt2SolarVoltage ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'} gap-6`}>
            <MpptChargerCard
              label={availableFields.mppt2SolarVoltage ? 'Charger 1' : undefined}
              solarVoltage={currentData.mpptSolarVoltage ?? null}
              solarCurrent={currentData.mpptSolarCurrent ?? null}
              solarPower={currentData.mpptSolarPower ?? null}
              loadVoltage={currentData.mpptLoadVoltage ?? null}
              loadCurrent={currentData.mpptLoadCurrent ?? null}
              batteryVoltage={currentData.mpptBatteryVoltage ?? null}
              chargerState={currentData.mpptChargerState ?? null}
              mpptAbsiAvg={currentData.mpptAbsiAvg ?? null}
              boardTemp={currentData.mpptBoardTemp ?? null}
              mode={currentData.mpptMode ?? null}
            />
            {availableFields.mppt2SolarVoltage && (
            <MpptChargerCard
              label="Charger 2"
              solarVoltage={currentData.mppt2SolarVoltage ?? null}
              solarCurrent={currentData.mppt2SolarCurrent ?? null}
              solarPower={currentData.mppt2SolarPower ?? null}
              loadVoltage={currentData.mppt2LoadVoltage ?? null}
              loadCurrent={currentData.mppt2LoadCurrent ?? null}
              batteryVoltage={currentData.mppt2BatteryVoltage ?? null}
              chargerState={currentData.mppt2ChargerState ?? null}
              mpptAbsiAvg={null}
              boardTemp={currentData.mppt2BoardTemp ?? null}
              mode={currentData.mppt2Mode ?? null}
            />
            )}
            {!availableFields.mppt2SolarVoltage && (availableFields.mpptSolarVoltage || availableFields.mpptChargerState) && (
            <DataBlockChart
              title="Solar Voltage & Charger State"
              data={chartData}
              series={[
                ...(availableFields.mpptSolarVoltage ? [{ dataKey: "mpptSolarVoltage", name: "Solar Voltage", color: "#ef4444", unit: "V" }] : []),
                ...(availableFields.mpptChargerState ? [{ dataKey: "mpptChargerState", name: "Charger State", color: "#22c55e", unit: "" }] : []),
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Voltage"
              showAverage={false}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
            )}
            {!availableFields.mppt2SolarVoltage && (availableFields.mpptLoadVoltage || availableFields.mpptBatteryVoltage) && (
            <DataBlockChart
              title="Load & Battery Voltage"
              data={chartData}
              series={[
                ...(availableFields.mpptLoadVoltage ? [{ dataKey: "mpptLoadVoltage", name: "Load Voltage", color: "#ef4444", unit: "V" }] : []),
                ...(availableFields.mpptBatteryVoltage ? [{ dataKey: "mpptBatteryVoltage", name: "Battery Voltage", color: "#3b82f6", unit: "V" }] : []),
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Voltage"
              showAverage={true}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
            )}
          </div>
          {/* Charts - Solar Voltage comparison for dual charger */}
          {availableFields.mppt2SolarVoltage && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DataBlockChart
              title="Solar Voltage – Charger 1 vs 2"
              data={chartData}
              series={[
                { dataKey: "mpptSolarVoltage", name: "Charger 1", color: "#ef4444", unit: "V" },
                { dataKey: "mppt2SolarVoltage", name: "Charger 2", color: "#3b82f6", unit: "V" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Voltage"
              showAverage={false}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
            <DataBlockChart
              title="Battery Voltage – Charger 1 vs 2"
              data={chartData}
              series={[
                { dataKey: "mpptBatteryVoltage", name: "Charger 1", color: "#3b82f6", unit: "V" },
                { dataKey: "mppt2BatteryVoltage", name: "Charger 2", color: "#3b82f6", unit: "V" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Voltage"
              showAverage={true}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
          </div>
          )}
          {/* Current & Power charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {(availableFields.mpptSolarCurrent || availableFields.mpptLoadCurrent || availableFields.mpptAbsiAvg) && (
            <DataBlockChart
              title={availableFields.mppt2SolarVoltage ? "Charger 1 – Current" : "Solar Current, Load Current & MPPT Current"}
              data={chartData}
              series={[
                ...(availableFields.mpptSolarCurrent ? [{ dataKey: "mpptSolarCurrent", name: "Solar Current", color: "#ef4444", unit: "mA" }] : []),
                ...(availableFields.mpptLoadCurrent ? [{ dataKey: "mpptLoadCurrent", name: "Load Current", color: "#3b82f6", unit: "mA" }] : []),
                ...(availableFields.mpptAbsiAvg ? [{ dataKey: "mpptAbsiAvg", name: "MPPT Avg Current", color: "#22c55e", unit: "mA" }] : []),
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Current"
              showAverage={false}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
            )}
            {availableFields.mppt2SolarCurrent && (
            <DataBlockChart
              title="Charger 2 – Current"
              data={chartData}
              series={[
                { dataKey: "mppt2SolarCurrent", name: "Solar Current", color: "#3b82f6", unit: "mA" },
                ...(availableFields.mppt2LoadCurrent ? [{ dataKey: "mppt2LoadCurrent", name: "Load Current", color: "#3b82f6", unit: "mA" }] : []),
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Current"
              showAverage={false}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
            )}
            {availableFields.mpptSolarPower && (
            <DataBlockChart
              title={availableFields.mppt2SolarPower ? "Charger 1 – Solar Power" : "Solar Power"}
              data={chartData}
              series={[
                { dataKey: "mpptSolarPower", name: "Solar Power", color: "#ef4444", unit: "W" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Power"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.mpptSolarPower ?? 0}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
            )}
            {availableFields.mppt2SolarPower && (
            <DataBlockChart
              title="Charger 2 – Solar Power"
              data={chartData}
              series={[
                { dataKey: "mppt2SolarPower", name: "Solar Power", color: "#3b82f6", unit: "W" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Power"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.mppt2SolarPower ?? 0}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
            )}
          </div>
          {/* Board Temperature chart for dual charger */}
          {(availableFields.mpptBoardTemp || availableFields.mppt2BoardTemp) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DataBlockChart
              title="Board Temperature"
              data={chartData}
              series={[
                ...(availableFields.mpptBoardTemp ? [{ dataKey: "mpptBoardTemp", name: "Charger 1", color: "#ef4444", unit: "°C" }] : []),
                ...(availableFields.mppt2BoardTemp ? [{ dataKey: "mppt2BoardTemp", name: "Charger 2", color: "#3b82f6", unit: "°C" }] : []),
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Temperature"
              showAverage={true}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
            />
          </div>
          )}
        </section>
        )}

        {/* Water & Sensors Section - Only show if any water/sensor data exists AND section enabled */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.waterSensors !== false && (availableFields.waterLevel || availableFields.temperatureSwitch || availableFields.levelSwitch || availableFields.temperatureSwitchOutlet || availableFields.levelSwitchStatus || availableFields.lightning || availableFields.chargerVoltage) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Water & Sensors</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {availableFields.waterLevel && (
              <MetricCard
                title="Water Level"
                value={formatValue(currentData.waterLevel || 0, 1)}
                unit="mm"
                sparklineData={chartData.slice(-24).map(d => d.waterLevel).filter((v): v is number => v != null)}
                chartColor="#3b82f6"
              />
            )}
            {availableFields.temperatureSwitch && (
              <MetricCard
                title="Temp Switch"
                value={formatValue(currentData.temperatureSwitch || 0, 1)}
                unit="mV"
                sparklineData={chartData.slice(-24).map(d => d.temperatureSwitch).filter((v): v is number => v != null)}
                chartColor="#ef4444"
              />
            )}
            {availableFields.levelSwitch && (
              <MetricCard
                title="Level Switch"
                value={(currentData.levelSwitch ?? 0) > 100 ? "On" : "Off"}
                unit=""
                chartColor={(currentData.levelSwitch ?? 0) > 100 ? "#22c55e" : "#6b7280"}
              />
            )}
            {availableFields.temperatureSwitchOutlet && (
              <MetricCard
                title="Temp Switch Outlet"
                value={formatValue(currentData.temperatureSwitchOutlet || 0, 1)}
                unit="mV"
                sparklineData={chartData.slice(-24).map(d => d.temperatureSwitchOutlet).filter((v): v is number => v != null)}
                chartColor="#ef4444"
              />
            )}
            {availableFields.levelSwitchStatus && (
              <MetricCard
                title="Level Switch Status"
                value={(currentData.levelSwitchStatus ?? 0) > 0 ? "On" : "Off"}
                unit=""
                chartColor={(currentData.levelSwitchStatus ?? 0) > 0 ? "#22c55e" : "#6b7280"}
              />
            )}
            {availableFields.lightning && (
              <MetricCard
                title="Lightning"
                value={formatValue(currentData.lightning || 0, 0)}
                unit="strikes"
                sparklineData={chartData.slice(-24).map(d => d.lightning).filter((v): v is number => v != null)}
                chartColor="#22c55e"
              />
            )}
            {availableFields.chargerVoltage && (
              <MetricCard
                title="Charger Voltage"
                value={formatValue(currentData.chargerVoltage || 0, 2)}
                unit="V"
                sparklineData={chartData.slice(-24).map(d => d.chargerVoltage).filter((v): v is number => v != null)}
                chartColor="#22c55e"
              />
            )}
          </div>
          {/* Water Level Chart */}
          {availableFields.waterLevel && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DataBlockChart
              title="Water Level History"
              data={chartData}
              series={[
                { dataKey: "waterLevel", name: "Water Level", color: "#3b82f6", unit: "mm" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Water Level"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.waterLevel || 0}
            />
            {availableFields.temperatureSwitch && (
            <DataBlockChart
              title="Temperature Switch History"
              data={chartData}
              series={[
                { dataKey: "temperatureSwitch", name: "Temp Switch", color: "#ef4444", unit: "mV" },
                ...(availableFields.temperatureSwitchOutlet ? [{ dataKey: "temperatureSwitchOutlet", name: "Temp Switch Outlet", color: "#ef4444", unit: "mV" }] : []),
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Millivolts (mV)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.temperatureSwitch || 0}
            />
            )}
          </div>
          )}
        </section>
        )}

        {/* Solar & Radiation Section - only show when station has coordinates or solar data */}
        {!isMpptOnlyStation && (dashboardConfig.sectionVisibility?.solarRadiation !== false || dashboardConfig.sectionVisibility?.solarPosition !== false) && (hasStationCoordinates || availableFields.solarRadiation || availableFields.uvIndex) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar Position & Radiation</h2>
          
          {/* Solar Position and Air Density Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {dashboardConfig.sectionVisibility?.solarPosition !== false && hasStationCoordinates && (
            <SolarPositionCard
              elevation={solarPosition.elevation}
              azimuth={solarPosition.azimuth}
              sunrise={solarPosition.sunrise}
              sunset={solarPosition.sunset}
              nauticalDawn={solarPosition.nauticalDawn}
              nauticalDusk={solarPosition.nauticalDusk}
              solarNoon={solarPosition.solarNoon}
              dayLength={solarPosition.dayLength}
            />
            )}
            {(availableFields.temperature && availableFields.pressure) && (
            <AirDensityCard
              airDensity={currentData.airDensity || calculatedAirDensity}
              temperature={currentData.temperature ?? undefined}
              pressure={currentData.pressure ?? undefined}
              humidity={currentData.humidity ?? undefined}
            />
            )}
          </div>
          
          
          {/* Solar Position Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Solar Radiation Chart */}
            {availableFields.solarRadiation && (
            <DataBlockChart
              title="Solar Radiation"
              data={chartData}
              series={[
                { dataKey: "solar", name: "Solar Radiation", color: "#ef4444", unit: "W/m²" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Radiation"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.solarRadiation || 0}
            />
            )}
            {/* Reference ETo Chart */}
            {availableFields.solarRadiation && (
            <DataBlockChart
              title="Reference ETo"
              data={chartData}
              series={[
                { dataKey: "eto", name: "Reference ETo", color: "#22c55e", unit: "mm/day" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="ETo (mm/day)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.eto ?? calculatedETo ?? 0}
            />
            )}
            {/* Dew Point 7-day Chart - Always shows when temp+humidity available */}
            {(availableFields.temperature && availableFields.humidity) && dewPointChartData.length > 0 && (
            <DataBlockChart
              title="Dew Point Temperature (7 days)"
              data={dewPointChartData}
              series={[
                { dataKey: "dewPoint", name: "Dew Point", color: "#3b82f6", unit: "°C" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Dew Point (°C)"
              showAverage={true}
              showMinMax={true}
              currentValue={effectiveDewPoint ?? 0}
            />
            )}
            {/* Sun Elevation & Azimuth Chart - Calculated from station coordinates */}
            {dashboardConfig.sectionVisibility?.solarPosition !== false && hasStationCoordinates && (
            <DataBlockChart
              title="Sun Elevation & Azimuth (24h)"
              data={(() => {
                const lat = selectedStation?.latitude || 0;
                const lon = selectedStation?.longitude || 0;
                const now = new Date();
                const points = [];
                for (let h = 0; h < 24; h++) {
                  for (let m = 0; m < 60; m += 30) {
                    const time = new Date(now);
                    time.setHours(h, m, 0, 0);
                    const dayOfYear = Math.floor((time.getTime() - new Date(time.getFullYear(), 0, 0).getTime()) / 86400000);
                    const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
                    const hourAngle = 15 * (h + m / 60 - 12 + (lon / 15));
                    const latRad = lat * Math.PI / 180;
                    const declRad = declination * Math.PI / 180;
                    const haRad = hourAngle * Math.PI / 180;
                    const elevation = Math.asin(
                      Math.sin(latRad) * Math.sin(declRad) +
                      Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad)
                    ) * 180 / Math.PI;
                    const azimuth = (Math.atan2(
                      Math.sin(haRad),
                      Math.cos(haRad) * Math.sin(latRad) - Math.tan(declRad) * Math.cos(latRad)
                    ) * 180 / Math.PI + 180) % 360;
                    points.push({
                      timestamp: time.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
                      sunElevation: Math.round(elevation * 10) / 10,
                      sunAzimuth: Math.round(azimuth * 10) / 10
                    });
                  }
                }
                return points;
              })()}
              series={[
                { dataKey: "sunElevation", name: "Sun Elevation", color: "#3b82f6", unit: "°" },
                { dataKey: "sunAzimuth", name: "Sun Azimuth", color: "#ef4444", unit: "°" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Degrees"
              yAxisDomain={[-80, 360]}
              showAverage={false}
              showMinMax={false}
              currentValue={solarPosition.elevation}
            />
            )}
          </div>



          {/* Solar Power Harvesting Potential - only show when solar radiation data available */}
          {availableFields.solarRadiation && (
            <SolarPowerHarvestCard
              currentRadiation={availableFields.solarRadiation ? currentData.solarRadiation : null}
              dailyAverageRadiation={avgDaytimeRadiation}
              panelEfficiency={0.20}
              systemLosses={0.15}
            />
          )}
        </section>
        )}

        {/* Soil & Environment Section - Only show if any soil/air quality data exists */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.soilEnvironment !== false && (availableFields.soilTemperature || availableFields.soilMoisture || availableFields.pm25 || availableFields.pm10) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Soil & Environment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {availableFields.soilTemperature && (
            <MetricCard
              title="Soil Temperature"
              value={formatValue(currentData.soilTemperature || 0, 1)}
              unit="°C"
              chartColor="#ef4444"
            />
            )}
            {availableFields.soilMoisture && (
            <MetricCard
              title="Soil Moisture"
              value={formatValue(currentData.soilMoisture || 0, 1)}
              unit="%"
              subMetrics={[
                { label: "Status", value: (currentData.soilMoisture || 0) < 20 ? "Dry" : (currentData.soilMoisture || 0) < 40 ? "Optimal" : "Wet" },
              ]}
              chartColor="#22c55e"
            />
            )}
            {availableFields.pm25 && (
            <MetricCard
              title="PM2.5"
              value={formatValue(currentData.pm25 || 0, 1)}
              unit="µg/m³"
              subMetrics={[
                { label: "AQI", value: (currentData.pm25 || 0) < 12 ? "Good" : (currentData.pm25 || 0) < 35 ? "Moderate" : "Unhealthy" },
              ]}
              chartColor="#3b82f6"
            />
            )}
            {availableFields.pm10 && (
            <MetricCard
              title="PM10"
              value={formatValue(currentData.pm10 || 0, 1)}
              unit="µg/m³"
              chartColor="#22c55e"
            />
            )}
          </div>
          
          {/* Soil Charts - Only show if soil data available */}
          {(availableFields.soilTemperature || availableFields.soilMoisture) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.soilTemperature && (
            <DataBlockChart
              title="Soil Temperature"
              data={chartData.filter(d => d.soilTemperature !== null).map(d => ({ ...d, soilTemp: d.soilTemperature }))}
              series={[
                { dataKey: "soilTemp", name: "Soil Temp", color: "#ef4444", unit: "°C" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Temperature"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.soilTemperature || 0}
            />
            )}
            {availableFields.soilMoisture && (
            <DataBlockChart
              title="Soil Moisture"
              data={chartData.filter(d => d.soilMoisture !== null).map(d => ({ ...d, soilMoist: d.soilMoisture }))}
              series={[
                { dataKey: "soilMoist", name: "Moisture", color: "#22c55e", unit: "%" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Moisture"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.soilMoisture || 0}
            />
            )}
          </div>
          )}

          {/* Air Quality Charts - Only show if PM data available */}
          {(availableFields.pm10 || availableFields.pm25) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.pm10 && (
            <DataBlockChart
              title="PM10 History"
              data={chartData.filter(d => d.pm10 !== null && d.pm10 !== undefined).map(d => ({ ...d, pm10Val: d.pm10 }))}
              series={[
                { dataKey: "pm10Val", name: "PM10", color: "#ef4444", unit: "µg/m³" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="PM10"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.pm10 || 0}
            />
            )}
            {availableFields.pm25 && (
            <DataBlockChart
              title="PM2.5 History"
              data={chartData.filter(d => d.pm25 !== null && d.pm25 !== undefined).map(d => ({ ...d, pm25Val: d.pm25 }))}
              series={[
                { dataKey: "pm25Val", name: "PM2.5", color: "#ef4444", unit: "µg/m³" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="PM2.5"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.pm25 || 0}
            />
            )}
          </div>
          )}
        </section>
        )}

        {/* Wind Direction Compass & Charts - Only show if wind data available */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.windAnalysis !== false && (availableFields.windSpeed || availableFields.windDirection) && (
        <section className="space-y-6">
          <h2 className="text-base font-normal text-foreground">Wind Analysis (WMO/Beaufort Scale)</h2>
          
          {/* Wind Compass and Wind Roses */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {availableFields.windDirection ? (
            <WindCompass
              direction={currentData.windDirection || 0}
              speed={currentData.windSpeed || 0}
              gust={currentData.windGust ?? undefined}
              unit={windUnitLabel}
            />
            ) : (
            <NoDataWrapper
              data={null}
              title="Wind Compass"
              noDataMessage="No Data"
              noDataDescription="Wind direction data is not available for this station"
            >
              <div />
            </NoDataWrapper>
            )}
            
            {/* Wind Rose - 30 Minutes */}
            {windDataByPeriod['30min'].count > 0 && (
            <WindRose 
              data={windDataByPeriod['30min'].rose} 
              title="Wind Rose (30 min)"
              maxWindSpeed={maxWindSpeed}
              windSpeedUnit={windSpeedUnit}
            />
            )}
            
            {/* Wind Rose - 60 Minutes */}
            {windDataByPeriod['60min'].count > 0 && (
            <WindRose 
              data={windDataByPeriod['60min'].rose} 
              title="Wind Rose (60 min)"
              maxWindSpeed={maxWindSpeed}
              windSpeedUnit={windSpeedUnit}
            />
            )}
            
            {/* Wind Rose - 24h */}
            {windDataByPeriod['24h'].count > 0 && (
            <WindRose 
              data={windDataByPeriod['24h'].rose} 
              title="Wind Rose (24h)"
              maxWindSpeed={maxWindSpeed}
              windSpeedUnit={windSpeedUnit}
            />
            )}
            
            {/* Wind Rose - 48h */}
            {windDataByPeriod['48h'].count > 0 && (
            <WindRose 
              data={windDataByPeriod['48h'].rose} 
              title="Wind Rose (48h)"
              maxWindSpeed={maxWindSpeed}
              windSpeedUnit={windSpeedUnit}
            />
            )}
          </div>
          
          {/* Extended Period Wind Roses - 7-day and 30-day */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {windDataByPeriod['7d'].count > 0 && (
              <WindRose 
                data={windDataByPeriod['7d'].rose} 
                title="Wind Rose (7 days)"
                maxWindSpeed={maxWindSpeed}
                windSpeedUnit={windSpeedUnit}
              />
            )}
            {windDataByPeriod['31d'].count > 0 && (
              <WindRose 
                data={windDataByPeriod['31d'].rose} 
                title="Wind Rose (30 days)"
                maxWindSpeed={maxWindSpeed}
                windSpeedUnit={windSpeedUnit}
              />
            )}
          </div>
          
          {/* Wind Scatter Plots - 24h and 48h only */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Wind Scatter - 24h */}
            {windDataByPeriod['24h'].count > 0 && (
            <WindRoseScatter 
              data={windDataByPeriod['24h'].scatter} 
              title="Wind Scatter (24h)"
              maxWindSpeed={maxWindSpeed}
              windSpeedUnit={windSpeedUnit}
            />
            )}
            
            {/* Wind Scatter - 48h */}
            {windDataByPeriod['48h'].count > 0 && (
            <WindRoseScatter 
              data={windDataByPeriod['48h'].scatter} 
              title="Wind Scatter (48h)"
              maxWindSpeed={maxWindSpeed}
              windSpeedUnit={windSpeedUnit}
            />
            )}
          </div>
        </section>
        )}

        {/* Wind Energy Section - Only show if wind data available */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.windEnergy !== false && (availableFields.windSpeed || availableFields.windDirection) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Wind Energy</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <WindPowerCard
              currentPower={calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit)}
              gustPower={calculateWindPower(currentData.windGust || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit)}
              airDensity={currentData.airDensity || STANDARD_AIR_DENSITY_KGM3}
              avgSpeed={chartData.slice(-10).reduce((sum, d) => sum + (d.windSpeed ?? 0), 0) / Math.max(chartData.slice(-10).length, 1)}
              avgPower={chartData.slice(-10).reduce((sum, d) => sum + calculateWindPower(d.windSpeed ?? 0, STANDARD_AIR_DENSITY_KGM3, windSpeedUnit), 0) / Math.max(chartData.slice(-10).length, 1)}
              sparklineData={chartData.slice(-12).map(d => calculateWindPower(d.windSpeed ?? 0, STANDARD_AIR_DENSITY_KGM3, windSpeedUnit))}
            />
            <MetricCard
              title="Current Wind Power"
              value={safeFixed(calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit), 1)}
              unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.windPower)}
              chartColor="#22c55e"
            />
            <MetricCard
              title="Peak Gust Power"
              value={safeFixed(calculateWindPower(currentData.windGust || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit), 1)}
              unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.gustPower)}
              chartColor="#ef4444"
            />
            <MetricCard
              title="Daily Energy Potential"
              value={safeFixed(windEnergyData.length > 0 ? windEnergyData[windEnergyData.length - 1].cumulativeEnergy : 0, 2)}
              unit="kWh/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.cumulativeEnergy)}
              chartColor="#3b82f6"
            />
          </div>
          {/* Wind Energy Dedicated Chart */}
          <DataBlockChart
            title="Wind Power Density Over Time"
            data={windEnergyData.map(d => ({
              timestamp: d.timestamp,
              windPower: d.windPower,
              windSpeed: d.windSpeed,
            }))}
            series={[
              { dataKey: "windPower", name: "Wind Power", color: "#22c55e", unit: "W/m²" },
              { dataKey: "windSpeed", name: "Wind Speed", color: "#3b82f6", unit: windUnitLabel },
            ]}
            chartType="area"
            xAxisLabel="Time"
            yAxisLabel="Power / Speed"
            showAverage={true}
            showMinMax={true}
            currentValue={calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit)}
          />
        </section>
        )}

        {/* Fire Danger Section - Only show when we have actual data */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.fireDanger !== false && (availableFields.temperature && availableFields.humidity && availableFields.windSpeed) && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FireDangerCard
              temperature={currentData.temperature!}
              humidity={currentData.humidity!}
              windSpeed={currentData.windSpeed!}
            />
            <FireDangerChart
              data={fireDangerChartData}
              title="Fire Danger History"
            />
          </div>
        </section>
        )}

        {/* Rainfall Section - Only show chart if actual rainfall in timeframe */}
        {!isMpptOnlyStation && availableFields.rainfall && accumulatedRainfall > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Rainfall</h2>
          <DataBlockChart
            title="Rainfall History"
            data={chartData}
            series={[
              { dataKey: "rain", name: "Rainfall", color: "#3b82f6", unit: "mm" },
            ]}
            chartType="area"
            xAxisLabel="Time"
            yAxisLabel="Rainfall"
            showMinMax={true}
            currentValue={currentData.rainfall || 0}
          />
        </section>
        )}

        {/* Charts Section */}
        {!isMpptOnlyStation && (chartData.length > 0 || historicalChartData.length > 0) && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-base font-normal text-foreground">Historical Data</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Time Range:</span>
              <div className="flex gap-1">
                {[
                  { label: "1h", hours: 1 },
                  { label: "6h", hours: 6 },
                  { label: "12h", hours: 12 },
                  { label: "24h", hours: 24 },
                  { label: "48h", hours: 48 },
                  { label: "7d", hours: 168 },
                ].map(({ label, hours }) => (
                  <Button
                    key={hours}
                    variant={historicalChartRange === hours ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setHistoricalChartRange(hours)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {historicalSectionLoading && (
                <Badge variant="outline" className="text-xs ml-2">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Loading...
                </Badge>
              )}
              {!historicalSectionLoading && historicalSectionData.length > 0 && (
                <Badge variant="outline" className="text-xs ml-2">
                  {historicalSectionData.length} records
                </Badge>
              )}
            </div>
          </div>
          {(() => {
            const historicalTabs = [
              { key: 'temperature', label: 'Temp & RH', show: availableFields.temperature || availableFields.humidity },
              { key: 'wind', label: 'Wind', show: availableFields.windSpeed },
              { key: 'pressure', label: 'Pressure', show: availableFields.pressure },
              { key: 'solar', label: 'Solar', show: availableFields.solarRadiation },
              { key: 'rain', label: 'Rain', show: availableFields.rainfall },
            ];
            const firstVisible = historicalTabs.find(t => t.show);
            if (!firstVisible) return null;
            return (
          <Suspense fallback={<ChartFallback />}>
          <Tabs defaultValue={firstVisible.key} className="w-full">
            <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
              {(availableFields.temperature || availableFields.humidity) && <TabsTrigger value="temperature" className="flex-1 min-w-[80px]" data-testid="tab-temperature">Temp & RH</TabsTrigger>}
              {availableFields.windSpeed && <TabsTrigger value="wind" className="flex-1 min-w-[80px]" data-testid="tab-wind">Wind</TabsTrigger>}
              {availableFields.pressure && <TabsTrigger value="pressure" className="flex-1 min-w-[80px]" data-testid="tab-pressure">Pressure</TabsTrigger>}
              {availableFields.solarRadiation && <TabsTrigger value="solar" className="flex-1 min-w-[80px]" data-testid="tab-solar">Solar</TabsTrigger>}
              {availableFields.rainfall && <TabsTrigger value="rain" className="flex-1 min-w-[80px]" data-testid="tab-rain">Rain</TabsTrigger>}
            </TabsList>
            {(availableFields.temperature || availableFields.humidity) && (
            <TabsContent value="temperature" className="mt-4">
              <WeatherChart
                title="Temperature & Humidity"
                data={historicalChartData}
                series={[
                  ...(availableFields.temperature ? [{ dataKey: "temperature", name: "Temperature (°C)", color: "#ef4444" }] : []),
                  ...(availableFields.humidity ? [{ dataKey: "humidity", name: "Relative Humidity (%)", color: "#3b82f6" }] : []),
                ]}
              />
            </TabsContent>
            )}
            {availableFields.windSpeed && (
            <TabsContent value="wind" className="mt-4">
              <WeatherChart
                title="Wind Speed"
                data={historicalChartData}
                series={[
                  { dataKey: "windSpeed", name: `Wind Speed (${windUnitLabel})`, color: "#22c55e" },
                ]}
              />
            </TabsContent>
            )}
            {availableFields.pressure && (
            <TabsContent value="pressure" className="mt-4">
              <WeatherChart
                title="Barometric Pressure"
                data={historicalChartData}
                series={[
                  { dataKey: "pressure", name: "Pressure (hPa)", color: "#3b82f6" },
                ]}
              />
            </TabsContent>
            )}
            {availableFields.solarRadiation && (
            <TabsContent value="solar" className="mt-4">
              <WeatherChart
                title="Solar Radiation"
                data={historicalChartData}
                series={[
                  { dataKey: "solar", name: "Solar Radiation (W/m²)", color: "#ef4444" },
                ]}
              />
            </TabsContent>
            )}
            {availableFields.rainfall && (
            <TabsContent value="rain" className="mt-4">
              <WeatherChart
                title="Rainfall"
                data={historicalChartData}
                series={[
                  { dataKey: "rain", name: "Rainfall (mm)", color: "#3b82f6" },
                ]}
              />
            </TabsContent>
            )}
          </Tabs>
          </Suspense>
            );
          })()}
        </section>
        )}

        {/* Solar & ET Cards */}
        {!isMpptOnlyStation && (availableFields.solarRadiation || availableFields.temperature) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar & Reference ET₀</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {availableFields.solarRadiation && (
            <SolarRadiationCard
              currentRadiation={currentData.solarRadiation || 0}
              peakRadiation={solarStats.peak ?? 0}
              dailyEnergy={solarStats.dailyEnergy ?? 0}
              avgRadiation={solarStats.avg ?? 0}
              panelTemperature={currentData.panelTemperature ?? undefined}
            />
            )}
            <EToCard
              dailyETo={currentData.eto ?? etoStats.daily ?? 0}
              weeklyETo={etoStats.weekly ?? 0}
              monthlyETo={etoStats.monthly ?? 0}
            />
            <StatisticsCard
              title="Temperature Statistics"
              periods={[
                {
                  period: "24h",
                  stats: [
                    { label: "Min", value: temperatureStats['24h'].min ?? '--', unit: "°C" },
                    { label: "Max", value: temperatureStats['24h'].max ?? '--', unit: "°C" },
                    { label: "Avg", value: temperatureStats['24h'].avg ?? '--', unit: "°C" },
                    { label: "Range", value: temperatureStats['24h'].range ?? '--', unit: "°C" },
                  ],
                },
                {
                  period: "7d",
                  stats: [
                    { label: "Min", value: temperatureStats['7d'].min ?? '--', unit: "°C" },
                    { label: "Max", value: temperatureStats['7d'].max ?? '--', unit: "°C" },
                    { label: "Avg", value: temperatureStats['7d'].avg ?? '--', unit: "°C" },
                    { label: "Range", value: temperatureStats['7d'].range ?? '--', unit: "°C" },
                  ],
                },
              ]}
            />
          </div>
        </section>
        )}

        {/* Station Administration - Admin Only (hidden in PDF export) */}
        {isAdmin && selectedStation && !isDemoStation && !isMpptOnlyStation && (
          <section className="no-print">
          <StationInfoPanel
            station={{
              id: selectedStation.id,
              name: selectedStation.name,
              location: selectedStation.location || undefined,
              latitude: selectedStation.latitude || undefined,
              longitude: selectedStation.longitude || undefined,
              altitude: selectedStation.altitude || undefined,
              pakbusAddress: selectedStation.pakbusAddress || undefined,
              securityCode: selectedStation.securityCode || undefined,
              dataloggerModel: selectedStation.dataloggerModel || undefined,
              dataloggerSerialNumber: selectedStation.dataloggerSerialNumber || undefined,
              programName: selectedStation.dataloggerProgramName || undefined,
              siteDescription: selectedStation.siteDescription || undefined,
              notes: selectedStation.notes || undefined,
              modemModel: selectedStation.modemModel || undefined,
              modemSerialNumber: selectedStation.modemSerialNumber || undefined,
              lastCalibrationDate: selectedStation.lastCalibrationDate ? new Date(selectedStation.lastCalibrationDate).toISOString().split('T')[0] : undefined,
              nextCalibrationDate: selectedStation.nextCalibrationDate ? new Date(selectedStation.nextCalibrationDate).toISOString().split('T')[0] : undefined,
            }}
            isAdmin={true}
            onSave={async (data) => {
              try {
                const response = await authFetch(`/api/stations/${selectedStation.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data),
                });
                if (!response.ok) throw new Error('Failed to save');
                // Refresh station data. invalidate both list and station-specific queries
                // so the map and all panels pick up the new coordinates immediately
                await queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
                await queryClient.invalidateQueries({ queryKey: [`/api/stations/${selectedStation.id}`] });
                // Force refetch to ensure selectedStation has updated lat/lng for the map
                await queryClient.refetchQueries({ queryKey: ["/api/stations"] });
                toast({
                  title: "Saved Successfully",
                  description: "Station information has been updated.",
                });
              } catch (error) {
                console.error("Error saving station:", error);
                toast({
                  title: "Save Failed",
                  description: "Could not save station information. Please try again.",
                  variant: "destructive",
                });
              }
            }}
            onDelete={async () => {
              const response = await authFetch(`/api/stations/${selectedStation.id}`, {
                method: 'DELETE',
              });
              if (!response.ok) throw new Error('Failed to delete station');
              // Refresh station data and navigate back
              await queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
              // Navigate back to station selector
              if (onBackToStations) {
                onBackToStations();
              }
            }}
          />
          </section>
        )}
      </div>
    </div>
  );
}
