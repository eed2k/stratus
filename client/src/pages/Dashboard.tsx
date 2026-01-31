import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { WindDirectionChart } from "@/components/dashboard/WindDirectionChart";
import { FireDangerCard } from "@/components/dashboard/FireDangerCard";
import { FireDangerChart } from "@/components/charts/FireDangerChart";
import { NoDataWrapper, hasValidData } from "@/components/dashboard/NoDataWrapper";
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
} from "lucide-react";
import type { WeatherStation, WeatherData } from "@shared/schema";
import { 
  calculateSolarPosition, 
  calculateAirDensity, 
  calculateSeaLevelPressure,
  calculateETo,
  getDayOfYear,
  kmhToMs,
  wattsToMJPerDay,
  calculateFireDanger
} from "@shared/utils/calc";
import { DEFAULT_DASHBOARD_CONFIG, type DashboardConfig } from "../../../shared/dashboardConfig";

/**
 * Helper function to format numbers to a maximum of 3 decimal places
 * Removes trailing zeros for cleaner display
 */
const formatValue = (value: number, maxDecimals: number = 3): string => {
  return parseFloat(value.toFixed(maxDecimals)).toString();
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
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    } else if (effectiveRange <= 24) {
      // 2-24 hours: show HH:MM
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    } else if (effectiveRange <= 72) {
      // 1-3 days: show Day HH:MM
      return date.toLocaleDateString("en-US", { weekday: "short" }) + " " +
             date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    } else if (effectiveRange <= 168) {
      // 3-7 days: show Day DD HH:00
      return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }) + " " +
             date.toLocaleTimeString("en-US", { hour: "2-digit" });
    } else if (effectiveRange <= 720) {
      // 7-30 days: show MM/DD HH:00
      return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) + " " +
             date.toLocaleTimeString("en-US", { hour: "2-digit" });
    } else {
      // Over 30 days: show MM/DD
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  };
  
  return sampledData.map(d => ({
    timestamp: formatTimestamp(new Date(d.timestamp)),
    fullTimestamp: new Date(d.timestamp).toISOString(),
    temperature: d.temperature ?? 0,
    humidity: d.humidity ?? 0,
    pressure: d.pressure ?? 0,
    windSpeed: d.windSpeed ?? 0,
    solar: d.solarRadiation ?? 0,
    rain: d.rainfall ?? 0,
  }));
};

/**
 * Process historical data into wind energy format
 * Calculates wind power density using P = 0.5 * ρ * v³
 */
