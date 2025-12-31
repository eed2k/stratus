import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CurrentConditions } from "@/components/dashboard/CurrentConditions";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { WindRose } from "@/components/charts/WindRose";
import { WindCompass } from "@/components/dashboard/WindCompass";
import { WindPowerCard } from "@/components/dashboard/WindPowerCard";
import { WeatherChart } from "@/components/charts/WeatherChart";
import { DataBlockChart } from "@/components/charts/DataBlockChart";
import { StatisticsCard } from "@/components/dashboard/StatisticsCard";
import { SolarRadiationCard } from "@/components/dashboard/SolarRadiationCard";
import { EToCard } from "@/components/dashboard/EToCard";
import { StationSelector } from "@/components/dashboard/StationSelector";
import { ExportTools } from "@/components/dashboard/ExportTools";
import { DataImport } from "@/components/dashboard/DataImport";
import { DashboardConfigPanel } from "@/components/dashboard/DashboardConfigPanel";
import { ShareDashboard } from "@/components/dashboard/ShareDashboard";
import { StationInfoPanel } from "@/components/dashboard/StationInfoPanel";
import { StationMap } from "@/components/dashboard/StationMap";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Radio,
  Plus,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { WeatherStation, WeatherData } from "@shared/schema";
import { DEFAULT_DASHBOARD_CONFIG, type DashboardConfig } from "../../../shared/dashboardConfig";

/**
 * Helper function to format numbers to a maximum of 3 decimal places
 * Removes trailing zeros for cleaner display
 */
const formatValue = (value: number, maxDecimals: number = 3): string => {
  return parseFloat(value.toFixed(maxDecimals)).toString();
};

const generateChartData = (hours: number) => {
  const data = [];
  const now = new Date();
  for (let i = hours; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    data.push({
      timestamp: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      temperature: 20 + Math.sin(i / 4) * 5 + Math.random() * 2,
      humidity: 60 + Math.cos(i / 6) * 15 + Math.random() * 5,
      pressure: 1013 + Math.sin(i / 8) * 5,
      windSpeed: 10 + Math.random() * 15,
      solar: Math.max(0, 400 * Math.sin((i - 6) / 12 * Math.PI) + Math.random() * 50),
      rain: Math.random() > 0.9 ? Math.random() * 2 : 0,
    });
  }
  return data;
};

const generateWindRoseData = () => {
  const data = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    speeds: [
      Math.random() * 5,
      Math.random() * 8,
      Math.random() * 12,
      Math.random() * 6,
      Math.random() * 3,
      Math.random() * 2,
    ],
  }));
  data[8].speeds = [2, 8, 15, 10, 5, 2];
  data[9].speeds = [3, 10, 18, 12, 6, 3];
  data[10].speeds = [2, 6, 12, 8, 4, 1];
  return data;
};

const generateYesterdayWindRoseData = () => {
  const data = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    speeds: [
      Math.random() * 4,
      Math.random() * 7,
      Math.random() * 10,
      Math.random() * 5,
      Math.random() * 2,
      Math.random() * 1,
    ],
  }));
  data[4].speeds = [3, 7, 12, 8, 4, 1];
  data[5].speeds = [4, 9, 14, 9, 5, 2];
  data[6].speeds = [2, 5, 10, 6, 3, 1];
  return data;
};

const generateLast60MinutesWindRoseData = () => {
  const data = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    speeds: [
      Math.random() * 3,
      Math.random() * 5,
      Math.random() * 8,
      Math.random() * 4,
      Math.random() * 2,
      Math.random() * 1,
    ],
  }));
  // Bias toward current wind direction (southwest)
  data[10].speeds = [2, 6, 10, 6, 3, 1];
  data[11].speeds = [3, 8, 12, 7, 4, 2];
  data[9].speeds = [1, 4, 8, 5, 2, 1];
  return data;
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

/**
 * Generate wind energy chart data
 */
