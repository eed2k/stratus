// Stratus Weather Server
// Created by Lukas Esterhuizen

﻿import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { CurrentConditions } from "@/components/dashboard/CurrentConditions";
import { DashboardLoadingOverlay } from "@/components/DashboardLoadingOverlay";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { WindCompass } from "@/components/dashboard/WindCompass";
// WindPowerCard replaced with inline Card layout
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
import { calculateSolarEstimates } from "@/components/dashboard/SolarPowerHarvestCard";
import { FireDangerCard } from "@/components/dashboard/FireDangerCard";
import { AirQualityCard } from "@/components/dashboard/AirQualityCard";
import { processWindPowerRoseData } from "@/components/charts/WindPowerRose";
// RainfallYearlyCard removed - yearly data now shown as subMetric in Rainfall MetricCard
import { NoDataWrapper, hasValidData } from "@/components/dashboard/NoDataWrapper";
import { safeFixed } from "@/lib/utils";

// Lazy-load heavy chart and visualization components for faster initial render
const WindRose = lazy(() => import("@/components/charts/WindRose").then(m => ({ default: m.WindRose })));
const WindRoseScatter = lazy(() => import("@/components/charts/WindRoseScatter").then(m => ({ default: m.WindRoseScatter })));
const WeibullCard = lazy(() => import("@/components/dashboard/WeibullCard").then(m => ({ default: m.WeibullCard })));
import { WindPowerRose } from "@/components/charts/WindPowerRose";
const WeatherChart = lazy(() => import("@/components/charts/WeatherChart").then(m => ({ default: m.WeatherChart })));
const DataBlockChart = lazy(() => import("@/components/charts/DataBlockChart").then(m => ({ default: m.DataBlockChart })));
const FireDangerChart = lazy(() => import("@/components/charts/FireDangerChart").then(m => ({ default: m.FireDangerChart })));
const StationMapWithErrorBoundary = lazy(() => import("@/components/dashboard/StationMap").then(m => ({ default: m.StationMapWithErrorBoundary })));
const SolarPositionCard = lazy(() => import("@/components/dashboard/SolarPositionCard").then(m => ({ default: m.SolarPositionCard })));

// Merge any partial/legacy saved config over defaults so required array/object
// fields (enabledParameters, sectionVisibility) are never undefined, which would
// otherwise crash the dashboard and config panel. Also clamps chartTimeRange.
function normalizeDashboardConfig(c: Partial<DashboardConfig> | null | undefined): DashboardConfig {
  const merged: DashboardConfig = {
    ...DEFAULT_DASHBOARD_CONFIG,
    ...(c ?? {}),
    enabledParameters: Array.isArray(c?.enabledParameters)
      ? (c!.enabledParameters as string[])
      : (DEFAULT_DASHBOARD_CONFIG.enabledParameters ?? []),
    sectionVisibility: {
      ...(DEFAULT_DASHBOARD_CONFIG.sectionVisibility ?? {}),
      ...(c?.sectionVisibility ?? {}),
    },
    // Only carry the restriction through when it is a usable list. A malformed
    // value is dropped rather than stored, so it cannot later empty the range
    // selector.
    allowedChartTimeRanges: Array.isArray(c?.allowedChartTimeRanges)
      ? (c!.allowedChartTimeRanges as number[]).filter((h) => typeof h === "number")
      : undefined,
  };
  if (merged.chartTimeRange > 720) merged.chartTimeRange = 720;
  // Keep the saved window inside what this station actually offers, otherwise a
  // restricted station could load pointing at a range it will not display.
  merged.chartTimeRange = defaultChartTimeRange(
    merged.allowedChartTimeRanges, merged.chartTimeRange);
  return merged;
}

// Chart loading placeholder
const ChartFallback = () => (
  <div className="flex items-center justify-center h-48 bg-muted/20 rounded-lg animate-pulse">
    <Loader2 className="h-6 w-6 animate-spin text-black" />
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
  ArrowLeft,
  Layers,
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
  calculateFireDanger,
  calculateHeatIndex,
  calculateWindChill,
} from "@shared/utils/calc";
import { interpretLightningIntensity } from "@shared/utils/lightning";
import { rainfallTotalFromRecords, type RainfallType } from "@shared/utils/rainfall";
import { CHART_COLORS } from "@shared/chartColors";
import {
  DEFAULT_DASHBOARD_CONFIG,
  DASHBOARD_CATEGORIES,
  isParameterEnabled,
  resolveChartTimeRanges,
  defaultChartTimeRange,
  chartTimeRangeLabel,
  type DashboardConfig,
} from "../../../shared/dashboardConfig";
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

