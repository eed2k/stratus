import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
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

interface ShareAccess {
  stationId: number;
  accessLevel: 'viewer' | 'editor';
  name: string;
}

// Sample data generators (same as Dashboard)
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

  // Fetch weather data once we have access
  const { data: weatherData, refetch: refetchWeather } = useQuery({
    queryKey: ['shared-weather', access?.stationId],
    queryFn: async () => {
      // In production, fetch from API
      // For now, return demo data
      return {
        temperature: 22.5,
        humidity: 65,
        pressure: 1013.25,
        windSpeed: 15.2,
        windDirection: 225,
        windGust: 22.1,
        rainfall: 0,
        solarRadiation: 450,
        uvIndex: 5,
        dewPoint: 15.3,
      };
    },
    enabled: !!access,
    refetchInterval: 60000, // Refresh every minute
  });

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

  // Sample data
  const chartData = generateChartData(24);
  const windRoseData = generateWindRoseData();

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
            value={weatherData?.temperature.toFixed(1) || '--'}
            unit="°C"
            trend={{ value: 2.5, label: "vs yesterday" }}
          />
          <MetricCard
            title="Humidity"
            value={weatherData?.humidity.toFixed(0) || '--'}
            unit="%"
          />
          <MetricCard
            title="Wind Speed"
            value={weatherData?.windSpeed.toFixed(1) || '--'}
            unit="km/h"
            subMetrics={[{ label: "Gust", value: `${weatherData?.windGust.toFixed(1)} km/h` }]}
          />
          <MetricCard
            title="Pressure"
            value={weatherData?.pressure.toFixed(1) || '--'}
            unit="hPa"
          />
          <MetricCard
            title="Solar Radiation"
            value={weatherData?.solarRadiation.toFixed(0) || '--'}
            unit="W/m²"
          />
          <MetricCard
            title="UV Index"
            value={weatherData?.uvIndex.toFixed(0) || '--'}
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
                title="Wind Rose (Today)" 
                maxWindSpeed={weatherData?.windGust || 25}
              />
              <Card>
                <CardHeader>
                  <CardTitle>Wind Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Average Speed</p>
                      <p className="text-2xl font-semibold">{weatherData?.windSpeed.toFixed(1)} km/h</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Max Gust</p>
                      <p className="text-2xl font-semibold">{weatherData?.windGust.toFixed(1)} km/h</p>
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
                  { period: "Today", stats: [
                    { label: "Current", value: weatherData?.temperature.toFixed(1) || 0, unit: "°C" },
                    { label: "Min", value: "15.2", unit: "°C" },
                    { label: "Max", value: "28.5", unit: "°C" },
                    { label: "Avg", value: "21.3", unit: "°C" },
                  ]},
                  { period: "Week", stats: [
                    { label: "Min", value: "12.1", unit: "°C" },
                    { label: "Max", value: "31.2", unit: "°C" },
                    { label: "Avg", value: "20.8", unit: "°C" },
                  ]},
                ]}
              />
              <StatisticsCard
                title="Humidity"
                periods={[
                  { period: "Today", stats: [
                    { label: "Current", value: weatherData?.humidity.toFixed(0) || 0, unit: "%" },
                    { label: "Min", value: "45", unit: "%" },
                    { label: "Max", value: "85", unit: "%" },
                    { label: "Avg", value: "65", unit: "%" },
                  ]},
                  { period: "Week", stats: [
                    { label: "Min", value: "38", unit: "%" },
                    { label: "Max", value: "92", unit: "%" },
                    { label: "Avg", value: "62", unit: "%" },
                  ]},
                ]}
              />
              <StatisticsCard
                title="Wind Speed"
                periods={[
                  { period: "Today", stats: [
                    { label: "Current", value: weatherData?.windSpeed.toFixed(1) || 0, unit: "km/h" },
                    { label: "Min", value: "0", unit: "km/h" },
                    { label: "Max", value: (weatherData?.windGust || 25).toFixed(1), unit: "km/h" },
                    { label: "Avg", value: "12.5", unit: "km/h" },
                  ]},
                  { period: "Week", stats: [
                    { label: "Min", value: "0", unit: "km/h" },
                    { label: "Max", value: "35.2", unit: "km/h" },
                    { label: "Avg", value: "11.8", unit: "km/h" },
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
