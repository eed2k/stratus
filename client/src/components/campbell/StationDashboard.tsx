import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Thermometer, Droplets, Wind, Gauge, Sun, CloudRain, Activity } from "lucide-react";

interface WeatherData {
  temperature: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  rainfall: number;
  solarRadiation: number;
  dewPoint: number;
  timestamp: string;
}

interface StationStatus {
  id: number;
  name: string;
  isConnected: boolean;
  lastConnectionTime: string;
  batteryVoltage: number;
  panelTemperature: number;
}

interface StationDashboardProps {
  stationId: number;
}

export function StationDashboard({ stationId }: StationDashboardProps) {
  const [station, setStation] = useState<StationStatus | null>(null);
  const [latestData, setLatestData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStationData();
    const interval = setInterval(fetchStationData, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [stationId]);

  const fetchStationData = async () => {
    try {
      // Fetch station status
      const statusRes = await fetch(`/api/campbell/stations/${stationId}/status`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStation(statusData);
      }

      // Fetch latest weather data
      const dataRes = await fetch(`/api/stations/${stationId}/data/latest`);
      if (dataRes.ok) {
        const weatherData = await dataRes.json();
        setLatestData(weatherData);
      }
    } catch (error) {
      console.error("Error fetching station data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!station) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-8 text-center text-muted-foreground">
          Station not found
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (isConnected: boolean) => {
    return isConnected ? "bg-green-900 text-white" : "bg-red-900 text-white";
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    
    if (diffSecs < 60) return `${diffSecs} seconds ago`;
    if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)} minutes ago`;
    return date.toLocaleString();
  };

  return (
    <div className="space-y-6 p-6">
      {/* Station Header */}
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl text-foreground">{station.name}</CardTitle>
              <CardDescription className="text-muted-foreground">
                Station ID: {station.id}
              </CardDescription>
            </div>
            <Badge className={getStatusColor(station.isConnected)}>
              {station.isConnected ? "Online" : "Offline"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Last Communication:</span>
              <p className="font-medium text-foreground">
                {formatTimestamp(station.lastConnectionTime)}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Battery Voltage:</span>
              <p className="font-medium text-foreground">{station.batteryVoltage.toFixed(2)} V</p>
            </div>
            <div>
              <span className="text-muted-foreground">Panel Temperature:</span>
              <p className="font-medium text-foreground">{station.panelTemperature.toFixed(1)} °C</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Weather Data */}
      {latestData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Temperature */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Temperature
                </CardTitle>
                <Thermometer className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {latestData.temperature.toFixed(1)}°C
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Dew Point: {latestData.dewPoint.toFixed(1)}°C
              </p>
            </CardContent>
          </Card>

          {/* Humidity */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Humidity
                </CardTitle>
                <Droplets className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {latestData.humidity.toFixed(1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Relative Humidity
              </p>
            </CardContent>
          </Card>

          {/* Wind Speed */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Wind Speed
                </CardTitle>
                <Wind className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {latestData.windSpeed.toFixed(1)} m/s
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Gust: {latestData.windGust.toFixed(1)} m/s | Dir: {latestData.windDirection}°
              </p>
            </CardContent>
          </Card>

          {/* Pressure */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Pressure
                </CardTitle>
                <Gauge className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {latestData.pressure.toFixed(1)} hPa
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Barometric Pressure
              </p>
            </CardContent>
          </Card>

          {/* Solar Radiation */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Solar Radiation
                </CardTitle>
                <Sun className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {latestData.solarRadiation.toFixed(0)} W/m²
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Current Solar Irradiance
              </p>
            </CardContent>
          </Card>

          {/* Rainfall */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Rainfall
                </CardTitle>
                <CloudRain className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {latestData.rainfall.toFixed(2)} mm
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Current Reading
              </p>
            </CardContent>
          </Card>

          {/* Data Timestamp */}
          <Card className="bg-card border-border col-span-1 md:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Last Update
                </CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-medium text-foreground">
                {formatTimestamp(latestData.timestamp)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(latestData.timestamp).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {!latestData && (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center text-muted-foreground">
            No weather data available
          </CardContent>
        </Card>
      )}
    </div>
  );
}