const processChartData = (historicalData: WeatherData[], timeRangeHours?: number, stationLat?: number, stationAltitude?: number, windUnit: WindSpeedUnit = 'ms', rainfallType: 'incremental' | 'cumulative_yearly' | 'cumulative_lifetime' | 'tip_count' | 'auto' = 'auto') => {
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

      // Rainfall: per-day total. Behavior depends on logger type:
      //  - incremental/tip_count: server-side rainfall is already a per-period
      //    increment, so the daily total is the SUM of the bucket.
      //  - cumulative_*/auto: rainfall is a running counter; daily total is
      //    last - first (with negatives clamped to 0).
      const rainfallVals = dayData.map(d => d.rainfall).filter((v): v is number => v != null);
      let dayRain = 0;
      if (rainfallVals.length > 0) {
        if (rainfallType === 'incremental' || rainfallType === 'tip_count') {
          dayRain = rainfallVals.reduce((s, v) => s + (v > 0 && v < 100 ? v : 0), 0);
        } else if (rainfallVals.length >= 2) {
          dayRain = Math.max(0, rainfallVals[rainfallVals.length - 1] - rainfallVals[0]);
        }
      }

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
        windDirection: avgNonNull(dayData.map(d => d.windDirection ?? null)),
        windGust: avgNonNull(dayData.map(d => d.windGust ?? d.windSpeed ?? null)),
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
        batteryVoltage2: avgNonNull(dayData.map(d => d.batteryVoltage2 ?? null)),
        batteryVoltage2Min: minNonNull(dayData.map(d => d.batteryVoltage2 ?? null)),
        batteryVoltage2Max: maxNonNull(dayData.map(d => d.batteryVoltage2 ?? null)),
        waterLevel: avgNonNull(dayData.map(d => d.waterLevel ?? null)),
        temperatureSwitch: avgNonNull(dayData.map(d => d.temperatureSwitch ?? null)),
        levelSwitch: avgNonNull(dayData.map(d => d.levelSwitch ?? null)),
        temperatureSwitchOutlet: avgNonNull(dayData.map(d => d.temperatureSwitchOutlet ?? null)),
        levelSwitchStatus: avgNonNull(dayData.map(d => d.levelSwitchStatus ?? null)),
        lightning: sumNonNull(dayData.map(d => d.lightning ?? null)),
        lightningDistance: minNonNull(dayData.map(d => d.lightningDistance ?? null)),
        lightningEnergy: maxNonNull(dayData.map(d => d.lightningEnergy ?? null)),
        lightningRaw: avgNonNull(dayData.map(d => d.lightningRaw ?? null)),
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
        mpptBulkFloatVoltage: avgNonNull(dayData.map(d => toNum(d.mpptBulkFloatVoltage))),
        mpptFloatVoltage: avgNonNull(dayData.map(d => toNum(d.mpptFloatVoltage))),
        mpptCurrentLimit: avgNonNull(dayData.map(d => toNum(d.mpptCurrentLimit))),
        mpptAbsorbTimeLimit: avgNonNull(dayData.map(d => toNum(d.mpptAbsorbTimeLimit))),
        mpptAbsorbFullCurrent: avgNonNull(dayData.map(d => toNum(d.mpptAbsorbFullCurrent))),
        mpptVCalSlope: avgNonNull(dayData.map(d => toNum(d.mpptVCalSlope))),
        mpptICalSlope: avgNonNull(dayData.map(d => toNum(d.mpptICalSlope))),
        mppt2SolarVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2SolarVoltage))),
        mppt2SolarCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2SolarCurrent))),
        mppt2SolarPower: avgNonNull(dayData.map(d => toNum(d.mppt2SolarPower))),
        mppt2LoadVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2LoadVoltage))),
        mppt2LoadCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2LoadCurrent))),
        mppt2BatteryVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2BatteryVoltage))),
        mppt2ChargerState: avgNonNull(dayData.map(d => toNum(d.mppt2ChargerState))),
        mppt2BoardTemp: avgNonNull(dayData.map(d => toNum(d.mppt2BoardTemp))),
        mppt2Mode: avgNonNull(dayData.map(d => toNum(d.mppt2Mode))),
        mppt2BulkFloatVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2BulkFloatVoltage))),
        mppt2FloatVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2FloatVoltage))),
        mppt2CurrentLimit: avgNonNull(dayData.map(d => toNum(d.mppt2CurrentLimit))),
        mppt2AbsorbTimeLimit: avgNonNull(dayData.map(d => toNum(d.mppt2AbsorbTimeLimit))),
        mppt2AbsorbFullCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2AbsorbFullCurrent))),
        mppt2VCalSlope: avgNonNull(dayData.map(d => toNum(d.mppt2VCalSlope))),
        mppt2ICalSlope: avgNonNull(dayData.map(d => toNum(d.mppt2ICalSlope))),
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
        irrigationTime: (() => {
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
          const eto = calculateETo(temp, hum, windMs, solarMJ, alt, lat, dayOfYear);
          const rainfallVals = dayData.map(d => d.rainfall).filter((v): v is number => v != null);
          const dayRain = rainfallVals.length >= 2 ? Math.max(0, rainfallVals[rainfallVals.length - 1] - rainfallVals[0]) : 0;
          const netNeed = Math.max(0, eto - dayRain);
          return Math.round((netNeed / 5) * 60);
        })(),
        visibility: avgNonNull(dayData.map(d => d.visibility ?? null)),
        visibilityVolt: avgNonNull(dayData.map(d => d.visibilityVolt ?? null)),
        atmosphericVisibility: avgNonNull(dayData.map(d => d.atmosphericVisibility ?? null)),
        cloudBase: avgNonNull(dayData.map(d => d.cloudBase ?? null)),
        cloudCover: avgNonNull(dayData.map(d => d.cloudCover ?? null)),
        temperature8m: avgNonNull(dayData.map(d => d.temperature8m ?? null)),
        deltaTemperature: avgNonNull(dayData.map(d => d.deltaTemperature ?? null)),
        airDensity: (() => {
          const t = avgNonNull(dayData.map(d => d.temperature ?? null));
          const p = avgNonNull(dayData.map(d => d.pressure ?? null));
          const rh = avgNonNull(dayData.map(d => d.humidity ?? null));
          if (t == null || p == null || rh == null) return null;
          return Math.round(calculateAirDensity(t, p, rh) * 1000) / 1000;
        })(),
        heatIndex: (() => {
          const t = avgNonNull(dayData.map(d => d.temperature ?? null));
          const rh = avgNonNull(dayData.map(d => d.humidity ?? null));
          if (t == null || rh == null) return null;
          return Math.round(calculateHeatIndex(t, rh) * 10) / 10;
        })(),
        windChill: (() => {
          const t = avgNonNull(dayData.map(d => d.temperature ?? null));
          const ws = avgNonNull(dayData.map(d => d.windSpeed ?? null));
          if (t == null || ws == null) return null;
          const windMs = windUnit === 'kmh' ? kmhToMs(ws) : ws;
          return Math.round(calculateWindChill(t, windMs) * 10) / 10;
        })(),
        panelTemperature: avgNonNull(dayData.map(d => d.panelTemperature ?? null)),
        _readings: dayData.length,
      };
    });
  }
  
  // Format timestamp based on time range
  const formatTimestamp = (date: Date) => {
    if (effectiveRange <= 24) {
      // Up to 24 hours: show HH:MM
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
    // Rainfall per chart point: depends on logger type.
    //  - incremental/tip_count: each reading IS the per-period rainfall.
    //  - cumulative_*/auto: convert running total to per-period delta.
    const rawRain = d.rainfall ?? 0;
    let incrementalRain: number;
    if (rainfallType === 'incremental' || rainfallType === 'tip_count') {
      incrementalRain = rawRain > 0 && rawRain < 100 ? rawRain : 0;
    } else if (i > 0) {
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
      windDirection: d.windDirection ?? null,
      windGust: d.windGust ?? null,
      solar: d.solarRadiation != null ? Math.max(d.solarRadiation, 0) : null,
      rain: incrementalRain,
      soilTemperature: d.soilTemperature ?? null,
      soilMoisture: d.soilMoisture ?? null,
      pm10: d.pm10 ?? null,
      pm25: d.pm25 ?? null,
      batteryVoltage: d.batteryVoltage ?? null,
      batteryVoltage2: d.batteryVoltage2 ?? null,
      waterLevel: d.waterLevel ?? null,
      temperatureSwitch: d.temperatureSwitch ?? null,
      levelSwitch: d.levelSwitch ?? null,
      temperatureSwitchOutlet: d.temperatureSwitchOutlet ?? null,
      levelSwitchStatus: d.levelSwitchStatus ?? null,
      lightning: d.lightning ?? null,
      lightningDistance: d.lightningDistance ?? null,
      lightningEnergy: d.lightningEnergy ?? null,
      lightningRaw: d.lightningRaw ?? null,
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
      mpptBulkFloatVoltage: toNum(d.mpptBulkFloatVoltage),
      mpptFloatVoltage: toNum(d.mpptFloatVoltage),
      mpptCurrentLimit: toNum(d.mpptCurrentLimit),
      mpptAbsorbTimeLimit: toNum(d.mpptAbsorbTimeLimit),
      mpptAbsorbFullCurrent: toNum(d.mpptAbsorbFullCurrent),
      mpptVCalSlope: toNum(d.mpptVCalSlope),
      mpptICalSlope: toNum(d.mpptICalSlope),
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
      mppt2BulkFloatVoltage: toNum(d.mppt2BulkFloatVoltage),
      mppt2FloatVoltage: toNum(d.mppt2FloatVoltage),
      mppt2CurrentLimit: toNum(d.mppt2CurrentLimit),
      mppt2AbsorbTimeLimit: toNum(d.mppt2AbsorbTimeLimit),
      mppt2AbsorbFullCurrent: toNum(d.mppt2AbsorbFullCurrent),
      mppt2VCalSlope: toNum(d.mppt2VCalSlope),
      mppt2ICalSlope: toNum(d.mppt2ICalSlope),
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
      irrigationTime: (() => {
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
        const eto = calculateETo(temp, hum, windMs, solarMJ, alt, lat, dayOfYear);
        const netNeed = Math.max(0, eto - (incrementalRain || 0));
        return Math.round((netNeed / 5) * 60);
      })(),
      visibility: d.visibility ?? null,
      visibilityVolt: d.visibilityVolt ?? null,
      atmosphericVisibility: d.atmosphericVisibility ?? null,
      cloudBase: d.cloudBase ?? null,
      cloudCover: d.cloudCover ?? null,
      temperature8m: d.temperature8m ?? null,
      deltaTemperature: d.deltaTemperature ?? null,
      airDensity: (d.temperature != null && d.pressure != null && d.humidity != null)
        ? Math.round(calculateAirDensity(d.temperature, d.pressure, d.humidity) * 1000) / 1000
        : null,
      heatIndex: (d.temperature != null && d.humidity != null)
        ? Math.round(calculateHeatIndex(d.temperature, d.humidity) * 10) / 10
        : null,
      windChill: (d.temperature != null && d.windSpeed != null)
        ? Math.round(calculateWindChill(d.temperature, windUnit === 'kmh' ? kmhToMs(d.windSpeed) : d.windSpeed) * 10) / 10
        : null,
      panelTemperature: d.panelTemperature ?? null,
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
        return normalizeDashboardConfig(JSON.parse(stationSaved));
      }
    }
    return DEFAULT_DASHBOARD_CONFIG;
  });
  // Local time range for historical charts section (independent of global dashboard time range)
  const [historicalChartRange, setHistoricalChartRange] = useState(24);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Ranges this station offers, and a guard that keeps the current selection
   * inside them.
   *
   * The selection lives in local state and starts at 24h, so on a station that
   * does not offer 24h it would otherwise sit on a range with no button lit and
   * query a window the operator cannot see.
   */
  const offeredChartRanges = useMemo(
    () => resolveChartTimeRanges(dashboardConfig.allowedChartTimeRanges),
    [dashboardConfig.allowedChartTimeRanges],
  );

  useEffect(() => {
    if (!offeredChartRanges.includes(historicalChartRange)) {
      setHistoricalChartRange(defaultChartTimeRange(
        dashboardConfig.allowedChartTimeRanges, historicalChartRange));
    }
  }, [offeredChartRanges, historicalChartRange, dashboardConfig.allowedChartTimeRanges]);

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
      setDashboardConfig(normalizeDashboardConfig(JSON.parse(stationSaved)));
    } else {
      // No config saved for this station. use clean defaults (not another station's config)
      setDashboardConfig(DEFAULT_DASHBOARD_CONFIG);
    }
  }, [activeStationId]);

  // Fetch the authoritative server-saved config for this station and prefer it over
  // localStorage/defaults so the layout persists across reloads, logouts and devices.
  const { data: serverDashboardConfig } = useQuery<DashboardConfig | null>({
    queryKey: ["/api/stations", activeStationId, "dashboard-config"],
    queryFn: async () => {
      const res = await authFetch(`/api/stations/${activeStationId}/dashboard-config`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!activeStationId,
    staleTime: 60000,
  });

  // When the server config arrives, apply it (and mirror into localStorage) so the
  // saved layout survives a fresh login or cleared local storage.
  useEffect(() => {
    if (!activeStationId || !serverDashboardConfig) return;
    const parsed = normalizeDashboardConfig(serverDashboardConfig);
    setDashboardConfig(parsed);
    localStorage.setItem(`dashboardConfig_${activeStationId}`, JSON.stringify(parsed));
  }, [serverDashboardConfig, activeStationId]);

  const { data: latestData, isLoading: dataLoading, isSuccess: latestReady } = useQuery<WeatherData>({
    queryKey: ["/api/stations", activeStationId, "data", "latest"],
    enabled: !!activeStationId,
    refetchInterval: dashboardConfig.updatePeriod * 1000, // Auto-refresh based on config
  });

  // Fetch the actual data time range for this station (used for historical-only stations)
  // NOTE: Auto-polled. Every dependent chart/stats/wind query is keyed on dataRange.latest,
  // so without periodic refresh the whole dashboard freezes on the original load timestamp
  // even as new rows arrive (especially noticeable on hourly stations like SAWS Testbed).
  const { data: dataRange } = useQuery<{ earliest: string; latest: string; count: number }>({
    queryKey: ["/api/stations", activeStationId, "data", "range"],
    queryFn: async () => {
      if (!activeStationId) return null;
      const res = await authFetch(`/api/stations/${activeStationId}/data/range`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!activeStationId,
    staleTime: 60 * 1000,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 60) * 1000,
    refetchIntervalInBackground: true,
  });

  // Fetch historical data for charts and wind roses (based on configured time range)
  // Auto-expands to 30 days, then falls back to station's actual data range
  const { data: historicalData = [], refetch: refetchHistorical, isSuccess: historyReady } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "history", dashboardConfig.chartTimeRange, dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const limit = dashboardConfig.chartTimeRange > 168 ? 5000 : dashboardConfig.chartTimeRange > 72 ? 2000 : 1000;
      // Use dataRange to pick the right time window upfront (avoids sequential fallback calls)
      let endTime: Date;
      let startTime: Date;
      if (dataRange?.latest) {
        const latestTs = new Date(dataRange.latest).getTime();
        const now = Date.now();
        // If latest data is older than our requested range, query around the actual data range
        if (now - latestTs > dashboardConfig.chartTimeRange * 60 * 60 * 1000) {
          endTime = new Date(latestTs + 60000); // +1min buffer
          startTime = new Date(endTime.getTime() - dashboardConfig.chartTimeRange * 60 * 60 * 1000);
        } else {
          endTime = new Date();
          startTime = new Date(endTime.getTime() - dashboardConfig.chartTimeRange * 60 * 60 * 1000);
        }
      } else {
        endTime = new Date();
        startTime = new Date(endTime.getTime() - dashboardConfig.chartTimeRange * 60 * 60 * 1000);
      }
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`
      );
      if (!response.ok) return [];
      const data = await response.json();
      // If still no data, try expanding to 30 days as last resort
      if (Array.isArray(data) && data.length === 0) {
        const expandedEnd = dataRange?.latest ? new Date(new Date(dataRange.latest).getTime() + 60000) : endTime;
        const expandedStart = new Date(expandedEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${expandedStart.toISOString()}&endTime=${expandedEnd.toISOString()}&limit=${limit}`
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!activeStationId,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 120) * 1000, // Min 2min for historical charts
    staleTime: 60 * 1000, // Consider data fresh for 60 seconds to prevent rapid re-fetches
    placeholderData: keepPreviousData, // Show previous data while new range loads
  });

  // Separate query for 30-day stats data (always fetches 30 days regardless of chart time range)
  const statsTimeRangeHours = 30 * 24; // 720 hours = 30 days
  const { data: statsData = [], isSuccess: statsReady } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "stats-30d", dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - statsTimeRangeHours * 60 * 60 * 1000);
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=5000`
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - statsTimeRangeHours * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=5000`
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

  // Separate query for 365-day wind data (for annual wind power rose)
  const { data: wind365Data = [] } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "wind-365d", dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 365 * 24 * 60 * 60 * 1000);
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=53000`
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=53000`
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!activeStationId,
    refetchInterval: 30 * 60 * 1000, // Refresh every 30 min
    staleTime: 20 * 60 * 1000,
  });

  // Separate query for historical charts section (uses its own independent time range)
  const { data: historicalSectionData = [], isLoading: historicalSectionLoading } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "historical-section", historicalChartRange, dataRange?.latest],
    queryFn: async () => {
      if (!activeStationId) return [];
      const limit = historicalChartRange > 168 ? 3000 : historicalChartRange > 72 ? 2000 : 1000;
      // Use dataRange to pick the right time window upfront
      let endTime: Date;
      let startTime: Date;
      if (dataRange?.latest) {
        const latestTs = new Date(dataRange.latest).getTime();
        const now = Date.now();
        if (now - latestTs > historicalChartRange * 60 * 60 * 1000) {
          endTime = new Date(latestTs + 60000);
          startTime = new Date(endTime.getTime() - historicalChartRange * 60 * 60 * 1000);
        } else {
          endTime = new Date();
          startTime = new Date(endTime.getTime() - historicalChartRange * 60 * 60 * 1000);
        }
      } else {
        endTime = new Date();
        startTime = new Date(endTime.getTime() - historicalChartRange * 60 * 60 * 1000);
      }
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data) && data.length === 0) {
        const expandedEnd = dataRange?.latest ? new Date(new Date(dataRange.latest).getTime() + 60000) : endTime;
        const expandedStart = new Date(expandedEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
        const fallback = await authFetch(
          `/api/stations/${activeStationId}/data?startTime=${expandedStart.toISOString()}&endTime=${expandedEnd.toISOString()}&limit=${limit}`
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!activeStationId,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 120) * 1000,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });

  // Fetch yearly rainfall totals
  const { data: rainfallYearly } = useQuery<{ year: number; total: number; readings: number; isCurrent: boolean }[]>({
    queryKey: ['rainfall-yearly', activeStationId],
    queryFn: async () => {
      const res = await authFetch(`/api/stations/${activeStationId}/data/rainfall-yearly`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeStationId,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  // Per-station rainfall config - drives whether the chart/daily aggregations
  // SUM increments vs delta cumulative counters. Falls back to 'auto' when no
  // config exists (preserves legacy heuristic display behavior).
  const { data: rainfallConfig } = useQuery<{ type: 'incremental' | 'cumulative_yearly' | 'cumulative_lifetime' | 'tip_count' | 'auto'; offset: number; tipFactor: number; configured: boolean }>({
    queryKey: ['rainfall-config', activeStationId],
    queryFn: async () => {
      const res = await authFetch(`/api/stations/${activeStationId}/rainfall-config`);
      if (!res.ok) return { type: 'auto', offset: 0, tipFactor: 0.2, configured: false };
      return res.json();
    },
    enabled: !!activeStationId,
    staleTime: 60 * 60 * 1000,
  });
  const rainfallType = rainfallConfig?.type ?? 'auto';

  // The operator-configured type wins. When a station has never been calibrated
  // the type is 'auto'; for RIKA we still know the answer from the protocol
  // itself (RikaCloud reports a lifetime counter), so seed that rather than
  // leaving the generic detector to guess from a short window.
  // NOTE: derived from selectedStation directly - `isRikaStation` is declared
  // further down the component and referencing it here would be a TDZ error.
  const effectiveRainfallType: RainfallType =
    rainfallType !== 'auto'
      ? rainfallType
      : (selectedStation?.connectionType === 'rikacloud' ? 'cumulative_lifetime' : 'auto');

  // Process historical section chart data
  const historicalChartData = useMemo(() => {
    if (historicalSectionData.length === 0) return [];
    const sorted = [...historicalSectionData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return processChartData(sorted, historicalChartRange, selectedStation?.latitude ?? undefined, selectedStation?.altitude ?? undefined, windSpeedUnit, rainfallType);
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

  // Detect which data fields have valid data AND are enabled in config
  const availableFields = useMemo(() => {
    // Build set of known toggleable parameter dataFields from DASHBOARD_CATEGORIES
    const toggleableFields = new Set(
      DASHBOARD_CATEGORIES.flatMap(c => c.parameters.map(p => p.dataField))
    );
    const ep = dashboardConfig.enabledParameters;

    // Check if field has at least some non-null, meaningful values
    // Fields that are always 0 (disconnected sensors) are treated as unavailable
    // allowZero: rainfall can be 0 and still mean the sensor exists
    const hasData = (field: keyof WeatherData, allowZero = false) => {
      // If this field is a toggleable parameter and was disabled in config, hide it.
      // Parameters added to the catalog after a config was saved stay visible
      // (see LATE_ADDED_PARAMETERS) so new sensors are not silently hidden.
      if (toggleableFields.has(field) && !isParameterEnabled(field, ep)) {
        return false;
      }

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
      windGust: hasData('windGust'),
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
      batteryVoltage2: hasData('batteryVoltage2'),
      waterLevel: hasData('waterLevel'),
      temperatureSwitch: hasData('temperatureSwitch'),
      levelSwitch: hasData('levelSwitch'),
      temperatureSwitchOutlet: hasData('temperatureSwitchOutlet'),
      levelSwitchStatus: hasData('levelSwitchStatus'),
      lightning: hasData('lightning'),
      lightningDistance: hasData('lightningDistance'),
      lightningEnergy: hasData('lightningEnergy'),
      lightningRaw: hasData('lightningRaw'),
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
      // Visibility
      visibility: hasData('visibility'),
      visibilityVolt: hasData('visibilityVolt'),
      atmosphericVisibility: hasData('atmosphericVisibility'),
      cloudBase: hasData('cloudBase'),
      cloudCover: hasData('cloudCover'),
      // Airshed / multi-height temperature
      temperature8m: hasData('temperature8m'),
      deltaTemperature: hasData('deltaTemperature'),
      // Air quality extended
      pm1: hasData('pm1'),
      co2: hasData('co2'),
      tvoc: hasData('tvoc'),
      aqi: hasData('aqi'),
      so2: hasData('so2'),
      particulateCount: hasData('particulateCount'),
      moduleTemperature: hasData('moduleTemperature'),
      // Agriculture
      leafWetness: hasData('leafWetness'),
    };
  }, [historicalData, latestData, dashboardConfig.enabledParameters]);

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
  const chartData = useMemo(() => processChartData(sortedHistoricalData, dashboardConfig.chartTimeRange, selectedStation?.latitude ?? undefined, selectedStation?.altitude ?? undefined, windSpeedUnit, rainfallType), [sortedHistoricalData, dashboardConfig.chartTimeRange, selectedStation?.latitude, selectedStation?.altitude, windSpeedUnit, rainfallType]);


  
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

  // Calculate temperature statistics for 24h, 7d, 14d and 30d periods
  const temperatureStats = useMemo(() => {
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Merge stats + historical data for widest coverage, deduplicate by timestamp
    const seen = new Set<string>();
    const allData: WeatherData[] = [];
    for (const d of [...sortedStatsData, ...sortedHistoricalData]) {
      const ts = String(d.timestamp);
      if (!seen.has(ts)) { seen.add(ts); allData.push(d); }
    }
    const last24h = allData.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last7d = allData.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last14d = allData.filter(d => new Date(d.timestamp).getTime() > fourteenDaysAgo);
    const last30d = allData.filter(d => new Date(d.timestamp).getTime() > thirtyDaysAgo);

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
      '14d': calculateStats(last14d),
      '30d': calculateStats(last30d),
      has14d: last14d.some(d => d.temperature != null && new Date(d.timestamp).getTime() < sevenDaysAgo),
      has30d: last30d.some(d => d.temperature != null && new Date(d.timestamp).getTime() < fourteenDaysAgo),
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
  }, [sortedStatsData, selectedStation?.latitude, selectedStation?.altitude, referenceNow]);

  // Save config to localStorage (per-station only) and server, invalidate queries when changed
  const handleConfigChange = useCallback((newConfig: DashboardConfig) => {
    setDashboardConfig(newConfig);
    // Save only for this station. never write to global key
    if (activeStationId) {
      localStorage.setItem(`dashboardConfig_${activeStationId}`, JSON.stringify(newConfig));
      // Also persist to server so shared dashboard can read it
      authFetch(`/api/stations/${activeStationId}/dashboard-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      }).catch(() => {}); // Fire and forget
    }
    // Invalidate historical data queries to force refresh with new time range
    queryClient.invalidateQueries({ 
      queryKey: ["/api/stations", activeStationId, "data", "history"],
      refetchType: 'active' // Force immediate refetch of active queries
    });
    // Immediately refetch live data so an update-period change takes visible effect now
    queryClient.invalidateQueries({
      queryKey: ["/api/stations", activeStationId, "data", "latest"],
      refetchType: 'active'
    });
    // Also directly refetch after state update to ensure fresh data
    setTimeout(() => refetchHistorical(), 100);
  }, [queryClient, activeStationId, refetchHistorical]);

  // Manual refresh handler - reload the entire page so all caches/queries reset
  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);


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
  // Some Campbell stations also report sea-level corrected pressure (e.g. Koeberg)
  const pressureIsSLP = isRikaStation || (selectedStation?.connectionConfig as any)?.pressureIsSLP === true;

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
        batteryVoltage2: null,
        particulateCount: null,
        pm25: null,
        pm10: null,
        visibility: null,
        visibilityVolt: null,
        atmosphericVisibility: null,
        cloudBase: null,
        cloudCover: null,
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
        lightningDistance: null,
        lightningEnergy: null,
        lightningRaw: null,
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
        mpptBulkFloatVoltage: null,
        mpptFloatVoltage: null,
        mpptCurrentLimit: null,
        mpptAbsorbTimeLimit: null,
        mpptAbsorbFullCurrent: null,
        mpptVCalSlope: null,
        mpptICalSlope: null,
        mppt2SolarVoltage: null,
        mppt2SolarCurrent: null,
        mppt2SolarPower: null,
        mppt2LoadVoltage: null,
        mppt2LoadCurrent: null,
        mppt2BatteryVoltage: null,
        mppt2ChargerState: null,
        mppt2BoardTemp: null,
        mppt2Mode: null,
        mppt2BulkFloatVoltage: null,
        mppt2FloatVoltage: null,
        mppt2CurrentLimit: null,
        mppt2AbsorbTimeLimit: null,
        mppt2AbsorbFullCurrent: null,
        mppt2VCalSlope: null,
        mppt2ICalSlope: null,
        temperature8m: null,
        deltaTemperature: null,
        so2: null,
        moduleTemperature: null,
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
        civilDawn: undefined,
        civilDusk: undefined,
        solarNoon: undefined,
        dayLength: undefined,
      };
    }
    return calculateSolarPosition(lat, lon);
  }, [selectedStation?.latitude, selectedStation?.longitude]);

  // Calculate air density from current conditions (needs actual station pressure, not SLP)
  const calculatedAirDensity = useMemo(() => {
    const rawPressure = currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA;
    // For stations reporting SLP, convert to station pressure for density calc
    const stationPressure = pressureIsSLP
      ? calculateStationPressure(rawPressure, selectedStation?.altitude || 0, currentData.temperature || DEFAULT_TEMPERATURE_C)
      : rawPressure;
    return calculateAirDensity(
      currentData.temperature || DEFAULT_TEMPERATURE_C,
      stationPressure,
      currentData.humidity || DEFAULT_HUMIDITY_PERCENT
    );
  }, [currentData.temperature, currentData.pressure, currentData.humidity, pressureIsSLP, selectedStation?.altitude]);

  // Process wind energy data from historical data (must be after calculatedAirDensity)
  const windEnergyData = useMemo(() => processWindEnergyData(sortedHistoricalData, calculatedAirDensity, windSpeedUnit, dashboardConfig.chartTimeRange), [sortedHistoricalData, calculatedAirDensity, windSpeedUnit, dashboardConfig.chartTimeRange]);

  // Wind power rose data - energy contribution per direction (always 30-day, independent of chart time range)
  const windPowerRoseData = useMemo(() => {
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    return processWindPowerRoseData(dataSource, calculatedAirDensity, windSpeedUnit);
  }, [sortedStatsData, sortedHistoricalData, calculatedAirDensity, windSpeedUnit]);

  // Wind power rose data - 365-day (only if we have >30 days of data)
  const sortedWind365Data = useMemo(() => {
    if (wind365Data.length === 0) return [];
    return [...wind365Data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [wind365Data]);

  const windPowerRose365Data = useMemo(() => {
    if (sortedWind365Data.length === 0) return null;
    // Only show if data spans more than 35 days (avoid duplicate of 30d)
    const timestamps = sortedWind365Data.map(d => new Date(d.timestamp).getTime());
    const spanDays = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24);
    if (spanDays < 35) return null;
    return processWindPowerRoseData(sortedWind365Data, calculatedAirDensity, windSpeedUnit);
  }, [sortedWind365Data, calculatedAirDensity, windSpeedUnit]);

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
    if (pressureIsSLP) {
      // Pressure IS already SLP. use it directly
      return currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA;
    }
    return calculateSeaLevelPressure(
      currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA,
      altitude,
      currentData.temperature || DEFAULT_TEMPERATURE_C
    );
  }, [currentData.pressure, currentData.temperature, selectedStation?.altitude, pressureIsSLP]);

  // For stations reporting SLP, derive station pressure from SLP
  const effectiveStationPressure = useMemo(() => {
    if (pressureIsSLP) {
      const altitude = selectedStation?.altitude || 0;
      return calculateStationPressure(
        currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA,
        altitude,
        currentData.temperature || DEFAULT_TEMPERATURE_C
      );
    }
    return currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA;
  }, [currentData.pressure, currentData.temperature, selectedStation?.altitude, pressureIsSLP]);

  // Calculate reference evapotranspiration
  const calculatedETo = useMemo(() => {
    const lat = selectedStation?.latitude || 0;
    const altitude = selectedStation?.altitude || 0;
    const dayOfYear = getDayOfYear();
    // Convert solar radiation from W/m² to MJ/m²/day (assuming 12hr daylight average)
    const solarMJ = wattsToMJPerDay(currentData.solarRadiation || 0, ASSUMED_DAYLIGHT_HOURS);
    const windMs = windSpeedUnit === 'kmh' ? kmhToMs(currentData.windSpeed || 0) : (currentData.windSpeed || 0);
    
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
    
    // Get average of first half vs last value (filter nulls to avoid poisoning average)
    const halfLen = Math.floor(historicalData.length / 2);
    const olderData = historicalData.slice(0, halfLen);
    
    const olderTemps = olderData.map(d => d.temperature).filter((v): v is number => v != null);
    const olderHums = olderData.map(d => d.humidity).filter((v): v is number => v != null);
    const olderPress = olderData.map(d => d.pressure).filter((v): v is number => v != null);
    
    const avgOldTemp = olderTemps.length > 0 ? olderTemps.reduce((s, v) => s + v, 0) / olderTemps.length : null;
    const avgOldHumidity = olderHums.length > 0 ? olderHums.reduce((s, v) => s + v, 0) / olderHums.length : null;
    const avgOldPressure = olderPress.length > 0 ? olderPress.reduce((s, v) => s + v, 0) / olderPress.length : null;
    
    return {
      temperature: avgOldTemp != null && currentData.temperature != null ? currentData.temperature - avgOldTemp : null,
      humidity: avgOldHumidity != null && currentData.humidity != null ? currentData.humidity - avgOldHumidity : null,
      pressure: avgOldPressure != null && currentData.pressure != null ? currentData.pressure - avgOldPressure : null,
    };
  }, [historicalData, currentData]);

  // Calculate accumulated rainfall from historical data (always uses 24h window)
  // Auto-detects whether the logger emits incremental (CRBasic Totalize) or cumulative readings:
  //   - Incremental: each value is rainfall during that interval (small numbers, typically <50mm)
  //     -> total = SUM of values
  //   - Cumulative: monotonically increasing counter
  //     -> total = SUM of positive deltas (cap each delta to filter spikes / counter resets)
  const { effectiveRainfall } = useMemo(() => {
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const last24hData = dataSource.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);

    if (last24hData.length === 0) {
      // No window to integrate over. Report nothing rather than falling back to
      // `currentData.rainfall`, which for a cumulative station is the lifetime
      // counter (hundreds of mm) and would read as a 24-hour total.
      return { accumulatedRainfall: 0, isRainfallStale: false, effectiveRainfall: 0 };
    }

    const total = rainfallTotalFromRecords(last24hData, effectiveRainfallType, rainfallConfig?.tipFactor ?? 0.2);
    return { accumulatedRainfall: total, isRainfallStale: total < 0.05, effectiveRainfall: total };
  }, [sortedStatsData, sortedHistoricalData, referenceNow, effectiveRainfallType, rainfallConfig?.tipFactor]);

  // Rainfall totals over standard reporting periods (24h / yesterday / this week / this month)
  // Uses the same incremental-vs-cumulative auto-detection as effectiveRainfall.
  const rainfallPeriods = useMemo(() => {
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const sumWindow = (startMs: number, endMs: number) => {
      const window = dataSource
        .filter(d => {
          const t = new Date(d.timestamp).getTime();
          return t > startMs && t <= endMs;
        })
        .map(d => d.rainfall)
        .filter((v): v is number => v != null);
      if (window.length === 0) return 0;
      let total = 0;
      if (isRikaStation) {
        // RIKA cumulative counter: sum realistic positive increments only.
        for (let i = 1; i < window.length; i++) {
          const diff = window[i] - window[i - 1];
          if (diff > 0 && diff < 15) total += diff;
        }
      } else {
        const maxVal = Math.max(...window);
        if (maxVal <= 50) {
          total = window.reduce((s, v) => s + Math.min(Math.max(v, 0), 50), 0);
        } else {
          for (let i = 1; i < window.length; i++) {
            const diff = window[i] - window[i - 1];
            if (diff > 0 && diff < 200) total += diff;
          }
        }
      }
      return Math.round(total * 100) / 100;
    };
    const now = referenceNow;
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const last24hStart = now - 24 * 60 * 60 * 1000;
    const week7Start = now - 7 * 24 * 60 * 60 * 1000;
    const month30Start = now - 30 * 24 * 60 * 60 * 1000;
    return {
      last24h: sumWindow(last24hStart, now),
      yesterday: sumWindow(startOfYesterday.getTime(), startOfToday.getTime()),
      thisWeek: sumWindow(week7Start, now),
      thisMonth: sumWindow(month30Start, now),
    };
  }, [sortedStatsData, sortedHistoricalData, referenceNow]);

  // Daily ETo vs Rainfall over the last 30 days (fixed window).
  // ETo: average per-record FAO Penman-Monteith result (mm/day) per day.
  // Rain: per-day total using the same incremental/cumulative auto-detection.
  // Always uses sortedStatsData (always-30-day query) so this chart is NOT
  // influenced by the dashboard's chart timeframe selector.
  const etoRainDaily = useMemo(() => {
    const dataSource = sortedStatsData;
    if (dataSource.length === 0) return { data: [], totalRain: 0 };
    const lat = selectedStation?.latitude || 0;
    const alt = selectedStation?.altitude || 0;
    const now = referenceNow;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const inWindow = dataSource.filter(d => {
      const t = new Date(d.timestamp).getTime();
      return t > thirtyDaysAgo && t <= now;
    });
    if (inWindow.length === 0) return { data: [], totalRain: 0 };

    // Group by local date
    const buckets = new Map<string, WeatherData[]>();
    inWindow.forEach(d => {
      const key = new Date(d.timestamp).toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(d);
    });

    const dayRainTotal = (records: WeatherData[]) => {
      const vals = records.map(r => r.rainfall).filter((v): v is number => v != null);
      if (vals.length === 0) return 0;
      const maxVal = Math.max(...vals);
      let total = 0;
      if (maxVal <= 50) {
        total = vals.reduce((s, v) => s + Math.min(Math.max(v, 0), 50), 0);
      } else {
        for (let i = 1; i < vals.length; i++) {
          const diff = vals[i] - vals[i - 1];
          if (diff > 0 && diff < 200) total += diff;
        }
      }
      return Math.round(total * 100) / 100;
    };

    const dayEto = (records: WeatherData[]) => {
      const etoValues = records
        .map(r => {
          const temp = r.temperature;
          const hum = r.humidity;
          const ws = r.windSpeed;
          const sr = r.solarRadiation;
          if (temp == null || hum == null || ws == null || sr == null) return null;
          const ts = new Date(r.timestamp);
          const doy = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / 86400000);
          return calculateETo(temp, hum, windSpeedUnit === 'kmh' ? kmhToMs(ws) : ws, wattsToMJPerDay(sr, ASSUMED_DAYLIGHT_HOURS), alt, lat, doy);
        })
        .filter((e): e is number => e !== null && e !== undefined && !isNaN(e) && e > 0);
      if (etoValues.length === 0) return null;
      const avg = etoValues.reduce((a, b) => a + b, 0) / etoValues.length;
      return Math.round(avg * 100) / 100;
    };

    const data = [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, records]) => {
        const eto = dayEto(records);
        const rain = dayRainTotal(records);
        const date = new Date(dateKey + 'T12:00:00');
        return {
          timestamp: date.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }),
          eto: eto ?? 0,
          rain,
        };
      });

    const totalRain = Math.round(data.reduce((s, d) => s + (d.rain || 0), 0) * 100) / 100;
    return { data, totalRain };
  }, [sortedStatsData, sortedHistoricalData, selectedStation?.latitude, selectedStation?.altitude, referenceNow, windSpeedUnit]);

  // Compute rainfall stats for Fire Danger card (7-day total + days since last rain)
  const rainfallStats = useMemo(() => {
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    if (dataSource.length < 2) return { rainfall7day: 0, daysSinceRain: 30 };

    const readings = dataSource
      .map(d => ({ ts: new Date(d.timestamp).getTime(), val: d.rainfall }))
      .filter((r): r is { ts: number; val: number } => r.val !== null && r.val !== undefined);
    if (readings.length < 2) return { rainfall7day: 0, daysSinceRain: 30 };

    // 7-day total using range method (cumulative gauge)
    const minVal = Math.min(...readings.map(r => r.val));
    const maxVal = Math.max(...readings.map(r => r.val));
    const rainfall7day = Math.max(0, maxVal - minVal);

    // Days since last rain: find the most recent reading where rainfall value changed (increased)
    let daysSinceRain = 30; // default if no rain found
    const now = referenceNow;
    for (let i = readings.length - 1; i > 0; i--) {
      if (readings[i].val > readings[i - 1].val + 0.05) {
        // Rain detected at this reading
        daysSinceRain = Math.max(0, Math.round((now - readings[i].ts) / (24 * 60 * 60 * 1000)));
        break;
      }
    }

    return { rainfall7day, daysSinceRain };
  }, [sortedStatsData, sortedHistoricalData, referenceNow]);

  // Extract battery voltage from historical data for proper charting.
  // Both banks are carried so installations with two batteries chart each one.
  const batteryChartData = useMemo(() => {
    const effectiveRange = dashboardConfig.chartTimeRange || 24;
    const round2 = (v: number) => Math.round(v * 100) / 100;
    const mean = (a: number[]) => round2(a.reduce((x, y) => x + y, 0) / a.length);

    if (effectiveRange >= 168 && sortedHistoricalData.length > 0) {
      // Daily aggregation for 7d+ ranges
      const dayBuckets = new Map<string, { bank1: number[]; bank2: number[] }>();
      sortedHistoricalData.forEach(d => {
        if (d.batteryVoltage == null && d.batteryVoltage2 == null) return;
        const key = new Date(d.timestamp).toISOString().slice(0, 10);
        if (!dayBuckets.has(key)) dayBuckets.set(key, { bank1: [], bank2: [] });
        const bucket = dayBuckets.get(key)!;
        if (d.batteryVoltage != null) bucket.bank1.push(d.batteryVoltage);
        if (d.batteryVoltage2 != null) bucket.bank2.push(d.batteryVoltage2);
      });
      return [...dayBuckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dateKey, { bank1, bank2 }]) => {
          const date = new Date(dateKey + 'T12:00:00');
          return {
            timestamp: date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" }),
            batteryVoltage: bank1.length ? mean(bank1) : null,
            batteryVoltageMin: bank1.length ? round2(Math.min(...bank1)) : null,
            batteryVoltageMax: bank1.length ? round2(Math.max(...bank1)) : null,
            batteryVoltage2: bank2.length ? mean(bank2) : null,
            batteryVoltage2Min: bank2.length ? round2(Math.min(...bank2)) : null,
            batteryVoltage2Max: bank2.length ? round2(Math.max(...bank2)) : null,
          };
        });
    }
    return sortedHistoricalData.map(d => ({
      timestamp: new Date(d.timestamp).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
      batteryVoltage: d.batteryVoltage ?? 0,
      batteryVoltage2: d.batteryVoltage2 ?? null,
    }));
  }, [sortedHistoricalData, dashboardConfig.chartTimeRange]);

  /**
   * Daily solar energy harvested per charge regulator, in watt-hours.
   *
   * The regulator reports instantaneous panel power, which on its own says
   * nothing about how much the array actually delivered. Integrating power over
   * the sample interval (trapezoidal, with a 2 hour cap so a data gap cannot
   * invent energy) turns that into a daily yield figure, which is the number
   * that matters when sizing or fault-finding a solar installation.
   */
  const chargerEnergyData = useMemo(() => {
    if (sortedHistoricalData.length < 2) return [];
    const MAX_GAP_MS = 2 * 60 * 60 * 1000;
    const days = new Map<string, { wh1: number; wh2: number }>();

    for (let i = 1; i < sortedHistoricalData.length; i++) {
      const prev = sortedHistoricalData[i - 1];
      const curr = sortedHistoricalData[i];
      const dtMs = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();
      if (!(dtMs > 0) || dtMs > MAX_GAP_MS) continue;
      const hours = dtMs / 3600000;
      const key = new Date(curr.timestamp).toISOString().slice(0, 10);
      if (!days.has(key)) days.set(key, { wh1: 0, wh2: 0 });
      const bucket = days.get(key)!;

      const p1a = Number(prev.mpptSolarPower);
      const p1b = Number(curr.mpptSolarPower);
      if (Number.isFinite(p1a) && Number.isFinite(p1b)) {
        bucket.wh1 += ((Math.max(0, p1a) + Math.max(0, p1b)) / 2) * hours;
      }
      const p2a = Number(prev.mppt2SolarPower);
      const p2b = Number(curr.mppt2SolarPower);
      if (Number.isFinite(p2a) && Number.isFinite(p2b)) {
        bucket.wh2 += ((Math.max(0, p2a) + Math.max(0, p2b)) / 2) * hours;
      }
    }

    return [...days.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, { wh1, wh2 }]) => ({
        timestamp: new Date(dateKey + 'T12:00:00').toLocaleDateString("en-ZA", { day: "numeric", month: "short" }),
        chargerEnergy1: Math.round(wh1 * 10) / 10,
        chargerEnergy2: Math.round(wh2 * 10) / 10,
        chargerEnergyTotal: Math.round((wh1 + wh2) * 10) / 10,
      }));
  }, [sortedHistoricalData]);

  // Battery charging daily check. detect if battery charged in the last 24h
  const batteryChargingStatus = useMemo(() => {
    const batteryReadings = sortedHistoricalData
      .filter(d => d.batteryVoltage != null && d.batteryVoltage > 0);
    if (batteryReadings.length < 2) return { hasData: false, didCharge: true, maxVoltage: 0, minVoltage: 0 };
    
    const voltages = batteryReadings.map(d => d.batteryVoltage!);
    const maxV = Math.max(...voltages);
    const minV = Math.min(...voltages);
    // LiFePO4: voltage above 13.6V indicates charging (resting full is ~13.4-13.6V)
    // A voltage swing of at least 0.3V also indicates charging activity
    const didCharge = maxV > 13.6 || (maxV - minV) > 0.3;
    return { hasData: true, didCharge, maxVoltage: maxV, minVoltage: minV };
  }, [sortedHistoricalData]);

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
          <Radio className="h-12 w-12 mx-auto text-black opacity-50" />
          <h2 className="text-base font-normal text-foreground">No Stations Assigned</h2>
          <p className="text-sm text-black max-w-md">
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
        <Loader2 className="h-8 w-8 animate-spin text-black" />
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 px-8">
            <Radio className="h-12 w-12 text-black mb-4" />
            <h2 className="text-base font-normal text-foreground mb-2">No Weather Stations</h2>
            <p className="text-sm text-black text-center mb-4 max-w-sm">
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

  // Hold the loader until the current reading, chart history and 30-day stats
  // for the selected station have all arrived, so the dashboard never appears
  // with empty cards that fill in a beat later.
  const loadSteps = [latestReady, historyReady, statsReady];
  const loadReady = loadSteps.filter(Boolean).length;
  const loadDone = loadSteps.every(Boolean);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8">
      <DashboardLoadingOverlay ready={loadReady} total={loadSteps.length} done={loadDone} />
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
          /* 24-hour accumulation, NOT currentData.rainfall. For cumulative
             stations (RIKA) the raw field is a lifetime counter, so passing it
             here reported hundreds of mm as if it had fallen today. */
          rainfall={availableFields.rainfall ? effectiveRainfall : undefined}
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
              windDirection={currentData.windDirection ?? undefined}
              windSpeed={currentData.windSpeed ?? undefined}
            />
            </Suspense>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-normal">Station Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-black">Latitude</p>
                    <p className="text-sm font-normal">{safeFixed(selectedStation?.latitude, 6, "Not set")}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-black">Longitude</p>
                    <p className="text-sm font-normal">{safeFixed(selectedStation?.longitude, 6, "Not set")}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-black">Altitude</p>
                    <p className="text-sm font-normal">{selectedStation?.altitude ? `${selectedStation.altitude} m` : "Not set"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-black">Location</p>
                    <p className="text-sm font-normal">{selectedStation?.location || "Not specified"}</p>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-black">Station Type</p>
                    <p className="text-sm font-normal">{selectedStation?.dataloggerModel || selectedStation?.stationType || "Weather Station"}</p>
                  </div>
                </div>
                <p className="text-xs text-black italic mt-3 flex items-center gap-1">
                  <Layers className="h-3 w-3 inline" /> Click the layers icon on the map (top-right) to switch between street and satellite view
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
        )}

        {/* Primary Metrics charts - cards shown in CurrentConditions above; here go straight to charts */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.primaryMetrics !== false && (availableFields.temperature || availableFields.humidity || availableFields.pressure || availableFields.windSpeed || availableFields.rainfall) && (
        <section className="space-y-4">
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
          {dashboardConfig.sectionVisibility?.barometricPressure !== false && availableFields.pressure && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarometricPressureCard
              stationPressure={effectiveStationPressure}
              seaLevelPressure={seaLevelPressure}
              altitude={selectedStation?.altitude || 0}
              temperature={currentData.temperature || DEFAULT_TEMPERATURE_C}
              trend={trends.pressure !== null ? parseFloat(safeFixed(trends.pressure, 1, "0")) : 0}
            />
            <DataBlockChart
              title="Barometric Pressure History"
              data={chartData}
              series={[
                { dataKey: "pressure", name: "Station Pressure", color: CHART_COLORS.pressure, unit: "hPa" },
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
              <div>
                <p className="text-sm font-medium">Battery Not Charging</p>
                <p className="text-xs text-amber-600">
                  No charging activity detected in the last 24 hours. Voltage range: {batteryChargingStatus.minVoltage.toFixed(2)}V to {batteryChargingStatus.maxVoltage.toFixed(2)}V. 
                  Check solar panel, wiring, or charge controller.
                </p>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BatteryVoltageCard
              voltage={currentData.batteryVoltage || 0}
              minVoltage={10.0}
              maxVoltage={14.6}
              isCharging={currentData.batteryVoltage ? currentData.batteryVoltage > 13.6 && ((currentData.solarRadiation ?? 0) > 0 || (currentData.mpptSolarPower != null ? Number(currentData.mpptSolarPower) > 0 : false)) : false}
            />
            <DataBlockChart
              title="Battery Voltage History"
              data={batteryChartData}
              series={[
                { dataKey: "batteryVoltage", name: "Battery Voltage", color: CHART_COLORS.batteryVoltage, unit: "V" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Voltage"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.batteryVoltage || 0}
              defaultExpanded={false}
            />
            {availableFields.batteryVoltage && availableFields.solarRadiation && (
            <DataBlockChart
              title="Battery Voltage vs Solar Irradiance"
              data={chartData}
              series={[
                { dataKey: "batteryVoltage", name: "Battery Voltage", color: CHART_COLORS.batteryVoltage, unit: "V", yAxisId: "left" },
                { dataKey: "solar", name: "Solar Irradiance", color: "#f59e0b", unit: "W/m²", yAxisId: "right", strokeDasharray: "4 3" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Voltage (V)"
              rightYAxisLabel="Irradiance (W/m²)"
              showAverage={false}
              showMinMax={true}
              currentValue={currentData.batteryVoltage || 0}
            />
            )}
            {hasValidData(currentData.panelTemperature) && currentData.panelTemperature !== 0 && (
              chartData.length > 0 ? (
                <DataBlockChart
                  title="Panel Temperature"
                  data={chartData}
                  series={[{ dataKey: "panelTemperature", name: "Panel Temperature", color: "#ef4444", unit: "°C" }]}
                  chartType="line"
                  xAxisLabel="Time"
                  yAxisLabel="Temperature (°C)"
                  showAverage={true}
                  showMinMax={true}
                  currentValue={currentData.panelTemperature || 0}
                />
              ) : (
                <MetricCard
                  title="Panel Temperature"
                  value={formatValue(currentData.panelTemperature || 0, 1)}
                  unit="°C"
                />
              )
            )}
            {hasValidData((currentData as any).moduleTemperature) && (
            <MetricCard
              title="Module Temperature"
              value={formatValue((currentData as any).moduleTemperature || 0, 1)}
              unit="°C"
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
            Test Data - MPPT values shown below are simulated for demonstration purposes and do not represent real-world measurements.
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
              bulkFloatVoltage={currentData.mpptBulkFloatVoltage ?? null}
              floatVoltage={currentData.mpptFloatVoltage ?? null}
              currentLimit={currentData.mpptCurrentLimit ?? null}
              absorbTimeLimit={currentData.mpptAbsorbTimeLimit ?? null}
              absorbFullCurrent={currentData.mpptAbsorbFullCurrent ?? null}
              vCalSlope={currentData.mpptVCalSlope ?? null}
              iCalSlope={currentData.mpptICalSlope ?? null}
            />
            {availableFields.mppt2SolarVoltage && (
            <MpptChargerCard
              label="Charger 2"
              testIdSuffix="-2"
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
              bulkFloatVoltage={currentData.mppt2BulkFloatVoltage ?? null}
              floatVoltage={currentData.mppt2FloatVoltage ?? null}
              currentLimit={currentData.mppt2CurrentLimit ?? null}
              absorbTimeLimit={currentData.mppt2AbsorbTimeLimit ?? null}
              absorbFullCurrent={currentData.mppt2AbsorbFullCurrent ?? null}
              vCalSlope={currentData.mppt2VCalSlope ?? null}
              iCalSlope={currentData.mppt2ICalSlope ?? null}
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
                ...(availableFields.mpptBatteryVoltage ? [{ dataKey: "mpptBatteryVoltage", name: "Battery Voltage", color: CHART_COLORS.mpptBatteryVoltage, unit: "V" }] : []),
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
              title="Solar Voltage: Charger 1 vs 2"
              data={chartData}
              series={[
                { dataKey: "mpptSolarVoltage", name: "Charger 1", color: "#ef4444", unit: "V" },
                { dataKey: "mppt2SolarVoltage", name: "Charger 2", color: "#f97316", unit: "V" },
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
              title="Battery Voltage: Charger 1 vs 2"
              data={chartData}
              series={[
                { dataKey: "mpptBatteryVoltage", name: "Charger 1", color: CHART_COLORS.mpptBatteryVoltage, unit: "V" },
                { dataKey: "mppt2BatteryVoltage", name: "Charger 2", color: CHART_COLORS.mppt2BatteryVoltage, unit: "V" },
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
              title={availableFields.mppt2SolarVoltage ? "Charger 1 Current" : "Solar Current, Load Current & MPPT Current"}
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
              title="Charger 2 Current"
              data={chartData}
              series={[
                { dataKey: "mppt2SolarCurrent", name: "Solar Current", color: "#3b82f6", unit: "mA" },
                ...(availableFields.mppt2LoadCurrent ? [{ dataKey: "mppt2LoadCurrent", name: "Load Current", color: "#22c55e", unit: "mA" }] : []),
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
              title={availableFields.mppt2SolarPower ? "Charger 1 Solar Power" : "Solar Power"}
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
              title="Charger 2 Solar Power"
              data={chartData}
              series={[
                { dataKey: "mppt2SolarPower", name: "Solar Power", color: "#f97316", unit: "W" },
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
          {/* Daily yield: what the array actually delivered, not just peak power */}
          {chargerEnergyData.length > 0 && (availableFields.mpptSolarPower || availableFields.mppt2SolarPower) && (
          <div className="grid grid-cols-1 gap-6">
            <DataBlockChart
              title="Daily Solar Energy Harvested"
              data={chargerEnergyData}
              series={[
                ...(availableFields.mpptSolarPower ? [{ dataKey: "chargerEnergy1", name: availableFields.mppt2SolarPower ? "Charger 1" : "Harvested", color: "#f59e0b", unit: "Wh" }] : []),
                ...(availableFields.mppt2SolarPower ? [{ dataKey: "chargerEnergy2", name: "Charger 2", color: CHART_COLORS.chargerEnergy2, unit: "Wh" }] : []),
                // With two regulators the system total is the figure that matters
                // when judging whether the installation is meeting its load.
                ...(availableFields.mpptSolarPower && availableFields.mppt2SolarPower
                  ? [{ dataKey: "chargerEnergyTotal", name: "System total", color: "#1e3a5f", unit: "Wh" }]
                  : []),
              ]}
              chartType="bar"
              xAxisLabel="Day"
              yAxisLabel="Energy (Wh)"
              showAverage={true}
              showMinMax={true}
              defaultExpanded={isMpptOnlyStation}
              yAxisDomain={[0, 'auto']}
            />
          </div>
          )}
        </section>
        )}

        {/* Water & Sensors Section - Only show if any water/sensor data exists AND section enabled */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.waterSensors !== false && (availableFields.waterLevel || availableFields.temperatureSwitch || availableFields.levelSwitch || availableFields.temperatureSwitchOutlet || availableFields.levelSwitchStatus || availableFields.lightning || availableFields.lightningDistance || availableFields.lightningEnergy || availableFields.lightningRaw || availableFields.chargerVoltage || availableFields.temperature8m || availableFields.deltaTemperature) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Sensors</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {availableFields.waterLevel && (
              <MetricCard
                title="Water Level"
                value={formatValue(currentData.waterLevel || 0, 1)}
                unit="mm"
              />
            )}
            {availableFields.temperatureSwitch && (
              <MetricCard
                title="Temp Switch"
                value={formatValue(currentData.temperatureSwitch || 0, 1)}
                unit="mV"
              />
            )}
            {availableFields.levelSwitch && (
              <MetricCard
                title="Level Switch"
                value={(currentData.levelSwitch ?? 0) > 100 ? "On" : "Off"}
                unit=""
              />
            )}
            {availableFields.temperatureSwitchOutlet && (
              <MetricCard
                title="Temp Switch Outlet"
                value={formatValue(currentData.temperatureSwitchOutlet || 0, 1)}
                unit="mV"
              />
            )}
            {availableFields.levelSwitchStatus && (
              <MetricCard
                title="Level Switch Status"
                value={(currentData.levelSwitchStatus ?? 0) > 0 ? "On" : "Off"}
                unit=""
              />
            )}
            {availableFields.lightning && (
              <MetricCard
                title="Lightning Strikes"
                value={formatValue(currentData.lightning || 0, 0)}
                unit="strikes"
              />
            )}
            {availableFields.lightningRaw && (
              <MetricCard
                title="Lightning Raw"
                value={formatValue(currentData.lightningRaw || 0, 2)}
                unit="mA"
              />
            )}
            {availableFields.lightningDistance && (
              <MetricCard
                title="Strike Distance"
                value={formatValue(currentData.lightningDistance != null && currentData.lightningDistance > 0 ? currentData.lightningDistance : 0, 0)}
                unit="km"
              />
            )}
            {availableFields.lightningEnergy && (
              // The AS3935 intensity register has no physical unit, so show the
              // relative 0 to 100 figure and its band rather than a bare number.
              <MetricCard
                title="Strike Intensity"
                value={formatValue(interpretLightningIntensity(currentData.lightningEnergy).relative, 1)}
                unit="of 100"
                subMetrics={[
                  { label: interpretLightningIntensity(currentData.lightningEnergy).label, value: `raw ${formatValue(currentData.lightningEnergy || 0, 0)}` },
                ]}
              />
            )}
            {availableFields.chargerVoltage && (
              <MetricCard
                title="Charger Voltage"
                value={formatValue(currentData.chargerVoltage || 0, 2)}
                unit="V"
              />
            )}
            {availableFields.temperature8m && (
              <MetricCard
                title="Temperature (8m)"
                value={formatValue(currentData.temperature8m || 0, 1)}
                unit="°C"
              />
            )}
            {availableFields.deltaTemperature && (
              <MetricCard
                title="Delta Temperature"
                value={formatValue(currentData.deltaTemperature || 0, 2)}
                unit="°C"
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
                ...(availableFields.temperatureSwitchOutlet ? [{ dataKey: "temperatureSwitchOutlet", name: "Temp Switch Outlet", color: "#3b82f6", unit: "mV" }] : []),
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
          {/* Temperature (8m), Delta Temperature, Lightning Charts */}
          {(availableFields.temperature8m || availableFields.deltaTemperature || availableFields.lightning || availableFields.lightningDistance || availableFields.lightningEnergy || availableFields.lightningRaw) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.temperature8m && (
            <DataBlockChart
              title="Temperature (8m) History"
              data={chartData}
              series={[
                { dataKey: "temperature8m", name: "Temperature (8m)", color: "#ef4444", unit: "°C" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Temperature (°C)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.temperature8m || 0}
            />
            )}
            {availableFields.deltaTemperature && (
            <DataBlockChart
              title="Delta Temperature History"
              data={chartData}
              series={[
                { dataKey: "deltaTemperature", name: "Delta Temperature", color: "#f97316", unit: "°C" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Delta T (°C)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.deltaTemperature || 0}
            />
            )}
            {availableFields.lightning && (
            <DataBlockChart
              title="Lightning Strikes"
              data={chartData}
              series={[
                { dataKey: "lightning", name: "Lightning Strikes", color: "#f59e0b", unit: "strikes" },
              ]}
              chartType="bar"
              xAxisLabel="Time"
              yAxisLabel="Strikes"
              showAverage={false}
              showMinMax={true}
            />
            )}
            {availableFields.lightningDistance && (
            <DataBlockChart
              title="Lightning Strike Distance"
              data={chartData}
              series={[
                { dataKey: "lightningDistance", name: "Strike Distance", color: "#ef4444", unit: "km" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Distance (km)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.lightningDistance != null && currentData.lightningDistance > 0 ? currentData.lightningDistance : 0}
            />
            )}
            {availableFields.lightningEnergy && (
            <DataBlockChart
              title="Lightning Strike Intensity (relative, no physical unit)"
              data={chartData}
              series={[
                { dataKey: "lightningEnergy", name: "Strike Intensity", color: "#f97316", unit: "" },
              ]}
              chartType="bar"
              xAxisLabel="Time"
              yAxisLabel="Energy (relative)"
              showAverage={false}
              showMinMax={true}
            />
            )}
            {availableFields.lightningRaw && (
            <DataBlockChart
              title="Lightning Raw"
              data={chartData}
              series={[
                { dataKey: "lightningRaw", name: "Lightning Raw", color: "#eab308", unit: "mA" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Current (mA)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.lightningRaw || 0}
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
          
          {/* Solar Position Card - full width */}
          {dashboardConfig.sectionVisibility?.solarPosition !== false && hasStationCoordinates && (
            <SolarPositionCard
              elevation={solarPosition.elevation}
              azimuth={solarPosition.azimuth}
              latitude={selectedStation!.latitude!}
              longitude={selectedStation!.longitude!}
              sunrise={solarPosition.sunrise}
              sunset={solarPosition.sunset}
              nauticalDawn={solarPosition.nauticalDawn}
              nauticalDusk={solarPosition.nauticalDusk}
              civilDawn={solarPosition.civilDawn}
              civilDusk={solarPosition.civilDusk}
              solarNoon={solarPosition.solarNoon}
              dayLength={solarPosition.dayLength}
            />
          )}
          {/* Air Density Card + Chart in same row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {(availableFields.temperature && availableFields.pressure) && (
            <AirDensityCard
              airDensity={currentData.airDensity || calculatedAirDensity}
              temperature={currentData.temperature ?? undefined}
              pressure={currentData.pressure ?? undefined}
              humidity={currentData.humidity ?? undefined}
            />
            )}
            {/* Air Density History Chart */}
            {(availableFields.temperature && availableFields.pressure) && (
            <DataBlockChart
              title="Air Density History"
              data={chartData}
              series={[
                { dataKey: "airDensity", name: "Air Density", color: "#3b82f6", unit: "kg/m³" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Density (kg/m³)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.airDensity || calculatedAirDensity}
            />
            )}
          </div>
          
          
          {/* Charts grid - paired rows */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                { dataKey: "eto", name: "Reference ETo", color: CHART_COLORS.eto, unit: "mm/day" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="ETo (mm/day)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.eto ?? calculatedETo ?? 0}
            />
            )}
            {/* Irrigation Time Chart */}
            {availableFields.solarRadiation && availableFields.rainfall && (
            <DataBlockChart
              title="Irrigation Time (Estimated)"
              data={chartData}
              series={[
                { dataKey: "irrigationTime", name: "Irrigation Time", color: "#3b82f6", unit: "min" },
              ]}
              chartType="bar"
              xAxisLabel="Time"
              yAxisLabel="Minutes"
              showAverage={true}
              showMinMax={true}
              footer="(ETo - rainfall) × crop factor × valve flow rate | Based on FAO-56 Penman-Monteith ETo. Assumes Kc=1.0 (reference grass) and 5 mm/hr flow rate. Estimation only (does not account for soil type, crop stage, or irrigation system efficiency)."
            />
            )}
            {/* Dew Point Temperature */}
            {(availableFields.temperature && availableFields.humidity) && chartData.length > 0 && (
            <DataBlockChart
              title="Dew Point Temperature"
              data={chartData}
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
            {/* Wind Speed vs Wind Gust */}
            {availableFields.windSpeed && (
            <DataBlockChart
              title="Wind Speed vs Wind Gust"
              data={chartData}
              series={[
                { dataKey: "windSpeed", name: "Wind Speed", color: "#22c55e", unit: windUnitLabel },
                { dataKey: "windGust", name: "Wind Gust", color: "#f59e0b", unit: windUnitLabel },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel={`Speed (${windUnitLabel})`}
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.windSpeed || 0}
            />
            )}
            {/* Wind Speed vs Wind Direction */}
            {availableFields.windSpeed && availableFields.windDirection && (
            <DataBlockChart
              title="Wind Speed vs Wind Direction"
              data={chartData}
              series={[
                { dataKey: "windSpeed", name: "Wind Speed", color: "#22c55e", unit: windUnitLabel, yAxisId: "left" },
                { dataKey: "windDirection", name: "Wind Direction", color: "#f97316", unit: "°", yAxisId: "right", strokeDasharray: "4 3" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel={`Speed (${windUnitLabel})`}
              rightYAxisLabel="Direction (°)"
              rightYAxisDomain={[0, 360]}
              showAverage={false}
              showMinMax={true}
              currentValue={currentData.windSpeed || 0}
            />
            )}
            {/* Heat Index */}
            {availableFields.temperature && availableFields.humidity && (
            <DataBlockChart
              title="Heat Index"
              data={chartData}
              series={[
                { dataKey: "heatIndex", name: "Heat Index", color: "#dc2626", unit: "°C" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Heat Index (°C)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.temperature != null && currentData.humidity != null ? calculateHeatIndex(currentData.temperature, currentData.humidity) : 0}
            />
            )}
            {/* Wind Chill */}
            {availableFields.temperature && availableFields.windSpeed && (
            <DataBlockChart
              title="Wind Chill"
              data={chartData}
              series={[
                { dataKey: "windChill", name: "Wind Chill", color: CHART_COLORS.windChill, unit: "°C" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Wind Chill (°C)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.temperature != null && currentData.windSpeed != null ? calculateWindChill(currentData.temperature, windSpeedUnit === 'kmh' ? kmhToMs(currentData.windSpeed) : currentData.windSpeed) : 0}
            />
            )}
          </div>



          {/* Solar Power Harvesting - Single full-width block */}
          {availableFields.solarRadiation && (() => {
            const eff = 0.20;
            const losses = 0.15;
            const rad = currentData.solarRadiation ?? 0;
            const currentOutput = rad * eff * (1 - losses);
            const estimateRad = avgDaytimeRadiation ?? rad;
            const est = calculateSolarEstimates(estimateRad, eff, losses);
            return (
            <Card className="border border-gray-300 bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar Power Harvesting Potential</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(currentOutput, 1)}</span>
                  <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>W/m²</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Current Radiation</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(rad, 0)} W/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Panel Efficiency</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(eff * 100, 0)}%</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Peak Sun Hours</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(est.peakSunHours, 1)} hrs</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Radiation</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(estimateRad, 0)} W/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Daily Energy</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(est.dailyEnergy, 2)} kWh/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Monthly Energy</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(est.monthlyEnergy, 1)} kWh/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Yearly Energy</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(est.yearlyEnergy, 0)} kWh/m²</p>
                  </div>
                </div>
                <p className="text-xs text-black italic" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  Estimates based on {safeFixed(eff * 100, 0)}% panel efficiency, {safeFixed(losses * 100, 0)}% system losses (wiring, inverter, dust), 1 m² panel area, and {safeFixed(estimateRad, 0)} W/m² average radiation. Actual output depends on panel orientation, shading, and local conditions. Yearly estimate includes 15% seasonal reduction factor.
                </p>
              </CardContent>
            </Card>
            );
          })()}
          {availableFields.solarRadiation && (
            <DataBlockChart
              title="Solar Power Output Over Time"
              data={chartData.map(d => ({
                timestamp: d.timestamp,
                solarPower: (d.solar ?? 0) * 0.20 * (1 - 0.15),
                solarRadiation: d.solar ?? 0,
              }))}
              series={[
                { dataKey: "solarPower", name: "Solar Power (W/m²)", color: "#f59e0b", unit: "W/m²" },
                { dataKey: "solarRadiation", name: "Radiation (W/m²)", color: "#ef4444", unit: "W/m²" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Power / Radiation"
              showAverage={true}
              showMinMax={true}
              currentValue={(currentData.solarRadiation ?? 0) * 0.20 * (1 - 0.15)}
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
            />
            )}
            {availableFields.pm10 && (
            <MetricCard
              title="PM10"
              value={formatValue(currentData.pm10 || 0, 1)}
              unit="µg/m³"
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

        {/* Visibility & Clouds - Only show if visibility data available */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.visibilityClouds !== false && (availableFields.visibility || availableFields.atmosphericVisibility || availableFields.cloudBase || availableFields.cloudCover) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Visibility & Clouds</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {availableFields.visibility && (
            <MetricCard
              title="Visibility"
              value={formatValue(currentData.visibility || 0, 1)}
              unit="km"
              subMetrics={[
                { label: "Conditions", value: (currentData.visibility || 0) >= 10 ? "Clear" : (currentData.visibility || 0) >= 4 ? "Moderate" : (currentData.visibility || 0) >= 1 ? "Poor" : "Fog" },
              ]}
              chartColor="#3b82f6"
            />
            )}
            {availableFields.atmosphericVisibility && (
            <MetricCard
              title="Atmospheric Visibility"
              value={formatValue(currentData.atmosphericVisibility || 0, 1)}
              unit="km"
              chartColor="#2563eb"
            />
            )}
            {availableFields.cloudBase && (
            <MetricCard
              title="Cloud Base"
              value={formatValue(currentData.cloudBase || 0, 0)}
              unit="m"
              chartColor="#06b6d4"
            />
            )}
            {availableFields.cloudCover && (
            <MetricCard
              title="Cloud Cover"
              value={formatValue(currentData.cloudCover || 0, 0)}
              unit="%"
              chartColor="#94a3b8"
            />
            )}
          </div>

          {/* Visibility Charts */}
          {(availableFields.visibility || availableFields.atmosphericVisibility) && (
          <div className="grid grid-cols-1 gap-6">
            {availableFields.visibility && (
            <DataBlockChart
              title="Visibility"
              data={chartData.filter(d => d.visibility !== null).map(d => ({ ...d, vis: d.visibility }))}
              series={[
                { dataKey: "vis", name: "Visibility", color: "#3b82f6", unit: "km" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Visibility (km)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.visibility || 0}
            />
            )}
            {availableFields.atmosphericVisibility && (
            <DataBlockChart
              title="Atmospheric Visibility"
              data={chartData.filter(d => d.atmosphericVisibility !== null && d.atmosphericVisibility !== undefined).map(d => ({ ...d, atmosVis: d.atmosphericVisibility }))}
              series={[
                { dataKey: "atmosVis", name: "Atmospheric Vis.", color: "#2563eb", unit: "km" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Visibility (km)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.atmosphericVisibility || 0}
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

        {/* Wind Energy Section - Single full-width block */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.windEnergy !== false && (availableFields.windSpeed || availableFields.windDirection) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Wind Energy</h2>
          {(() => {
            const density = currentData.airDensity || STANDARD_AIR_DENSITY_KGM3;
            const currentPower = calculateWindPower(currentData.windSpeed || 0, density, windSpeedUnit);
            const gustPower = calculateWindPower(currentData.windGust || 0, density, windSpeedUnit);
            const avgSpd = chartData.slice(-10).reduce((sum, d) => sum + (d.windSpeed ?? 0), 0) / Math.max(chartData.slice(-10).length, 1);
            const avgPwr = chartData.slice(-10).reduce((sum, d) => sum + calculateWindPower(d.windSpeed ?? 0, STANDARD_AIR_DENSITY_KGM3, windSpeedUnit), 0) / Math.max(chartData.slice(-10).length, 1);
            const dailyEnergy = windEnergyData.length > 0 ? windEnergyData[windEnergyData.length - 1].cumulativeEnergy : 0;
            const monthlyEnergy = dailyEnergy * 30;
            const yearlyEnergy = dailyEnergy * 365 * 0.85;
            return (
            <Card className="border border-gray-300 bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Wind Power</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(currentPower, 1)}</span>
                  <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>W/m²</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Gust Power</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(gustPower, 1)} W/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Air Density</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(density, 3)} kg/m³</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Speed (Recent)</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(avgSpd, 1)} {windUnitLabel}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Power (Recent)</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(avgPwr, 1)} W/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Daily Energy Potential</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyEnergy, 2)} kWh/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Monthly Energy Potential</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(monthlyEnergy, 1)} kWh/m²</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                    <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Yearly Energy Potential</p>
                    <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(yearlyEnergy, 0)} kWh/m²</p>
                  </div>
                </div>
                <p className="text-xs text-black italic" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  Wind power density calculated using P = ½ × ρ × v³ where ρ = {safeFixed(density, 3)} kg/m³ (air density) and v = wind speed in m/s. Energy potential assumes continuous operation at average power. Monthly and yearly projections extrapolated from daily cumulative energy. Yearly estimate includes 15% capacity reduction for variable wind conditions.
                </p>
              </CardContent>
            </Card>
            );
          })()}
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
          {/* Weibull Distribution, Turbulence & Power Rose */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sortedHistoricalData.length >= 10 && (
            <Suspense fallback={<ChartFallback />}>
              <WeibullCard
                windSpeeds={sortedHistoricalData.map(d => d.windSpeed ?? 0).filter(v => v > 0)}
              />
            </Suspense>
            )}
            {/* Turbulence Intensity card removed at the operator's request. */}
            {sortedHistoricalData.length >= 10 && (
              <WindPowerRose
                data={windPowerRoseData}
                title="Wind Power Rose (30d)"
              />
            )}
            {windPowerRose365Data && (
              <WindPowerRose
                data={windPowerRose365Data}
                title="Wind Power Rose (365d)"
              />
            )}
          </div>
        </section>
        )}

        {/* Fire Danger Section - Only show when we have actual data */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.fireDanger !== false && (availableFields.temperature && availableFields.humidity && availableFields.windSpeed) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Fire Danger</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FireDangerCard
              temperature={currentData.temperature!}
              humidity={currentData.humidity!}
              windSpeed={currentData.windSpeed!}
              rainfall7day={rainfallStats.rainfall7day}
              daysSinceRain={rainfallStats.daysSinceRain}
            />
            <FireDangerChart
              data={fireDangerChartData}
              title="Fire Danger History"
            />
          </div>
        </section>
        )}

        {/* Air Quality Section - Only show if PM data available */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.airQuality !== false && (availableFields.pm10 || availableFields.pm25 || availableFields.pm1 || availableFields.co2 || availableFields.tvoc || availableFields.so2 || availableFields.particulateCount) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Air Quality</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AirQualityCard
              pm25={currentData.pm25}
              pm10={currentData.pm10}
              pm1={(currentData as any).pm1}
              co2={(currentData as any).co2}
              tvoc={(currentData as any).tvoc}
              so2={(currentData as any).so2}
              particulateCount={(currentData as any).particulateCount}
            />
          </div>
        </section>
        )}

        {/* Atmospheric Stability & Aviation (Pasquill-Gifford and Density
            Altitude) section removed at the operator's request. */}

        {/* Rainfall Section */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.rainfall !== false && availableFields.rainfall && activeStationId && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Rainfall</h2>

          {/* Period MetricCards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Rainfall (24h)" value={formatValue(rainfallPeriods.last24h, 2)} unit="mm" />
            <MetricCard title="Rainfall (Yesterday)" value={formatValue(rainfallPeriods.yesterday, 2)} unit="mm" />
            <MetricCard title="Rainfall (This Week)" value={formatValue(rainfallPeriods.thisWeek, 2)} unit="mm" />
            <MetricCard title="Rainfall (This Month)" value={formatValue(rainfallPeriods.thisMonth, 2)} unit="mm" />
          </div>

          {(() => {
            /**
             * Year-to-date rainfall is hidden for RIKA stations.
             *
             * RikaCloud reports a lifetime counter rather than per-interval
             * rainfall, and the yearly endpoint aggregates it against a
             * partitioned window, so the "YTD total" it produces for these
             * stations is not a trustworthy rainfall depth. Rather than show a
             * confidently wrong figure, the card is omitted for RIKA.
             */
            if (isRikaStation) return null;
            const currentYear = new Date().getFullYear();
            // Show ONLY the current calendar year (year-to-date) total.
            const sortedYearly = (rainfallYearly || [])
              .filter((r: any) => r.year === currentYear && (r.total > 0 || r.readings > 0));
            if (sortedYearly.length === 0) return null;
            return (
            <Card className="border border-gray-300 bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Rainfall Total (Year to Date)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className={`grid gap-3 ${sortedYearly.length === 1 ? 'grid-cols-1' : sortedYearly.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {sortedYearly.map((entry: any) => {
                    const isCurrent = entry.year === currentYear;
                    return (
                      <div key={entry.year} className={`rounded-lg border p-3 ${isCurrent ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
                        <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{entry.year}{isCurrent ? ' (YTD)' : ''}</p>
                        <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                          {`${safeFixed(entry.total, 1)} mm`}
                        </p>
                        <p className="text-xs text-black">{(entry.readings || 0).toLocaleString()} readings</p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-black italic" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  Rainfall totals are calculated from station logger data. Accuracy may be affected by periods where the station was offline, clogged or blocked rain gauges, logger resets, or data gaps during synchronization interruptions.
                </p>
              </CardContent>
            </Card>
            );
          })()}
        </section>
        )}


        {/* ETo vs Rainfall (last 30 days) - only when there was rain */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.rainfall !== false && availableFields.rainfall && etoRainDaily.totalRain > 0 && etoRainDaily.data.length > 0 && (
        <section className="space-y-4">
          <Suspense fallback={<ChartFallback />}>
            <DataBlockChart
              title="ETo vs Rainfall (Last 30 Days)"
              data={etoRainDaily.data}
              chartType="bar"
              series={[
                { dataKey: "rain", name: "Rainfall (mm)", color: "#3b82f6", unit: "mm", yAxisId: "left" },
                { dataKey: "eto", name: "ETo (mm/day)", color: CHART_COLORS.eto, unit: "mm/day", yAxisId: "right" },
              ]}
              yAxisLabel="Rainfall (mm)"
              rightYAxisLabel="ETo (mm/day)"
            />
          </Suspense>
        </section>
        )}


        {/* Charts Section */}
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.historicalCharts !== false && (chartData.length > 0 || historicalChartData.length > 0) && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-base font-normal text-foreground">Historical Data</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-black">Time Range:</span>
              {/*
                Ranges come from the station's dashboard config rather than a
                literal list here, so a station whose record only spans a fixed
                window is not offered ranges that fall outside it. With no
                config set, every range is offered exactly as before.
              */}
              <div className="flex gap-1">
                {offeredChartRanges.map((hours) => (
                  <Button
                    key={hours}
                    variant={historicalChartRange === hours ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setHistoricalChartRange(hours)}
                  >
                    {chartTimeRangeLabel(hours)}
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
                  ...(availableFields.windGust ? [{ dataKey: "windGust", name: `Wind Gust (${windUnitLabel})`, color: "#f59e0b" }] : []),
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
                  { dataKey: "pressure", name: "Pressure (hPa)", color: CHART_COLORS.pressure },
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
        {!isMpptOnlyStation && dashboardConfig.sectionVisibility?.solarEtCards !== false && (availableFields.solarRadiation || availableFields.temperature) && (
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
                ...(temperatureStats.has14d ? [{
                  period: "14d",
                  stats: [
                    { label: "Min", value: temperatureStats['14d'].min ?? '--', unit: "°C" },
                    { label: "Max", value: temperatureStats['14d'].max ?? '--', unit: "°C" },
                    { label: "Avg", value: temperatureStats['14d'].avg ?? '--', unit: "°C" },
                    { label: "Range", value: temperatureStats['14d'].range ?? '--', unit: "°C" },
                  ],
                }] : [{
                  period: "14d",
                  stats: [
                    { label: "Min", value: '--', unit: "°C" },
                    { label: "Max", value: '--', unit: "°C" },
                    { label: "Avg", value: '--', unit: "°C" },
                    { label: "Range", value: '--', unit: "°C" },
                  ],
                }]),
                ...(temperatureStats.has30d ? [{
                  period: "30d",
                  stats: [
                    { label: "Min", value: temperatureStats['30d'].min ?? '--', unit: "°C" },
                    { label: "Max", value: temperatureStats['30d'].max ?? '--', unit: "°C" },
                    { label: "Avg", value: temperatureStats['30d'].avg ?? '--', unit: "°C" },
                    { label: "Range", value: temperatureStats['30d'].range ?? '--', unit: "°C" },
                  ],
                }] : [{
                  period: "30d",
                  stats: [
                    { label: "Min", value: '--', unit: "°C" },
                    { label: "Max", value: '--', unit: "°C" },
                    { label: "Avg", value: '--', unit: "°C" },
                    { label: "Range", value: '--', unit: "°C" },
                  ],
                }]),
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
