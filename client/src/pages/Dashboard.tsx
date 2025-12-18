import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CurrentConditions } from "@/components/dashboard/CurrentConditions";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { WindRose } from "@/components/charts/WindRose";
import { WindRose3D } from "@/components/charts/WindRose3D";
import { WeatherChart } from "@/components/charts/WeatherChart";
import { StatisticsCard } from "@/components/dashboard/StatisticsCard";
import { SolarRadiationCard } from "@/components/dashboard/SolarRadiationCard";
import { EToCard } from "@/components/dashboard/EToCard";
import { StationSelector } from "@/components/dashboard/StationSelector";
import { RefreshIndicator } from "@/components/dashboard/RefreshIndicator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Link } from "wouter";
import {
  Radio,
  Plus,
  Loader2,
} from "lucide-react";
import type { WeatherStation, WeatherData } from "@shared/schema";

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

export default function Dashboard() {
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [interval, setIntervalValue] = useState(60);
  const [windRoseView, setWindRoseView] = useState<"2d" | "3d">("2d");
  
  const chartData = useMemo(() => generateChartData(24), []);
  const windRoseData = useMemo(() => generateWindRoseData(), []);

  const { data: stations = [], isLoading: stationsLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  const activeStationId = selectedStationId || (stations.length > 0 ? stations[0].id : null);

  const { data: latestData, isLoading: dataLoading, refetch } = useQuery<WeatherData>({
    queryKey: ["/api/stations", activeStationId, "data", "latest"],
    enabled: !!activeStationId,
  });

  const selectedStation = stations.find(s => s.id === activeStationId);

  const handleRefresh = () => {
    refetch();
    setLastUpdate(new Date());
  };

  const stationOptions = stations.map(s => ({
    id: String(s.id),
    name: s.name,
    location: s.location || "",
    isOnline: s.isActive || false,
  }));

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
            <h2 className="text-xl font-semibold mb-2">No Weather Stations</h2>
            <p className="text-sm text-muted-foreground text-center mb-4 max-w-sm">
              Add a weather station to start monitoring weather data on your dashboard.
            </p>
            <Link href="/stations">
              <Button data-testid="button-add-station-dashboard">
                <Plus className="mr-2 h-4 w-4" />
                Add Station
              </Button>
            </Link>
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
  };

  const sparkline = chartData.slice(-12).map(d => d.temperature);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <StationSelector
          stations={stationOptions}
          selectedId={String(activeStationId)}
          onSelect={(id) => setSelectedStationId(parseInt(id))}
        />
        <RefreshIndicator
          lastUpdate={lastUpdate}
          autoRefresh={autoRefresh}
          interval={interval}
          onRefresh={handleRefresh}
          onIntervalChange={setIntervalValue}
          onAutoRefreshChange={setAutoRefresh}
        />
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Temperature"
          value={currentData.temperature || 0}
          unit="°C"
          trend={{ value: 1.2, label: "vs yesterday" }}
          sparklineData={sparkline}
        />
        <MetricCard
          title="Humidity"
          value={currentData.humidity || 0}
          unit="%"
          trend={{ value: -5, label: "vs yesterday" }}
          sparklineData={chartData.slice(-12).map(d => d.humidity)}
        />
        <MetricCard
          title="Pressure"
          value={currentData.pressure || 0}
          unit="hPa"
          trend={{ value: 2.1, label: "vs yesterday" }}
          sparklineData={chartData.slice(-12).map(d => d.pressure)}
        />
        <MetricCard
          title="Wind Speed"
          value={currentData.windSpeed || 0}
          unit="km/h"
          subMetrics={[
            { label: "Gust", value: `${currentData.windGust || 0} km/h` },
            { label: "Dir", value: `${currentData.windDirection || 0}°` },
          ]}
        />
        <MetricCard
          title="Solar Radiation"
          value={currentData.solarRadiation || 0}
          unit="W/m²"
          sparklineData={chartData.slice(-12).map(d => d.solar)}
        />
        <MetricCard
          title="Rainfall (24h)"
          value={currentData.rainfall || 0}
          unit="mm"
          subMetrics={[
            { label: "7d Total", value: "12.8 mm" },
            { label: "30d Total", value: "45.2 mm" },
          ]}
        />
      </div>

      <Tabs defaultValue="temperature" className="w-full">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:grid-cols-none lg:flex">
          <TabsTrigger value="temperature" data-testid="tab-temperature">Temperature</TabsTrigger>
          <TabsTrigger value="wind" data-testid="tab-wind">Wind</TabsTrigger>
          <TabsTrigger value="pressure" data-testid="tab-pressure">Pressure</TabsTrigger>
          <TabsTrigger value="solar" data-testid="tab-solar">Solar</TabsTrigger>
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
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">View Mode</span>
            <ToggleGroup type="single" value={windRoseView} onValueChange={(v) => v && setWindRoseView(v as "2d" | "3d")}>
              <ToggleGroupItem value="2d" size="sm" className="text-xs">2D</ToggleGroupItem>
              <ToggleGroupItem value="3d" size="sm" className="text-xs">3D</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {windRoseView === "2d" ? (
            <WindRose data={windRoseData} title="Wind Rose (24h)" />
          ) : (
            <WindRose3D data={windRoseData} title="Wind Rose 3D (24h)" />
          )}
        </div>
        <div className="space-y-4">
          <SolarRadiationCard
            currentRadiation={currentData.solarRadiation || 0}
            peakRadiation={1050}
            dailyEnergy={18.5}
            avgRadiation={450}
            panelTemperature={currentData.temperature ? currentData.temperature + 5 : undefined}
          />
          <EToCard
            dailyETo={currentData.eto || 4.85}
            weeklyETo={32.4}
            monthlyETo={128.5}
          />
        </div>
        <StatisticsCard
          title="Temperature Statistics"
          periods={[
            {
              period: "24h",
              stats: [
                { label: "Minimum", value: 15.2, unit: "°C" },
                { label: "Maximum", value: 28.4, unit: "°C" },
                { label: "Average", value: 21.8, unit: "°C" },
                { label: "Range", value: 13.2, unit: "°C" },
              ],
            },
            {
              period: "7d",
              stats: [
                { label: "Minimum", value: 12.1, unit: "°C" },
                { label: "Maximum", value: 31.5, unit: "°C" },
                { label: "Average", value: 20.3, unit: "°C" },
                { label: "Range", value: 19.4, unit: "°C" },
              ],
            },
            {
              period: "30d",
              stats: [
                { label: "Minimum", value: 8.5, unit: "°C" },
                { label: "Maximum", value: 34.2, unit: "°C" },
                { label: "Average", value: 19.6, unit: "°C" },
                { label: "Range", value: 25.7, unit: "°C" },
              ],
            },
          ]}
        />
      </div>
    </div>
  );
}
