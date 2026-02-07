import { useEffect, useState } from "react";
import { authFetch } from "@/lib/queryClient";
import { safeFixed } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { StationLogs } from "@/components/station/StationLogs";
import { StationHardware } from "@/components/station/StationHardware";

interface WeatherData {
  temperature: number;
  temperatureMin?: number;
  temperatureMax?: number;
  humidity: number;
  pressure: number;
  pressureSeaLevel?: number;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  windGust10min?: number;
  windPower?: number;
  rainfall: number;
  rainfall10min?: number;
  rainfall24h?: number;
  rainfall7d?: number;
  rainfall30d?: number;
  rainfallYearly?: number;
  solarRadiation: number;
  solarRadiationMax?: number;
  uvIndex?: number;
  dewPoint: number;
  airDensity?: number;
  eto?: number;
  eto24h?: number;
  eto7d?: number;
  eto30d?: number;
  sunAzimuth?: number;
  sunElevation?: number;
  sunrise?: string;
  sunset?: string;
  soilTemperature?: number;
  soilMoisture?: number;
  leafWetness?: number;
  batteryVoltage?: number;
  panelTemperature?: number;
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
    const interval = setInterval(fetchStationData, 10000);
    return () => clearInterval(interval);
  }, [stationId]);

  const fetchStationData = async () => {
    try {
      // First try to get Campbell-specific status
      const statusRes = await authFetch(`/api/campbell/stations/${stationId}/status`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStation(statusData);
      } else {
        // Fallback to main station info for demo/non-Campbell stations
        const stationRes = await authFetch(`/api/stations/${stationId}`);
        if (stationRes.ok) {
          const stationData = await stationRes.json();
          setStation({
            id: stationData.id,
            name: stationData.name,
            isConnected: stationData.isConnected || true,
            lastConnectionTime: stationData.lastConnectionTime || new Date().toISOString(),
            batteryVoltage: stationData.batteryVoltage || 12.8,
            panelTemperature: stationData.panelTemperature || 25.0,
          });
        }
      }

      // Fetch latest weather data
      const dataRes = await authFetch(`/api/stations/${stationId}/data/latest`);
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
    return date.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false });
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
              <p className="font-medium text-foreground">{safeFixed(station.batteryVoltage, 2)} V</p>
            </div>
            <div>
              <span className="text-muted-foreground">Panel Temperature:</span>
              <p className="font-medium text-foreground">{safeFixed(station.panelTemperature, 1)} °C</p>
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
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Temperature
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {safeFixed(latestData.temperature, 1)}°C
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Dew Point: {safeFixed(latestData.dewPoint, 1)}°C
              </p>
              {latestData.temperatureMin !== undefined && latestData.temperatureMax !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Min: {safeFixed(latestData.temperatureMin, 1)}°C | Max: {safeFixed(latestData.temperatureMax, 1)}°C
                </p>
              )}
            </CardContent>
          </Card>

          {/* Humidity */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Humidity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {safeFixed(latestData.humidity, 1)}%
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Relative Humidity
              </p>
              {latestData.airDensity !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Air Density: {safeFixed(latestData.airDensity, 4)} kg/m³
                </p>
              )}
            </CardContent>
          </Card>

          {/* Wind Speed */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Wind Speed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {safeFixed(latestData.windSpeed, 1)} km/h
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Gust: {safeFixed(latestData.windGust, 1)} km/h | Dir: {latestData.windDirection}°
              </p>
              {latestData.windGust10min !== undefined && (
                <p className="text-xs text-muted-foreground">
                  10-min Gust: {safeFixed(latestData.windGust10min, 1)} km/h
                </p>
              )}
            </CardContent>
          </Card>

          {/* Wind Power */}
          {latestData.windPower !== undefined && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Wind Power
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {safeFixed(latestData.windPower, 1)} W/m²
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Power Density (0.5 × ρ × v³)
                </p>
              </CardContent>
            </Card>
          )}

          {/* Pressure */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pressure
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {safeFixed(latestData.pressure, 1)} hPa
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Station Pressure
              </p>
              {latestData.pressureSeaLevel !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Sea Level: {safeFixed(latestData.pressureSeaLevel, 1)} hPa
                </p>
              )}
            </CardContent>
          </Card>

          {/* Solar Radiation */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Solar Radiation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {safeFixed(latestData.solarRadiation, 0)} W/m²
              </div>
              {latestData.solarRadiationMax !== undefined && (
                <p className="text-xs text-muted-foreground mt-1">
                  Max: {safeFixed(latestData.solarRadiationMax, 0)} W/m²
                </p>
              )}
              {latestData.uvIndex !== undefined && (
                <p className="text-xs text-muted-foreground">
                  UV Index: {safeFixed(latestData.uvIndex, 1)}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Rainfall */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Rainfall
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {safeFixed(latestData.rainfall, 2)} mm
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {latestData.rainfall10min !== undefined && `10-min: ${safeFixed(latestData.rainfall10min, 2)} mm`}
                {latestData.rainfall24h !== undefined && ` | 24h: ${safeFixed(latestData.rainfall24h, 1)} mm`}
              </p>
              {(latestData.rainfall7d !== undefined || latestData.rainfall30d !== undefined) && (
                <p className="text-xs text-muted-foreground">
                  {latestData.rainfall7d !== undefined && `7d: ${safeFixed(latestData.rainfall7d, 1)} mm`}
                  {latestData.rainfall30d !== undefined && ` | 30d: ${safeFixed(latestData.rainfall30d, 1)} mm`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* ETo (Evapotranspiration) */}
          {latestData.eto !== undefined && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  ETo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {safeFixed(latestData.eto, 2)} mm
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Evapotranspiration
                </p>
                {(latestData.eto24h !== undefined || latestData.eto7d !== undefined) && (
                  <p className="text-xs text-muted-foreground">
                    {latestData.eto24h !== undefined && `24h: ${safeFixed(latestData.eto24h, 2)} mm`}
                    {latestData.eto7d !== undefined && ` | 7d: ${safeFixed(latestData.eto7d, 1)} mm`}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Sun Position */}
          {latestData.sunElevation !== undefined && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Sun Position
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {latestData.sunElevation > 0 ? `${safeFixed(latestData.sunElevation, 1)}°` : "Below horizon"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Elevation: {safeFixed(latestData.sunElevation, 1)}°
                  {latestData.sunAzimuth !== undefined && ` | Azimuth: ${safeFixed(latestData.sunAzimuth, 1)}°`}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Sunrise/Sunset */}
          {(latestData.sunrise || latestData.sunset) && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Sun Times
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  {latestData.sunrise && (
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {new Date(latestData.sunrise).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-xs text-muted-foreground">Sunrise</p>
                    </div>
                  )}
                  {latestData.sunset && (
                    <div className="text-center">
                      <p className="text-sm font-medium text-foreground">
                        {new Date(latestData.sunset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-xs text-muted-foreground">Sunset</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Soil Temperature */}
          {latestData.soilTemperature !== undefined && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Soil Temperature
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {safeFixed(latestData.soilTemperature, 1)}°C
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Ground Temperature
                </p>
                {latestData.soilMoisture !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Moisture: {safeFixed(latestData.soilMoisture, 1)}%
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* System Status */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                System Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">
                {safeFixed(latestData.batteryVoltage, 2) !== '--' ? safeFixed(latestData.batteryVoltage, 2) : safeFixed(station.batteryVoltage, 2)} V
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Battery Voltage
              </p>
              <p className="text-xs text-muted-foreground">
                Panel: {safeFixed(latestData.panelTemperature, 1) !== '--' ? safeFixed(latestData.panelTemperature, 1) : safeFixed(station.panelTemperature, 1)}°C
              </p>
            </CardContent>
          </Card>

          {/* Data Timestamp */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Last Update
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-medium text-foreground">
                {formatTimestamp(latestData.timestamp)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(latestData.timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false })}
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

      {/* Hardware & Personnel */}
      <StationHardware stationId={stationId} />

      {/* Station Logs */}
      <StationLogs stationId={stationId} />
    </div>
  );
}
