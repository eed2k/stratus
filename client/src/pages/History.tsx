import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { safeFixed } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download, Calendar, Radio, Plus, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { WeatherStation, WeatherData } from "@shared/schema";

export default function History() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedStation, setSelectedStation] = useState<string>("");

  const { data: stations = [], isLoading: stationsLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  const activeStationId = selectedStation || (stations.length > 0 ? String(stations[0].id) : "");

  const { data: weatherData = [], isLoading: dataLoading, refetch } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", activeStationId, "data", "history", startDate, endDate],
    queryFn: async () => {
      if (!activeStationId || !startDate || !endDate) return [];
      // Convert dates to ISO strings with time components
      const startISO = new Date(startDate + "T00:00:00").toISOString();
      const endISO = new Date(endDate + "T23:59:59").toISOString();
      const res = await authFetch(
        `/api/stations/${activeStationId}/data?startTime=${startISO}&endTime=${endISO}`
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeStationId && !!startDate && !!endDate,
  });

  const handleApplyFilters = () => {
    if (!startDate || !endDate) {
      return;
    }
    refetch();
  };

  const handleExportCSV = () => {
    if (weatherData.length === 0) return;
    
    const headers = [
      "Timestamp", "Temperature", "Humidity", "Pressure", "Wind Speed", "Wind Direction",
      "Wind Gust", "Rainfall", "Solar Radiation", "UV Index", "Dew Point", "ETo",
      "Battery Voltage", "Panel Temp", "Soil Temp", "Soil Moisture",
      "PM10", "PM2.5", "Air Density",
      "Water Level (mm)", "Temp Switch (mV)", "Level Switch (On/Off)", "Temp Switch Outlet (mV)", "Level Switch Status",
      "Lightning", "Charger Voltage",
    ];
    const rows = weatherData.map(d => [
      new Date(d.timestamp).toISOString(),
      d.temperature?.toString() || "",
      d.humidity?.toString() || "",
      d.pressure?.toString() || "",
      d.windSpeed?.toString() || "",
      d.windDirection?.toString() || "",
      d.windGust?.toString() || "",
      d.rainfall?.toString() || "",
      d.solarRadiation?.toString() || "",
      d.uvIndex?.toString() || "",
      d.dewPoint?.toString() || "",
      d.eto?.toString() || "",
      d.batteryVoltage?.toString() || "",
      d.panelTemperature?.toString() || "",
      d.soilTemperature?.toString() || "",
      d.soilMoisture?.toString() || "",
      d.pm10?.toString() || "",
      d.pm25?.toString() || "",
      d.airDensity?.toString() || "",
      d.waterLevel?.toString() || "",
      d.temperatureSwitch?.toString() || "",
      d.levelSwitch?.toString() || "",
      d.temperatureSwitchOutlet?.toString() || "",
      d.levelSwitchStatus?.toString() || "",
      d.lightning?.toString() || "",
      d.chargerVoltage?.toString() || "",
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `weather_data_${activeStationId}_${startDate}_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
              Add a weather station to start viewing historical weather data.
            </p>
            <Link href="/stations">
              <Button data-testid="button-add-station-history">
                <Plus className="mr-2 h-4 w-4" />
                Add Station
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Historical Data</h1>
          <p className="text-sm text-muted-foreground">
            View and export historical weather records
          </p>
        </div>
        <Button variant="outline" data-testid="button-export-data" disabled={weatherData.length === 0} onClick={handleExportCSV}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Station</Label>
              <Select value={activeStationId} onValueChange={setSelectedStation}>
                <SelectTrigger data-testid="select-history-station">
                  <SelectValue placeholder="Select station" />
                </SelectTrigger>
                <SelectContent>
                  {stations.map((station) => (
                    <SelectItem key={station.id} value={String(station.id)}>
                      {station.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-10"
                  data-testid="input-start-date"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="pl-10"
                  data-testid="input-end-date"
                />
              </div>
            </div>
            <div className="flex items-end">
              <Button className="w-full" data-testid="button-apply-filters" onClick={handleApplyFilters}>
                Apply Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {dataLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : weatherData.length === 0 ? null : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {weatherData.length} Records — {stations.find(s => String(s.id) === activeStationId)?.name || "Station"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Timestamp</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Temp (°C)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Humidity (%)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Pressure (hPa)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Wind (m/s)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Gust (m/s)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Dir (°)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Rain (mm)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Solar (W/m²)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">UV</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Dew Pt (°C)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">ETo (mm)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">PM10 (µg/m³)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">PM2.5 (µg/m³)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Soil T (°C)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Soil M (%)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Battery (V)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Panel T (°C)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weatherData.map((row, i) => (
                    <TableRow key={i} data-testid={`row-history-${i}`}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">
                        {new Date(row.timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false })}
                      </TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.temperature, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.humidity, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.pressure, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.windSpeed, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.windGust, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{row.windDirection != null ? Math.round(row.windDirection) : "-"}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.rainfall, 2, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.solarRadiation, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.uvIndex, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.dewPoint, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.eto, 2, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.pm10, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.pm25, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.soilTemperature, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.soilMoisture, 1, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.batteryVoltage, 2, "-")}</TableCell>
                      <TableCell className="text-right font-mono">{safeFixed(row.panelTemperature, 1, "-")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
