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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WeatherChart } from "@/components/charts/WeatherChart";
import { Download, Calendar, Filter, Radio, Plus, Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { WeatherStation, WeatherData } from "@shared/schema";

export default function History() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedStation, setSelectedStation] = useState<string>("");
  const [viewMode, setViewMode] = useState("chart");

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
    
    const headers = ["Timestamp", "Temperature", "Humidity", "Pressure", "Wind Speed", "Wind Direction", "Rainfall"];
    const rows = weatherData.map(d => [
      new Date(d.timestamp).toISOString(),
      d.temperature?.toString() || "",
      d.humidity?.toString() || "",
      d.pressure?.toString() || "",
      d.windSpeed?.toString() || "",
      d.windDirection?.toString() || "",
      d.rainfall?.toString() || "",
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

  const chartData = weatherData.map((d) => ({
    timestamp: new Date(d.timestamp).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
    temperature: d.temperature || 0,
    humidity: d.humidity || 0,
    pressure: d.pressure || 0,
    windSpeed: d.windSpeed || 0,
  }));

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
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="h-5 w-5" />
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
      ) : weatherData.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">No historical data available for this station yet.</p>
            <p className="text-sm text-muted-foreground mt-2">Data will appear here once your station starts collecting measurements.</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs value={viewMode} onValueChange={setViewMode}>
          <TabsList>
            <TabsTrigger value="chart" data-testid="tab-chart-view">Chart View</TabsTrigger>
            <TabsTrigger value="table" data-testid="tab-table-view">Table View</TabsTrigger>
          </TabsList>

          <TabsContent value="chart" className="mt-4 space-y-4">
            <WeatherChart
              title="Temperature History"
              data={chartData}
              series={[
                { dataKey: "temperature", name: "Temperature (°C)", color: "#ef4444" },
              ]}
              timeRanges={["1d", "7d", "30d", "90d"]}
              defaultRange="7d"
            />
            <WeatherChart
              title="Wind Speed History"
              data={chartData}
              series={[
                { dataKey: "windSpeed", name: "Wind Speed (km/h)", color: "#14b8a6" },
              ]}
              timeRanges={["1d", "7d", "30d", "90d"]}
              defaultRange="7d"
            />
          </TabsContent>

          <TabsContent value="table" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <div className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Timestamp</TableHead>
                        <TableHead className="text-right">Temp (°C)</TableHead>
                        <TableHead className="text-right">Humidity (%)</TableHead>
                        <TableHead className="text-right">Pressure (hPa)</TableHead>
                        <TableHead className="text-right">Wind (km/h)</TableHead>
                        <TableHead className="text-right">Direction (°)</TableHead>
                        <TableHead className="text-right">Rain (mm)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {weatherData.map((row, i) => (
                        <TableRow key={i} data-testid={`row-history-${i}`}>
                          <TableCell className="font-mono text-sm">
                            {new Date(row.timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false })}
                          </TableCell>
                          <TableCell className="text-right font-mono">{safeFixed(row.temperature, 1, "-")}</TableCell>
                          <TableCell className="text-right font-mono">{row.humidity || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{safeFixed(row.pressure, 1, "-")}</TableCell>
                          <TableCell className="text-right font-mono">{safeFixed(row.windSpeed, 1, "-")}</TableCell>
                          <TableCell className="text-right font-mono">{row.windDirection || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{safeFixed(row.rainfall, 2, "-")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
