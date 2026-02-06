import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { safeFixed } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { WindRose } from "@/components/charts/WindRose";
import { WeatherChart } from "@/components/charts/WeatherChart";
import { StatisticsCard } from "@/components/dashboard/StatisticsCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Cloud,
  Lock,
  AlertCircle,
  Eye,
  RefreshCw,
  Share2,
} from "lucide-react";
import type { WeatherData } from "@shared/schema";

interface ShareAccess {
  stationId: number;
  accessLevel: 'viewer' | 'editor';
  name: string;
}

/**
 * Process historical data into chart format
 */
const processChartData = (historicalData: WeatherData[]) => {
  return historicalData.map(d => ({
    timestamp: new Date(d.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    temperature: d.temperature ?? 0,
    humidity: d.humidity ?? 0,
    pressure: d.pressure ?? 0,
    windSpeed: d.windSpeed ?? 0,
    solar: d.solarRadiation ?? 0,
    rain: d.rainfall ?? 0,
  }));
};

/**
 * Process historical data into wind rose format
 */
const processWindRoseData = (historicalData: WeatherData[]) => {
  const windRoseData = Array.from({ length: 16 }, (_, i) => ({
    direction: i * 22.5,
    speeds: [0, 0, 0, 0, 0, 0],
  }));

  historicalData.forEach(data => {
    if (data.windDirection == null || data.windSpeed == null) return;
    const dirBin = Math.round(data.windDirection / 22.5) % 16;
    const speed = data.windSpeed;
    let speedClass = 0;
    if (speed < 1) speedClass = 0;
    else if (speed < 12) speedClass = 1;
    else if (speed < 20) speedClass = 2;
    else if (speed < 29) speedClass = 3;
    else if (speed < 39) speedClass = 4;
    else speedClass = 5;
    windRoseData[dirBin].speeds[speedClass]++;
  });

  return windRoseData;
};

// Internal component that may throw errors
function SharedDashboardContent() {
  const params = useParams();
  const shareToken = params.shareToken as string;
  
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<ShareAccess | null>(null);
  const [passwordError, setPasswordError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

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
  });

  // Fetch latest weather data once we have access
  const { data: weatherData, refetch: refetchWeather } = useQuery<WeatherData>({
    queryKey: ['shared-weather', access?.stationId, 'latest'],
    queryFn: async () => {
      const res = await fetch(`/api/stations/${access?.stationId}/data/latest`);
      if (!res.ok) throw new Error('Failed to fetch weather data');
      return res.json();
    },
    enabled: !!access,
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch historical data for charts
  const { data: historicalData = [] } = useQuery<WeatherData[]>({
    queryKey: ['shared-weather', access?.stationId, 'history'],
    queryFn: async () => {
      if (!access?.stationId) return [];
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours
      const res = await fetch(
        `/api/stations/${access.stationId}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}`
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!access,
    refetchInterval: 60000,
  });

  // Process historical data
  const chartData = useMemo(() => processChartData(historicalData), [historicalData]);
  const windRoseData = useMemo(() => processWindRoseData(historicalData), [historicalData]);
  const maxWindSpeed = useMemo(() => {
    const speeds = historicalData.map(d => d.windSpeed ?? 0);
    return Math.max(weatherData?.windGust || 0, ...speeds) || 25;
  }, [historicalData, weatherData?.windGust]);

  // Compute real statistics from historical data
  const stats = useMemo(() => {
    const temps = historicalData.map(d => d.temperature).filter((v): v is number => v != null);
    const humids = historicalData.map(d => d.humidity).filter((v): v is number => v != null);
    const winds = historicalData.map(d => d.windSpeed).filter((v): v is number => v != null);
    const avg = (arr: number[]) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const min = (arr: number[]) => arr.length > 0 ? Math.min(...arr) : null;
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : null;
    return {
      temp: { min: min(temps), max: max(temps), avg: avg(temps) },
      humid: { min: min(humids), max: max(humids), avg: avg(humids) },
      wind: { min: min(winds), max: max(winds), avg: avg(winds) },
    };
  }, [historicalData]);

  // Fetch station info once we have access
  const { data: stationData } = useQuery({
    queryKey: ['shared-station', access?.stationId],
    queryFn: async () => {
      const res = await fetch(`/api/stations/${access?.stationId}`);
      if (!res.ok) throw new Error('Failed to fetch station');
      return res.json();
    },
    enabled: !!access,
  });

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
          }
        });
    }
  }, [shareInfo, shareToken, access]);

  // Loading state
  if (isLoadingShare) {
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

  const station = stationData?.station || { name: access.name, location: 'Unknown' };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container py-4 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Cloud className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">{station.name}</h1>
              <p className="text-sm text-muted-foreground">{station.location}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Eye className="h-3 w-3" />
              View Only
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                refetchWeather();
                setLastRefresh(new Date());
              }}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-6 px-4 space-y-6">
        {/* Current Conditions */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <MetricCard
            title="Temperature"
            value={safeFixed(weatherData?.temperature, 1)}
            unit="°C"
            trend={{ value: 2.5, label: "vs yesterday" }}
          />
          <MetricCard
            title="Humidity"
            value={safeFixed(weatherData?.humidity, 0)}
            unit="%"
          />
          <MetricCard
            title="Wind Speed"
            value={safeFixed(weatherData?.windSpeed, 1)}
            unit="km/h"
            subMetrics={[{ label: "Gust", value: `${safeFixed(weatherData?.windGust, 1)} km/h` }]}
          />
          <MetricCard
            title="Pressure"
            value={safeFixed(weatherData?.pressure, 1)}
            unit="hPa"
          />
          <MetricCard
            title="Solar Radiation"
            value={safeFixed(weatherData?.solarRadiation, 0)}
            unit="W/m²"
          />
          <MetricCard
            title="UV Index"
            value={safeFixed(weatherData?.uvIndex, 0)}
            unit=""
          />
        </div>

        <Tabs defaultValue="charts" className="space-y-4">
          <TabsList>
            <TabsTrigger value="charts">Charts</TabsTrigger>
            <TabsTrigger value="wind">Wind Analysis</TabsTrigger>
            <TabsTrigger value="statistics">Statistics</TabsTrigger>
          </TabsList>

          <TabsContent value="charts" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WeatherChart
                data={chartData}
                title="Temperature (24h)"
                series={[{ dataKey: "temperature", name: "Temperature", color: "#ef4444", unit: "°C" }]}
              />
              <WeatherChart
                data={chartData}
                title="Humidity (24h)"
                series={[{ dataKey: "humidity", name: "Humidity", color: "#3b82f6", unit: "%" }]}
              />
              <WeatherChart
                data={chartData}
                title="Wind Speed (24h)"
                series={[{ dataKey: "windSpeed", name: "Wind Speed", color: "#22c55e", unit: "km/h" }]}
              />
              <WeatherChart
                data={chartData}
                title="Pressure (24h)"
                series={[{ dataKey: "pressure", name: "Pressure", color: "#8b5cf6", unit: "hPa" }]}
              />
            </div>
          </TabsContent>

          <TabsContent value="wind" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <WindRose 
                data={windRoseData} 
                title="Wind Rose (24h)" 
                maxWindSpeed={maxWindSpeed}
              />
              <Card>
                <CardHeader>
                  <CardTitle>Wind Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Average Speed</p>
                      <p className="text-2xl font-semibold">{safeFixed(weatherData?.windSpeed, 1)} km/h</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Max Gust</p>
                      <p className="text-2xl font-semibold">{safeFixed(weatherData?.windGust, 1)} km/h</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Direction</p>
                      <p className="text-2xl font-semibold">{weatherData?.windDirection}° SW</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Prevailing</p>
                      <p className="text-2xl font-semibold">SW</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="statistics" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <StatisticsCard
                title="Temperature"
                periods={[
                  { period: "Last 24h", stats: [
                    { label: "Current", value: safeFixed(weatherData?.temperature, 1, '--'), unit: "°C" },
                    { label: "Min", value: stats.temp.min != null ? stats.temp.min.toFixed(1) : '--', unit: "°C" },
                    { label: "Max", value: stats.temp.max != null ? stats.temp.max.toFixed(1) : '--', unit: "°C" },
                    { label: "Avg", value: stats.temp.avg != null ? stats.temp.avg.toFixed(1) : '--', unit: "°C" },
                  ]},
                ]}
              />
              <StatisticsCard
                title="Humidity"
                periods={[
                  { period: "Last 24h", stats: [
                    { label: "Current", value: safeFixed(weatherData?.humidity, 0, '--'), unit: "%" },
                    { label: "Min", value: stats.humid.min != null ? stats.humid.min.toFixed(0) : '--', unit: "%" },
                    { label: "Max", value: stats.humid.max != null ? stats.humid.max.toFixed(0) : '--', unit: "%" },
                    { label: "Avg", value: stats.humid.avg != null ? stats.humid.avg.toFixed(0) : '--', unit: "%" },
                  ]},
                ]}
              />
              <StatisticsCard
                title="Wind Speed"
                periods={[
                  { period: "Last 24h", stats: [
                    { label: "Current", value: safeFixed(weatherData?.windSpeed, 1, '--'), unit: "km/h" },
                    { label: "Min", value: stats.wind.min != null ? stats.wind.min.toFixed(1) : '--', unit: "km/h" },
                    { label: "Max", value: stats.wind.max != null ? stats.wind.max.toFixed(1) : '--', unit: "km/h" },
                    { label: "Avg", value: stats.wind.avg != null ? stats.wind.avg.toFixed(1) : '--', unit: "km/h" },
                  ]},
                ]}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground pt-4 border-t">
          <p className="flex items-center justify-center gap-2">
            <Share2 className="h-4 w-4" />
            Shared Dashboard • Last updated: {lastRefresh.toLocaleTimeString()}
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
