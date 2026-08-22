// Stratus Weather Server
// Created by Lukas Esterhuizen
// v3.2 - View Only button restyle
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { safeFixed } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { CurrentConditions } from "@/components/dashboard/CurrentConditions";
import { DashboardLoadingOverlay } from "@/components/DashboardLoadingOverlay";
import { rainfallTotalFromRecords, isCumulativeType, type RainfallType } from "@shared/utils/rainfall";
import { WindCompass } from "@/components/dashboard/WindCompass";
// WindPowerCard replaced with inline Card layout
import { StatisticsCard } from "@/components/dashboard/StatisticsCard";
import { SolarRadiationCard } from "@/components/dashboard/SolarRadiationCard";
import { EToCard } from "@/components/dashboard/EToCard";
import { AirDensityCard } from "@/components/dashboard/AirDensityCard";
import { BatteryVoltageCard } from "@/components/dashboard/BatteryVoltageCard";
import { MpptChargerCard } from "@/components/dashboard/MpptChargerCard";
import { BarometricPressureCard } from "@/components/dashboard/BarometricPressureCard";
import { calculateSolarEstimates } from "@/components/dashboard/SolarPowerHarvestCard";
import { SolarPositionCard } from "@/components/dashboard/SolarPositionCard";
import { FireDangerCard } from "@/components/dashboard/FireDangerCard";
import { AirQualityCard } from "@/components/dashboard/AirQualityCard";
import { AtmosphericStabilityCard } from "@/components/dashboard/AtmosphericStabilityCard";

import { DensityAltitudeCard } from "@/components/dashboard/DensityAltitudeCard";

import { TurbulenceCard } from "@/components/dashboard/TurbulenceCard";
import { WindPowerRose, processWindPowerRoseData } from "@/components/charts/WindPowerRose";
// RainfallYearlyCard removed - yearly data shown in Rainfall MetricCard subMetric
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Lock,
  RefreshCw,
  Download,
  Loader2,
  Layers,
} from "lucide-react";
import type { WeatherData } from "@shared/schema";
import { DEFAULT_SECTION_VISIBILITY, DASHBOARD_CATEGORIES, isParameterEnabled, type SectionVisibility } from "../../../shared/dashboardConfig";
import { 
  calculateSeaLevelPressure,
  calculateStationPressure,
  calculateAirDensity,
  calculateETo,
  getDayOfYear,
  kmhToMs,
  wattsToMJPerDay,
  calculateFireDanger,
  calculateSolarPosition,
  calculateHeatIndex,
  calculateWindChill,
} from "@shared/utils/calc";
import { interpretLightningIntensity } from "@shared/utils/lightning";
import { CHART_COLOURS } from "@shared/chartColours";
import { getSimplifiedClasses, getWindUnitLabel, getWindDirectionLabel, type WindSpeedUnit } from "@/lib/windConstants";
import {
  STANDARD_SEA_LEVEL_PRESSURE_HPA,
  STANDARD_AIR_DENSITY_KGM3,
  DEFAULT_TEMPERATURE_C,
  DEFAULT_HUMIDITY_PERCENT,
  ASSUMED_DAYLIGHT_HOURS,
} from "@shared/utils/weatherConstants";

// Lazy-load heavy chart components
const WindRose = lazy(() => import("@/components/charts/WindRose").then(m => ({ default: m.WindRose })));
const WindRoseScatter = lazy(() => import("@/components/charts/WindRoseScatter").then(m => ({ default: m.WindRoseScatter })));
const WeatherChart = lazy(() => import("@/components/charts/WeatherChart").then(m => ({ default: m.WeatherChart })));
const DataBlockChart = lazy(() => import("@/components/charts/DataBlockChart").then(m => ({ default: m.DataBlockChart })));
const FireDangerChart = lazy(() => import("@/components/charts/FireDangerChart").then(m => ({ default: m.FireDangerChart })));
const StationMap = lazy(() => import("@/components/dashboard/StationMap").then(m => ({ default: m.StationMapWithErrorBoundary })));
const WeibullCard = lazy(() => import("@/components/dashboard/WeibullCard").then(m => ({ default: m.WeibullCard })));

const ChartFallback = () => (
  <div className="flex items-center justify-center h-48 bg-muted/20 rounded-lg animate-pulse">
    <Loader2 className="h-6 w-6 animate-spin text-black" />
  </div>
);

interface ShareAccess {
  stationId: number;
  accessLevel: 'viewer' | 'editor';
  name: string;
}

const safeNumber = (value: number | string | null | undefined): number => {
  if (value == null) return 0;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? 0 : num;
};

const toNum = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const formatValue = (value: number | string | null | undefined, maxDecimals: number = 3): string => {
  const num = safeNumber(value);
  return parseFloat(num.toFixed(maxDecimals)).toString();
};

const processWindRoseData = (historicalData: WeatherData[], windUnit: WindSpeedUnit = 'ms') => {
  const windRoseData = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    speeds: [0, 0, 0, 0, 0, 0],
  }));
  const classes = getSimplifiedClasses(windUnit);
  historicalData.forEach(data => {
    if (data.windDirection == null || data.windSpeed == null) return;
    const dirBin = Math.round(data.windDirection / 22.5) % 16;
    const speed = data.windSpeed;
    let speedClass = 0;
    for (let i = classes.length - 1; i >= 0; i--) {
      if (speed >= classes[i].min) { speedClass = i; break; }
    }
    windRoseData[dirBin].speeds[speedClass]++;
  });
  return windRoseData;
};

const processWindScatterData = (historicalData: WeatherData[]) => {
  return historicalData
    .filter(d => d.windDirection != null && d.windSpeed != null)
    .map(d => ({
      direction: d.windDirection!,
      speed: d.windSpeed!,
      timestamp: new Date(d.timestamp),
    }));
};

// Helper: aggregate an array of numbers (non-null) into avg/sum/min/max
const avgNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null;
};
const minNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round(Math.min(...nums) * 10) / 10 : null;
};
const maxNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round(Math.max(...nums) * 10) / 10 : null;
};
const sumNonNull = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => v != null);
  return nums.length > 0 ? Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};

