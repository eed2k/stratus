// Stratus Weather System
// Created by Lukas Esterhuizen

import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { safeFixed } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { WindCompass } from "@/components/dashboard/WindCompass";
import { WindPowerCard } from "@/components/dashboard/WindPowerCard";
import { StatisticsCard } from "@/components/dashboard/StatisticsCard";
import { SolarRadiationCard } from "@/components/dashboard/SolarRadiationCard";
import { EToCard } from "@/components/dashboard/EToCard";
import { AirDensityCard } from "@/components/dashboard/AirDensityCard";
import { BatteryVoltageCard } from "@/components/dashboard/BatteryVoltageCard";
import { MpptChargerCard } from "@/components/dashboard/MpptChargerCard";
import { BarometricPressureCard } from "@/components/dashboard/BarometricPressureCard";
import { SolarPowerHarvestCard } from "@/components/dashboard/SolarPowerHarvestCard";
import { SolarPositionCard } from "@/components/dashboard/SolarPositionCard";
import { FireDangerCard } from "@/components/dashboard/FireDangerCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Lock,
  AlertCircle,
  Eye,
  RefreshCw,
  Share2,
  Download,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { WeatherData } from "@shared/schema";
import { 
  calculateSeaLevelPressure,
  calculateAirDensity,
  calculateETo,
  getDayOfYear,
  kmhToMs,
  wattsToMJPerDay,
  calculateFireDanger,
  calculateSolarPosition,
} from "@shared/utils/calc";
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

