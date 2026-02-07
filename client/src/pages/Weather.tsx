import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  MapPin,
  Wind,
  CloudRain,
  Thermometer,
  Gauge,
  Cloud,
  Loader2,
  RefreshCw,
  Navigation,
  AlertTriangle,
  Info,
  ExternalLink,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from "recharts";

// ============================================================
// Types
// ============================================================
interface WeatherConfig {
  windy: { configured: boolean; mapApiKey: string };
}

interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
  address?: Record<string, string>;
}

interface ForecastData {
  ts: number[];
  units: Record<string, string>;
  [key: string]: unknown;
}

// ============================================================
// Weather Layers for Windy Map
// ============================================================
const WINDY_LAYERS = [
  { id: "wind", label: "Wind" },
  { id: "rain", label: "Rain & Thunder" },
  { id: "temp", label: "Temperature" },
  { id: "pressure", label: "Pressure" },
  { id: "clouds", label: "Clouds" },
  { id: "rh", label: "Humidity" },
  { id: "gust", label: "Wind Gusts" },
  { id: "cape", label: "CAPE Index" },
] as const;

const FORECAST_MODELS = [
  { id: "gfs", label: "GFS (Global)" },
] as const;

// ============================================================
// Main Weather Component
// ============================================================
export default function Weather() {
  const { toast } = useToast();

  // Location state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<GeoResult | null>(null);
  const [activeLayer, setActiveLayer] = useState("wind");
  const [forecastModel, setForecastModel] = useState("gfs");

  // Windy map state
  const windyContainerRef = useRef<HTMLDivElement>(null);
  const windyApiRef = useRef<any>(null);
  const [windyLoaded, setWindyLoaded] = useState(false);
  const [windyError, setWindyError] = useState<string | null>(null);

  // API config query
  const { data: config } = useQuery<WeatherConfig>({
    queryKey: ["/api/weather/config"],
    staleTime: 5 * 60 * 1000,
  });

  // Geocoding search
  const [searchResults, setSearchResults] = useState<GeoResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Point forecast data
  const { data: forecastData, isLoading: forecastLoading, refetch: refetchForecast } = useQuery<ForecastData>({
    queryKey: ["/api/weather/forecast", selectedLocation?.lat, selectedLocation?.lon, forecastModel],
    queryFn: async () => {
      if (!selectedLocation) return null;
      const res = await authFetch("/api/weather/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: selectedLocation.lat,
          lon: selectedLocation.lon,
          model: forecastModel,
          parameters: ["wind", "windGust", "temp", "dewpoint", "precip", "pressure", "rh", "lclouds", "mclouds", "hclouds", "cape"],
        }),
      });
      if (!res.ok) throw new Error("Forecast request failed");
      const json = await res.json();
      return json.data;
    },
    enabled: !!selectedLocation && !!config?.windy?.configured,
    staleTime: 10 * 60 * 1000, // 10 min cache
  });

  // ============================================================
  // Geocode search handler
  // ============================================================
  const handleSearch = useCallback(async () => {
    if (!searchQuery || searchQuery.length < 2) return;
    setIsSearching(true);
    try {
      const res = await authFetch(`/api/weather/geocode?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) throw new Error("Search failed");
      const json = await res.json();
      setSearchResults(json.data || []);
    } catch (error) {
      toast({
        title: "Search Failed",
        description: "Could not find location. Try a different search term.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, toast]);

  const selectLocation = useCallback((result: GeoResult) => {
    setSelectedLocation(result);
    setSearchResults([]);
    setSearchQuery(result.displayName.split(",")[0]);

    // Update Windy map position if loaded
    if (windyApiRef.current?.map) {
      windyApiRef.current.map.setView([result.lat, result.lon], 8);
    }
  }, []);

  // ============================================================
  // Windy Map Initialisation
  // ============================================================
  useEffect(() => {
    if (!config?.windy?.mapApiKey || windyLoaded) return;

    const initWindy = () => {
      // Check if Windy script already loaded
      if ((window as any).windyInit) {
        try {
          const options = {
            key: config.windy.mapApiKey,
            lat: selectedLocation?.lat || -30.5595,
            lon: selectedLocation?.lon || 22.9375,
            zoom: selectedLocation ? 8 : 5,
          };
          (window as any).windyInit(options, (windyAPI: any) => {
            windyApiRef.current = windyAPI;
            setWindyLoaded(true);
            setWindyError(null);

            // Set the initial layer
            const { store } = windyAPI;
            store.set("overlay", activeLayer);
          });
        } catch (err) {
          console.error("[Weather] Windy init error:", err);
          setWindyError("Failed to initialise Windy map");
        }
        return;
      }

      // Load Leaflet first, then Windy
      const leafletScript = document.createElement("script");
      leafletScript.src = "https://unpkg.com/leaflet@1.4.0/dist/leaflet.js";
      leafletScript.async = true;
      leafletScript.onload = () => {
        const windyScript = document.createElement("script");
        windyScript.src = "https://api.windy.com/assets/map-forecast/libBoot.js";
        windyScript.async = true;
        windyScript.onload = () => {
          // Wait a tick for Windy to set up windyInit
          setTimeout(() => initWindy(), 100);
        };
        windyScript.onerror = () => setWindyError("Failed to load Windy library");
        document.head.appendChild(windyScript);
      };
      leafletScript.onerror = () => setWindyError("Failed to load Leaflet library");
      document.head.appendChild(leafletScript);
    };

    initWindy();
  }, [config?.windy?.mapApiKey]);

  // Update Windy layer when changed
  useEffect(() => {
    if (windyApiRef.current) {
      try {
        const { store, map } = windyApiRef.current;
        store.set("overlay", activeLayer);
        // Force map re-render so overlay tiles refresh
        if (map) {
          setTimeout(() => map.invalidateSize(), 100);
        }
      } catch {
        // Layer may not be available in testing tier
      }
    }
  }, [activeLayer]);

  // ============================================================
  // Process forecast data for charts
  // ============================================================
  const processedForecast = (() => {
    if (!forecastData?.ts) return null;

    const timestamps = forecastData.ts as number[];
    return timestamps.map((ts, i) => {
      const date = new Date(ts);
      const entry: Record<string, any> = {
        time: date.toLocaleString("en-ZA", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        timestamp: ts,
      };

      // Temperature
      const temp = (forecastData as any)["temp-surface"];
      if (temp?.[i] != null) entry.temp = Math.round((temp[i] - 273.15) * 10) / 10; // K to °C

      // Dew point
      const dewpoint = (forecastData as any)["dewpoint-surface"];
      if (dewpoint?.[i] != null) entry.dewpoint = Math.round((dewpoint[i] - 273.15) * 10) / 10;

      // Wind speed (from u,v components)
      const windU = (forecastData as any)["wind_u-surface"];
      const windV = (forecastData as any)["wind_v-surface"];
      if (windU?.[i] != null && windV?.[i] != null) {
        entry.windSpeed = Math.round(Math.sqrt(windU[i] ** 2 + windV[i] ** 2) * 3.6 * 10) / 10; // m/s to km/h
        entry.windDir = Math.round((Math.atan2(-windU[i], -windV[i]) * 180) / Math.PI + 360) % 360;
      }

      // Wind gust
      const gust = (forecastData as any)["gust-surface"];
      if (gust?.[i] != null) entry.gust = Math.round(gust[i] * 3.6 * 10) / 10;

      // Precipitation
      const precip = (forecastData as any)["past3hprecip-surface"];
      if (precip?.[i] != null) entry.precip = Math.round(precip[i] * 100) / 100;

      // Pressure
      const pressure = (forecastData as any)["pressure-surface"];
      if (pressure?.[i] != null) entry.pressure = Math.round(pressure[i] / 100 * 10) / 10; // Pa to hPa

      // Humidity
      const rh = (forecastData as any)["rh-surface"];
      if (rh?.[i] != null) entry.humidity = Math.round(rh[i]);

      // Clouds
      const lclouds = (forecastData as any)["lclouds-surface"];
      const mclouds = (forecastData as any)["mclouds-surface"];
      const hclouds = (forecastData as any)["hclouds-surface"];
      if (lclouds?.[i] != null) entry.lowClouds = Math.round(lclouds[i]);
      if (mclouds?.[i] != null) entry.midClouds = Math.round(mclouds[i]);
      if (hclouds?.[i] != null) entry.highClouds = Math.round(hclouds[i]);

      // CAPE
      const cape = (forecastData as any)["cape-surface"];
      if (cape?.[i] != null) entry.cape = Math.round(cape[i]);

      return entry;
    });
  })();

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Weather</h1>
          <p className="text-muted-foreground">
            Live weather maps and forecasts
          </p>
        </div>

      </div>

      {/* Location Search */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Search Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                placeholder="Enter a city, town or area name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} disabled={isSearching || searchQuery.length < 2}>
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Search
            </Button>
          </div>

          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="mt-2 border rounded-md divide-y max-h-48 overflow-y-auto">
              {searchResults.map((result, idx) => (
                <button
                  key={idx}
                  className="w-full px-3 py-2 text-left hover:bg-accent text-sm flex items-center gap-2"
                  onClick={() => selectLocation(result)}
                >
                  <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="truncate">{result.displayName}</span>
                  <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                    {result.lat.toFixed(2)}, {result.lon.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Selected location */}
          {selectedLocation && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Navigation className="h-4 w-4 text-primary" />
              <span className="font-medium">{selectedLocation.displayName.split(",").slice(0, 2).join(",")}</span>
              <span className="text-muted-foreground">
                ({selectedLocation.lat.toFixed(4)}, {selectedLocation.lon.toFixed(4)})
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Map + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Layer Selection */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Map Layers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {WINDY_LAYERS.map((layer) => {
              return (
                <Button
                  key={layer.id}
                  variant={activeLayer === layer.id ? "default" : "outline"}
                  className="w-full justify-start"
                  size="sm"
                  onClick={() => setActiveLayer(layer.id)}
                >
                  {layer.label}
                </Button>
              );
            })}
          </CardContent>
        </Card>

        {/* Windy Map */}
        <Card className="lg:col-span-3">
          <CardContent className="p-0 relative">
            {windyError ? (
              <div className="flex flex-col items-center justify-center h-[500px] text-center p-6">
                <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
                <p className="font-medium text-lg">{windyError}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Please ensure a valid Windy Map Forecast API key is configured.
                </p>
                <a
                  href="https://api.windy.com/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary mt-3 text-sm flex items-center gap-1 hover:underline"
                >
                  Get an API key <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : !config?.windy?.mapApiKey ? (
              <div className="flex flex-col items-center justify-center h-[500px] text-center p-6">
                <Wind className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="font-medium text-lg">Windy Map Not Configured</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Set <code>WINDY_API_KEY</code> in your environment variables to enable the interactive weather map.
                </p>
                <div className="mt-4 p-3 bg-muted rounded-md text-xs text-left font-mono max-w-sm">
                  <p># Get a free testing key at:</p>
                  <a
                    href="https://api.windy.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    https://api.windy.com/keys
                  </a>
                  <p className="mt-1"># Add to .env file:</p>
                  <p>WINDY_API_KEY=your_key_here</p>
                </div>
              </div>
            ) : (
              <div
                id="windy"
                ref={windyContainerRef}
                className="w-full h-[500px] rounded-md overflow-hidden"
              />
            )}
            {!windyLoaded && config?.windy?.mapApiKey && !windyError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Loading weather map...</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Forecast Data Section */}
      {selectedLocation && (
        <Tabs defaultValue="temperature" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <TabsList>
              <TabsTrigger value="temperature">Temperature</TabsTrigger>
              <TabsTrigger value="wind">Wind</TabsTrigger>
              <TabsTrigger value="precipitation">Precipitation</TabsTrigger>
              <TabsTrigger value="pressure">Pressure</TabsTrigger>
              <TabsTrigger value="clouds">Clouds</TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground">Model: GFS (Global)</Label>
              <Button variant="outline" size="icon" onClick={() => refetchForecast()}>
                <RefreshCw className={`h-4 w-4 ${forecastLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {forecastLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="text-muted-foreground">Loading forecast data...</span>
              </CardContent>
            </Card>
          ) : !processedForecast ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Info className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">
                  {config?.windy?.configured
                    ? "Select a location to view forecast data"
                    : "Configure WINDY_API_KEY to enable point forecasts"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Temperature Tab */}
              <TabsContent value="temperature">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Thermometer className="h-4 w-4" />
                      Temperature Forecast — {selectedLocation.displayName.split(",")[0]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={processedForecast}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis unit="°C" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="temp" name="Temperature (°C)" stroke="#ef4444" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="dewpoint" name="Dew Point (°C)" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Wind Tab */}
              <TabsContent value="wind">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wind className="h-4 w-4" />
                      Wind Forecast — {selectedLocation.displayName.split(",")[0]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={processedForecast}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis unit=" km/h" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="windSpeed" name="Wind Speed (km/h)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="gust" name="Gusts (km/h)" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Precipitation Tab */}
              <TabsContent value="precipitation">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CloudRain className="h-4 w-4" />
                      Precipitation Forecast — {selectedLocation.displayName.split(",")[0]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <BarChart data={processedForecast}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis unit=" mm" />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="precip" name="Precipitation (mm/3h)" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={processedForecast}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis unit="%" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#10b981" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Pressure Tab */}
              <TabsContent value="pressure">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Gauge className="h-4 w-4" />
                      Pressure Forecast — {selectedLocation.displayName.split(",")[0]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={350}>
                      <LineChart data={processedForecast}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis domain={["auto", "auto"]} unit=" hPa" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="pressure" name="Pressure (hPa)" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Clouds Tab */}
              <TabsContent value="clouds">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Cloud className="h-4 w-4" />
                      Cloud Cover & CAPE — {selectedLocation.displayName.split(",")[0]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={processedForecast}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis unit="%" />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="lowClouds" name="Low Clouds (%)" stroke="#94a3b8" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="midClouds" name="Mid Clouds (%)" stroke="#64748b" strokeWidth={1.5} dot={false} />
                        <Line type="monotone" dataKey="highClouds" name="High Clouds (%)" stroke="#475569" strokeWidth={1} dot={false} strokeDasharray="5 5" />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="mt-4">
                      <h4 className="text-sm font-medium mb-2">CAPE Index (Convective Available Potential Energy)</h4>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={processedForecast}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                          <YAxis unit=" J/kg" />
                          <Tooltip />
                          <Bar dataKey="cape" name="CAPE (J/kg)" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

            </>
          )}
        </Tabs>
      )}


    </div>
  );
}