const generateWindEnergyData = (hours: number) => {
  const data = [];
  const now = new Date();
  for (let i = hours; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    const windSpeed = 10 + Math.random() * 15;
    const airDensity = 1.225 + (Math.random() - 0.5) * 0.05;
    const power = calculateWindPower(windSpeed, airDensity);
    data.push({
      timestamp: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      windSpeed,
      windPower: power,
      cumulativeEnergy: power * 0.001, // kWh/m² approximation
    });
  }
  return data;
};

interface DashboardProps {
  isAdmin?: boolean;
  canAccessStation?: (stationId: number) => boolean;
  assignedStations?: number[];
}

export default function Dashboard({ isAdmin = true, canAccessStation, assignedStations = [] }: DashboardProps) {
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig>(() => {
    // Load config from localStorage if available
    const saved = localStorage.getItem('dashboardConfig');
    return saved ? JSON.parse(saved) : DEFAULT_DASHBOARD_CONFIG;
  });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const chartData = useMemo(() => generateChartData(dashboardConfig.chartTimeRange), [dashboardConfig.chartTimeRange]);
  const windRoseData = useMemo(() => generateWindRoseData(), []);
  const yesterdayWindRoseData = useMemo(() => generateYesterdayWindRoseData(), []);
  const last60MinutesWindRoseData = useMemo(() => generateLast60MinutesWindRoseData(), []);
  const windEnergyData = useMemo(() => generateWindEnergyData(dashboardConfig.chartTimeRange), [dashboardConfig.chartTimeRange]);

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

  // Save config to localStorage when it changes
  const handleConfigChange = useCallback((newConfig: DashboardConfig) => {
    setDashboardConfig(newConfig);
    localStorage.setItem('dashboardConfig', JSON.stringify(newConfig));
  }, []);

  // Manual refresh handler
  const handleRefresh = useCallback(() => {
    refetch();
    setLastRefresh(new Date());
  }, [refetch]);

  // Check if a parameter is enabled
  const isParameterEnabled = useCallback((paramId: string) => {
    return dashboardConfig.enabledParameters.includes(paramId);
  }, [dashboardConfig.enabledParameters]);

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
          <h2 className="text-xl font-semibold text-muted-foreground">No Stations Assigned</h2>
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
            <h2 className="text-base font-semibold mb-2">No Weather Stations</h2>
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

  const currentData = latestData || {
    temperature: 23.5,
    humidity: 68,
    pressure: 1013.25,
    windSpeed: 15,
    windGust: 22,
    windDirection: 225,
    solarRadiation: 456,
    rainfall: 2.4,
    dewPoint: 16.8,
    airDensity: 1.225,
    eto: 4.85,
    batteryVoltage: 12.8,
    particulateCount: 42,
    pm25: 12.5,
    pm10: 25.3,
    atmosphericVisibility: 18.5,
    panelTemperature: 28.5,
    soilTemperature: 18.2,
    soilMoisture: 32.5,
    uvIndex: 6.2,
  };

  const sparkline = chartData.slice(-12).map(d => d.temperature);
  const maxWindSpeed = Math.max(currentData.windGust || 0, ...windRoseData.flatMap(d => d.speeds));

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 lg:p-8">
      {/* Header Section */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between no-print">
        <StationSelector
          stations={stationOptions}
          selectedId={String(activeStationId)}
          onSelect={(id) => setSelectedStationId(parseInt(id))}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updates every {dashboardConfig.updatePeriod < 60 
              ? `${dashboardConfig.updatePeriod}s` 
              : `${Math.floor(dashboardConfig.updatePeriod / 60)}m`}
          </Badge>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={dataLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${dataLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <DashboardConfigPanel
            config={dashboardConfig}
            onConfigChange={handleConfigChange}
            onRefresh={handleRefresh}
          />
          {activeStationId && (
            <DataImport 
              stationId={activeStationId} 
              stationName={selectedStation?.name || "Weather Station"} 
            />
          )}
          {activeStationId && selectedStation && (
            <ShareDashboard 
              stationId={activeStationId} 
              stationName={selectedStation.name} 
            />
          )}
          <ExportTools 
            targetId="dashboard-content" 
            stationName={selectedStation?.name || "Weather Station"} 
          />
        </div>
      </div>

      <div id="dashboard-content" className="space-y-6">
        {/* Current Conditions Header */}
        <CurrentConditions
          stationName={selectedStation?.name || "Weather Station"}
          lastUpdate={latestData?.timestamp ? new Date(latestData.timestamp).toLocaleString() : "No data"}
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
        />

        {/* Station Location Map */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Station Location</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <StationMap
              latitude={selectedStation?.latitude || undefined}
              longitude={selectedStation?.longitude || undefined}
              stationName={selectedStation?.name || "Weather Station"}
              altitude={selectedStation?.altitude || undefined}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-normal">Station Details</CardTitle>
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
              trend={{ value: 1.2, label: "vs yesterday" }}
              sparklineData={sparkline}
              chartColor="#ef4444"
            />
            <MetricCard
              title="Humidity"
              value={formatValue(currentData.humidity || 0, 1)}
              unit="%"
              trend={{ value: -5, label: "vs yesterday" }}
              sparklineData={chartData.slice(-12).map(d => d.humidity)}
              chartColor="#3b82f6"
            />
            <MetricCard
              title="Dew Point"
              value={formatValue(currentData.dewPoint || 0, 1)}
              unit="°C"
              chartColor="#06b6d4"
            />
            <MetricCard
              title="Pressure"
              value={formatValue(currentData.pressure || 0, 1)}
              unit="hPa"
              trend={{ value: 2.1, label: "vs yesterday" }}
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
                { label: "7d", value: "12.8 mm" },
              ]}
              sparklineData={chartData.slice(-12).map(d => d.rain)}
              chartColor="#0ea5e9"
            />
          </div>
          
          {/* Primary Metrics Dedicated Charts - Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
              trend={{ value: 1.2, label: "vs yesterday" }}
            />
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
              trend={{ value: -5, label: "vs yesterday" }}
            />
          </div>
          
          {/* Pressure Chart */}
          <DataBlockChart
            title="Barometric Pressure"
            data={chartData}
            series={[
              { dataKey: "pressure", name: "Pressure", color: "#8b5cf6", unit: "hPa" },
            ]}
            chartType="line"
            xAxisLabel="Time"
            yAxisLabel="Pressure"
            showAverage={true}
            showMinMax={true}
            currentValue={currentData.pressure || 0}
          />
        </section>

        {/* Solar & Radiation Section */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar & Radiation</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <MetricCard
              title="Solar Radiation"
              value={formatValue(currentData.solarRadiation || 0, 0)}
              unit="W/m²"
              sparklineData={chartData.slice(-12).map(d => d.solar)}
              chartColor="#f59e0b"
            />
            <MetricCard
              title="UV Index"
              value={formatValue(currentData.uvIndex || 0, 1)}
              unit=""
              subMetrics={[
                { label: "Risk", value: (currentData.uvIndex || 0) < 3 ? "Low" : (currentData.uvIndex || 0) < 6 ? "Moderate" : "High" },
              ]}
              chartColor="#dc2626"
            />
            <MetricCard
              title="Reference ET"
              value={formatValue(currentData.eto || 0, 2)}
              unit="mm"
              chartColor="#22c55e"
            />
            <MetricCard
              title="Panel Temp"
              value={formatValue(currentData.panelTemperature || 0, 1)}
              unit="°C"
              chartColor="#f97316"
            />
            <MetricCard
              title="Air Density"
              value={formatValue(currentData.airDensity || 0, 3)}
              unit="kg/m³"
              chartColor="#64748b"
            />
          </div>
          {/* Solar Radiation Dedicated Chart */}
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
        </section>

        {/* Soil & Environment Section */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Soil & Environment</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <MetricCard
              title="Soil Temperature"
              value={formatValue(currentData.soilTemperature || 0, 1)}
              unit="°C"
              chartColor="#a16207"
            />
            <MetricCard
              title="Soil Moisture"
              value={formatValue(currentData.soilMoisture || 0, 1)}
              unit="%"
              subMetrics={[
                { label: "Status", value: (currentData.soilMoisture || 0) < 20 ? "Dry" : (currentData.soilMoisture || 0) < 40 ? "Optimal" : "Wet" },
              ]}
              chartColor="#15803d"
            />
            <MetricCard
              title="PM2.5"
              value={formatValue(currentData.pm25 || 0, 1)}
              unit="µg/m³"
              subMetrics={[
                { label: "AQI", value: (currentData.pm25 || 0) < 12 ? "Good" : (currentData.pm25 || 0) < 35 ? "Moderate" : "Unhealthy" },
              ]}
              chartColor="#6b7280"
            />
            <MetricCard
              title="PM10"
              value={formatValue(currentData.pm10 || 0, 1)}
              unit="µg/m³"
              chartColor="#9ca3af"
            />
            <MetricCard
              title="Battery"
              value={formatValue(currentData.batteryVoltage || 0, 2)}
              unit="V"
              subMetrics={[
                { label: "Status", value: (currentData.batteryVoltage || 0) > 12 ? "Good" : "Low" },
              ]}
              chartColor="#22c55e"
            />
          </div>
          
          {/* Soil Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
          </div>
        </section>

        {/* Wind Direction Compass & Charts */}
        <section className="space-y-6">
          <h2 className="text-base font-normal text-foreground">Wind Analysis (WMO/Beaufort Scale)</h2>
          
          {/* Top Row: Wind Compass and Last 60 Minutes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Wind Compass */}
            <WindCompass
              direction={currentData.windDirection || 0}
              speed={currentData.windSpeed || 0}
              gust={currentData.windGust}
              unit="km/h"
            />
            
            {/* Wind Rose Last 60 Minutes */}
            <WindRose 
              data={last60MinutesWindRoseData} 
              title="Wind Rose (Last 60 min)" 
              maxWindSpeed={maxWindSpeed}
            />
          </div>
          
          {/* Bottom Row: Today and Yesterday Wind Roses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Wind Rose Today */}
            <WindRose 
              data={windRoseData} 
              title="Wind Rose (Today)" 
              maxWindSpeed={maxWindSpeed}
            />
            
            {/* Wind Rose Yesterday */}
            <WindRose 
              data={yesterdayWindRoseData} 
              title="Wind Rose (Yesterday)"
              maxWindSpeed={maxWindSpeed}
            />
          </div>
        </section>

        {/* Wind Energy Section */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Wind Energy</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <WindPowerCard
              currentPower={calculateWindPower(currentData.windSpeed || 0, currentData.airDensity || 1.225)}
              gustPower={calculateWindPower(currentData.windGust || 0, currentData.airDensity || 1.225)}
              airDensity={currentData.airDensity || 1.225}
              avgSpeed={chartData.slice(-10).reduce((sum, d) => sum + d.windSpeed, 0) / 10}
              avgPower={chartData.slice(-10).reduce((sum, d) => sum + calculateWindPower(d.windSpeed), 0) / 10}
              sparklineData={windEnergyData.slice(-12).map(d => d.windPower)}
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

        {/* Rainfall Section */}
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

        {/* Charts Section */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Historical Data</h2>
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

        {/* Solar & ET Cards */}
        <section className="space-y-4">
          <h2 className="text-base font-normal text-foreground">Solar & Evapotranspiration</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <SolarRadiationCard
              currentRadiation={currentData.solarRadiation || 0}
              peakRadiation={1050}
              dailyEnergy={18.5}
              avgRadiation={450}
              panelTemperature={currentData.panelTemperature}
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

        {/* Station Administration - Admin Only */}
        {selectedStation && (
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
                const response = await fetch(`/api/stations/${selectedStation.id}`, {
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
        )}
      </div>
    </div>
  );
}