const processChartData = (historicalData: WeatherData[], timeRangeHours?: number, stationLat?: number, stationAltitude?: number, windUnit: WindSpeedUnit = 'ms', rainfallType: 'incremental' | 'cumulative_yearly' | 'cumulative_lifetime' | 'tip_count' | 'auto' = 'auto') => {
  if (historicalData.length === 0) return [];
  const timestamps = historicalData.map(d => new Date(d.timestamp).getTime());
  const dataSpanHours = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60);
  const effectiveRange = timeRangeHours || dataSpanHours;

  // For ranges beyond 7d, aggregate data by day (daily averages)
  if (effectiveRange > 168) {
    const dayBuckets = new Map<string, WeatherData[]>();
    historicalData.forEach(d => {
      const dt = new Date(d.timestamp);
      const key = dt.toISOString().slice(0, 10);
      if (!dayBuckets.has(key)) dayBuckets.set(key, []);
      dayBuckets.get(key)!.push(d);
    });

    const sortedDays = [...dayBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    return sortedDays.map(([dateKey, dayData]) => {
      const date = new Date(dateKey + 'T12:00:00');
      const label = date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });

      // Rainfall: per-day total. Behaviour depends on logger type.
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
        temperatureSwitchOutlet: avgNonNull(dayData.map(d => d.temperatureSwitchOutlet ?? null)),
        chargerVoltage: avgNonNull(dayData.map(d => d.chargerVoltage ?? null)),
        mpptSolarVoltage: avgNonNull(dayData.map(d => toNum(d.mpptSolarVoltage))),
        mpptSolarCurrent: avgNonNull(dayData.map(d => toNum(d.mpptSolarCurrent))),
        mpptSolarPower: avgNonNull(dayData.map(d => toNum(d.mpptSolarPower))),
        mpptLoadVoltage: avgNonNull(dayData.map(d => toNum(d.mpptLoadVoltage))),
        mpptLoadCurrent: avgNonNull(dayData.map(d => toNum(d.mpptLoadCurrent))),
        mpptBatteryVoltage: avgNonNull(dayData.map(d => toNum(d.mpptBatteryVoltage))),
        mpptChargerState: avgNonNull(dayData.map(d => toNum(d.mpptChargerState))),
        mpptAbsiAvg: avgNonNull(dayData.map(d => toNum(d.mpptAbsiAvg))),
        mpptBoardTemp: avgNonNull(dayData.map(d => toNum(d.mpptBoardTemp))),
        mpptBulkFloatVoltage: avgNonNull(dayData.map(d => toNum(d.mpptBulkFloatVoltage))),
        mpptFloatVoltage: avgNonNull(dayData.map(d => toNum(d.mpptFloatVoltage))),
        mpptCurrentLimit: avgNonNull(dayData.map(d => toNum(d.mpptCurrentLimit))),
        mpptAbsorbTimeLimit: avgNonNull(dayData.map(d => toNum(d.mpptAbsorbTimeLimit))),
        mpptAbsorbFullCurrent: avgNonNull(dayData.map(d => toNum(d.mpptAbsorbFullCurrent))),
        mppt2SolarVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2SolarVoltage))),
        mppt2SolarCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2SolarCurrent))),
        mppt2SolarPower: avgNonNull(dayData.map(d => toNum(d.mppt2SolarPower))),
        mppt2BatteryVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2BatteryVoltage))),
        mppt2BoardTemp: avgNonNull(dayData.map(d => toNum(d.mppt2BoardTemp))),
        mppt2BulkFloatVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2BulkFloatVoltage))),
        mppt2FloatVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2FloatVoltage))),
        mppt2CurrentLimit: avgNonNull(dayData.map(d => toNum(d.mppt2CurrentLimit))),
        mppt2AbsorbTimeLimit: avgNonNull(dayData.map(d => toNum(d.mppt2AbsorbTimeLimit))),
        mppt2AbsorbFullCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2AbsorbFullCurrent))),
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
          let dayRain = 0;
          if (rainfallVals.length > 0) {
            if (rainfallType === 'incremental' || rainfallType === 'tip_count') {
              dayRain = rainfallVals.reduce((s, v) => s + (v > 0 && v < 100 ? v : 0), 0);
            } else if (rainfallVals.length >= 2) {
              dayRain = Math.max(0, rainfallVals[rainfallVals.length - 1] - rainfallVals[0]);
            }
          }
          const netNeed = Math.max(0, eto - dayRain);
          return Math.round((netNeed / 5) * 60);
        })(),
        lightning: sumNonNull(dayData.map(d => d.lightning ?? null)),
        lightningDistance: minNonNull(dayData.map(d => d.lightningDistance ?? null)),
        lightningEnergy: maxNonNull(dayData.map(d => d.lightningEnergy ?? null)),
        lightningRaw: avgNonNull(dayData.map(d => d.lightningRaw ?? null)),
        levelSwitch: avgNonNull(dayData.map(d => d.levelSwitch ?? null)),
        levelSwitchStatus: avgNonNull(dayData.map(d => d.levelSwitchStatus ?? null)),
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

  const formatTimestamp = (date: Date) => {
    if (effectiveRange <= 24) {
      return date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    } else if (effectiveRange <= 72) {
      return date.toLocaleDateString("en-ZA", { weekday: "short" }) + " " +
             date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
    } else {
      return date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric" }) + " " +
             date.toLocaleTimeString("en-ZA", { hour: "2-digit", hour12: false });
    }
  };

  return historicalData.map((d, i, arr) => {
    const rawRain = d.rainfall ?? 0;
    let incrementalRain = 0;
    if (rainfallType === 'incremental' || rainfallType === 'tip_count') {
      incrementalRain = rawRain > 0 && rawRain < 100 ? rawRain : 0;
    } else if (i > 0) {
      const diff = rawRain - (arr[i - 1].rainfall ?? 0);
      incrementalRain = diff > 0 && diff < 50 ? diff : 0;
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
      temperatureSwitchOutlet: d.temperatureSwitchOutlet ?? null,
      chargerVoltage: d.chargerVoltage ?? null,
      lightning: d.lightning ?? null,
      lightningDistance: d.lightningDistance ?? null,
      lightningEnergy: d.lightningEnergy ?? null,
      lightningRaw: d.lightningRaw ?? null,
      levelSwitch: d.levelSwitch ?? null,
      levelSwitchStatus: d.levelSwitchStatus ?? null,
      mpptSolarVoltage: toNum(d.mpptSolarVoltage),
      mpptSolarCurrent: toNum(d.mpptSolarCurrent),
      mpptSolarPower: toNum(d.mpptSolarPower),
      mpptLoadVoltage: toNum(d.mpptLoadVoltage),
      mpptLoadCurrent: toNum(d.mpptLoadCurrent),
      mpptBatteryVoltage: toNum(d.mpptBatteryVoltage),
      mpptChargerState: toNum(d.mpptChargerState),
      mpptAbsiAvg: toNum(d.mpptAbsiAvg),
      mpptBoardTemp: toNum(d.mpptBoardTemp),
      mpptBulkFloatVoltage: toNum(d.mpptBulkFloatVoltage),
      mpptFloatVoltage: toNum(d.mpptFloatVoltage),
      mpptCurrentLimit: toNum(d.mpptCurrentLimit),
      mpptAbsorbTimeLimit: toNum(d.mpptAbsorbTimeLimit),
      mpptAbsorbFullCurrent: toNum(d.mpptAbsorbFullCurrent),
      mppt2SolarVoltage: toNum(d.mppt2SolarVoltage),
      mppt2SolarCurrent: toNum(d.mppt2SolarCurrent),
      mppt2SolarPower: toNum(d.mppt2SolarPower),
      mppt2BatteryVoltage: toNum(d.mppt2BatteryVoltage),
      mppt2BoardTemp: toNum(d.mppt2BoardTemp),
      mppt2BulkFloatVoltage: toNum(d.mppt2BulkFloatVoltage),
      mppt2FloatVoltage: toNum(d.mppt2FloatVoltage),
      mppt2CurrentLimit: toNum(d.mppt2CurrentLimit),
      mppt2AbsorbTimeLimit: toNum(d.mppt2AbsorbTimeLimit),
      mppt2AbsorbFullCurrent: toNum(d.mppt2AbsorbFullCurrent),
      dewPoint: (() => {
        const t = d.temperature;
        const rh = d.humidity;
        if (t == null || rh == null || rh <= 0) return d.dewPoint ?? null;
        const a = 17.625;
        const b = 243.04;
        const alpha = Math.log(rh / 100) + (a * t) / (b + t);
        return Math.round(((b * alpha) / (a - alpha)) * 10) / 10;
      })(),
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

const processWindEnergyData = (historicalData: WeatherData[], density: number = STANDARD_AIR_DENSITY_KGM3, windUnit: WindSpeedUnit = 'ms', timeRangeHours?: number) => {
  const toMs = (v: number) => windUnit === 'kmh' ? v / 3.6 : v;
  
  const timestamps = historicalData.map(d => new Date(d.timestamp).getTime());
  const dataSpanHours = timestamps.length > 1 ? (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60) : 24;
  const effectiveRange = timeRangeHours || dataSpanHours;

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
      cumulativeEnergy += (windPower * 24) / 1000;
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
    return { timestamp: formatTs(new Date(d.timestamp)), windSpeed, windGust, windPower, gustPower, cumulativeEnergy };
  });
};

const calculateWindPower = (windSpeed: number, airDensity: number = STANDARD_AIR_DENSITY_KGM3, windUnit: WindSpeedUnit = 'ms'): number => {
  const speedMs = windUnit === 'kmh' ? windSpeed / 3.6 : windSpeed;
  return 0.5 * airDensity * Math.pow(speedMs, 3);
};

// Internal component that may throw errors
function SharedDashboardContent() {
  const [location] = useLocation();
  
  // Determine if this is a slug route (/:slug) or token route (/shared/:shareToken)
  const isSlugRoute = !location.startsWith('/shared/');
  const slug = isSlugRoute ? location.replace(/^\//, '') : undefined;
  // Extract token directly from the URL path (useParams won't work outside a <Route>)
  const tokenFromUrl = !isSlugRoute ? location.replace('/shared/', '') : undefined;
  
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<ShareAccess | null>(null);
  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState(false);

  // Resolve slug → shareToken if needed
  const { data: slugData, isLoading: isResolvingSlug, error: slugError } = useQuery({
    queryKey: ['share-slug', slug],
    queryFn: async () => {
      const res = await fetch(`/api/shares/resolve/${slug}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Share not found');
      }
      return res.json();
    },
    enabled: !!slug,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // The actual share token to use for all API calls
  const shareToken = isSlugRoute ? slugData?.shareToken : tokenFromUrl;

  // Fetch share info
  const { data: shareInfo, isLoading: isLoadingShare, error: shareError } = useQuery({
    queryKey: ['share-info', shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Share not found');
      }
      return res.json();
    },
    enabled: !!shareToken,
    retry: false,
  });

  // Build headers for data requests (include session token for password-protected shares)
  const shareHeaders: HeadersInit = sessionToken
    ? { 'X-Share-Session': sessionToken }
    : {};

  // Fetch data range for historical fallback
  // NOTE: Auto-polled. Every dependent chart/stats/wind query is keyed on dataRange.latest,
  // so without periodic refresh the dashboard freezes on the load-time snapshot even as
  // new rows arrive (especially noticeable on hourly stations like SAWS Testbed).
  const { data: dataRange } = useQuery<{ earliest: string; latest: string; count: number }>({
    queryKey: ['shared-data-range', shareToken, sessionToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/data/range`, { headers: shareHeaders });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!access,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: true,
  });

  // Fetch latest weather data via share token (public, no auth needed)
  const { data: weatherData, isSuccess: weatherReady } = useQuery<WeatherData>({
    queryKey: ['shared-weather', shareToken, 'latest'],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/data/latest`, { headers: shareHeaders });
      if (!res.ok) throw new Error('Failed to fetch weather data');
      return res.json();
    },
    enabled: !!access,
    refetchInterval: 60000, // Refresh every minute
  });

  // Chart time range state (hours) - user-selectable for primary charts, wind roses, etc.
  const [chartTimeRange, setChartTimeRange] = useState(24);

  // Fetch historical data for charts via share token (public, no auth needed)
  const { data: historicalData = [], isSuccess: historyReady } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'history', chartTimeRange, dataRange?.latest],
    queryFn: async () => {
      const limit = chartTimeRange > 168 ? 5000 : chartTimeRange > 72 ? 2000 : 1000;
      // Use dataRange to pick the right time window upfront
      let endTime: Date;
      let startTime: Date;
      if (dataRange?.latest) {
        const latestTs = new Date(dataRange.latest).getTime();
        const now = Date.now();
        if (now - latestTs > chartTimeRange * 60 * 60 * 1000) {
          endTime = new Date(latestTs + 60000);
          startTime = new Date(endTime.getTime() - chartTimeRange * 60 * 60 * 1000);
        } else {
          endTime = new Date();
          startTime = new Date(endTime.getTime() - chartTimeRange * 60 * 60 * 1000);
        }
      } else {
        endTime = new Date();
        startTime = new Date(endTime.getTime() - chartTimeRange * 60 * 60 * 1000);
      }
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0) {
        const expandedEnd = dataRange?.latest ? new Date(new Date(dataRange.latest).getTime() + 60000) : endTime;
        const expandedStart = new Date(expandedEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
        const fallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${expandedStart.toISOString()}&endTime=${expandedEnd.toISOString()}&limit=${limit}`,
          { headers: shareHeaders }
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!access,
    refetchInterval: 60000,
  });

  // Separate query for 30-day stats data (always fetches 30 days regardless of chart time range)
  const { data: statsData = [], isSuccess: statsReady } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'stats-30d', dataRange?.latest],
    queryFn: async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=5000`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
        const fallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=5000`,
          { headers: shareHeaders }
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!access,
    staleTime: 10 * 60 * 1000,
  });

  // Separate query for 365-day wind data (for annual wind power rose)
  const { data: wind365Data = [] } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'wind-365d', dataRange?.latest],
    queryFn: async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 365 * 24 * 60 * 60 * 1000);
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=53000`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
        const fallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=53000`,
          { headers: shareHeaders }
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!access,
    staleTime: 20 * 60 * 1000,
  });

  // Fetch station info via share token
  const { data: stationData, isSuccess: stationReady } = useQuery({
    queryKey: ['shared-station', shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/station`, { headers: shareHeaders });
      if (!res.ok) throw new Error('Failed to fetch station');
      return res.json();
    },
    enabled: !!access,
  });

  const windSpeedUnit: WindSpeedUnit = (stationData?.station?.windSpeedUnit === 'kmh') ? 'kmh' : 'ms';
  const windUnitLabel = getWindUnitLabel(windSpeedUnit);

  // Fetch dashboard config (section visibility) set by admin
  const { data: serverConfig } = useQuery<{ sectionVisibility?: SectionVisibility; enabledParameters?: string[] } | null>({
    queryKey: ['shared-dashboard-config', shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/dashboard-config`, { headers: shareHeaders });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!access,
    staleTime: 5 * 60 * 1000,
  });
  const sv = serverConfig?.sectionVisibility ?? DEFAULT_SECTION_VISIBILITY;
  const sharedEnabledParameters = serverConfig?.enabledParameters;

  // Historical chart range (user-selectable)
  const [historicalChartRange, setHistoricalChartRange] = useState(24);

  // Fetch historical data for the selected time range
  const { data: historicalSectionData = [], isLoading: historicalSectionLoading } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'historical-section', historicalChartRange, dataRange?.latest],
    queryFn: async () => {
      const limit = historicalChartRange > 168 ? 3000 : historicalChartRange > 72 ? 2000 : 1000;
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
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0) {
        const expandedEnd = dataRange?.latest ? new Date(new Date(dataRange.latest).getTime() + 60000) : endTime;
        const expandedStart = new Date(expandedEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
        const fallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${expandedStart.toISOString()}&endTime=${expandedEnd.toISOString()}&limit=${limit}`,
          { headers: shareHeaders }
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!access,
    refetchInterval: 5 * 60 * 1000,
  });

  // Fetch yearly rainfall totals (refetched alongside latest data so the
  // YTD year ticks up live as new readings arrive).
  const { data: rainfallYearly } = useQuery<{ year: number; total: number; readings: number; isCurrent: boolean }[]>({
    queryKey: ['rainfall-yearly', shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/data/rainfall-yearly`, { headers: shareHeaders });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!shareToken,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  // Per-station rainfall config exposed via the share token. Drives whether
  // the chart/daily aggregation SUMs (incremental/tip_count) or deltas
  // (cumulative_*). Falls back to 'auto' when no config exists.
  const { data: rainfallConfig } = useQuery<{ type: 'incremental' | 'cumulative_yearly' | 'cumulative_lifetime' | 'tip_count' | 'auto'; offset: number; tipFactor: number; configured: boolean }>({
    queryKey: ['rainfall-config', shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/rainfall-config`, { headers: shareHeaders });
      if (!res.ok) return { type: 'auto', offset: 0, tipFactor: 0.2, configured: false };
      return res.json();
    },
    enabled: !!shareToken,
    staleTime: 60 * 60 * 1000,
  });
  const rainfallType = rainfallConfig?.type ?? 'auto';
  const sortedHistoricalData = useMemo(() => {
    if (historicalData.length === 0) return [];
    return [...historicalData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [historicalData]);

  // Sort stats data ascending (independent 7-day dataset)
  const sortedStatsData = useMemo(() => {
    if (statsData.length === 0) return [];
    return [...statsData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [statsData]);

  // Reference timestamp for historical-only stations  
  const referenceNow = useMemo(() => {
    const realNow = Date.now();
    if (sortedHistoricalData.length === 0) return realNow;
    const latestTs = new Date(sortedHistoricalData[sortedHistoricalData.length - 1].timestamp).getTime();
    return (realNow - latestTs) > 24 * 60 * 60 * 1000 ? latestTs : realNow;
  }, [sortedHistoricalData]);

  // Detect available data fields AND respect enabledParameters from config
  const availableFields = useMemo(() => {
    const toggleableFields = new Set(
      DASHBOARD_CATEGORIES.flatMap(c => c.parameters.map(p => p.dataField))
    );
    const ep = sharedEnabledParameters;

    const hasData = (field: keyof WeatherData, allowZero = false) => {
      // If parameter was disabled in config, hide it. Parameters added to the
      // catalogue after a config was saved stay visible (LATE_ADDED_PARAMETERS).
      if (toggleableFields.has(field) && !isParameterEnabled(field, ep)) {
        return false;
      }
      if (historicalData.length > 0) {
        return historicalData.some(d => {
          const v = d[field];
          return allowZero ? (v !== null && v !== undefined) : (v !== null && v !== undefined && v !== 0);
        });
      }
      if (weatherData) {
        const v = weatherData[field];
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
      uvIndex: hasData('uvIndex'),
      pm25: hasData('pm25'),
      pm10: hasData('pm10'),
      soilTemperature: hasData('soilTemperature'),
      soilMoisture: hasData('soilMoisture'),
      batteryVoltage: hasData('batteryVoltage'),
      batteryVoltage2: hasData('batteryVoltage2'),
      waterLevel: hasData('waterLevel'),
      temperatureSwitch: hasData('temperatureSwitch'),
      chargerVoltage: hasData('chargerVoltage'),
      lightning: hasData('lightning'),
      lightningDistance: hasData('lightningDistance'),
      lightningEnergy: hasData('lightningEnergy'),
      lightningRaw: hasData('lightningRaw'),
      levelSwitch: hasData('levelSwitch'),
      temperatureSwitchOutlet: hasData('temperatureSwitchOutlet'),
      levelSwitchStatus: hasData('levelSwitchStatus'),
      mpptSolarVoltage: hasData('mpptSolarVoltage'),
      mpptSolarCurrent: hasData('mpptSolarCurrent'),
      mpptSolarPower: hasData('mpptSolarPower'),
      mpptLoadVoltage: hasData('mpptLoadVoltage'),
      mpptLoadCurrent: hasData('mpptLoadCurrent'),
      mpptBatteryVoltage: hasData('mpptBatteryVoltage'),
      mpptChargerState: hasData('mpptChargerState'),
      mpptAbsiAvg: hasData('mpptAbsiAvg'),
      mpptBoardTemp: hasData('mpptBoardTemp'),
      mppt2SolarVoltage: hasData('mppt2SolarVoltage'),
      mppt2SolarCurrent: hasData('mppt2SolarCurrent'),
      mppt2SolarPower: hasData('mppt2SolarPower'),
      mppt2BatteryVoltage: hasData('mppt2BatteryVoltage'),
      mppt2BoardTemp: hasData('mppt2BoardTemp'),
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
      so2: hasData('so2'),
      particulateCount: hasData('particulateCount'),
      moduleTemperature: hasData('moduleTemperature'),
    };
  }, [historicalData, weatherData, sharedEnabledParameters]);

  const station = stationData?.station || { name: access?.name || 'Weather Station', location: 'Unknown' };
  const currentData = weatherData || {} as WeatherData;

  // Process chart data
  const chartData = useMemo(() => processChartData(sortedHistoricalData, chartTimeRange, station?.latitude, station?.altitude, windSpeedUnit, rainfallType), [sortedHistoricalData, chartTimeRange, station?.latitude, station?.altitude, windSpeedUnit, rainfallType]);

  // Wind chart always uses fixed 24h range regardless of user-selected chart time range


  // Average daytime solar radiation from historical data (for Solar Power Harvesting card)
  const avgDaytimeRadiation = useMemo(() => {
    const nonZero = sortedHistoricalData
      .map(d => d.solarRadiation)
      .filter((v): v is number => v != null && v > 0);
    if (nonZero.length === 0) return null;
    return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  }, [sortedHistoricalData]);

  const windEnergyData = useMemo(() => processWindEnergyData(sortedHistoricalData, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit, chartTimeRange), [sortedHistoricalData, currentData.airDensity, windSpeedUnit, chartTimeRange]);

  // Wind power rose data - always 30-day, independent of chart time range
  const windPowerRoseData = useMemo(() => {
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    return processWindPowerRoseData(dataSource, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit);
  }, [sortedStatsData, sortedHistoricalData, currentData.airDensity, windSpeedUnit]);

  // Wind power rose data - 365-day (only if we have >30 days of data)
  const sortedWind365Data = useMemo(() => {
    if (wind365Data.length === 0) return [];
    return [...wind365Data].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [wind365Data]);

  const windPowerRose365Data = useMemo(() => {
    if (sortedWind365Data.length === 0) return null;
    const timestamps = sortedWind365Data.map(d => new Date(d.timestamp).getTime());
    const spanDays = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24);
    if (spanDays < 35) return null;
    return processWindPowerRoseData(sortedWind365Data, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit);
  }, [sortedWind365Data, currentData.airDensity, windSpeedUnit]);

  const maxWindSpeed = useMemo(() => {
    const speeds = historicalData.map(d => d.windSpeed ?? 0);
    const defaultMax = windSpeedUnit === 'kmh' ? 90 : 25;
    return Math.max(weatherData?.windGust || 0, ...speeds) || defaultMax;
  }, [historicalData, weatherData?.windGust, windSpeedUnit]);

  // Historical section chart data (separate time range)
  const historicalChartData = useMemo(() => {
    if (historicalSectionData.length === 0) return [];
    const sorted = [...historicalSectionData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return processChartData(sorted, historicalChartRange, station?.latitude, station?.altitude, windSpeedUnit, rainfallType);
  }, [historicalSectionData, historicalChartRange, station?.latitude, station?.altitude, windSpeedUnit]);

  // Wind data by period (use latest data timestamp for short windows so Dropbox-synced stations show 30m/60m roses)
  const windDataByPeriod = useMemo(() => {
    const latestDataTs = sortedHistoricalData.length > 0
      ? new Date(sortedHistoricalData[sortedHistoricalData.length - 1].timestamp).getTime()
      : referenceNow;
    const thirtyMinAgo = latestDataTs - 30 * 60 * 1000;
    const oneHourAgo = latestDataTs - 60 * 60 * 1000;
    const twentyFourHoursAgo = latestDataTs - 24 * 60 * 60 * 1000;
    const fortyEightHoursAgo = latestDataTs - 48 * 60 * 60 * 1000;
    const sevenDaysAgo = latestDataTs - 7 * 24 * 60 * 60 * 1000;
    const thirtyOneDaysAgo = latestDataTs - 31 * 24 * 60 * 60 * 1000;

    const last30Min = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > thirtyMinAgo);
    const last60Min = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > oneHourAgo);
    const last24h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last48h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > fortyEightHoursAgo);
    const windDataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const last7d = windDataSource.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last31d = windDataSource.filter(d => new Date(d.timestamp).getTime() > thirtyOneDaysAgo);

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
    };
  }, [sortedHistoricalData, sortedStatsData, referenceNow, windSpeedUnit]);

  // Dew point
  const calculatedDewPoint = useMemo(() => {
    const t = currentData.temperature;
    const rh = currentData.humidity;
    if (t == null || rh == null || rh <= 0) return null;
    const a = 17.625;
    const b = 243.04;
    const alpha = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * alpha) / (a - alpha);
  }, [currentData.temperature, currentData.humidity]);
  const effectiveDewPoint = currentData.dewPoint ?? calculatedDewPoint ?? null;

  // Solar position (calculated from station coordinates)
  const hasStationCoordinates = station?.latitude != null && station?.longitude != null;
  const solarPosition = useMemo(() => {
    if (!hasStationCoordinates) {
      return { elevation: 0, azimuth: 0, sunrise: undefined, sunset: undefined, nauticalDawn: undefined, nauticalDusk: undefined, civilDawn: undefined, civilDusk: undefined, solarNoon: undefined, dayLength: undefined };
    }
    return calculateSolarPosition(station!.latitude!, station!.longitude!);
  }, [station?.latitude, station?.longitude, hasStationCoordinates]);

  // Sea level pressure - handle stations that already report SLP
  const pressureIsSLP = station?.connectionConfig?.pressureIsSLP === true || station?.connectionType === 'rikacloud';
  const seaLevelPressure = useMemo(() => {
    if (pressureIsSLP) return currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA;
    return calculateSeaLevelPressure(currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA, station?.altitude || 0, currentData.temperature || DEFAULT_TEMPERATURE_C);
  }, [currentData.pressure, currentData.temperature, station?.altitude, pressureIsSLP]);

  /**
   * Rainfall shape for this station, from the share's own rainfall-config.
   *
   * The shared station payload deliberately omits `connectionType`, so the old
   * `connectionType === 'rikacloud'` test here was always false and a lifetime
   * counter got summed as if every reading were fresh rain. The configured type
   * is authoritative; 'auto' leaves detection to the shared helper.
   */
  const effectiveRainfallType: RainfallType = rainfallConfig?.type ?? 'auto';
  const rainfallTipFactor = rainfallConfig?.tipFactor ?? 0.2;

  // Rainfall over the last 24h, via the one canonical implementation.
  const { effectiveRainfall } = useMemo(() => {
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const now = referenceNow;
    const last24h = dataSource.filter(d => new Date(d.timestamp).getTime() > now - 24 * 60 * 60 * 1000);
    if (last24h.length === 0) {
      // No window to measure. Falling back to currentData.rainfall used to
      // report a cumulative counter (e.g. 1490 mm) as the 24h total, so report
      // nothing instead of something wrong.
      return { accumulatedRainfall: 0, isRainfallStale: true, effectiveRainfall: 0 };
    }
    const total = rainfallTotalFromRecords(last24h, effectiveRainfallType, rainfallTipFactor);
    return { accumulatedRainfall: total, isRainfallStale: total < 0.05, effectiveRainfall: total };
  }, [sortedStatsData, sortedHistoricalData, referenceNow, effectiveRainfallType, rainfallTipFactor]);

  // Rainfall totals over standard reporting periods (24h / yesterday / this week / this month)
  const rainfallPeriods = useMemo(() => {
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const sumWindow = (startMs: number, endMs: number) => {
      const window = dataSource.filter(d => {
        const t = new Date(d.timestamp).getTime();
        return t > startMs && t <= endMs;
      });
      if (window.length === 0) return 0;
      return rainfallTotalFromRecords(window, effectiveRainfallType, rainfallTipFactor);
    };
    const now = referenceNow;
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    return {
      last24h: sumWindow(now - 24 * 60 * 60 * 1000, now),
      yesterday: sumWindow(startOfYesterday.getTime(), startOfToday.getTime()),
      thisWeek: sumWindow(now - 7 * 24 * 60 * 60 * 1000, now),
      thisMonth: sumWindow(now - 30 * 24 * 60 * 60 * 1000, now),
    };
  }, [sortedStatsData, sortedHistoricalData, referenceNow, effectiveRainfallType, rainfallTipFactor]);

  // Daily ETo vs Rainfall over the last 30 days (fixed window).
  // Always uses sortedStatsData (always-30-day query) so this chart is NOT
  // influenced by the dashboard's chart timeframe selector.
  const etoRainDaily = useMemo(() => {
    const dataSource = sortedStatsData;
    if (dataSource.length === 0) return { data: [], totalRain: 0 };
    const lat = station?.latitude || 0;
    const alt = station?.altitude || 0;
    const now = referenceNow;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const inWindow = dataSource.filter(d => {
      const t = new Date(d.timestamp).getTime();
      return t > thirtyDaysAgo && t <= now;
    });
    if (inWindow.length === 0) return { data: [], totalRain: 0 };

    const buckets = new Map<string, WeatherData[]>();
    inWindow.forEach(d => {
      const key = new Date(d.timestamp).toISOString().slice(0, 10);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(d);
    });

    const dayRainTotal = (records: WeatherData[]) =>
      rainfallTotalFromRecords(records, effectiveRainfallType, rainfallTipFactor);

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
  }, [sortedStatsData, sortedHistoricalData, station?.latitude, station?.altitude, referenceNow, windSpeedUnit]);

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
        daysSinceRain = Math.max(0, Math.round((now - readings[i].ts) / (24 * 60 * 60 * 1000)));
        break;
      }
    }

    return { rainfall7day, daysSinceRain };
  }, [sortedStatsData, sortedHistoricalData, referenceNow, effectiveRainfallType, rainfallTipFactor]);

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

  // Battery chart data. Both banks are carried so installations with two
  // batteries chart each one.
  const batteryChartData = useMemo(() => {
    const effectiveRange = chartTimeRange || 24;
    const round2 = (v: number) => Math.round(v * 100) / 100;
    const mean = (a: number[]) => round2(a.reduce((x, y) => x + y, 0) / a.length);

    if (effectiveRange >= 168 && sortedHistoricalData.length > 0) {
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
  }, [sortedHistoricalData, chartTimeRange]);

  const batteryChargingStatus = useMemo(() => {
    const batteryReadings = sortedHistoricalData.filter(d => d.batteryVoltage != null && d.batteryVoltage > 0);
    if (batteryReadings.length < 2) return { hasData: false, didCharge: true, maxVoltage: 0, minVoltage: 0 };
    const voltages = batteryReadings.map(d => d.batteryVoltage!);
    const maxV = Math.max(...voltages);
    const minV = Math.min(...voltages);
    // LiFePO4: voltage above 13.6V indicates charging
    const didCharge = maxV > 13.6 || (maxV - minV) > 0.3;
    return { hasData: true, didCharge, maxVoltage: maxV, minVoltage: minV };
  }, [sortedHistoricalData]);

  // Temperature statistics (uses independent 7-day stats data)
  const temperatureStats = useMemo(() => {
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    // Merge stats + historical data for widest coverage
    const seen = new Set<string>();
    const allData: WeatherData[] = [];
    for (const d of [...(sortedStatsData.length > 0 ? sortedStatsData : []), ...sortedHistoricalData]) {
      const ts = String(d.timestamp);
      if (!seen.has(ts)) { seen.add(ts); allData.push(d); }
    }
    const last24h = allData.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last7d = allData.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last14d = allData.filter(d => new Date(d.timestamp).getTime() > fourteenDaysAgo);
    const last30d = allData.filter(d => new Date(d.timestamp).getTime() > thirtyDaysAgo);
    const calc = (data: WeatherData[]) => {
      const temps = data.map(d => d.temperature).filter((t): t is number => t != null && !isNaN(t));
      if (temps.length === 0) return { min: null, max: null, avg: null, range: null };
      const min = Math.min(...temps);
      const max = Math.max(...temps);
      return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, avg: Math.round((temps.reduce((s, t) => s + t, 0) / temps.length) * 10) / 10, range: Math.round((max - min) * 10) / 10 };
    };
    return {
      '24h': calc(last24h),
      '7d': calc(last7d),
      '14d': calc(last14d),
      '30d': calc(last30d),
      has14d: last14d.some(d => d.temperature != null && new Date(d.timestamp).getTime() < sevenDaysAgo),
      has30d: last30d.some(d => d.temperature != null && new Date(d.timestamp).getTime() < fourteenDaysAgo),
    };
  }, [sortedStatsData, sortedHistoricalData, referenceNow, effectiveRainfallType, rainfallTipFactor]);

  // Solar stats
  const solarStats = useMemo(() => {
    const now = referenceNow;
    const last24h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > now - 24 * 60 * 60 * 1000);
    const vals = last24h.map(d => d.solarRadiation).filter((r): r is number => r != null && !isNaN(r));
    if (vals.length === 0) return { peak: null, avg: null, dailyEnergy: null };
    const peak = Math.max(...vals);
    const avg = vals.reduce((s, r) => s + r, 0) / vals.length;
    const hours = last24h.length > 1 ? (new Date(last24h[last24h.length - 1].timestamp).getTime() - new Date(last24h[0].timestamp).getTime()) / (1000 * 60 * 60) : 0;
    return { peak: Math.round(peak), avg: Math.round(avg), dailyEnergy: Math.round(avg * hours * 0.0036 * 10) / 10 };
  }, [sortedHistoricalData, referenceNow]);

  // ETo stats
  const etoStats = useMemo(() => {
    const lat = station?.latitude || 0;
    const alt = station?.altitude || 0;
    const now = referenceNow;
    const calcPeriodETo = (data: WeatherData[]) => {
      const etoValues = data.map(d => {
        if (d.temperature == null || d.humidity == null || d.windSpeed == null || d.solarRadiation == null) return null;
        const ts = new Date(d.timestamp);
        const doy = Math.floor((ts.getTime() - new Date(ts.getFullYear(), 0, 0).getTime()) / 86400000);
        return calculateETo(d.temperature, d.humidity, windSpeedUnit === 'kmh' ? kmhToMs(d.windSpeed) : d.windSpeed, wattsToMJPerDay(d.solarRadiation, ASSUMED_DAYLIGHT_HOURS), alt, lat, doy);
      }).filter((e): e is number => e != null && !isNaN(e) && e > 0);
      if (etoValues.length === 0) return null;
      return Math.round((etoValues.reduce((s, e) => s + e, 0) / etoValues.length) * 10) / 10;
    };
    const statsSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const daily = calcPeriodETo(statsSource.filter(d => new Date(d.timestamp).getTime() > now - 24 * 60 * 60 * 1000));
    const weekly = calcPeriodETo(statsSource.filter(d => new Date(d.timestamp).getTime() > now - 7 * 24 * 60 * 60 * 1000));
    const monthly = calcPeriodETo(statsSource.filter(d => new Date(d.timestamp).getTime() > now - 30 * 24 * 60 * 60 * 1000));
    return { daily, weekly: weekly != null ? Math.round(weekly * 7 * 10) / 10 : null, monthly: monthly != null ? Math.round(monthly * 30 * 10) / 10 : null };
  }, [sortedStatsData, sortedHistoricalData, station?.latitude, station?.altitude, referenceNow, windSpeedUnit]);

  // Trends (use sorted data so first half = older records; filter nulls to avoid skewing averages)
  const trends = useMemo(() => {
    if (sortedHistoricalData.length < 2) return { temperature: null, humidity: null, pressure: null };
    const halfLen = Math.floor(sortedHistoricalData.length / 2);
    const older = sortedHistoricalData.slice(0, halfLen);
    const olderTemps = older.map(d => d.temperature).filter((v): v is number => v != null);
    const olderHums = older.map(d => d.humidity).filter((v): v is number => v != null);
    const olderPress = older.map(d => d.pressure).filter((v): v is number => v != null);
    const avgOldT = olderTemps.length > 0 ? olderTemps.reduce((s, v) => s + v, 0) / olderTemps.length : null;
    const avgOldH = olderHums.length > 0 ? olderHums.reduce((s, v) => s + v, 0) / olderHums.length : null;
    const avgOldP = olderPress.length > 0 ? olderPress.reduce((s, v) => s + v, 0) / olderPress.length : null;
    return {
      temperature: avgOldT != null && currentData.temperature != null ? currentData.temperature - avgOldT : null,
      humidity: avgOldH != null && currentData.humidity != null ? currentData.humidity - avgOldH : null,
      pressure: avgOldP != null && currentData.pressure != null ? currentData.pressure - avgOldP : null,
    };
  }, [sortedHistoricalData, currentData]);

  // Fire danger chart data
  const fireDangerChartData = useMemo(() => {
    return chartData.map(d => {
      const fd = calculateFireDanger(d.temperature ?? 20, d.humidity ?? 50, d.windSpeed ?? 0);
      return { timestamp: d.timestamp, ffdi: fd.ffdi, temperature: d.temperature ?? 0, humidity: d.humidity ?? 0, windSpeed: d.windSpeed ?? 0 };
    });
  }, [chartData]);

  // Air density
  const calculatedAirDensity = useMemo(() => {
    if (currentData.temperature == null || currentData.pressure == null) return STANDARD_AIR_DENSITY_KGM3;
    const stationPress = pressureIsSLP
      ? calculateStationPressure(currentData.pressure, station?.altitude || 0, currentData.temperature)
      : currentData.pressure;
    return calculateAirDensity(currentData.temperature, stationPress, currentData.humidity ?? 50);
  }, [currentData.temperature, currentData.pressure, currentData.humidity, pressureIsSLP, station?.altitude]);

  // ETo
  const calculatedETo = useMemo(() => {
    const lat = station?.latitude || 0;
    const alt = station?.altitude || 0;
    const dayOfYear = getDayOfYear();
    const solarMJ = wattsToMJPerDay(currentData.solarRadiation || 0, ASSUMED_DAYLIGHT_HOURS);
    const windMs = windSpeedUnit === 'kmh' ? kmhToMs(currentData.windSpeed || 0) : (currentData.windSpeed || 0);
    return calculateETo(currentData.temperature || DEFAULT_TEMPERATURE_C, currentData.humidity || DEFAULT_HUMIDITY_PERCENT, windMs, solarMJ, alt, lat, dayOfYear);
  }, [currentData.temperature, currentData.humidity, currentData.windSpeed, currentData.solarRadiation, station?.latitude, station?.altitude, windSpeedUnit]);

  const handleExportCSV = () => {
    if (historicalData.length === 0) return;
    const sorted = [...historicalData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const stationName = (station?.name || 'station').replace(/[^a-zA-Z0-9_-]/g, '_');
    const headers = [
      "Timestamp (UTC)", "Timestamp (Local)", "Temperature (C)", "Relative Humidity (%)",
      "Barometric Pressure (hPa)", "Wind Speed (m/s)", "Wind Direction (deg)",
      "Wind Gust (m/s)", "Rainfall (mm)", "Solar Radiation (W/m2)",
      "Dew Point (C)", "Battery Voltage (V)",
    ];
    const rows = sorted.map(d => {
      const ts = new Date(d.timestamp);
      return [
        ts.toISOString(),
        ts.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false }),
        d.temperature ?? "",
        d.humidity ?? "",
        d.pressure ?? "",
        d.windSpeed ?? "",
        d.windDirection ?? "",
        d.windGust ?? "",
        d.rainfall ?? "",
        d.solarRadiation ?? "",
        d.dewPoint ?? "",
        d.batteryVoltage ?? "",
      ];
    });
    const timeLabel = chartTimeRange <= 48 ? chartTimeRange + 'h' : Math.round(chartTimeRange / 24) + 'd';
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${stationName}_${timeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportTOA5 = () => {
    if (historicalData.length === 0) return;
    const sorted = [...historicalData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const stationName = (station?.name || 'station').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fields = [
      "TIMESTAMP", "AirTemp_Avg", "RelHumid_Avg", "BPress_Avg", "WndSpd_Avg", "WndDir_Avg",
      "WndSpd_Max", "Rain_Tot", "SlrRad_Avg", "UV_Index", "DewPt_Avg", "ETo",
      "BattV_Avg", "PnlTmp_Avg", "SoilT_Avg", "SoilM_Avg",
      "PM10_Avg", "PM25_Avg", "AirDens_Avg",
      "WtrLvl_mm", "TmpSw_mV", "LvlSw", "TmpSwOut_mV", "LvlSwStat",
      "Lghtnng", "ChrgV_Avg",
    ];
    const units = [
      "TS", "Deg C", "%", "hPa", "m/s", "degrees",
      "m/s", "mm", "W/m\u00b2", "", "Deg C", "mm",
      "V", "Deg C", "Deg C", "%",
      "\u00b5g/m\u00b3", "\u00b5g/m\u00b3", "kg/m\u00b3",
      "mm", "mV", "", "mV", "",
      "", "V",
    ];
    const process = fields.map((_, i) => i === 0 ? "" : "Avg");
    const line1 = `"TOA5","${stationName}","CR300","0","CR300.Std","CPU:${stationName}.CR300","0","Stratus_Export"`;
    const line2 = fields.map(f => `"${f}"`).join(",");
    const line3 = units.map(u => `"${u}"`).join(",");
    const line4 = process.map(p => `"${p}"`).join(",");
    const rows = sorted.map((d: any) => {
      const ts = new Date(d.timestamp);
      const tsStr = `"${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')} ${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}"`;
      return [
        tsStr,
        d.temperature ?? "NAN", d.humidity ?? "NAN", d.pressure ?? "NAN",
        d.windSpeed ?? "NAN", d.windDirection ?? "NAN", d.windGust ?? "NAN",
        d.rainfall ?? "NAN", d.solarRadiation ?? "NAN", d.uvIndex ?? "NAN",
        d.dewPoint ?? "NAN", d.eto ?? "NAN", d.batteryVoltage ?? "NAN",
        d.panelTemperature ?? "NAN", d.soilTemperature ?? "NAN", d.soilMoisture ?? "NAN",
        d.pm10 ?? "NAN", d.pm25 ?? "NAN", d.airDensity ?? "NAN",
        d.waterLevel ?? "NAN", d.temperatureSwitch ?? "NAN", d.levelSwitch ?? "NAN",
        d.temperatureSwitchOutlet ?? "NAN", d.levelSwitchStatus ?? "NAN",
        d.lightning ?? "NAN", d.chargerVoltage ?? "NAN",
      ].join(",");
    });
    const content = [line1, line2, line3, line4, ...rows].join("\r\n");
    const blob = new Blob([content], { type: "text/plain;charset=ascii;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timeLabel = chartTimeRange <= 48 ? chartTimeRange + 'h' : Math.round(chartTimeRange / 24) + 'd';
    link.download = `${stationName}_${timeLabel}_${new Date().toISOString().slice(0, 10)}.dat`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJSON = () => {
    if (historicalData.length === 0) return;
    const sorted = [...historicalData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const stationName = (station?.name || 'station').replace(/[^a-zA-Z0-9_-]/g, '_');
    const exportObj = {
      station: stationName,
      exportDate: new Date().toISOString(),
      recordCount: sorted.length,
      data: sorted.map((d: any) => ({
        timestamp: d.timestamp,
        temperature: d.temperature,
        humidity: d.humidity,
        pressure: d.pressure,
        windSpeed: d.windSpeed,
        windDirection: d.windDirection,
        windGust: d.windGust,
        rainfall: d.rainfall,
        solarRadiation: d.solarRadiation,
        uvIndex: d.uvIndex,
        dewPoint: d.dewPoint,
        eto: d.eto,
        batteryVoltage: d.batteryVoltage,
        panelTemperature: d.panelTemperature,
        soilTemperature: d.soilTemperature,
        soilMoisture: d.soilMoisture,
        pm10: d.pm10,
        pm25: d.pm25,
        airDensity: d.airDensity,
      })),
    };
    const content = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([content], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timeLabel = chartTimeRange <= 48 ? chartTimeRange + 'h' : Math.round(chartTimeRange / 24) + 'd';
    link.download = `${stationName}_${timeLabel}_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePasswordSubmit = async () => {
    try {
      const res = await fetch(`/api/shares/${shareToken}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        setAccess(data.access);
        if (data.sessionToken) setSessionToken(data.sessionToken);
        setPasswordError(false);
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    }
  };

  // Auto-validate if no password required
  useEffect(() => {
    if (shareInfo?.share && !shareInfo.share.requiresPassword && !access) {
      fetch(`/api/shares/${shareToken}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setAccess(data.access);
            if (data.sessionToken) setSessionToken(data.sessionToken);
          }
        })
        .catch(err => console.error('Auto-validate failed:', err));
    }
  }, [shareInfo, shareToken, access]);

  // Error state for slug resolution
  if (slugError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              Not Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-black">
              {(slugError as Error)?.message || 'This link is invalid or has expired.'}
            </p>
            <Button className="mt-4 w-full" variant="outline" onClick={() => window.location.href = '/'}>
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state
  if (isResolvingSlug || isLoadingShare || !shareToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <RefreshCw className="h-8 w-8 mx-auto mb-4 animate-spin text-black" />
            <p>Loading dashboard...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (shareError || !shareInfo?.success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-black">
              {(shareError as Error)?.message || 'This share link is invalid or has expired.'}
            </p>
            <Button className="mt-4 w-full" variant="outline" onClick={() => window.location.href = '/'}>
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Password required
  if (shareInfo.share.requiresPassword && !access) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Password Required
            </CardTitle>
            <CardDescription>
              Enter the password to access "{shareInfo.share.name}"
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                placeholder="Enter password"
                className={passwordError ? 'border-destructive' : ''}
              />
              {passwordError && (
                <p className="text-sm text-destructive">Incorrect password</p>
              )}
            </div>
            <Button className="w-full" onClick={handlePasswordSubmit}>
              Access Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main dashboard view
  if (!access) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-black" />
      </div>
    );
  }

  // Gate the page behind the loader until the station, current reading and the
  // chart/stats series have all arrived, so nothing renders half-populated.
  const loadSteps = [stationReady, weatherReady, historyReady, statsReady];
  const loadReady = loadSteps.filter(Boolean).length;
  const loadDone = loadSteps.every(Boolean);

  return (
    <div className="min-h-screen bg-background">
      <DashboardLoadingOverlay ready={loadReady} total={loadSteps.length} done={loadDone} />
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container py-4 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold">{station.name}</h1>
              <p className="text-sm text-black">{station.location}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {weatherData?.timestamp && (
            <span className="text-xs text-black hidden sm:inline">
              Synced: {(() => {
                const ts = new Date((weatherData as any).collectedAt || weatherData.timestamp);
                if (isNaN(ts.getTime())) return '--';
                const diffMs = Date.now() - ts.getTime();
                const diffMin = Math.floor(diffMs / 60000);
                let ago = '';
                if (diffMin < 1) ago = 'Just now';
                else if (diffMin < 60) ago = `${diffMin}m ago`;
                else { const h = Math.floor(diffMin / 60); const m = diffMin % 60; ago = `${h}h ${m}m ago`; }
                return `${ts.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} (${ago})`;
              })()}
            </span>
            )}
            <Button variant="outline" size="sm" disabled className="cursor-default">
              View Only
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={historicalData.length === 0}>
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCSV}>
                  CSV - Comma-separated values
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportTOA5}>
                  TOA5 - Campbell Scientific format
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportJSON}>
                  JSON - Structured data
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Time Range Selector */}
      <div className="border-b bg-card">
        <div className="container py-2 px-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-black mr-1">Time Range:</span>
          {[
            { label: '1h', hours: 1 },
            { label: '6h', hours: 6 },
            { label: '12h', hours: 12 },
            { label: '24h', hours: 24 },
            { label: '48h', hours: 48 },
            { label: '7d', hours: 168 },
            { label: '30d', hours: 720 },
          ].map(({ label, hours }) => (
            <Button
              key={hours}
              variant={chartTimeRange === hours ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setChartTimeRange(hours)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="container py-6 px-4 space-y-6">

        {/* Station Location & Details */}
        {(station.latitude || station.longitude) && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Suspense fallback={<ChartFallback />}>
              <StationMap
                latitude={station.latitude ?? undefined}
                longitude={station.longitude ?? undefined}
                stationName={station.name || 'Weather Station'}
                altitude={station.altitude ?? undefined}
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
                    <p className="text-xs text-black">Station Name</p>
                    <p className="text-sm font-normal">{station.name || 'Not set'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-black">Location</p>
                    <p className="text-sm font-normal">{station.location || 'Not specified'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-black">Latitude</p>
                    <p className="text-sm font-normal">{safeFixed(station.latitude, 6, 'Not set')}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-black">Longitude</p>
                    <p className="text-sm font-normal">{safeFixed(station.longitude, 6, 'Not set')}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-black">Altitude</p>
                    <p className="text-sm font-normal">{station.altitude ? `${station.altitude} m` : 'Not set'}</p>
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

        {/* Primary Metrics */}
        {sv.primaryMetrics !== false && (availableFields.temperature || availableFields.humidity || availableFields.pressure || availableFields.windSpeed || availableFields.rainfall) && (
        <section className="space-y-4">
          {/* Primary metrics: identical presentation to the main dashboard
              (station header + grey metric blocks) so a shared link looks the
              same as what the owner sees. */}
          <CurrentConditions
            stationName={station.name || "Weather Station"}
            lastUpdate={(currentData as any)?.collectedAt || currentData?.timestamp || "No data"}
            temperature={availableFields.temperature ? (currentData.temperature ?? undefined) : undefined}
            humidity={availableFields.humidity ? (currentData.humidity ?? undefined) : undefined}
            pressure={availableFields.pressure ? (currentData.pressure ?? undefined) : undefined}
            windSpeed={availableFields.windSpeed ? (currentData.windSpeed ?? undefined) : undefined}
            windGust={availableFields.windSpeed ? (currentData.windGust ?? undefined) : undefined}
            windDirection={availableFields.windDirection ? (currentData.windDirection ?? undefined) : undefined}
            solarRadiation={availableFields.solarRadiation ? (currentData.solarRadiation ?? undefined) : undefined}
            /* 24-hour accumulation, not currentData.rainfall: on cumulative
               stations (RIKA) the raw field is a lifetime counter. */
            rainfall={availableFields.rainfall ? effectiveRainfall : undefined}
            dewPoint={effectiveDewPoint != null && effectiveDewPoint !== 0 ? effectiveDewPoint : undefined}
            isOnline={(station as any)?.isActive ?? true}
            connectionType={(station as any)?.connectionType ?? undefined}
            syncInterval={3600000}
            latitude={station.latitude ?? undefined}
            longitude={station.longitude ?? undefined}
          />

          {/* Primary Charts */}
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.temperature && (
            <DataBlockChart title="Temperature" data={chartData}
              series={[{ dataKey: "temperature", name: "Temperature", color: "#ef4444", unit: "°C" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Temperature"
              showAverage={true} showMinMax={true} currentValue={currentData.temperature || 0}
              trend={trends.temperature !== null ? { value: parseFloat(safeFixed(trends.temperature, 1, "0")), label: "vs avg" } : undefined}
            />
            )}
            {availableFields.humidity && (
            <DataBlockChart title="Relative Humidity" data={chartData}
              series={[{ dataKey: "humidity", name: "Relative Humidity", color: "#3b82f6", unit: "%" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Relative Humidity"
              showAverage={true} showMinMax={true} currentValue={currentData.humidity || 0}
              trend={trends.humidity !== null ? { value: parseFloat(safeFixed(trends.humidity, 1, "0")), label: "vs avg" } : undefined}
            />
            )}
          </div>
          </Suspense>

          {/* Barometric Pressure */}
          {sv.barometricPressure !== false && availableFields.pressure && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarometricPressureCard
              stationPressure={pressureIsSLP ? calculateStationPressure(currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA, station?.altitude || 0, currentData.temperature || DEFAULT_TEMPERATURE_C) : currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA}
              seaLevelPressure={seaLevelPressure}
              altitude={station?.altitude || 0}
              temperature={currentData.temperature || DEFAULT_TEMPERATURE_C}
              trend={trends.pressure !== null ? parseFloat(safeFixed(trends.pressure, 1, "0")) : 0}
            />
            <Suspense fallback={<ChartFallback />}>
            <DataBlockChart title="Barometric Pressure History" data={chartData}
              series={[{ dataKey: "pressure", name: "Station Pressure", color: CHART_COLOURS.pressure, unit: "hPa" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Pressure"
              showAverage={true} showMinMax={true} currentValue={currentData.pressure || 0}
            />
            </Suspense>
          </div>
          )}
        </section>
        )}

        {/* Logger Battery Section - Only show if battery data exists */}
        {sv.loggerBattery !== false && availableFields.batteryVoltage && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Logger Battery Status</h2>
          {batteryChargingStatus.hasData && !batteryChargingStatus.didCharge && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
              <div>
                <p className="text-sm font-medium">Battery Not Charging</p>
                <p className="text-xs text-amber-600">
                  No charging activity detected in the last 24 hours. Voltage range: {batteryChargingStatus.minVoltage.toFixed(2)}V to {batteryChargingStatus.maxVoltage.toFixed(2)}V.
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
            <Suspense fallback={<ChartFallback />}>
            <DataBlockChart title="Battery Voltage History" data={batteryChartData}
              series={[
                { dataKey: "batteryVoltage", name: "Battery Voltage", color: CHART_COLOURS.batteryVoltage, unit: "V" },
              ]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Voltage"
              showAverage={true} showMinMax={true} currentValue={currentData.batteryVoltage || 0}
              defaultExpanded={false}
            />
            </Suspense>
            {availableFields.batteryVoltage && availableFields.solarRadiation && (
            <Suspense fallback={<ChartFallback />}>
            <DataBlockChart title="Battery Voltage vs Solar Irradiance" data={chartData}
              series={[
                { dataKey: "batteryVoltage", name: "Battery Voltage", color: CHART_COLOURS.batteryVoltage, unit: "V", yAxisId: "left" },
                { dataKey: "solar", name: "Solar Irradiance", color: "#f59e0b", unit: "W/m²", yAxisId: "right", strokeDasharray: "4 3" },
              ]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Voltage (V)"
              rightYAxisLabel="Irradiance (W/m²)"
              showAverage={false} showMinMax={true} currentValue={currentData.batteryVoltage || 0}
            />
            </Suspense>
            )}
          </div>
        </section>
        )}

        {/* Panel Temperature (independent, shows whenever data is available) */}
        {currentData.panelTemperature != null && Number(currentData.panelTemperature) !== 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Panel Temperature</h2>
          <div className="grid grid-cols-1 gap-6">
            <Suspense fallback={<ChartFallback />}>
              <DataBlockChart title="Panel Temperature" data={chartData}
                series={[{ dataKey: "panelTemperature", name: "Panel Temperature", color: "#ef4444", unit: "°C" }]}
                chartType="line" xAxisLabel="Time" yAxisLabel="Temperature (°C)"
                showAverage={true} showMinMax={true} currentValue={Number(currentData.panelTemperature) || 0}
              />
            </Suspense>
          </div>
        </section>
        )}

        {/* MPPT Solar Charge Controller */}
        {sv.mpptCharger !== false && (availableFields.mpptSolarVoltage || availableFields.mpptSolarPower || availableFields.mpptBatteryVoltage) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">MPPT Solar Charge Controller</h2>
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
            />
            )}
          </div>
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {availableFields.mpptSolarPower && (
            <DataBlockChart title={availableFields.mppt2SolarPower ? "Charger 1 Solar Power" : "Solar Power"} data={chartData}
              series={[{ dataKey: "mpptSolarPower", name: "Solar Power", color: "#ef4444", unit: "W" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Power"
              showAverage={true} showMinMax={true} currentValue={currentData.mpptSolarPower ?? 0}
              yAxisDomain={[0, 'auto']}
            />
            )}
            {availableFields.mppt2SolarPower && (
            <DataBlockChart title="Charger 2 Solar Power" data={chartData}
              series={[{ dataKey: "mppt2SolarPower", name: "Solar Power", color: "#f97316", unit: "W" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Power"
              showAverage={true} showMinMax={true} currentValue={currentData.mppt2SolarPower ?? 0}
              yAxisDomain={[0, 'auto']}
            />
            )}
            {(availableFields.mpptBoardTemp || availableFields.mppt2BoardTemp) && (
            <DataBlockChart title="Board Temperature" data={chartData}
              series={[
                ...(availableFields.mpptBoardTemp ? [{ dataKey: "mpptBoardTemp", name: "Charger 1", color: "#ef4444", unit: "°C" }] : []),
                ...(availableFields.mppt2BoardTemp ? [{ dataKey: "mppt2BoardTemp", name: "Charger 2", color: "#3b82f6", unit: "°C" }] : []),
              ]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Temperature"
              showAverage={true} showMinMax={true}
            />
            )}
          </div>
          </Suspense>
          {/* Daily yield: what the array actually delivered, not just peak power */}
          {chargerEnergyData.length > 0 && (availableFields.mpptSolarPower || availableFields.mppt2SolarPower) && (
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 gap-6">
            <DataBlockChart title="Daily Solar Energy Harvested" data={chargerEnergyData}
              series={[
                ...(availableFields.mpptSolarPower ? [{ dataKey: "chargerEnergy1", name: availableFields.mppt2SolarPower ? "Charger 1" : "Harvested", color: "#f59e0b", unit: "Wh" }] : []),
                ...(availableFields.mppt2SolarPower ? [{ dataKey: "chargerEnergy2", name: "Charger 2", color: CHART_COLOURS.chargerEnergy2, unit: "Wh" }] : []),
                ...(availableFields.mpptSolarPower && availableFields.mppt2SolarPower
                  ? [{ dataKey: "chargerEnergyTotal", name: "System total", color: "#1e3a5f", unit: "Wh" }]
                  : []),
              ]}
              chartType="bar" xAxisLabel="Day" yAxisLabel="Energy (Wh)"
              showAverage={true} showMinMax={true}
              yAxisDomain={[0, 'auto']}
            />
          </div>
          </Suspense>
          )}
        </section>
        )}

        {/* Water & Sensors */}
        {sv.waterSensors !== false && (availableFields.waterLevel || availableFields.temperatureSwitch || availableFields.chargerVoltage || availableFields.lightning || availableFields.lightningDistance || availableFields.lightningEnergy || availableFields.lightningRaw || availableFields.levelSwitch || availableFields.levelSwitchStatus || availableFields.temperatureSwitchOutlet || availableFields.temperature8m || availableFields.deltaTemperature) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Sensors</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {availableFields.waterLevel && (
            <MetricCard title="Water Level" value={formatValue(currentData.waterLevel || 0, 1)} unit="mm" />
            )}
            {availableFields.temperatureSwitch && (
            <MetricCard title="Temp Switch" value={formatValue(currentData.temperatureSwitch || 0, 1)} unit="mV" />
            )}
            {availableFields.temperatureSwitchOutlet && (
            <MetricCard title="Temp Switch Outlet" value={formatValue(currentData.temperatureSwitchOutlet || 0, 1)} unit="mV" />
            )}
            {availableFields.levelSwitch && (
            <MetricCard title="Level Switch" value={formatValue(currentData.levelSwitch || 0, 1)} unit="" />
            )}
            {availableFields.levelSwitchStatus && (
            <MetricCard title="Level Switch Status" value={(currentData.levelSwitchStatus ?? 0) > 0 ? "On" : "Off"} unit="" />
            )}
            {availableFields.lightning && (
            <MetricCard title="Lightning Strikes" value={formatValue(currentData.lightning || 0, 0)} unit="strikes" />
            )}
            {availableFields.lightningRaw && (
            <MetricCard title="Lightning Raw" value={formatValue(currentData.lightningRaw || 0, 2)} unit="mA" />
            )}
            {availableFields.lightningDistance && (
            <MetricCard title="Strike Distance" value={formatValue(currentData.lightningDistance != null && currentData.lightningDistance > 0 ? currentData.lightningDistance : 0, 0)} unit="km" />
            )}
            {availableFields.lightningEnergy && (
            // Relative band + 0 to 100 figure, since the AS3935 register has no unit.
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
            <MetricCard title="Charger Voltage" value={formatValue(currentData.chargerVoltage || 0, 2)} unit="V" />
            )}
            {availableFields.temperature8m && (
            <MetricCard title="Temperature (8m)" value={formatValue(currentData.temperature8m || 0, 1)} unit="°C" />
            )}
            {availableFields.deltaTemperature && (
            <MetricCard title="Delta Temperature" value={formatValue(currentData.deltaTemperature || 0, 2)} unit="°C" />
            )}
            {availableFields.moduleTemperature && (
            <MetricCard title="Module Temperature" value={formatValue((currentData as any).moduleTemperature || 0, 1)} unit="°C" />
            )}
          </div>
          {/* Temperature (8m), Delta Temperature, Lightning Charts */}
          {(availableFields.temperature8m || availableFields.deltaTemperature || availableFields.lightning || availableFields.lightningDistance || availableFields.lightningEnergy || availableFields.lightningRaw) && (
          <Suspense fallback={<ChartFallback />}>
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
          </Suspense>
          )}
        </section>
        )}

        {/* Solar Position & Radiation */}
        {sv.solarRadiation !== false && (availableFields.solarRadiation || availableFields.uvIndex || (availableFields.temperature && availableFields.pressure) || hasStationCoordinates) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar Position & Radiation</h2>
          {/* Solar Position Card - full width */}
          {hasStationCoordinates && (
            <SolarPositionCard
              elevation={solarPosition.elevation}
              azimuth={solarPosition.azimuth}
              latitude={station!.latitude!}
              longitude={station!.longitude!}
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
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sun Elevation & Azimuth Chart */}
            {hasStationCoordinates && (
            <DataBlockChart
              title="Sun Elevation & Azimuth (24h)"
              data={(() => {
                const lat = station?.latitude || 0;
                const lon = station?.longitude || 0;
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
              chartType="line" xAxisLabel="Time" yAxisLabel="Degrees"
              yAxisDomain={[-80, 360]}
              showAverage={false} showMinMax={false}
              currentValue={solarPosition.elevation}
            />
            )}
            {availableFields.solarRadiation && (
            <DataBlockChart title="Solar Radiation" data={chartData}
              series={[{ dataKey: "solar", name: "Solar Radiation", color: "#ef4444", unit: "W/m²" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Radiation"
              showAverage={true} showMinMax={true} currentValue={currentData.solarRadiation || 0}
            />
            )}
            {availableFields.solarRadiation && (
            <DataBlockChart title="Reference ETo" data={chartData}
              series={[{ dataKey: "eto", name: "Reference ETo", color: CHART_COLOURS.eto, unit: "mm/day" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="ETo (mm/day)"
              showAverage={true} showMinMax={true} currentValue={currentData.eto ?? calculatedETo ?? 0}
            />
            )}
            {availableFields.solarRadiation && availableFields.rainfall && (
            <DataBlockChart title="Irrigation Time (Estimated)" data={chartData}
              series={[{ dataKey: "irrigationTime", name: "Irrigation Time", color: "#3b82f6", unit: "min" }]}
              chartType="bar" xAxisLabel="Time" yAxisLabel="Minutes"
              showAverage={true} showMinMax={true}
              footer="(ETo − rainfall) × crop factor × valve flow rate | Based on FAO-56 Penman-Monteith ETo. Assumes Kc=1.0 (reference grass) and 5 mm/hr flow rate. Estimation only (does not account for soil type, crop stage, or irrigation system efficiency)."
            />
            )}
            {/* Dew Point Temperature */}
            {(availableFields.temperature && availableFields.humidity) && chartData.length > 0 && (
            <DataBlockChart title="Dew Point Temperature" data={chartData}
              series={[{ dataKey: "dewPoint", name: "Dew Point", color: "#3b82f6", unit: "°C" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Dew Point (°C)"
              showAverage={true} showMinMax={true} currentValue={effectiveDewPoint ?? 0}
            />
            )}
            {/* Wind Speed vs Wind Gust */}
            {availableFields.windSpeed && (
            <DataBlockChart title="Wind Speed vs Wind Gust" data={chartData}
              series={[
                { dataKey: "windSpeed", name: "Wind Speed", color: "#22c55e", unit: windUnitLabel },
                { dataKey: "windGust", name: "Wind Gust", color: "#f59e0b", unit: windUnitLabel },
              ]}
              chartType="line" xAxisLabel="Time" yAxisLabel={`Speed (${windUnitLabel})`}
              showAverage={true} showMinMax={true} currentValue={currentData.windSpeed || 0}
            />
            )}
            {availableFields.windSpeed && availableFields.windDirection && (
            <DataBlockChart title="Wind Speed vs Wind Direction" data={chartData}
              series={[
                { dataKey: "windSpeed", name: "Wind Speed", color: "#22c55e", unit: windUnitLabel, yAxisId: "left" },
                { dataKey: "windDirection", name: "Wind Direction", color: "#f97316", unit: "°", yAxisId: "right", strokeDasharray: "4 3" },
              ]}
              chartType="line" xAxisLabel="Time" yAxisLabel={`Speed (${windUnitLabel})`}
              rightYAxisLabel="Direction (°)" rightYAxisDomain={[0, 360]}
              showAverage={false} showMinMax={true} currentValue={currentData.windSpeed || 0}
            />
            )}
            {availableFields.temperature && availableFields.humidity && (
            <DataBlockChart title="Heat Index" data={chartData}
              series={[{ dataKey: "heatIndex", name: "Heat Index", color: "#dc2626", unit: "°C" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Heat Index (°C)"
              showAverage={true} showMinMax={true}
              currentValue={currentData.temperature != null && currentData.humidity != null ? calculateHeatIndex(currentData.temperature, currentData.humidity) : 0}
            />
            )}
            {availableFields.temperature && availableFields.windSpeed && (
            <DataBlockChart title="Wind Chill" data={chartData}
              series={[{ dataKey: "windChill", name: "Wind Chill", color: CHART_COLOURS.windChill, unit: "°C" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Wind Chill (°C)"
              showAverage={true} showMinMax={true}
              currentValue={currentData.temperature != null && currentData.windSpeed != null ? calculateWindChill(currentData.temperature, windSpeedUnit === 'kmh' ? kmhToMs(currentData.windSpeed) : currentData.windSpeed) : 0}
            />
            )}
          </div>
          </Suspense>
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
            <Suspense fallback={<ChartFallback />}>
            <DataBlockChart title="Solar Power Output Over Time"
              data={chartData.map(d => ({ timestamp: d.timestamp, solarPower: (d.solar ?? 0) * 0.20 * (1 - 0.15), solarRadiation: d.solar ?? 0 }))}
              series={[
                { dataKey: "solarPower", name: "Solar Power (W/m²)", color: "#f59e0b", unit: "W/m²" },
                { dataKey: "solarRadiation", name: "Radiation (W/m²)", color: "#ef4444", unit: "W/m²" },
              ]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Power / Radiation"
              showAverage={true} showMinMax={true}
              currentValue={(currentData.solarRadiation ?? 0) * 0.20 * (1 - 0.15)}
            />
            </Suspense>
          )}
        </section>
        )}

        {/* Soil & Environment */}
        {sv.soilEnvironment !== false && (availableFields.soilTemperature || availableFields.soilMoisture || availableFields.pm25 || availableFields.pm10) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Soil & Environment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {availableFields.soilTemperature && (
            <MetricCard title="Soil Temperature" value={formatValue(currentData.soilTemperature || 0, 1)} unit="°C" />
            )}
            {availableFields.soilMoisture && (
            <MetricCard title="Soil Moisture" value={formatValue(currentData.soilMoisture || 0, 1)} unit="%"
              subMetrics={[{ label: "Status", value: (currentData.soilMoisture || 0) < 20 ? "Dry" : (currentData.soilMoisture || 0) < 40 ? "Optimal" : "Wet" }]} />
            )}
            {availableFields.pm25 && (
            <MetricCard title="PM2.5" value={formatValue(currentData.pm25 || 0, 1)} unit="µg/m³"
              subMetrics={[{ label: "AQI", value: (currentData.pm25 || 0) < 12 ? "Good" : (currentData.pm25 || 0) < 35 ? "Moderate" : "Unhealthy" }]} />
            )}
            {availableFields.pm10 && (
            <MetricCard title="PM10" value={formatValue(currentData.pm10 || 0, 1)} unit="µg/m³" />
            )}
          </div>
          {(availableFields.soilTemperature || availableFields.soilMoisture) && (
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.soilTemperature && (
            <DataBlockChart title="Soil Temperature" data={chartData.filter(d => d.soilTemperature !== null).map(d => ({ ...d, soilTemp: d.soilTemperature }))}
              series={[{ dataKey: "soilTemp", name: "Soil Temp", color: "#ef4444", unit: "°C" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Temperature"
              showAverage={true} showMinMax={true} currentValue={currentData.soilTemperature || 0}
            />
            )}
            {availableFields.soilMoisture && (
            <DataBlockChart title="Soil Moisture" data={chartData.filter(d => d.soilMoisture !== null).map(d => ({ ...d, soilMoist: d.soilMoisture }))}
              series={[{ dataKey: "soilMoist", name: "Moisture", color: "#22c55e", unit: "%" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Moisture"
              showAverage={true} showMinMax={true} currentValue={currentData.soilMoisture || 0}
            />
            )}
          </div>
          </Suspense>
          )}
          {(availableFields.pm10 || availableFields.pm25) && (
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.pm10 && (
            <DataBlockChart title="PM10 History" data={chartData.filter(d => d.pm10 !== null).map(d => ({ ...d, pm10Val: d.pm10 }))}
              series={[{ dataKey: "pm10Val", name: "PM10", color: "#ef4444", unit: "µg/m³" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="PM10"
              showAverage={true} showMinMax={true} currentValue={currentData.pm10 || 0}
            />
            )}
            {availableFields.pm25 && (
            <DataBlockChart title="PM2.5 History" data={chartData.filter(d => d.pm25 !== null).map(d => ({ ...d, pm25Val: d.pm25 }))}
              series={[{ dataKey: "pm25Val", name: "PM2.5", color: "#ef4444", unit: "µg/m³" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="PM2.5"
              showAverage={true} showMinMax={true} currentValue={currentData.pm25 || 0}
            />
            )}
          </div>
          </Suspense>
          )}
        </section>
        )}

        {/* Visibility & Clouds - Only show if visibility data available */}
        {sv.visibilityClouds !== false && (availableFields.visibility || availableFields.atmosphericVisibility || availableFields.cloudBase || availableFields.cloudCover) && (
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
          <Suspense fallback={<ChartFallback />}>
          {(availableFields.visibility || availableFields.atmosphericVisibility) && (
          <div className="grid grid-cols-1 gap-6">
            {availableFields.visibility && (
            <DataBlockChart
              title="Visibility"
              data={chartData.filter(d => d.visibility !== null).map(d => ({ ...d, vis: d.visibility }))}
              series={[{ dataKey: "vis", name: "Visibility", color: "#3b82f6", unit: "km" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Visibility (km)"
              showAverage={true} showMinMax={true} currentValue={currentData.visibility || 0}
            />
            )}
            {availableFields.atmosphericVisibility && (
            <DataBlockChart
              title="Atmospheric Visibility"
              data={chartData.filter(d => d.atmosphericVisibility !== null && d.atmosphericVisibility !== undefined).map(d => ({ ...d, atmosVis: d.atmosphericVisibility }))}
              series={[{ dataKey: "atmosVis", name: "Atmospheric Vis.", color: "#2563eb", unit: "km" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Visibility (km)"
              showAverage={true} showMinMax={true} currentValue={currentData.atmosphericVisibility || 0}
            />
            )}
          </div>
          )}
          </Suspense>
        </section>
        )}

        {/* Wind Analysis */}
        {sv.windAnalysis !== false && (availableFields.windSpeed || availableFields.windDirection) && (
        <section className="space-y-6">
          <h2 className="text-base font-normal text-foreground">Wind Analysis (WMO/Beaufort Scale)</h2>
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {availableFields.windDirection && (
            <WindCompass
              direction={currentData.windDirection || 0}
              speed={currentData.windSpeed || 0}
              gust={currentData.windGust ?? undefined}
              unit={windUnitLabel}
            />
            )}
            {chartTimeRange <= 24 && windDataByPeriod['30min'].count > 0 && (
            <WindRose data={windDataByPeriod['30min'].rose} title="Wind Rose (30 min)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange <= 24 && windDataByPeriod['60min'].count > 0 && (
            <WindRose data={windDataByPeriod['60min'].rose} title="Wind Rose (60 min)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange <= 24 && windDataByPeriod['24h'].count > 0 && (
            <WindRose data={windDataByPeriod['24h'].rose} title="Wind Rose (24h)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange > 24 && windDataByPeriod['48h'].count > 0 && (
            <WindRose data={windDataByPeriod['48h'].rose} title="Wind Rose (48h)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange >= 168 && windDataByPeriod['7d'].count > 0 && (
            <WindRose data={windDataByPeriod['7d'].rose} title="Wind Rose (7 days)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange >= 168 && windDataByPeriod['31d'].count > 0 && (
            <WindRose data={windDataByPeriod['31d'].rose} title="Wind Rose (30 days)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {chartTimeRange <= 24 && windDataByPeriod['60min'].count > 0 && (
            <WindRoseScatter data={windDataByPeriod['60min'].scatter} title="Wind Scatter (60 min)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange <= 24 && windDataByPeriod['24h'].count > 0 && (
            <WindRoseScatter data={windDataByPeriod['24h'].scatter} title="Wind Scatter (24h)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange > 24 && chartTimeRange < 168 && windDataByPeriod['48h'].count > 0 && (
            <WindRoseScatter data={windDataByPeriod['48h'].scatter} title="Wind Scatter (48h)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange >= 168 && windDataByPeriod['7d'].count > 0 && (
            <WindRoseScatter data={windDataByPeriod['7d'].scatter} title="Wind Scatter (7 days)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
            {chartTimeRange >= 168 && windDataByPeriod['31d'].count > 0 && (
            <WindRoseScatter data={windDataByPeriod['31d'].scatter} title="Wind Scatter (30 days)" maxWindSpeed={maxWindSpeed} windSpeedUnit={windSpeedUnit} />
            )}
          </div>
          </Suspense>
        </section>
        )}

        {/* Wind Energy - Single full-width block */}
        {sv.windEnergy !== false && (availableFields.windSpeed || availableFields.windDirection) && (
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
          <Suspense fallback={<ChartFallback />}>
          <DataBlockChart title="Wind Power Density Over Time"
            data={windEnergyData.map(d => ({ timestamp: d.timestamp, windPower: d.windPower, windSpeed: d.windSpeed }))}
            series={[
              { dataKey: "windPower", name: "Wind Power", color: "#22c55e", unit: "W/m²" },
              { dataKey: "windSpeed", name: "Wind Speed", color: "#3b82f6", unit: windUnitLabel },
            ]}
            chartType="area" xAxisLabel="Time" yAxisLabel="Power / Speed"
            showAverage={true} showMinMax={true} currentValue={calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit)}
          />
          </Suspense>
          {/* Weibull Distribution, Turbulence & Power Rose */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sortedHistoricalData.length >= 10 && (
            <Suspense fallback={<ChartFallback />}>
              <WeibullCard
                windSpeeds={sortedHistoricalData.map(d => d.windSpeed ?? 0).filter(v => v > 0)}
              />
            </Suspense>
            )}
            {(() => {
              const recentSpeeds = sortedHistoricalData.slice(-10).map(d => d.windSpeed ?? 0);
              const mean = recentSpeeds.length > 0 ? recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length : 0;
              const stdDev = recentSpeeds.length > 1 ? Math.sqrt(recentSpeeds.reduce((s, v) => s + (v - mean) ** 2, 0) / (recentSpeeds.length - 1)) : 0;
              return mean > 0.5 ? (
                <TurbulenceCard
                  windStdDev={stdDev}
                  meanWindSpeed={mean}
                />
              ) : null;
            })()}
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

        {/* Fire Danger */}
        {sv.fireDanger !== false && (availableFields.temperature && availableFields.humidity && availableFields.windSpeed) && (
        <section className="space-y-4">
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FireDangerCard temperature={currentData.temperature!} humidity={currentData.humidity!} windSpeed={currentData.windSpeed!} rainfall7day={rainfallStats.rainfall7day} daysSinceRain={rainfallStats.daysSinceRain} />
            <FireDangerChart data={fireDangerChartData} title="Fire Danger History" />
          </div>
          </Suspense>
        </section>
        )}

        {/* Air Quality Section */}
        {sv.airQuality !== false && (availableFields.pm10 || availableFields.pm25 || availableFields.so2 || availableFields.particulateCount) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Air Quality</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AirQualityCard
              pm25={currentData.pm25}
              pm10={currentData.pm10}
              co2={(currentData as any).co2}
              so2={(currentData as any).so2}
              particulateCount={(currentData as any).particulateCount}
            />
          </div>
        </section>
        )}

        {/* Atmospheric Stability / Aviation / Road Weather - 2x2 grid */}
        {((sv.atmosphericStability !== false && availableFields.windSpeed && availableFields.solarRadiation) ||
          (sv.aviation !== false && availableFields.pressure && availableFields.temperature)) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Atmospheric Stability &amp; Aviation</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {sv.atmosphericStability !== false && (availableFields.windSpeed && availableFields.solarRadiation) && (
            <AtmosphericStabilityCard
              windSpeed={currentData.windSpeed!}
              solarRadiation={currentData.solarRadiation!}
              cloudCover={currentData.cloudCover}
              deltaTemperature={currentData.deltaTemperature}
            />
            )}
            {sv.aviation !== false && (availableFields.pressure && availableFields.temperature) && (
            <DensityAltitudeCard
              stationPressure={currentData.pressure!}
              temperature={currentData.temperature!}
              dewPoint={effectiveDewPoint ?? undefined}
              stationElevation={station?.altitude ?? undefined}
            />
            )}
          </div>
        </section>
        )}



        {/* Rainfall Section */}
        {availableFields.rainfall && shareToken && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Rainfall</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard title="Rainfall (24h)" value={formatValue(rainfallPeriods.last24h, 2)} unit="mm" />
            <MetricCard title="Rainfall (Yesterday)" value={formatValue(rainfallPeriods.yesterday, 2)} unit="mm" />
            <MetricCard title="Rainfall (This Week)" value={formatValue(rainfallPeriods.thisWeek, 2)} unit="mm" />
            <MetricCard title="Rainfall (This Month)" value={formatValue(rainfallPeriods.thisMonth, 2)} unit="mm" />
          </div>
          {(() => {
            /**
             * Hidden for cumulative-counter stations (e.g. RIKA reports a
             * lifetime millimetre counter), where a yearly aggregate is not a
             * trustworthy rainfall depth. The shared station payload does not
             * expose connectionType, so we key off the configured rainfall
             * type instead - which is the authoritative signal anyway.
             */
            if (isCumulativeType(effectiveRainfallType)) return null;
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
                        <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{`${safeFixed(entry.total, 1)} mm`}</p>
                        <p className="text-xs text-black">{(entry.readings || 0).toLocaleString()} readings</p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-black italic" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  Rainfall totals are calculated from station logger data. Accuracy may be affected by periods where the station was offline, clogged or blocked rain gauges, logger resets, or data gaps during synchronisation interruptions.
                </p>
              </CardContent>
            </Card>
            );
          })()}
        </section>
        )}


        {/* ETo vs Rainfall (last 30 days) - only when there was rain */}
        {availableFields.rainfall && shareToken && etoRainDaily.totalRain > 0 && etoRainDaily.data.length > 0 && (
        <section className="space-y-4">
          <Suspense fallback={<ChartFallback />}>
            <DataBlockChart
              title="ETo vs Rainfall (Last 30 Days)"
              data={etoRainDaily.data}
              chartType="bar"
              series={[
                { dataKey: "rain", name: "Rainfall (mm)", color: "#3b82f6", unit: "mm", yAxisId: "left" },
                { dataKey: "eto", name: "ETo (mm/day)", color: CHART_COLOURS.eto, unit: "mm/day", yAxisId: "right" },
              ]}
              yAxisLabel="Rainfall (mm)"
              rightYAxisLabel="ETo (mm/day)"
            />
          </Suspense>
        </section>
        )}


        {/* Historical Data with Time Range Picker */}
        {sv.historicalCharts !== false && (chartData.length > 0 || historicalChartData.length > 0) && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-base font-normal text-foreground">Historical Data</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-black">Time Range:</span>
              <div className="flex gap-1">
                {[
                  { label: "1h", hours: 1 },
                  { label: "6h", hours: 6 },
                  { label: "12h", hours: 12 },
                  { label: "24h", hours: 24 },
                  { label: "48h", hours: 48 },
                  { label: "7d", hours: 168 },
                  { label: "30d", hours: 720 },
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
              {(availableFields.temperature || availableFields.humidity) && <TabsTrigger value="temperature" className="flex-1 min-w-[80px]">Temp & RH</TabsTrigger>}
              {availableFields.windSpeed && <TabsTrigger value="wind" className="flex-1 min-w-[80px]">Wind</TabsTrigger>}
              {availableFields.pressure && <TabsTrigger value="pressure" className="flex-1 min-w-[80px]">Pressure</TabsTrigger>}
              {availableFields.solarRadiation && <TabsTrigger value="solar" className="flex-1 min-w-[80px]">Solar</TabsTrigger>}
              {availableFields.rainfall && <TabsTrigger value="rain" className="flex-1 min-w-[80px]">Rain</TabsTrigger>}
            </TabsList>
            {(availableFields.temperature || availableFields.humidity) && (
            <TabsContent value="temperature" className="mt-4">
              <WeatherChart title="Temperature & Humidity" data={historicalChartData}
                series={[
                  ...(availableFields.temperature ? [{ dataKey: "temperature", name: "Temperature (°C)", color: "#ef4444" }] : []),
                  ...(availableFields.humidity ? [{ dataKey: "humidity", name: "Relative Humidity (%)", color: "#3b82f6" }] : []),
                ]}
              />
            </TabsContent>
            )}
            {availableFields.windSpeed && (
            <TabsContent value="wind" className="mt-4">
              <WeatherChart title="Wind Speed" data={historicalChartData}
                series={[{ dataKey: "windSpeed", name: `Wind Speed (${windUnitLabel})`, color: "#22c55e" }]}
              />
            </TabsContent>
            )}
            {availableFields.pressure && (
            <TabsContent value="pressure" className="mt-4">
              <WeatherChart title="Barometric Pressure" data={historicalChartData}
                series={[{ dataKey: "pressure", name: "Pressure (hPa)", color: CHART_COLOURS.pressure }]}
              />
            </TabsContent>
            )}
            {availableFields.solarRadiation && (
            <TabsContent value="solar" className="mt-4">
              <WeatherChart title="Solar Radiation" data={historicalChartData}
                series={[{ dataKey: "solar", name: "Solar Radiation (W/m²)", color: "#ef4444" }]}
              />
            </TabsContent>
            )}
            {availableFields.rainfall && (
            <TabsContent value="rain" className="mt-4">
              <WeatherChart title="Rainfall" data={historicalChartData}
                series={[{ dataKey: "rain", name: "Rainfall (mm)", color: "#3b82f6" }]}
              />
            </TabsContent>
            )}
          </Tabs>
          </Suspense>
            );
          })()}
        </section>
        )}

        {/* Solar & Reference ET₀ */}
        {sv.solarEtCards !== false && (availableFields.solarRadiation || availableFields.temperature) && (
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
                { period: "24h", stats: [
                  { label: "Min", value: temperatureStats['24h'].min ?? '--', unit: "°C" },
                  { label: "Max", value: temperatureStats['24h'].max ?? '--', unit: "°C" },
                  { label: "Avg", value: temperatureStats['24h'].avg ?? '--', unit: "°C" },
                  { label: "Range", value: temperatureStats['24h'].range ?? '--', unit: "°C" },
                ]},
                { period: "7d", stats: [
                  { label: "Min", value: temperatureStats['7d'].min ?? '--', unit: "°C" },
                  { label: "Max", value: temperatureStats['7d'].max ?? '--', unit: "°C" },
                  { label: "Avg", value: temperatureStats['7d'].avg ?? '--', unit: "°C" },
                  { label: "Range", value: temperatureStats['7d'].range ?? '--', unit: "°C" },
                ]},
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

        {/* Footer */}
        <div className="text-center text-sm text-black pt-4 border-t space-y-1">
          <p>
            Shared Dashboard • Station data: {(() => {
              const ts = new Date((currentData as any)?.collectedAt || currentData?.timestamp);
              if (!currentData?.timestamp || isNaN(ts.getTime())) return 'No data available';
              return ts.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            })()}
          </p>
          <p className="text-xs text-black/70">Powered by Stratus Weather Server V2.1.0 [2026]</p>
          <p className="text-xs text-black/70 max-w-3xl mx-auto px-4">
            Data is provided for informational and reference purposes only. Readings may contain
            inaccuracies due to sensor calibration, environmental conditions, or transmission gaps,
            and should be independently verified before being used for operational, agricultural,
            scientific, or commercial decisions. Use at your own discretion.
          </p>
        </div>
      </main>
    </div>
  );
}

// Export with ErrorBoundary wrapper
export default function SharedDashboard() {
  return (
    <ErrorBoundary>
      <SharedDashboardContent />
    </ErrorBoundary>
  );
}