const ChartFallback = () => (
  <div className="flex items-center justify-center h-48 bg-muted/20 rounded-lg animate-pulse">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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

const processChartData = (historicalData: WeatherData[], timeRangeHours?: number, stationLat?: number, stationAltitude?: number, windUnit: WindSpeedUnit = 'ms') => {
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
        mppt2SolarVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2SolarVoltage))),
        mppt2SolarCurrent: avgNonNull(dayData.map(d => toNum(d.mppt2SolarCurrent))),
        mppt2SolarPower: avgNonNull(dayData.map(d => toNum(d.mppt2SolarPower))),
        mppt2BatteryVoltage: avgNonNull(dayData.map(d => toNum(d.mppt2BatteryVoltage))),
        mppt2BoardTemp: avgNonNull(dayData.map(d => toNum(d.mppt2BoardTemp))),
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
    if (i > 0) {
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
      solar: d.solarRadiation != null ? Math.max(d.solarRadiation, 0) : null,
      rain: incrementalRain,
      soilTemperature: d.soilTemperature ?? null,
      soilMoisture: d.soilMoisture ?? null,
      pm10: d.pm10 ?? null,
      pm25: d.pm25 ?? null,
      batteryVoltage: d.batteryVoltage ?? null,
      waterLevel: d.waterLevel ?? null,
      temperatureSwitch: d.temperatureSwitch ?? null,
      temperatureSwitchOutlet: d.temperatureSwitchOutlet ?? null,
      chargerVoltage: d.chargerVoltage ?? null,
      mpptSolarVoltage: toNum(d.mpptSolarVoltage),
      mpptSolarCurrent: toNum(d.mpptSolarCurrent),
      mpptSolarPower: toNum(d.mpptSolarPower),
      mpptLoadVoltage: toNum(d.mpptLoadVoltage),
      mpptLoadCurrent: toNum(d.mpptLoadCurrent),
      mpptBatteryVoltage: toNum(d.mpptBatteryVoltage),
      mpptChargerState: toNum(d.mpptChargerState),
      mpptAbsiAvg: toNum(d.mpptAbsiAvg),
      mpptBoardTemp: toNum(d.mpptBoardTemp),
      mppt2SolarVoltage: toNum(d.mppt2SolarVoltage),
      mppt2SolarCurrent: toNum(d.mppt2SolarCurrent),
      mppt2SolarPower: toNum(d.mppt2SolarPower),
      mppt2BatteryVoltage: toNum(d.mppt2BatteryVoltage),
      mppt2BoardTemp: toNum(d.mppt2BoardTemp),
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
        const data = await res.json();
        throw new Error(data.error || 'Share not found');
      }
      return res.json();
    },
    enabled: !!shareToken,
  });

  // Build headers for data requests (include session token for password-protected shares)
  const shareHeaders: HeadersInit = sessionToken
    ? { 'X-Share-Session': sessionToken }
    : {};

  // Fetch data range for historical fallback
  const { data: dataRange } = useQuery<{ earliest: string; latest: string; count: number }>({
    queryKey: ['shared-data-range', shareToken, sessionToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/data/range`, { headers: shareHeaders });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!access,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch latest weather data via share token (public, no auth needed)
  const { data: weatherData } = useQuery<WeatherData>({
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
  // Falls back to station's actual data range for historical-only stations
  const { data: historicalData = [] } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'history', chartTimeRange, dataRange?.latest],
    queryFn: async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - chartTimeRange * 60 * 60 * 1000);
      const limit = chartTimeRange > 72 ? 2000 : 1000;
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      // Fallback: if no data in selected range, try station's actual data range
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - chartTimeRange * 60 * 60 * 1000);
        const rangeFallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=${limit}`,
          { headers: shareHeaders }
        );
        if (!rangeFallback.ok) return [];
        return rangeFallback.json();
      }
      return data;
    },
    enabled: !!access,
    refetchInterval: 60000,
  });

  // Separate query for 7-day stats data (always fetches 7 days regardless of chart time range)
  const { data: statsData = [] } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'stats-7d', dataRange?.latest],
    queryFn: async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=500`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=500`,
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

  // Separate 7-day query for dew point chart (always fetches 7 days regardless of chart time range)
  const { data: dewPointData7d = [] } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'dewpoint-7d', dataRange?.latest],
    queryFn: async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000);
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=1500`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
        const fallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=1500`,
          { headers: shareHeaders }
        );
        if (!fallback.ok) return [];
        return fallback.json();
      }
      return data;
    },
    enabled: !!access,
    refetchInterval: 30 * 60 * 1000,
    staleTime: 15 * 60 * 1000,
  });

  // Fetch station info via share token
  const { data: stationData } = useQuery({
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

  // Historical chart range (user-selectable)
  const [historicalChartRange, setHistoricalChartRange] = useState(24);

  // Fetch historical data for the selected time range
  const { data: historicalSectionData = [], isLoading: historicalSectionLoading } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', shareToken, 'historical-section', historicalChartRange, dataRange?.latest],
    queryFn: async () => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - historicalChartRange * 60 * 60 * 1000);
      const limit = historicalChartRange > 72 ? 2000 : 1000;
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=${limit}`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      const data = await res.json();
      if (Array.isArray(data) && data.length === 0 && dataRange?.latest) {
        const rangeEnd = new Date(new Date(dataRange.latest).getTime() + 60000);
        const rangeStart = new Date(rangeEnd.getTime() - historicalChartRange * 60 * 60 * 1000);
        const rangeFallback = await fetch(
          `/api/shares/${shareToken}/data?startTime=${rangeStart.toISOString()}&endTime=${rangeEnd.toISOString()}&limit=${limit}`,
          { headers: shareHeaders }
        );
        if (!rangeFallback.ok) return [];
        return rangeFallback.json();
      }
      return data;
    },
    enabled: !!access,
    refetchInterval: 5 * 60 * 1000,
  });

  // Sort historical data ascending
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

  // Detect available data fields
  const availableFields = useMemo(() => {
    const hasData = (field: keyof WeatherData, allowZero = false) => {
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
      waterLevel: hasData('waterLevel'),
      temperatureSwitch: hasData('temperatureSwitch'),
      chargerVoltage: hasData('chargerVoltage'),
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
    };
  }, [historicalData, weatherData]);

  const station = stationData?.station || { name: access?.name || 'Weather Station', location: 'Unknown' };
  const currentData = weatherData || {} as WeatherData;

  // Process chart data
  const chartData = useMemo(() => processChartData(sortedHistoricalData, chartTimeRange, station?.latitude, station?.altitude, windSpeedUnit), [sortedHistoricalData, chartTimeRange, station?.latitude, station?.altitude, windSpeedUnit]);
  const dewPointChartData = useMemo(() => {
    if (dewPointData7d.length === 0) return [];
    const sorted = [...dewPointData7d].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return processChartData(sorted, 168, station?.latitude, station?.altitude, windSpeedUnit);
  }, [dewPointData7d, station?.latitude, station?.altitude, windSpeedUnit]);

  // Average daytime solar radiation from historical data (for Solar Power Harvesting card)
  const avgDaytimeRadiation = useMemo(() => {
    const nonZero = sortedHistoricalData
      .map(d => d.solarRadiation)
      .filter((v): v is number => v != null && v > 0);
    if (nonZero.length === 0) return null;
    return nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  }, [sortedHistoricalData]);

  const windEnergyData = useMemo(() => processWindEnergyData(sortedHistoricalData, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit, chartTimeRange), [sortedHistoricalData, currentData.airDensity, windSpeedUnit, chartTimeRange]);
  const maxWindSpeed = useMemo(() => {
    const speeds = historicalData.map(d => d.windSpeed ?? 0);
    const defaultMax = windSpeedUnit === 'kmh' ? 90 : 25;
    return Math.max(weatherData?.windGust || 0, ...speeds) || defaultMax;
  }, [historicalData, weatherData?.windGust, windSpeedUnit]);

  // Historical section chart data (separate time range)
  const historicalChartData = useMemo(() => {
    if (historicalSectionData.length === 0) return [];
    const sorted = [...historicalSectionData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return processChartData(sorted, historicalChartRange, station?.latitude, station?.altitude, windSpeedUnit);
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
      return { elevation: 0, azimuth: 0, sunrise: undefined, sunset: undefined, nauticalDawn: undefined, nauticalDusk: undefined, solarNoon: undefined, dayLength: undefined };
    }
    return calculateSolarPosition(station!.latitude!, station!.longitude!);
  }, [station?.latitude, station?.longitude, hasStationCoordinates]);

  // Sea level pressure
  const seaLevelPressure = useMemo(() => {
    return calculateSeaLevelPressure(currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA, station?.altitude || 0, currentData.temperature || DEFAULT_TEMPERATURE_C);
  }, [currentData.pressure, currentData.temperature, station?.altitude]);

  // Rainfall
  const { accumulatedRainfall, isRainfallStale, effectiveRainfall } = useMemo(() => {
    const rainfallReadings = sortedHistoricalData.map(d => d.rainfall).filter((v): v is number => v !== null && v !== undefined);
    if (rainfallReadings.length < 2) {
      const currentRain = currentData.rainfall ?? 0;
      return { accumulatedRainfall: 0, isRainfallStale: false, effectiveRainfall: currentRain };
    }
    const minVal = Math.min(...rainfallReadings);
    const maxVal = Math.max(...rainfallReadings);
    const range = maxVal - minVal;
    const isStale = range < 0.1;
    return { accumulatedRainfall: isStale ? 0 : range, isRainfallStale: isStale, effectiveRainfall: isStale ? 0 : range };
  }, [sortedHistoricalData, currentData.rainfall]);

  // Battery chart data
  const batteryChartData = useMemo(() => {
    const effectiveRange = chartTimeRange || 24;
    if (effectiveRange >= 168 && sortedHistoricalData.length > 0) {
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
  }, [sortedHistoricalData, chartTimeRange]);

  const batteryChargingStatus = useMemo(() => {
    const batteryReadings = sortedHistoricalData.filter(d => d.batteryVoltage != null && d.batteryVoltage > 0);
    if (batteryReadings.length < 2) return { hasData: false, didCharge: true, maxVoltage: 0, minVoltage: 0 };
    const voltages = batteryReadings.map(d => d.batteryVoltage!);
    const maxV = Math.max(...voltages);
    const minV = Math.min(...voltages);
    const didCharge = maxV > 13.0 || (maxV - minV) > 0.3;
    return { hasData: true, didCharge, maxVoltage: maxV, minVoltage: minV };
  }, [sortedHistoricalData]);

  // Temperature statistics (uses independent 7-day stats data)
  const temperatureStats = useMemo(() => {
    const now = referenceNow;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const last24h = dataSource.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last7d = dataSource.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const calc = (data: WeatherData[]) => {
      const temps = data.map(d => d.temperature).filter((t): t is number => t != null && !isNaN(t));
      if (temps.length === 0) return { min: null, max: null, avg: null, range: null };
      const min = Math.min(...temps);
      const max = Math.max(...temps);
      return { min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10, avg: Math.round((temps.reduce((s, t) => s + t, 0) / temps.length) * 10) / 10, range: Math.round((max - min) * 10) / 10 };
    };
    return { '24h': calc(last24h), '7d': calc(last7d) };
  }, [sortedStatsData, sortedHistoricalData, referenceNow]);

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

  // Trends
  const trends = useMemo(() => {
    if (historicalData.length < 2) return { temperature: null, humidity: null, pressure: null };
    const halfLen = Math.floor(historicalData.length / 2);
    const older = historicalData.slice(0, halfLen);
    const avgOldT = older.reduce((s, d) => s + (d.temperature ?? 0), 0) / halfLen;
    const avgOldH = older.reduce((s, d) => s + (d.humidity ?? 0), 0) / halfLen;
    const avgOldP = older.reduce((s, d) => s + (d.pressure ?? 0), 0) / halfLen;
    return {
      temperature: avgOldT !== 0 ? (currentData.temperature ?? 0) - avgOldT : null,
      humidity: avgOldH !== 0 ? (currentData.humidity ?? 0) - avgOldH : null,
      pressure: avgOldP !== 0 ? (currentData.pressure ?? 0) - avgOldP : null,
    };
  }, [historicalData, currentData]);

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
    return calculateAirDensity(currentData.temperature, currentData.pressure, currentData.humidity ?? 50);
  }, [currentData.temperature, currentData.pressure, currentData.humidity]);

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
              <AlertCircle className="h-5 w-5" />
              Not Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
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
            <RefreshCw className="h-8 w-8 mx-auto mb-4 animate-spin text-muted-foreground" />
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
              <AlertCircle className="h-5 w-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
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
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container py-4 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold">{station.name}</h1>
              <p className="text-sm text-muted-foreground">{station.location}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {weatherData?.timestamp && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
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
            <Badge variant="secondary" className="gap-1">
              <Eye className="h-3 w-3" />
              View Only
            </Badge>
            <Button variant="outline" size="sm" disabled={historicalData.length === 0} onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>
      </header>

      {/* Time Range Selector */}
      <div className="border-b bg-card">
        <div className="container py-2 px-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-1">Time Range:</span>
          {[
            { label: '1h', hours: 1 },
            { label: '6h', hours: 6 },
            { label: '12h', hours: 12 },
            { label: '24h', hours: 24 },
            { label: '48h', hours: 48 },
            { label: '7d', hours: 168 },
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
              />
            </Suspense>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-normal">Station Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Station Name</p>
                    <p className="text-sm font-normal">{station.name || 'Not set'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Location</p>
                    <p className="text-sm font-normal">{station.location || 'Not specified'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Latitude</p>
                    <p className="text-sm font-normal">{safeFixed(station.latitude, 6, 'Not set')}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Longitude</p>
                    <p className="text-sm font-normal">{safeFixed(station.longitude, 6, 'Not set')}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Altitude</p>
                    <p className="text-sm font-normal">{station.altitude ? `${station.altitude} m` : 'Not set'}</p>
                  </div>

                </div>
              </CardContent>
            </Card>
          </div>
        </section>
        )}

        {/* Primary Metrics */}
        {(availableFields.temperature || availableFields.humidity || availableFields.pressure || availableFields.windSpeed || availableFields.rainfall) && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-normal text-foreground">Primary Metrics</h2>
            <span className="text-base font-normal text-muted-foreground">(Live data)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {availableFields.temperature && (
            <MetricCard
              title="Temperature"
              value={formatValue(currentData.temperature || 0, 1)}
              unit="°C"
              trend={trends.temperature !== null ? { value: parseFloat(safeFixed(trends.temperature, 1, "0")), label: "vs avg" } : undefined}
              subMetrics={effectiveDewPoint != null ? [{ label: "Dew Point", value: `${formatValue(effectiveDewPoint, 1)} °C` }] : undefined}
              sparklineData={chartData.slice(-12).map(d => d.temperature).filter((v): v is number => v != null)}
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
            {availableFields.windDirection && (
            <MetricCard
              title="Wind Direction"
              value={currentData.windDirection != null ? getWindDirectionLabel(currentData.windDirection) : '--'}
              unit={currentData.windDirection != null ? `${Math.round(currentData.windDirection)}°` : ''}
              subMetrics={(() => {
                const dirs = sortedHistoricalData
                  .filter(d => d.windDirection != null && new Date(d.timestamp).getTime() > referenceNow - 24 * 60 * 60 * 1000)
                  .map(d => d.windDirection!);
                if (dirs.length === 0) return undefined;
                const bins = new Array(16).fill(0);
                dirs.forEach(d => { bins[Math.round(d / 22.5) % 16]++; });
                const dominant = bins.indexOf(Math.max(...bins)) * 22.5;
                return [{ label: "Dominant 24h", value: `${getWindDirectionLabel(dominant)} (${Math.round(dominant)}°)` }];
              })()}
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
              subMetrics={[{ label: "Gust", value: `${formatValue(currentData.windGust || 0, 1)} ${windUnitLabel}` }]}
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
          {availableFields.pressure && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarometricPressureCard
              stationPressure={currentData.pressure || STANDARD_SEA_LEVEL_PRESSURE_HPA}
              seaLevelPressure={seaLevelPressure}
              altitude={station?.altitude || 0}
              temperature={currentData.temperature || DEFAULT_TEMPERATURE_C}
              trend={trends.pressure !== null ? parseFloat(safeFixed(trends.pressure, 1, "0")) : 0}
              sparklineDataStation={chartData.slice(-24).map(d => d.pressure ?? 0).filter((v): v is number => v != null)}
              sparklineDataSeaLevel={chartData.slice(-24).map(d => calculateSeaLevelPressure(d.pressure ?? 0, station?.altitude || 0, d.temperature ?? 20)).filter((v): v is number => v != null)}
            />
            <Suspense fallback={<ChartFallback />}>
            <DataBlockChart title="Barometric Pressure History" data={chartData}
              series={[{ dataKey: "pressure", name: "Station Pressure", color: "#3b82f6", unit: "hPa" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Pressure"
              showAverage={true} showMinMax={true} currentValue={currentData.pressure || 0}
            />
            </Suspense>
          </div>
          )}
        </section>
        )}

        {/* Logger Battery Section */}
        {availableFields.batteryVoltage && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Logger Battery Status</h2>
          {batteryChargingStatus.hasData && !batteryChargingStatus.didCharge && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-medium">Battery Not Charging</p>
                <p className="text-xs text-amber-600">
                  No charging activity detected in the last 24 hours. Voltage range: {batteryChargingStatus.minVoltage.toFixed(2)}V – {batteryChargingStatus.maxVoltage.toFixed(2)}V.
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
            <Suspense fallback={<ChartFallback />}>
            <DataBlockChart title="Battery Voltage History" data={batteryChartData}
              series={[{ dataKey: "batteryVoltage", name: "Battery Voltage", color: "#22c55e", unit: "V" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Voltage"
              showAverage={true} showMinMax={true} currentValue={currentData.batteryVoltage || 0}
              defaultExpanded={false}
            />
            </Suspense>
          </div>
        </section>
        )}

        {/* MPPT Solar Charge Controller */}
        {(availableFields.mpptSolarVoltage || availableFields.mpptSolarPower || availableFields.mpptBatteryVoltage) && (
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
          </div>
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {availableFields.mpptSolarPower && (
            <DataBlockChart title={availableFields.mppt2SolarPower ? "Charger 1 – Solar Power" : "Solar Power"} data={chartData}
              series={[{ dataKey: "mpptSolarPower", name: "Solar Power", color: "#ef4444", unit: "W" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Power"
              showAverage={true} showMinMax={true} currentValue={currentData.mpptSolarPower ?? 0}
              yAxisDomain={[0, 'auto']}
            />
            )}
            {availableFields.mppt2SolarPower && (
            <DataBlockChart title="Charger 2 – Solar Power" data={chartData}
              series={[{ dataKey: "mppt2SolarPower", name: "Solar Power", color: "#3b82f6", unit: "W" }]}
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
        </section>
        )}

        {/* Water & Sensors */}
        {(availableFields.waterLevel || availableFields.temperatureSwitch || availableFields.chargerVoltage) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Water & Sensors</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {availableFields.waterLevel && (
            <MetricCard title="Water Level" value={formatValue(currentData.waterLevel || 0, 1)} unit="mm"
              sparklineData={chartData.slice(-24).map(d => d.waterLevel).filter((v): v is number => v != null)} chartColor="#3b82f6" />
            )}
            {availableFields.temperatureSwitch && (
            <MetricCard title="Temp Switch" value={formatValue(currentData.temperatureSwitch || 0, 1)} unit="mV"
              sparklineData={chartData.slice(-24).map(d => d.temperatureSwitch).filter((v): v is number => v != null)} chartColor="#ef4444" />
            )}
            {availableFields.chargerVoltage && (
            <MetricCard title="Charger Voltage" value={formatValue(currentData.chargerVoltage || 0, 2)} unit="V"
              sparklineData={chartData.slice(-24).map(d => d.chargerVoltage).filter((v): v is number => v != null)} chartColor="#22c55e" />
            )}
          </div>
        </section>
        )}

        {/* Solar Position & Radiation */}
        {(availableFields.solarRadiation || availableFields.uvIndex || (availableFields.temperature && availableFields.pressure) || hasStationCoordinates) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar Position & Radiation</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {hasStationCoordinates && (
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
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {availableFields.solarRadiation && (
            <DataBlockChart title="Solar Radiation" data={chartData}
              series={[{ dataKey: "solar", name: "Solar Radiation", color: "#ef4444", unit: "W/m²" }]}
              chartType="area" xAxisLabel="Time" yAxisLabel="Radiation"
              showAverage={true} showMinMax={true} currentValue={currentData.solarRadiation || 0}
            />
            )}
            {availableFields.solarRadiation && (
            <DataBlockChart title="Reference ETo" data={chartData}
              series={[{ dataKey: "eto", name: "Reference ETo", color: "#22c55e", unit: "mm/day" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="ETo (mm/day)"
              showAverage={true} showMinMax={true} currentValue={currentData.eto ?? calculatedETo ?? 0}
            />
            )}
          </div>
          </Suspense>
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Dew Point Chart (7 days) */}
            {(availableFields.temperature && availableFields.humidity) && dewPointChartData.length > 0 && (
            <DataBlockChart title="Dew Point Temperature (7 days)" data={dewPointChartData}
              series={[{ dataKey: "dewPoint", name: "Dew Point", color: "#3b82f6", unit: "°C" }]}
              chartType="line" xAxisLabel="Time" yAxisLabel="Dew Point (°C)"
              showAverage={true} showMinMax={true} currentValue={effectiveDewPoint ?? 0}
            />
            )}
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
          </div>
          </Suspense>
          {availableFields.solarRadiation && (
          <SolarPowerHarvestCard
            currentRadiation={currentData.solarRadiation}
            dailyAverageRadiation={avgDaytimeRadiation}
            panelEfficiency={0.20}
            systemLosses={0.15}
          />
          )}
        </section>
        )}

        {/* Soil & Environment */}
        {(availableFields.soilTemperature || availableFields.soilMoisture || availableFields.pm25 || availableFields.pm10) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Soil & Environment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {availableFields.soilTemperature && (
            <MetricCard title="Soil Temperature" value={formatValue(currentData.soilTemperature || 0, 1)} unit="°C" chartColor="#ef4444" />
            )}
            {availableFields.soilMoisture && (
            <MetricCard title="Soil Moisture" value={formatValue(currentData.soilMoisture || 0, 1)} unit="%"
              subMetrics={[{ label: "Status", value: (currentData.soilMoisture || 0) < 20 ? "Dry" : (currentData.soilMoisture || 0) < 40 ? "Optimal" : "Wet" }]}
              chartColor="#22c55e" />
            )}
            {availableFields.pm25 && (
            <MetricCard title="PM2.5" value={formatValue(currentData.pm25 || 0, 1)} unit="µg/m³"
              subMetrics={[{ label: "AQI", value: (currentData.pm25 || 0) < 12 ? "Good" : (currentData.pm25 || 0) < 35 ? "Moderate" : "Unhealthy" }]}
              chartColor="#3b82f6" />
            )}
            {availableFields.pm10 && (
            <MetricCard title="PM10" value={formatValue(currentData.pm10 || 0, 1)} unit="µg/m³" chartColor="#22c55e" />
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

        {/* Wind Analysis */}
        {(availableFields.windSpeed || availableFields.windDirection) && (
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

        {/* Wind Energy */}
        {(availableFields.windSpeed || availableFields.windDirection) && (
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
            <MetricCard title="Current Wind Power" value={safeFixed(calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit), 1)} unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.windPower)} chartColor="#22c55e" />
            <MetricCard title="Peak Gust Power" value={safeFixed(calculateWindPower(currentData.windGust || 0, currentData.airDensity || STANDARD_AIR_DENSITY_KGM3, windSpeedUnit), 1)} unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.gustPower)} chartColor="#ef4444" />
            <MetricCard title="Daily Energy Potential" value={safeFixed(windEnergyData.length > 0 ? windEnergyData[windEnergyData.length - 1].cumulativeEnergy : 0, 2)} unit="kWh/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.cumulativeEnergy)} chartColor="#3b82f6" />
          </div>
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
        </section>
        )}

        {/* Fire Danger */}
        {(availableFields.temperature && availableFields.humidity && availableFields.windSpeed) && (
        <section className="space-y-4">
          <Suspense fallback={<ChartFallback />}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FireDangerCard temperature={currentData.temperature!} humidity={currentData.humidity!} windSpeed={currentData.windSpeed!} />
            <FireDangerChart data={fireDangerChartData} title="Fire Danger History" />
          </div>
          </Suspense>
        </section>
        )}

        {/* Rainfall */}
        {availableFields.rainfall && accumulatedRainfall > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Rainfall</h2>
          <Suspense fallback={<ChartFallback />}>
          <DataBlockChart title="Rainfall History" data={chartData}
            series={[{ dataKey: "rain", name: "Rainfall", color: "#3b82f6", unit: "mm" }]}
            chartType="area" xAxisLabel="Time" yAxisLabel="Rainfall"
            showMinMax={true} currentValue={currentData.rainfall || 0}
          />
          </Suspense>
        </section>
        )}

        {/* Historical Data with Time Range Picker */}
        {(chartData.length > 0 || historicalChartData.length > 0) && (
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
                series={[{ dataKey: "pressure", name: "Pressure (hPa)", color: "#3b82f6" }]}
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
        {(availableFields.solarRadiation || availableFields.temperature) && (
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
              ]}
            />
          </div>
        </section>
        )}

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground pt-4 border-t">
          <p className="flex items-center justify-center gap-2">
            <Share2 className="h-4 w-4" />
            Shared Dashboard • Station data: {(() => {
              const ts = new Date((currentData as any)?.collectedAt || currentData?.timestamp);
              if (!currentData?.timestamp || isNaN(ts.getTime())) return 'No data available';
              return ts.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            })()}
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