const processWindEnergyData = (historicalData: WeatherData[]) => {
  let cumulativeEnergy = 0;
  const airDensity = 1.225; // kg/m³ at sea level
  
  return historicalData.map(d => {
    const windSpeed = d.windSpeed ?? 0;
    const speedMs = windSpeed / 3.6; // Convert km/h to m/s
    const windPower = 0.5 * airDensity * Math.pow(speedMs, 3); // W/m²
    
    // Cumulative energy - assuming 1 hour intervals for simplicity
    cumulativeEnergy += windPower / 1000; // kWh/m²
    
    return {
      timestamp: new Date(d.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      windSpeed,
      windPower,
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
  assignedStations?: number[];
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
  const { data: historicalData = [], refetch: refetchHistorical } = useQuery<WeatherData[]>({
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
    refetchInterval: dashboardConfig.updatePeriod * 1000,
    staleTime: 0, // Always refetch when timeframe changes - don't use cached data
  });

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

  // Process wind energy data from historical data
  const windEnergyData = useMemo(() => processWindEnergyData(sortedHistoricalData), [sortedHistoricalData]);

  // Process wind data for different time periods (60min, 24h, 48h, 7d, 31d)
  const windDataByPeriod = useMemo(() => {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const fortyEightHoursAgo = now - 48 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
    
    const last60Min = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > oneHourAgo);
    const last24h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > twentyFourHoursAgo);
    const last48h = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > fortyEightHoursAgo);
    const last7d = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > sevenDaysAgo);
    const last31d = sortedHistoricalData.filter(d => new Date(d.timestamp).getTime() > thirtyOneDaysAgo);
    
    return {
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
  }, [sortedHistoricalData, windRoseData, windScatterData]);

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
  }, [refetch]);

  const selectedStation = stations.find(s => s.id === activeStationId);


  const stationOptions = stations.map(s => ({
    id: String(s.id),
    name: s.name,
    location: s.location || "",
    isOnline: s.isActive || false,
  }));

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

  // Check if viewing demo station (hide admin panels for demo)
  const isDemoStation = selectedStation?.connectionType === 'demo';

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
      };

  // Calculate solar position based on station coordinates
  const solarPosition = useMemo(() => {
    const lat = selectedStation?.latitude || 0;
    const lon = selectedStation?.longitude || 0;
    if (lat === 0 && lon === 0) {
      // No coordinates set - return null values
      return {
        elevation: 0,
        azimuth: 0,
        sunrise: new Date(new Date().setHours(6, 45, 0)),
        sunset: new Date(new Date().setHours(18, 30, 0)),
        nauticalDawn: new Date(new Date().setHours(5, 15, 0)),
        nauticalDusk: new Date(new Date().setHours(19, 45, 0)),
        solarNoon: new Date(new Date().setHours(12, 37, 0)),
        dayLength: 705,
      };
    }
    return calculateSolarPosition(lat, lon);
  }, [selectedStation?.latitude, selectedStation?.longitude]);

  // Calculate air density from current conditions
  const calculatedAirDensity = useMemo(() => {
    return calculateAirDensity(
      currentData.temperature || 20,
      currentData.pressure || 1013.25,
      currentData.humidity || 50
    );
  }, [currentData.temperature, currentData.pressure, currentData.humidity]);

  // Calculate sea level pressure
  const seaLevelPressure = useMemo(() => {
    const altitude = selectedStation?.altitude || 0;
    return calculateSeaLevelPressure(
      currentData.pressure || 1013.25,
      altitude,
      currentData.temperature || 20
    );
  }, [currentData.pressure, currentData.temperature, selectedStation?.altitude]);

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
    
    const avgOldTemp = olderData.reduce((sum, d) => sum + (d.temperature || 0), 0) / halfLen;
    const avgOldHumidity = olderData.reduce((sum, d) => sum + (d.humidity || 0), 0) / halfLen;
    const avgOldPressure = olderData.reduce((sum, d) => sum + (d.pressure || 0), 0) / halfLen;
    
    const currentTemp = currentData.temperature || 0;
    const currentHum = currentData.humidity || 0;
    const currentPress = currentData.pressure || 0;
    
    return {
      temperature: avgOldTemp ? ((currentTemp - avgOldTemp) / avgOldTemp) * 100 : null,
      humidity: avgOldHumidity ? ((currentHum - avgOldHumidity) / avgOldHumidity) * 100 : null,
      pressure: avgOldPressure ? ((currentPress - avgOldPressure) / avgOldPressure) * 100 : null,
    };
  }, [historicalData, currentData]);

  // Calculate accumulated rainfall from historical data
  const accumulatedRainfall = useMemo(() => {
    return historicalData.reduce((sum, d) => sum + (d.rainfall || 0), 0);
  }, [historicalData]);

  // Extract battery voltage from historical data for proper charting
  const batteryChartData = useMemo(() => {
    return historicalData.map(d => ({
      timestamp: new Date(d.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      batteryVoltage: d.batteryVoltage ?? 0,
    }));
  }, [historicalData]);

  const sparkline = chartData.slice(-12).map(d => d.temperature);
  
  // Calculate max wind speed from actual observations, not from wind rose bin counts
  const maxWindSpeed = useMemo(() => {
    const speeds = historicalData
      .map(d => Math.max(d.windSpeed || 0, d.windGust || 0))
      .filter(s => s > 0);
    return Math.max(currentData.windGust || 0, currentData.windSpeed || 0, ...speeds);
  }, [historicalData, currentData.windGust, currentData.windSpeed]);

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
              title={`Data from ${dataTimeRange.earliest.toLocaleString()} to ${dataTimeRange.latest.toLocaleString()}`}
            >
              {dataTimeRange.hoursAvailable < dashboardConfig.chartTimeRange 
                ? `${dataTimeRange.hoursAvailable.toFixed(1)}h of ${dashboardConfig.chartTimeRange}h data`
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
          lastUpdate={currentData.timestamp ? new Date(currentData.timestamp).toLocaleString() : "No data"}
          temperature={currentData.temperature || 0}
          humidity={currentData.humidity || 0}
          pressure={currentData.pressure || 0}
          windSpeed={currentData.windSpeed || 0}
          windGust={currentData.windGust || 0}
          windDirection={currentData.windDirection || 0}
          solarRadiation={currentData.solarRadiation || 0}
          rainfall={currentData.rainfall || 0}
          dewPoint={currentData.dewPoint || 0}
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
              key={`map-${selectedStation?.id || 'default'}`}
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
                    <p className="text-sm font-normal">{selectedStation?.latitude?.toFixed(6) || "Not set"}°</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Longitude</p>
                    <p className="text-sm font-normal">{selectedStation?.longitude?.toFixed(6) || "Not set"}°</p>
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
                    <p className="text-sm font-normal">{selectedStation?.dataloggerModel || "Campbell Scientific"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Primary Metrics - Always Visible */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Primary Metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <MetricCard
              title="Temperature"
              value={formatValue(currentData.temperature || 0, 1)}
              unit="°C"
              trend={trends.temperature !== null ? { value: parseFloat(trends.temperature.toFixed(1)), label: "vs avg" } : undefined}
              sparklineData={sparkline}
              chartColor="#ef4444"
            />
            <MetricCard
              title="Humidity"
              value={formatValue(currentData.humidity || 0, 1)}
              unit="%"
              trend={trends.humidity !== null ? { value: parseFloat(trends.humidity.toFixed(1)), label: "vs avg" } : undefined}
              sparklineData={chartData.slice(-12).map(d => d.humidity)}
              chartColor="#3b82f6"
            />
            {hasValidData(currentData.dewPoint) && (
              <MetricCard
                title="Dew Point"
                value={formatValue(currentData.dewPoint || 0, 1)}
                unit="°C"
                chartColor="#06b6d4"
              />
            )}
            <MetricCard
              title="Pressure"
              value={formatValue(currentData.pressure || 0, 1)}
              unit="mbar"
              trend={trends.pressure !== null ? { value: parseFloat(trends.pressure.toFixed(1)), label: "vs avg" } : undefined}
              sparklineData={chartData.slice(-12).map(d => d.pressure)}
              chartColor="#8b5cf6"
            />
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
            <MetricCard
              title="Rainfall (24h)"
              value={formatValue(currentData.rainfall || 0, 2)}
              unit="mm"
              subMetrics={[
                { label: "Period Total", value: `${formatValue(accumulatedRainfall, 1)} mm` },
              ]}
              sparklineData={chartData.slice(-12).map(d => d.rain)}
              chartColor="#0ea5e9"
            />
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
                trend={trends.temperature !== null ? { value: parseFloat(trends.temperature.toFixed(1)), label: "vs avg" } : undefined}
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
              trend={trends.humidity !== null ? { value: parseFloat(trends.humidity.toFixed(1)), label: "vs avg" } : undefined}
            />
            )}
          </div>
          
          {/* Barometric Pressure Section with Sea Level and Station Level */}
          {availableFields.pressure && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarometricPressureCard
              stationPressure={currentData.pressure || 1013.25}
              seaLevelPressure={seaLevelPressure}
              altitude={selectedStation?.altitude || 0}
              temperature={currentData.temperature || 20}
              trend={trends.pressure !== null ? parseFloat(trends.pressure.toFixed(1)) : 0}
              sparklineDataStation={chartData.slice(-24).map(d => d.pressure)}
              sparklineDataSeaLevel={chartData.slice(-24).map(d => d.pressure + 10)}
            />
            <DataBlockChart
              title="Barometric Pressure History"
              data={chartData}
              series={[
                { dataKey: "pressure", name: "Station Pressure", color: "#8b5cf6", unit: "mbar" },
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

        {/* Logger Battery Section - Only show if battery data exists */}
        {hasValidData(currentData.batteryVoltage) && (
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Logger Battery Status</h2>
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

        {/* Solar & Radiation Section */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar Position & Radiation</h2>
          
          {/* Solar Position and Air Density Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
            <AirDensityCard
              airDensity={currentData.airDensity || calculatedAirDensity}
              temperature={currentData.temperature ?? undefined}
              pressure={currentData.pressure ?? undefined}
              humidity={currentData.humidity ?? undefined}
            />
            <EvapotranspirationCard
              currentETo={(currentData.eto || calculatedETo) / 24}
              dailyETo={currentData.eto || calculatedETo}
              weeklyETo={(currentData.eto || calculatedETo) * 7}
              monthlyETo={(currentData.eto || calculatedETo) * 30}
            />
          </div>
          
          {/* Solar Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <MetricCard
              title="Sun Elevation"
              value={formatValue(solarPosition.elevation, 1)}
              unit="°"
              chartColor="#f59e0b"
            />
            <MetricCard
              title="Sun Azimuth"
              value={formatValue(solarPosition.azimuth, 1)}
              unit="°"
              chartColor="#fb923c"
            />
            <MetricCard
              title="Solar Radiation"
              value={formatValue(currentData.solarRadiation || 0, 0)}
              unit="W/m²"
              sparklineData={chartData.slice(-12).map(d => d.solar)}
              chartColor="#f59e0b"
            />
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
            <MetricCard
              title="Reference ETo"
              value={formatValue(currentData.eto || calculatedETo, 2)}
              unit="mm/day"
              chartColor="#22c55e"
            />
            <MetricCard
              title="Air Density"
              value={formatValue(currentData.airDensity || calculatedAirDensity, 3)}
              unit="kg/m³"
              chartColor="#64748b"
            />
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
                    timestamp: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
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
          </div>

          {/* Solar Power Harvesting Potential - Renewable Energy Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SolarPowerHarvestCard
              currentRadiation={hasValidData(currentData.solarRadiation) ? currentData.solarRadiation : null}
              panelEfficiency={0.20}
              systemLosses={0.15}
            />
            <WindDirectionChart
              currentDirection={hasValidData(currentData.windDirection) ? currentData.windDirection : null}
              currentSpeed={hasValidData(currentData.windSpeed) ? currentData.windSpeed : null}
              period="Today"
            />
          </div>
        </section>

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
        {(hasValidData(currentData.soilTemperature) || hasValidData(currentData.soilMoisture) || hasValidData(currentData.pm25) || hasValidData(currentData.pm10)) && (
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
              data={chartData.map(d => ({ ...d, soilTemp: 18 + Math.sin(parseFloat(d.timestamp.split(':')[0]) / 4) * 3 }))}
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
              data={chartData.map(d => ({ ...d, soilMoist: 30 + Math.random() * 10 }))}
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
        </section>
        )}

        {/* Wind Direction Compass & Charts - Only show if wind data available */}
        {availableFields.windSpeed && (
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
            
            {/* Wind Rose - 60 Minutes */}
            <WindRose 
              data={windDataByPeriod['60min'].rose} 
              title="Wind Rose (60 min)"
              maxWindSpeed={maxWindSpeed}
            />
            
            {/* Wind Rose - 24h */}
            <WindRose 
              data={windDataByPeriod['24h'].rose} 
              title="Wind Rose (24h)"
              maxWindSpeed={maxWindSpeed}
            />
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
            {/* Wind Scatter - 60 Minutes */}
            <WindRoseScatter 
              data={windDataByPeriod['60min'].scatter} 
              title="Wind Scatter (60 min)"
              maxWindSpeed={maxWindSpeed}
            />
            
            {/* Wind Scatter - 24h */}
            <WindRoseScatter 
              data={windDataByPeriod['24h'].scatter} 
              title="Wind Scatter (24h)"
              maxWindSpeed={maxWindSpeed}
            />
            
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
        {availableFields.windSpeed && (
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
              value={calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || 1.225).toFixed(1)}
              unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.windPower)}
              chartColor="#14b8a6"
            />
            <MetricCard
              title="Peak Gust Power"
              value={calculateWindPower(currentData.windGust || 0, currentData.airDensity || 1.225).toFixed(1)}
              unit="W/m²"
              sparklineData={windEnergyData.slice(-12).map(d => d.windPower * 1.5)}
              chartColor="#f97316"
            />
            <MetricCard
              title="Daily Energy Potential"
              value={(windEnergyData.reduce((sum, d) => sum + d.cumulativeEnergy, 0)).toFixed(2)}
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

        {/* Fire Danger Section */}
        <section className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FireDangerCard
              temperature={currentData.temperature || 25}
              humidity={currentData.humidity || 40}
              windSpeed={currentData.windSpeed || 10}
            />
            <FireDangerChart
              data={fireDangerChartData}
              title="Fire Danger History"
            />
          </div>
        </section>

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
                  {dataTimeRange.recordCount} records
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
                  { dataKey: "pressure", name: "Pressure (mbar)", color: "#8b5cf6" },
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

        {/* Solar & ET Cards */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar & Evapotranspiration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <SolarRadiationCard
              currentRadiation={currentData.solarRadiation || 0}
              peakRadiation={1050}
              dailyEnergy={18.5}
              avgRadiation={450}
              panelTemperature={currentData.panelTemperature ?? undefined}
            />
            <EToCard
              dailyETo={currentData.eto || 4.85}
              weeklyETo={32.4}
              monthlyETo={128.5}
            />
            <StatisticsCard
              title="Temperature Statistics"
              periods={[
                {
                  period: "24h",
                  stats: [
                    { label: "Min", value: 15.2, unit: "°C" },
                    { label: "Max", value: 28.4, unit: "°C" },
                    { label: "Avg", value: 21.8, unit: "°C" },
                    { label: "Range", value: 13.2, unit: "°C" },
                  ],
                },
                {
                  period: "7d",
                  stats: [
                    { label: "Min", value: 12.1, unit: "°C" },
                    { label: "Max", value: 31.5, unit: "°C" },
                    { label: "Avg", value: 20.3, unit: "°C" },
                    { label: "Range", value: 19.4, unit: "°C" },
                  ],
                },
              ]}
            />
          </div>
        </section>

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
                // Refresh station data
                await queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
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
          />
          </section>
        )}
      </div>
    </div>
  );
}
