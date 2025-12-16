import { useState } from "react";
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
import { Download, Calendar, Filter } from "lucide-react";

const generateHistoricalData = () => {
  const data = [];
  const now = new Date();
  for (let i = 168; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    data.push({
      timestamp: time.toLocaleString(),
      shortTime: time.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      temperature: (20 + Math.sin(i / 12) * 5 + Math.random() * 2).toFixed(1),
      humidity: Math.round(60 + Math.cos(i / 8) * 15 + Math.random() * 5),
      pressure: (1013 + Math.sin(i / 24) * 5).toFixed(1),
      windSpeed: (10 + Math.random() * 15).toFixed(1),
      windDir: Math.round(Math.random() * 360),
      rain: (Math.random() > 0.9 ? Math.random() * 2 : 0).toFixed(2),
    });
  }
  return data;
};

export default function History() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedStation, setSelectedStation] = useState("1");
  const [viewMode, setViewMode] = useState("chart");
  const [historicalData] = useState(() => generateHistoricalData());

  const chartData = historicalData.slice(-48).map((d) => ({
    timestamp: d.shortTime,
    temperature: parseFloat(d.temperature),
    humidity: d.humidity,
    pressure: parseFloat(d.pressure),
    windSpeed: parseFloat(d.windSpeed),
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
        <Button variant="outline" data-testid="button-export-data">
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
              <Select value={selectedStation} onValueChange={setSelectedStation}>
                <SelectTrigger data-testid="select-history-station">
                  <SelectValue placeholder="Select station" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Kommetjie Weather</SelectItem>
                  <SelectItem value="2">Table Mountain</SelectItem>
                  <SelectItem value="3">Stellenbosch</SelectItem>
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
              <Button className="w-full" data-testid="button-apply-filters">
                Apply Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
                    {historicalData.slice(0, 50).map((row, i) => (
                      <TableRow key={i} data-testid={`row-history-${i}`}>
                        <TableCell className="font-mono text-sm">{row.timestamp}</TableCell>
                        <TableCell className="text-right font-mono">{row.temperature}</TableCell>
                        <TableCell className="text-right font-mono">{row.humidity}</TableCell>
                        <TableCell className="text-right font-mono">{row.pressure}</TableCell>
                        <TableCell className="text-right font-mono">{row.windSpeed}</TableCell>
                        <TableCell className="text-right font-mono">{row.windDir}</TableCell>
                        <TableCell className="text-right font-mono">{row.rain}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
