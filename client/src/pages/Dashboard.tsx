import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { CurrentConditions } from "@/components/dashboard/CurrentConditions";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { WindRose } from "@/components/charts/WindRose";
import { WindRoseScatter } from "@/components/charts/WindRoseScatter";
import { WindCompass } from "@/components/dashboard/WindCompass";
import { WindPowerCard } from "@/components/dashboard/WindPowerCard";
import { WeatherChart } from "@/components/charts/WeatherChart";
import { DataBlockChart } from "@/components/charts/DataBlockChart";
import { StatisticsCard } from "@/components/dashboard/StatisticsCard";
import { SolarRadiationCard } from "@/components/dashboard/SolarRadiationCard";
import { EToCard } from "@/components/dashboard/EToCard";
import { StationSelector } from "@/components/dashboard/StationSelector";
import { DataImport } from "@/components/dashboard/DataImport";
import { DashboardConfigPanel } from "@/components/dashboard/DashboardConfigPanel";
import { ShareDashboard } from "@/components/dashboard/ShareDashboard";
import { StationInfoPanel } from "@/components/dashboard/StationInfoPanel";
import { StationMapWithErrorBoundary } from "@/components/dashboard/StationMap";
import { SolarPositionCard } from "@/components/dashboard/SolarPositionCard";
import { AirDensityCard } from "@/components/dashboard/AirDensityCard";
import { BatteryVoltageCard } from "@/components/dashboard/BatteryVoltageCard";
import { BarometricPressureCard } from "@/components/dashboard/BarometricPressureCard";
import { EvapotranspirationCard } from "@/components/dashboard/EvapotranspirationCard";
import { SolarPowerHarvestCard } from "@/components/dashboard/SolarPowerHarvestCard";
import { FireDangerCard } from "@/components/dashboard/FireDangerCard";
import { FireDangerChart } from "@/components/charts/FireDangerChart";
import { NoDataWrapper, hasValidData } from "@/components/dashboard/NoDataWrapper";
import { safeFixed } from "@/lib/utils";
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
const processWindRoseData = (historicalData: WeatherData[]) => {
  // 16 direction bins (N, NNE, NE, etc.)
  const windRoseData = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    speeds: [0, 0, 0, 0, 0, 0], // 6 speed classes (calm, light, gentle, moderate, fresh, strong)
  }));

  historicalData.forEach(data => {
    if (data.windDirection == null || data.windSpeed == null) return;
    
    // Determine direction bin (0-15)
    const dirBin = Math.round(data.windDirection / 22.5) % 16;
    
    // Determine speed class (WMO simplified)
    const speed = data.windSpeed;
    let speedClass = 0;
    if (speed < 1) speedClass = 0;       // Calm
    else if (speed < 12) speedClass = 1; // Light
    else if (speed < 20) speedClass = 2; // Gentle
    else if (speed < 29) speedClass = 3; // Moderate
    else if (speed < 39) speedClass = 4; // Fresh
    else speedClass = 5;                 // Strong+
    
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
const processChartData = (historicalData: WeatherData[], timeRangeHours?: number) => {
  if (historicalData.length === 0) return [];
  
  // Sample data if there are too many points (target ~500 points max for smooth charts)
  const maxPoints = 500;
  let sampledData = historicalData;
  if (historicalData.length > maxPoints) {
    const sampleRate = Math.ceil(historicalData.length / maxPoints);
    sampledData = historicalData.filter((_, index) => index % sampleRate === 0);
  }
  
  // Determine the time span of the data
  const timestamps = sampledData.map(d => new Date(d.timestamp).getTime());
  const dataSpanHours = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60);
  const effectiveRange = timeRangeHours || dataSpanHours;
  
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
    } else if (effectiveRange <= 168) {
      // 3-7 days: show Day DD HH:00
      return date.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric" }) + " " +
             date.toLocaleTimeString("en-ZA", { hour: "2-digit", hour12: false });
    } else if (effectiveRange <= 720) {
      // 7-30 days: show DD/MM HH:00
      return date.toLocaleDateString("en-ZA", { month: "numeric", day: "numeric" }) + " " +
             date.toLocaleTimeString("en-ZA", { hour: "2-digit", hour12: false });
    } else {
      // Over 30 days: show DD MMM
      return date.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
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
      temperature: d.temperature ?? 0,
      humidity: d.humidity ?? 0,
      pressure: d.pressure ?? 0,
      windSpeed: d.windSpeed ?? 0,
      solar: Math.max(d.solarRadiation ?? 0, 0),
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
    };
  });
};

/**
 * Process historical data into wind energy format
 * Calculates wind power density using P = 0.5 * ρ * v³
 */
const processWindEnergyData = (historicalData: WeatherData[], density: number = 1.225) => {
  let cumulativeEnergy = 0;
  
  return historicalData.map((d, i) => {
    const windSpeed = d.windSpeed ?? 0;
    const windGust = d.windGust ?? windSpeed; // Fall back to windSpeed if no gust data
    const speedMs = windSpeed / 3.6; // Convert km/h to m/s
    const gustMs = windGust / 3.6; // Convert gust km/h to m/s
    const windPower = 0.5 * density * Math.pow(speedMs, 3); // W/m²
    const gustPower = 0.5 * density * Math.pow(gustMs, 3); // W/m² for gusts
    
    // Calculate actual interval in hours from data timestamps
    let intervalHours = 1; // default fallback
    if (i > 0 && d.timestamp && historicalData[i - 1].timestamp) {
      const dtMs = new Date(d.timestamp).getTime() - new Date(historicalData[i - 1].timestamp).getTime();
      intervalHours = Math.max(dtMs / 3_600_000, 0); // convert ms to hours, clamp ≥0
    } else if (historicalData.length > 1) {
      // Estimate from total span for the first point
      const first = new Date(historicalData[0].timestamp).getTime();
      const last = new Date(historicalData[historicalData.length - 1].timestamp).getTime();
      intervalHours = (last - first) / 3_600_000 / Math.max(historicalData.length - 1, 1);
    }
    
    cumulativeEnergy += (windPower * intervalHours) / 1000; // kWh/m²
    
    return {
      timestamp: new Date(d.timestamp).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
      windSpeed,
      windGust,
      windPower,
      gustPower,
      cumulativeEnergy,
    };
  });
};

/**
 * Calculate wind power density using P = 0.5 * ρ * v³
 * @param windSpeed Wind speed in km/h
 * @param airDensity Air density in kg/m³ (default 1.225)
 * @returns Power density in W/m²
 */
const calculateWindPower = (windSpeed: number, airDensity: number = 1.225): number => {
  const speedMs = windSpeed / 3.6; // Convert km/h to m/s
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
    // Load config from localStorage if available
    const saved = localStorage.getItem('dashboardConfig');
    return saved ? JSON.parse(saved) : DEFAULT_DASHBOARD_CONFIG;
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allStations = [], isLoading: stationsLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  // Filter stations based on user access
  const stations = useMemo(() => {
    if (isAdmin) return allStations;
    if (!canAccessStation) return allStations;
    return allStations.filter(s => canAccessStation(s.id));
  }, [allStations, isAdmin, canAccessStation]);

  const activeStationId = selectedStationId || (stations.length > 0 ? stations[0].id : null);

  const { data: latestData, isLoading: dataLoading, refetch } = useQuery<WeatherData>({
    queryKey: ["/api/stations", activeStationId, "data", "latest"],
    enabled: !!activeStationId,
    refetchInterval: dashboardConfig.updatePeriod * 1000, // Auto-refresh based on config
  });

  // Fetch historical data for charts and wind roses (based on configured time range)
  const { data: historicalData = [], isLoading: historicalLoading, refetch: refetchHistorical } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "history", dashboardConfig.chartTimeRange],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - dashboardConfig.chartTimeRange * 60 * 60 * 1000);
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}`
      );
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!activeStationId,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 120) * 1000, // Min 2min for historical charts
    staleTime: 60 * 1000, // Consider data fresh for 60 seconds to prevent rapid re-fetches
    placeholderData: keepPreviousData, // Show previous data while new range loads
  });

  // Separate query for 7-day stats data (always fetches 7 days regardless of chart time range)
  const statsTimeRangeHours = 7 * 24; // 168 hours = 7 days
  const { data: statsData = [] } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "stats-7d"],
    queryFn: async () => {
      if (!activeStationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - statsTimeRangeHours * 60 * 60 * 1000);
      const response = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}`
      );
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!activeStationId,
    refetchInterval: Math.max(dashboardConfig.updatePeriod, 300) * 1000, // Min 5min for stats refresh
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes — stats data changes slowly
  });

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
    if (historicalData.length === 0) {
      return {
        temperature: false,
        humidity: false,
        pressure: false,
        windSpeed: false,
        windDirection: false,
        solarRadiation: false,
        rainfall: false,
        dewPoint: false,
        airDensity: false,
        uvIndex: false,
        pm25: false,
        pm10: false,
        soilTemperature: false,
        soilMoisture: false,
        batteryVoltage: false,
        waterLevel: false,
        temperatureSwitch: false,
        levelSwitch: false,
        temperatureSwitchOutlet: false,
        levelSwitchStatus: false,
        lightning: false,
        chargerVoltage: false,
        windDirStdDev: false,
        sdi12WindVector: false,
        pumpSelectWell: false,
        pumpSelectBore: false,
        portStatusC1: false,
        portStatusC2: false,
      };
    }
    
    // Check if field has at least some non-null values
    const hasData = (field: keyof WeatherData) => {
      return historicalData.some(d => d[field] !== null && d[field] !== undefined);
    };
    
    return {
      temperature: hasData('temperature'),
      humidity: hasData('humidity'),
      pressure: hasData('pressure'),
      windSpeed: hasData('windSpeed'),
      windDirection: hasData('windDirection'),
      solarRadiation: hasData('solarRadiation'),
      rainfall: hasData('rainfall'),
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
    };
  }, [historicalData]);

  // Sort historical data by timestamp ascending (oldest to newest) for charts to display correctly
  const sortedHistoricalData = useMemo(() => {
    if (historicalData.length === 0) return [];
    return [...historicalData].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [historicalData]);

  // Process historical data into chart format (pass time range for proper axis formatting)
  const chartData = useMemo(() => processChartData(sortedHistoricalData, dashboardConfig.chartTimeRange), [sortedHistoricalData, dashboardConfig.chartTimeRange]);
  
  // Process wind rose data from historical data
  const windRoseData = useMemo(() => processWindRoseData(sortedHistoricalData), [sortedHistoricalData]);
  
  // Process wind scatter data from historical data
  const windScatterData = useMemo(() => processWindScatterData(sortedHistoricalData), [sortedHistoricalData]);

  // Process wind data for different time periods (60min, 24h, 48h, 7d, 31d)
  const windDataByPeriod = useMemo(() => {
    const now = Date.now();
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
    // Use sortedStatsData (7-day dataset) for 7d/31d wind periods so they have real data
    const windDataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const last7d = windDataSource.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last31d = windDataSource.filter(d => new Date(d.timestamp).getTime() > thirtyOneDaysAgo);
    
    return {
      '30min': {
        rose: processWindRoseData(last30Min),
        scatter: processWindScatterData(last30Min),
        count: last30Min.length
      },
      '60min': {
        rose: processWindRoseData(last60Min),
        scatter: processWindScatterData(last60Min),
        count: last60Min.length
      },
      '24h': {
        rose: processWindRoseData(last24h),
        scatter: processWindScatterData(last24h),
        count: last24h.length
      },
      '48h': {
        rose: processWindRoseData(last48h),
        scatter: processWindScatterData(last48h),
        count: last48h.length
      },
      '7d': {
        rose: processWindRoseData(last7d),
        scatter: processWindScatterData(last7d),
        count: last7d.length
      },
      '31d': {
        rose: processWindRoseData(last31d),
        scatter: processWindScatterData(last31d),
        count: last31d.length
      },
      'configured': {
        rose: windRoseData,
        scatter: windScatterData,
        count: sortedHistoricalData.length
      }
    };
  }, [sortedHistoricalData, sortedStatsData, windRoseData, windScatterData]);

  // Calculate temperature statistics for 24h and 7d periods (uses 7-day stats data)
  const temperatureStats = useMemo(() => {
    const now = Date.now();
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
  }, [sortedStatsData, sortedHistoricalData]);

  // Calculate solar radiation statistics from historical data
  const solarStats = useMemo(() => {
    const now = Date.now();
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
  }, [sortedHistoricalData]);

  // Calculate ETo statistics from historical data (uses 7-day stats data)
  const etoStats = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Use sortedStatsData (7-day dataset) for more accurate period stats
    const dataSource = sortedStatsData.length > 0 ? sortedStatsData : sortedHistoricalData;
    const last24h = dataSource.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last7d = dataSource.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last30d = dataSource.filter(d => new Date(d.timestamp).getTime() > thirtyDaysAgo);

    // Calculate cumulative ETo for each period
    const calculateCumulativeETo = (data: WeatherData[]) => {
      const etoValues = data
        .map(d => d.eto)
        .filter((e): e is number => e !== null && e !== undefined && !isNaN(e));
      
      if (etoValues.length === 0) return null;
      
      // Sum up ETo values (assumes each reading is hourly increment)
      return Math.round(etoValues.reduce((sum, e) => sum + e, 0) * 10) / 10;
    };

    return {
      daily: calculateCumulativeETo(last24h),
      weekly: calculateCumulativeETo(last7d),
      monthly: calculateCumulativeETo(last30d),
    };
  }, [sortedStatsData, sortedHistoricalData]);

  // Save config to localStorage and invalidate queries when it changes
  const handleConfigChange = useCallback((newConfig: DashboardConfig) => {
    setDashboardConfig(newConfig);
    localStorage.setItem('dashboardConfig', JSON.stringify(newConfig));
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

  const selectedStation = stations.find(s => s.id === activeStationId);


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
  // RIKA stations report SLP as pressure — need to handle differently
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
    const rawPressure = currentData.pressure || 1013.25;
    // For RIKA, pressure is SLP — convert to station pressure for density calc
    const stationPressure = isRikaStation
      ? calculateStationPressure(rawPressure, selectedStation?.altitude || 0, currentData.temperature || 20)
      : rawPressure;
    return calculateAirDensity(
      currentData.temperature || 20,
      stationPressure,
      currentData.humidity || 50
    );
  }, [currentData.temperature, currentData.pressure, currentData.humidity, isRikaStation, selectedStation?.altitude]);

  // Process wind energy data from historical data (must be after calculatedAirDensity)
  const windEnergyData = useMemo(() => processWindEnergyData(sortedHistoricalData, calculatedAirDensity), [sortedHistoricalData, calculatedAirDensity]);

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
  // Only produce a value when there's actual data — never fall back to 0
  const effectiveDewPoint = currentData.dewPoint ?? calculatedDewPoint ?? null;

  // Calculate sea level pressure
  // RIKA stations report SLP (sea-level corrected pressure) as type_code 3003,
  // so we use it directly as SLP and reverse-calculate station pressure
  const seaLevelPressure = useMemo(() => {
    const altitude = selectedStation?.altitude || 0;
    if (isRikaStation) {
      // RIKA pressure IS already SLP — use it directly
      return currentData.pressure || 1013.25;
    }
    return calculateSeaLevelPressure(
      currentData.pressure || 1013.25,
      altitude,
      currentData.temperature || 20
    );
  }, [currentData.pressure, currentData.temperature, selectedStation?.altitude, isRikaStation]);

  // For RIKA stations, derive station pressure from SLP
  const effectiveStationPressure = useMemo(() => {
    if (isRikaStation) {
      const altitude = selectedStation?.altitude || 0;
      return calculateStationPressure(
        currentData.pressure || 1013.25,
        altitude,
        currentData.temperature || 20
      );
    }
    return currentData.pressure || 1013.25;
  }, [currentData.pressure, currentData.temperature, selectedStation?.altitude, isRikaStation]);

  // Calculate reference evapotranspiration
  const calculatedETo = useMemo(() => {
    const lat = selectedStation?.latitude || 0;
    const altitude = selectedStation?.altitude || 0;
    const dayOfYear = getDayOfYear();
    // Convert solar radiation from W/m² to MJ/m²/day (assuming 12hr daylight average)
    const solarMJ = wattsToMJPerDay(currentData.solarRadiation || 0, 12);
    // Convert wind speed from km/h to m/s
    const windMs = kmhToMs(currentData.windSpeed || 0);
    
    return calculateETo(
      currentData.temperature || 20,
      currentData.humidity || 50,
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
      const fd = calculateFireDanger(d.temperature, d.humidity, d.windSpeed);
      return {
        timestamp: d.timestamp,
        ffdi: fd.ffdi,
        gfdi: fd.grasslandFDI,
        temperature: d.temperature,
        humidity: d.humidity,
        windSpeed: d.windSpeed,
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
    const now = Date.now();
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
    // the station is likely sending cumulative rainfall that hasn't changed — treat as no rain
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
    return sortedHistoricalData.map(d => ({
      timestamp: new Date(d.timestamp).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
      batteryVoltage: d.batteryVoltage ?? 0,
    }));
  }, [sortedHistoricalData]);

  // Battery charging daily check — detect if battery charged in the last 24h
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

  const sparkline = chartData.slice(-12).map(d => d.temperature);
  
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
          <h2 className="text-base font-normal text-muted-foreground">No Stations Assigned</h2>
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
            <h2 className="text-base font-normal mb-2">No Weather Stations</h2>
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
        <CurrentConditions
          stationName={selectedStation?.name || "Weather Station"}
          lastUpdate={((currentData as any).collectedAt || currentData.timestamp) ? new Date((currentData as any).collectedAt || currentData.timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false }) : "No data"}
          temperature={currentData.temperature ?? undefined}
          humidity={currentData.humidity ?? undefined}
          pressure={currentData.pressure ?? undefined}
          windSpeed={currentData.windSpeed ?? undefined}
          windGust={currentData.windGust ?? undefined}
          windDirection={currentData.windDirection ?? undefined}
          solarRadiation={currentData.solarRadiation ?? undefined}
          rainfall={currentData.rainfall ?? undefined}
          dewPoint={effectiveDewPoint != null && effectiveDewPoint !== 0 ? effectiveDewPoint : undefined}
          isOnline={selectedStation?.isActive || false}
          connectionType={selectedStation?.connectionType ?? undefined}
          syncInterval={3600000} // 1 hour Dropbox sync interval
          latitude={selectedStation?.latitude ?? undefined}
          longitude={selectedStation?.longitude ?? undefined}
        />

        {/* Station Location Map */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Station Location</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <StationMapWithErrorBoundary
              key={`map-${selectedStation?.id || 'default'}-${selectedStation?.latitude ?? 'nolat'}-${selectedStation?.longitude ?? 'nolng'}`}
              latitude={selectedStation?.latitude ?? undefined}
              longitude={selectedStation?.longitude ?? undefined}
              stationName={selectedStation?.name || "Weather Station"}
              altitude={selectedStation?.altitude ?? undefined}
            />
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

        {/* Primary Metrics - Only show cards with data */}
        {(hasValidData(currentData.temperature) || hasValidData(currentData.humidity) || hasValidData(currentData.pressure) || hasValidData(currentData.windSpeed) || hasValidData(currentData.rainfall)) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Primary Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {hasValidData(currentData.temperature) && (
            <MetricCard
              title="Temperature"
              value={formatValue(currentData.temperature || 0, 1)}
              unit="°C"
              trend={trends.temperature !== null ? { value: parseFloat(safeFixed(trends.temperature, 1, "0")), label: "vs avg" } : undefined}
              sparklineData={sparkline}
              chartColor="#ef4444"
            />
            )}
            {hasValidData(currentData.humidity) && (
            <MetricCard
              title="Humidity"
              value={formatValue(currentData.humidity || 0, 1)}
              unit="%"
              trend={trends.humidity !== null ? { value: parseFloat(safeFixed(trends.humidity, 1, "0")), label: "vs avg" } : undefined}
              sparklineData={chartData.slice(-12).map(d => d.humidity)}
              chartColor="#3b82f6"
            />
            )}
            {effectiveDewPoint != null && (
              <MetricCard
                title="Dew Point"
                value={formatValue(effectiveDewPoint, 1)}
                unit="°C"
                chartColor="#06b6d4"
              />
            )}
            {hasValidData(currentData.pressure) && (
            <MetricCard
              title="Pressure"
              value={formatValue(currentData.pressure || 0, 1)}
              unit="hPa"
              trend={trends.pressure !== null ? { value: parseFloat(safeFixed(trends.pressure, 1, "0")), label: "vs avg" } : undefined}
              sparklineData={chartData.slice(-12).map(d => d.pressure)}
              chartColor="#8b5cf6"
            />
            )}
            {hasValidData(currentData.windSpeed) && (
            <MetricCard
              title="Wind Speed"
              value={formatValue(currentData.windSpeed || 0, 1)}
              unit="km/h"
              subMetrics={[
                { label: "Gust", value: `${formatValue(currentData.windGust || 0, 1)} km/h` },
              ]}
              sparklineData={chartData.slice(-12).map(d => d.windSpeed)}
              chartColor="#14b8a6"
            />
            )}
            {hasValidData(currentData.rainfall) && (
            <MetricCard
              title="Rainfall (24h)"
              value={formatValue(effectiveRainfall, 2)}
              unit="mm"
              subMetrics={[
                { label: "Period Total", value: `${formatValue(accumulatedRainfall, 1)} mm` },
                ...(isRainfallStale ? [{ label: "Status", value: "No change detected" }] : []),
              ]}
              sparklineData={chartData.slice(-12).map(d => d.rain)}
              chartColor="#0ea5e9"
            />
            )}
          </div>
          
          {/* Primary Metrics Dedicated Charts - Grid Layout */}
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
                title="Humidity"
                data={chartData}
              series={[
                { dataKey: "humidity", name: "Humidity", color: "#3b82f6", unit: "%" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Humidity"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.humidity || 0}
              trend={trends.humidity !== null ? { value: parseFloat(safeFixed(trends.humidity, 1, "0")), label: "vs avg" } : undefined}
            />
            )}
          </div>
          
          {/* Barometric Pressure Section with Sea Level and Station Level */}
          {availableFields.pressure && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarometricPressureCard
              stationPressure={effectiveStationPressure}
              seaLevelPressure={seaLevelPressure}
              altitude={selectedStation?.altitude || 0}
              temperature={currentData.temperature || 20}
              trend={trends.pressure !== null ? parseFloat(safeFixed(trends.pressure, 1, "0")) : 0}
              sparklineDataStation={chartData.slice(-24).map(d => isRikaStation ? calculateStationPressure(d.pressure, selectedStation?.altitude || 0, d.temperature ?? 20) : d.pressure)}
              sparklineDataSeaLevel={chartData.slice(-24).map(d => isRikaStation ? d.pressure : calculateSeaLevelPressure(d.pressure, selectedStation?.altitude || 0, d.temperature ?? 20))}
            />
            <DataBlockChart
              title="Barometric Pressure History"
              data={chartData}
              series={[
                { dataKey: "pressure", name: "Station Pressure", color: "#8b5cf6", unit: "hPa" },
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
        {dashboardConfig.sectionVisibility?.loggerBattery !== false && hasValidData(currentData.batteryVoltage) && (
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <BatteryVoltageCard
              voltage={currentData.batteryVoltage || 0}
              minVoltage={11.5}
              maxVoltage={14.5}
              isCharging={currentData.batteryVoltage ? currentData.batteryVoltage > 13.5 : false}
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
            />
            {hasValidData(currentData.panelTemperature) && (
            <MetricCard
              title="Panel Temperature"
              value={formatValue(currentData.panelTemperature || 0, 1)}
              unit="°C"
              chartColor="#f97316"
            />
            )}
          </div>
        </section>
        )}

        {/* Water & Sensors Section - Only show if any water/sensor data exists AND section enabled */}
        {dashboardConfig.sectionVisibility?.waterSensors !== false && (availableFields.waterLevel || availableFields.temperatureSwitch || availableFields.levelSwitch || availableFields.temperatureSwitchOutlet || availableFields.levelSwitchStatus || availableFields.lightning || availableFields.chargerVoltage) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Water & Sensors</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {hasValidData(currentData.waterLevel) && (
              <MetricCard
                title="Water Level"
                value={formatValue(currentData.waterLevel || 0, 2)}
                unit="m"
                sparklineData={chartData.slice(-24).map(d => d.waterLevel).filter((v): v is number => v != null)}
                chartColor="#3b82f6"
              />
            )}
            {hasValidData(currentData.temperatureSwitch) && (
              <MetricCard
                title="Temp Switch"
                value={formatValue(currentData.temperatureSwitch || 0, 2)}
                unit="°C"
                sparklineData={chartData.slice(-24).map(d => d.temperatureSwitch).filter((v): v is number => v != null)}
                chartColor="#ef4444"
              />
            )}
            {hasValidData(currentData.levelSwitch) && (
              <MetricCard
                title="Level Switch"
                value={formatValue(currentData.levelSwitch || 0, 0)}
                unit=""
                chartColor="#22c55e"
              />
            )}
            {hasValidData(currentData.temperatureSwitchOutlet) && (
              <MetricCard
                title="Temp Switch Outlet"
                value={formatValue(currentData.temperatureSwitchOutlet || 0, 1)}
                unit="°C"
                sparklineData={chartData.slice(-24).map(d => d.temperatureSwitchOutlet).filter((v): v is number => v != null)}
                chartColor="#f97316"
              />
            )}
            {hasValidData(currentData.levelSwitchStatus) && (
              <MetricCard
                title="Level Switch Status"
                value={formatValue(currentData.levelSwitchStatus || 0, 0)}
                unit=""
                chartColor="#8b5cf6"
              />
            )}
            {hasValidData(currentData.lightning) && (
              <MetricCard
                title="Lightning"
                value={formatValue(currentData.lightning || 0, 0)}
                unit="strikes"
                sparklineData={chartData.slice(-24).map(d => d.lightning).filter((v): v is number => v != null)}
                chartColor="#eab308"
              />
            )}
            {hasValidData(currentData.chargerVoltage) && (
              <MetricCard
                title="Charger Voltage"
                value={formatValue(currentData.chargerVoltage || 0, 2)}
                unit="V"
                sparklineData={chartData.slice(-24).map(d => d.chargerVoltage).filter((v): v is number => v != null)}
                chartColor="#10b981"
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
                { dataKey: "waterLevel", name: "Water Level", color: "#3b82f6", unit: "m" },
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
                { dataKey: "temperatureSwitch", name: "Temp Switch", color: "#ef4444", unit: "°C" },
                ...(availableFields.temperatureSwitchOutlet ? [{ dataKey: "temperatureSwitchOutlet", name: "Temp Switch Outlet", color: "#f97316", unit: "°C" }] : []),
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Temperature"
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
        {dashboardConfig.sectionVisibility?.solarRadiation !== false && (hasStationCoordinates || hasValidData(currentData.solarRadiation) || hasValidData(currentData.uvIndex) || availableFields.solarRadiation) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar Position & Radiation</h2>
          
          {/* Solar Position and Air Density Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            {(hasValidData(currentData.temperature) && hasValidData(currentData.pressure)) && (
            <AirDensityCard
              airDensity={currentData.airDensity || calculatedAirDensity}
              temperature={currentData.temperature ?? undefined}
              pressure={currentData.pressure ?? undefined}
              humidity={currentData.humidity ?? undefined}
            />
            )}
            {(hasValidData(currentData.temperature) && hasValidData(currentData.humidity)) && (
            <EvapotranspirationCard
              currentETo={(currentData.eto ?? calculatedETo ?? etoStats.daily ?? 0) / 24}
              dailyETo={currentData.eto ?? calculatedETo ?? etoStats.daily ?? 0}
              weeklyETo={etoStats.weekly ?? 0}
              monthlyETo={etoStats.monthly ?? 0}
            />
            )}
          </div>
          
          {/* Solar Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {hasStationCoordinates && (
            <MetricCard
              title="Sun Elevation"
              value={formatValue(solarPosition.elevation, 1)}
              unit="°"
              chartColor="#f59e0b"
            />
            )}
            {hasStationCoordinates && (
            <MetricCard
              title="Sun Azimuth"
              value={formatValue(solarPosition.azimuth, 1)}
              unit="°"
              chartColor="#fb923c"
            />
            )}
            {hasValidData(currentData.solarRadiation) && (
            <MetricCard
              title="Solar Radiation"
              value={formatValue(currentData.solarRadiation || 0, 0)}
              unit="W/m²"
              sparklineData={chartData.slice(-12).map(d => d.solar)}
              chartColor="#f59e0b"
            />
            )}
            {hasValidData(currentData.uvIndex) && (
              <MetricCard
                title="UV Index"
                value={formatValue(currentData.uvIndex || 0, 1)}
                unit=""
                subMetrics={[
                  { label: "Risk", value: (currentData.uvIndex || 0) < 3 ? "Low" : (currentData.uvIndex || 0) < 6 ? "Moderate" : "High" },
                ]}
                chartColor="#dc2626"
              />
            )}
            {(hasValidData(currentData.temperature) && hasValidData(currentData.humidity)) && (
            <MetricCard
              title="Reference ETo"
              value={formatValue(currentData.eto || calculatedETo, 2)}
              unit="mm/day"
              chartColor="#22c55e"
            />
            )}
            {(hasValidData(currentData.temperature) && hasValidData(currentData.pressure)) && (
            <MetricCard
              title="Air Density"
              value={formatValue(currentData.airDensity || calculatedAirDensity, 3)}
              unit="kg/m³"
              chartColor="#64748b"
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
                { dataKey: "solar", name: "Solar Radiation", color: "#f59e0b", unit: "W/m²" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Radiation"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.solarRadiation || 0}
            />
            )}
            {/* Sun Elevation Chart - Calculated from station coordinates */}
            {hasStationCoordinates && (
            <DataBlockChart
              title="Sun Elevation (24h)"
              data={(() => {
                const lat = selectedStation?.latitude || 0;
                const lon = selectedStation?.longitude || 0;
                const now = new Date();
                const points = [];
                for (let h = 0; h < 24; h++) {
                  const time = new Date(now);
                  time.setHours(h, 0, 0, 0);
                  const dayOfYear = Math.floor((time.getTime() - new Date(time.getFullYear(), 0, 0).getTime()) / 86400000);
                  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
                  const hourAngle = 15 * (h - 12 + (lon / 15));
                  const elevation = Math.asin(
                    Math.sin(lat * Math.PI / 180) * Math.sin(declination * Math.PI / 180) +
                    Math.cos(lat * Math.PI / 180) * Math.cos(declination * Math.PI / 180) * Math.cos(hourAngle * Math.PI / 180)
                  ) * 180 / Math.PI;
                  points.push({
                    timestamp: time.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
                    sunElevation: Math.max(-20, elevation)
                  });
                }
                return points;
              })()}
              series={[
                { dataKey: "sunElevation", name: "Sun Elevation", color: "#fb923c", unit: "°" },
              ]}
              chartType="area"
              xAxisLabel="Time"
              yAxisLabel="Elevation"
              showAverage={false}
              showMinMax={true}
              currentValue={solarPosition.elevation}
            />
            )}
          </div>

          {/* Solar Power Harvesting Potential - only show when solar radiation data available */}
          {availableFields.solarRadiation && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SolarPowerHarvestCard
              currentRadiation={hasValidData(currentData.solarRadiation) ? currentData.solarRadiation : null}
              panelEfficiency={0.20}
              systemLosses={0.15}
            />
          </div>
          )}
        </section>
        )}

        {/* Station Status Section - Battery */}
        {hasValidData(currentData.batteryVoltage) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Station Status</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <MetricCard
              title="Battery Voltage"
              value={formatValue(currentData.batteryVoltage || 0, 2)}
              unit="V"
              subMetrics={[
                { label: "Status", value: (currentData.batteryVoltage || 0) > 12.5 ? "Good" : (currentData.batteryVoltage || 0) > 11.5 ? "Low" : "Critical" },
              ]}
              chartColor="#22c55e"
            />
          </div>
        </section>
        )}

        {/* Soil & Environment Section - Only show if any soil/air quality data exists */}
        {dashboardConfig.sectionVisibility?.soilEnvironment !== false && (hasValidData(currentData.soilTemperature) || hasValidData(currentData.soilMoisture) || hasValidData(currentData.pm25) || hasValidData(currentData.pm10)) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Soil & Environment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {hasValidData(currentData.soilTemperature) && (
            <MetricCard
              title="Soil Temperature"
              value={formatValue(currentData.soilTemperature || 0, 1)}
              unit="°C"
              chartColor="#a16207"
            />
            )}
            {hasValidData(currentData.soilMoisture) && (
            <MetricCard
              title="Soil Moisture"
              value={formatValue(currentData.soilMoisture || 0, 1)}
              unit="%"
              subMetrics={[
                { label: "Status", value: (currentData.soilMoisture || 0) < 20 ? "Dry" : (currentData.soilMoisture || 0) < 40 ? "Optimal" : "Wet" },
              ]}
              chartColor="#15803d"
            />
            )}
            {hasValidData(currentData.pm25) && (
            <MetricCard
              title="PM2.5"
              value={formatValue(currentData.pm25 || 0, 1)}
              unit="µg/m³"
              subMetrics={[
                { label: "AQI", value: (currentData.pm25 || 0) < 12 ? "Good" : (currentData.pm25 || 0) < 35 ? "Moderate" : "Unhealthy" },
              ]}
              chartColor="#6b7280"
            />
            )}
            {hasValidData(currentData.pm10) && (
            <MetricCard
              title="PM10"
              value={formatValue(currentData.pm10 || 0, 1)}
              unit="µg/m³"
              chartColor="#9ca3af"
            />
            )}
          </div>
          
          {/* Soil Charts - Only show if soil data available */}
          {(hasValidData(currentData.soilTemperature) || hasValidData(currentData.soilMoisture)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {hasValidData(currentData.soilTemperature) && (
            <DataBlockChart
              title="Soil Temperature"
              data={chartData.filter(d => d.soilTemperature !== null).map(d => ({ ...d, soilTemp: d.soilTemperature }))}
              series={[
                { dataKey: "soilTemp", name: "Soil Temp", color: "#a16207", unit: "°C" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="Temperature"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.soilTemperature || 0}
            />
            )}
            {hasValidData(currentData.soilMoisture) && (
            <DataBlockChart
              title="Soil Moisture"
              data={chartData.filter(d => d.soilMoisture !== null).map(d => ({ ...d, soilMoist: d.soilMoisture }))}
              series={[
                { dataKey: "soilMoist", name: "Moisture", color: "#15803d", unit: "%" },
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
          {(hasValidData(currentData.pm10) || hasValidData(currentData.pm25)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {hasValidData(currentData.pm10) && (
            <DataBlockChart
              title="PM10 History"
              data={chartData.filter(d => d.pm10 !== null && d.pm10 !== undefined).map(d => ({ ...d, pm10Val: d.pm10 }))}
              series={[
                { dataKey: "pm10Val", name: "PM10", color: "#ef4444", unit: "µg/m³" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="PM10 (µg/m³)"
              showAverage={true}
              showMinMax={true}
              currentValue={currentData.pm10 || 0}
            />
            )}
            {hasValidData(currentData.pm25) && (
            <DataBlockChart
              title="PM2.5 History"
              data={chartData.filter(d => d.pm25 !== null && d.pm25 !== undefined).map(d => ({ ...d, pm25Val: d.pm25 }))}
              series={[
                { dataKey: "pm25Val", name: "PM2.5", color: "#dc2626", unit: "µg/m³" },
              ]}
              chartType="line"
              xAxisLabel="Time"
              yAxisLabel="PM2.5 (µg/m³)"
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
        {dashboardConfig.sectionVisibility?.windAnalysis !== false && (availableFields.windSpeed || availableFields.windDirection) && (
        <section className="space-y-6">
          <h2 className="text-base font-normal text-foreground">Wind Analysis (WMO/Beaufort Scale)</h2>
          
          {/* Wind Compass and Wind Roses */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {hasValidData(currentData.windDirection) ? (
            <WindCompass
              direction={currentData.windDirection || 0}
              speed={currentData.windSpeed || 0}
              gust={currentData.windGust ?? undefined}
              unit="km/h"
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
            />
            )}
            
            {/* Wind Rose - 60 Minutes */}
            {windDataByPeriod['60min'].count > 0 && (
            <WindRose 
              data={windDataByPeriod['60min'].rose} 
              title="Wind Rose (60 min)"
              maxWindSpeed={maxWindSpeed}
            />
            )}
            
            {/* Wind Rose - 24h */}
            {windDataByPeriod['24h'].count > 0 && (
            <WindRose 
              data={windDataByPeriod['24h'].rose} 
              title="Wind Rose (24h)"
              maxWindSpeed={maxWindSpeed}
            />
            )}
          </div>
          
          {/* Additional Wind Rose - 48h when more data available */}
          {windDataByPeriod['48h'].count > windDataByPeriod['24h'].count && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <WindRose 
                data={windDataByPeriod['48h'].rose} 
                title="Wind Rose (48h)"
                maxWindSpeed={maxWindSpeed}
              />
            </div>
          )}
          
          {/* Extended Period Wind Roses - Show 7-day and 31-day roses when time range > 24h */}
          {dashboardConfig.chartTimeRange > 24 && windDataByPeriod['7d'].count > windDataByPeriod['48h'].count && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              <WindRose 
                data={windDataByPeriod['7d'].rose} 
                title="Wind Rose (7 days)"
                maxWindSpeed={maxWindSpeed}
              />
              {dashboardConfig.chartTimeRange > 168 && windDataByPeriod['31d'].count > windDataByPeriod['7d'].count && (
                <WindRose 
                  data={windDataByPeriod['31d'].rose} 
                  title="Wind Rose (31 days)"
                  maxWindSpeed={maxWindSpeed}
                />
              )}
            </div>
          )}
          
          {/* Wind Scatter Plots */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Wind Scatter - 30 Minutes */}
            {windDataByPeriod['30min'].count > 0 && (
            <WindRoseScatter 
              data={windDataByPeriod['30min'].scatter} 
              title="Wind Scatter (30 min)"
              maxWindSpeed={maxWindSpeed}
            />
            )}
            
            {/* Wind Scatter - 60 Minutes */}
            {windDataByPeriod['60min'].count > 0 && (
            <WindRoseScatter 
              data={windDataByPeriod['60min'].scatter} 
              title="Wind Scatter (60 min)"
              maxWindSpeed={maxWindSpeed}
            />
            )}
            
            {/* Wind Scatter - 24h */}
            {windDataByPeriod['24h'].count > 0 && (
            <WindRoseScatter 
              data={windDataByPeriod['24h'].scatter} 
              title="Wind Scatter (24h)"
              maxWindSpeed={maxWindSpeed}
            />
            )}
            
            {/* Wind Scatter - 48h when more data available */}
            {windDataByPeriod['48h'].count > windDataByPeriod['24h'].count && (
              <WindRoseScatter 
                data={windDataByPeriod['48h'].scatter} 
                title="Wind Scatter (48h)"
                maxWindSpeed={maxWindSpeed}
              />
            )}
          </div>
          
          {/* Extended Period Wind Scatter - Show 7-day and 31-day scatter when time range > 24h */}
          {dashboardConfig.chartTimeRange > 24 && windDataByPeriod['7d'].count > windDataByPeriod['48h'].count && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              <WindRoseScatter 
                data={windDataByPeriod['7d'].scatter} 
                title="Wind Scatter (7 days)"
                maxWindSpeed={maxWindSpeed}
              />
              {dashboardConfig.chartTimeRange > 168 && windDataByPeriod['31d'].count > windDataByPeriod['7d'].count && (
                <WindRoseScatter 
                  data={windDataByPeriod['31d'].scatter} 
                  title="Wind Scatter (31 days)"
                  maxWindSpeed={maxWindSpeed}
                />
              )}
            </div>
          )}
        </section>
        )}

        {/* Wind Energy Section - Only show if wind data available */}
        {dashboardConfig.sectionVisibility?.windEnergy !== false && (availableFields.windSpeed || availableFields.windDirection) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Wind Energy</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <WindPowerCard
              currentPower={calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || 1.225)}
              gustPower={calculateWindPower(currentData.windGust || 0, currentData.airDensity || 1.225)}
              airDensity={currentData.airDensity || 1.225}
              avgSpeed={chartData.slice(-10).reduce((sum, d) => sum + d.windSpeed, 0) / Math.max(chartData.slice(-10).length, 1)}
              avgPower={chartData.slice(-10).reduce((sum, d) => sum + calculateWindPower(d.windSpeed), 0) / Math.max(chartData.slice(-10).length, 1)}
              sparklineData={chartData.slice(-12).map(d => calculateWindPower(d.windSpeed))}
            />
            <MetricCard
              title="Current Wind Power"
              value={safeFixed(calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || 1.225), 1)}
              unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.windPower)}
              chartColor="#14b8a6"
            />
            <MetricCard
              title="Peak Gust Power"
              value={safeFixed(calculateWindPower(currentData.windGust || 0, currentData.airDensity || 1.225), 1)}
              unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.gustPower)}
              chartColor="#f97316"
            />
            <MetricCard
              title="Daily Energy Potential"
              value={safeFixed(windEnergyData.length > 0 ? windEnergyData[windEnergyData.length - 1].cumulativeEnergy : 0, 2)}
              unit="kWh/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.cumulativeEnergy)}
              chartColor="#8b5cf6"
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
              { dataKey: "windPower", name: "Wind Power", color: "#14b8a6", unit: "W/m²" },
              { dataKey: "windSpeed", name: "Wind Speed", color: "#3b82f6", unit: "km/h" },
            ]}
            chartType="area"
            xAxisLabel="Time"
            yAxisLabel="Power / Speed"
            showAverage={true}
            showMinMax={true}
            currentValue={calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || 1.225)}
          />
        </section>
        )}

        {/* Fire Danger Section - Only show when we have actual data */}
        {dashboardConfig.sectionVisibility?.fireDanger !== false && (hasValidData(currentData.temperature) && hasValidData(currentData.humidity) && hasValidData(currentData.windSpeed)) && (
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

        {/* Rainfall Section - Only show if rainfall data available */}
        {availableFields.rainfall && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Rainfall</h2>
          <DataBlockChart
            title="Rainfall History"
            data={chartData}
            series={[
              { dataKey: "rain", name: "Rainfall", color: "#0ea5e9", unit: "mm" },
            ]}
            chartType="bar"
            xAxisLabel="Time"
            yAxisLabel="Rainfall"
            showMinMax={true}
            currentValue={currentData.rainfall || 0}
          />
        </section>
        )}

        {/* Charts Section */}
        {chartData.length > 0 && (
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
                  { label: "31d", hours: 744 },
                ].map(({ label, hours }) => (
                  <Button
                    key={hours}
                    variant={dashboardConfig.chartTimeRange === hours ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleConfigChange({ ...dashboardConfig, chartTimeRange: hours })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {dataTimeRange && (
                <Badge variant="outline" className="text-xs ml-2">
                  {historicalLoading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  {dataTimeRange.recordCount} records
                </Badge>
              )}
              {historicalLoading && !dataTimeRange && (
                <Badge variant="outline" className="text-xs ml-2">
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Loading...
                </Badge>
              )}
            </div>
          </div>
          <Tabs defaultValue="temperature" className="w-full">
            <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
              <TabsTrigger value="temperature" className="flex-1 min-w-[80px]" data-testid="tab-temperature">Temp</TabsTrigger>
              <TabsTrigger value="wind" className="flex-1 min-w-[80px]" data-testid="tab-wind">Wind</TabsTrigger>
              <TabsTrigger value="pressure" className="flex-1 min-w-[80px]" data-testid="tab-pressure">Pressure</TabsTrigger>
              <TabsTrigger value="solar" className="flex-1 min-w-[80px]" data-testid="tab-solar">Solar</TabsTrigger>
              <TabsTrigger value="rain" className="flex-1 min-w-[80px]" data-testid="tab-rain">Rain</TabsTrigger>
            </TabsList>
            <TabsContent value="temperature" className="mt-4">
              <WeatherChart
                title="Temperature & Humidity"
                data={chartData}
                series={[
                  { dataKey: "temperature", name: "Temperature (°C)", color: "#ef4444" },
                  { dataKey: "humidity", name: "Humidity (%)", color: "#3b82f6" },
                ]}
              />
            </TabsContent>
            <TabsContent value="wind" className="mt-4">
              <WeatherChart
                title="Wind Speed"
                data={chartData}
                series={[
                  { dataKey: "windSpeed", name: "Wind Speed (km/h)", color: "#14b8a6" },
                ]}
              />
            </TabsContent>
            <TabsContent value="pressure" className="mt-4">
              <WeatherChart
                title="Barometric Pressure"
                data={chartData}
                series={[
                  { dataKey: "pressure", name: "Pressure (hPa)", color: "#8b5cf6" },
                ]}
              />
            </TabsContent>
            <TabsContent value="solar" className="mt-4">
              <WeatherChart
                title="Solar Radiation"
                data={chartData}
                series={[
                  { dataKey: "solar", name: "Solar Radiation (W/m²)", color: "#f59e0b" },
                ]}
              />
            </TabsContent>
            <TabsContent value="rain" className="mt-4">
              <WeatherChart
                title="Rainfall"
                data={chartData}
                series={[
                  { dataKey: "rain", name: "Rainfall (mm)", color: "#06b6d4" },
                ]}
              />
            </TabsContent>
          </Tabs>
        </section>
        )}

        {/* Solar & ET Cards */}
        {(hasValidData(currentData.solarRadiation) || hasValidData(currentData.temperature)) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar & Evapotranspiration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {hasValidData(currentData.solarRadiation) && (
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
        {isAdmin && selectedStation && !isDemoStation && (
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
                // Refresh station data — invalidate both list and station-specific queries
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
