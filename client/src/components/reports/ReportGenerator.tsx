import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { WeatherStation, WeatherData } from "@shared/schema";
import { format } from "date-fns";
import jsPDF from "jspdf";

interface ReportConfig {
  stationId: number;
  startDate: string;
  endDate: string;
  reportType: "daily" | "weekly" | "monthly" | "custom";
  includeTemperature: boolean;
  includeHumidity: boolean;
  includePressure: boolean;
  includeWind: boolean;
  includeRainfall: boolean;
  includeSolar: boolean;
  includeStatistics: boolean;
}

interface ReportGeneratorProps {
  stations: WeatherStation[];
}

export function ReportGenerator({ stations }: ReportGeneratorProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const [config, setConfig] = useState<ReportConfig>({
    stationId: stations[0]?.id || 0,
    startDate: format(weekAgo, "yyyy-MM-dd"),
    endDate: format(today, "yyyy-MM-dd"),
    reportType: "weekly",
    includeTemperature: true,
    includeHumidity: true,
    includePressure: true,
    includeWind: true,
    includeRainfall: true,
    includeSolar: true,
    includeStatistics: true,
  });

  const { data: weatherData = [], isLoading: isLoadingData, isError, error } = useQuery<WeatherData[]>({
    queryKey: ["/api/stations", config.stationId, "data", config.startDate, config.endDate],
    queryFn: async () => {
      // Convert dates to ISO strings with time components
      const startISO = new Date(config.startDate + "T00:00:00").toISOString();
      const endISO = new Date(config.endDate + "T23:59:59").toISOString();
      const res = await authFetch(
        `/api/stations/${config.stationId}/data?startTime=${startISO}&endTime=${endISO}`
      );
      if (!res.ok) throw new Error("Failed to fetch data");
      return res.json();
    },
    enabled: config.stationId > 0,
  });

  const selectedStation = stations.find((s) => s.id === config.stationId);

  const calculateStatistics = (values: number[]) => {
    if (values.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
    const valid = values.filter((v) => v !== null && !isNaN(v));
    if (valid.length === 0) return { min: 0, max: 0, avg: 0, count: 0 };
    
    return {
      min: Math.min(...valid),
      max: Math.max(...valid),
      avg: valid.reduce((a, b) => a + b, 0) / valid.length,
      count: valid.length,
    };
  };

  const generatePDFReport = async () => {
    setIsGenerating(true);
    
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 20;

      doc.setFontSize(20);
      doc.text("Weather Station Report", pageWidth / 2, y, { align: "center" });
      y += 15;

      doc.setFontSize(12);
      doc.text(`Station: ${selectedStation?.name || "Unknown"}`, 20, y);
      y += 7;
      doc.text(`Location: ${selectedStation?.location || "N/A"}`, 20, y);
      y += 7;
      doc.text(`Period: ${config.startDate} to ${config.endDate}`, 20, y);
      y += 7;
      doc.text(`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}`, 20, y);
      y += 15;

      doc.setLineWidth(0.5);
      doc.line(20, y, pageWidth - 20, y);
      y += 10;

      const sections: Array<{
        title: string;
        enabled: boolean;
        getValue: (d: WeatherData) => number | null;
        unit: string;
      }> = [
        { title: "Temperature", enabled: config.includeTemperature, getValue: (d) => d.temperature, unit: "°C" },
        { title: "Humidity", enabled: config.includeHumidity, getValue: (d) => d.humidity, unit: "%" },
        { title: "Pressure", enabled: config.includePressure, getValue: (d) => d.pressure, unit: "hPa" },
        { title: "Wind Speed", enabled: config.includeWind, getValue: (d) => d.windSpeed, unit: "km/h" },
        { title: "Rainfall", enabled: config.includeRainfall, getValue: (d) => d.rainfall, unit: "mm" },
        { title: "Solar Radiation", enabled: config.includeSolar, getValue: (d) => d.solarRadiation, unit: "W/m²" },
      ];

      for (const section of sections) {
        if (!section.enabled) continue;

        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(section.title, 20, y);
        y += 8;

        if (config.includeStatistics) {
          const values = weatherData
            .map(section.getValue)
            .filter((v): v is number => v !== null);
          const stats = calculateStatistics(values);

          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(`Minimum: ${stats.min.toFixed(1)} ${section.unit}`, 25, y);
          y += 5;
          doc.text(`Maximum: ${stats.max.toFixed(1)} ${section.unit}`, 25, y);
          y += 5;
          doc.text(`Average: ${stats.avg.toFixed(1)} ${section.unit}`, 25, y);
          y += 5;
          doc.text(`Data Points: ${stats.count}`, 25, y);
          y += 10;
        }
      }

      if (y > 250) {
        doc.addPage();
        y = 20;
      }

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Data Summary", 20, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Total Records: ${weatherData.length}`, 25, y);
      y += 5;
      
      if (weatherData.length > 0) {
        const firstDate = new Date(weatherData[0].timestamp);
        const lastDate = new Date(weatherData[weatherData.length - 1].timestamp);
        doc.text(`First Record: ${format(firstDate, "yyyy-MM-dd HH:mm")}`, 25, y);
        y += 5;
        doc.text(`Last Record: ${format(lastDate, "yyyy-MM-dd HH:mm")}`, 25, y);
      }

      const filename = `weather-report-${selectedStation?.name?.replace(/\s+/g, "-") || "station"}-${config.startDate}-to-${config.endDate}.pdf`;
      doc.save(filename);

      toast({
        title: "Report Generated",
        description: `Downloaded ${filename}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const generateCSVReport = () => {
    const headers = ["Timestamp"];
    if (config.includeTemperature) headers.push("Temperature (°C)");
    if (config.includeHumidity) headers.push("Humidity (%)");
    if (config.includePressure) headers.push("Pressure (hPa)");
    if (config.includeWind) headers.push("Wind Speed (km/h)", "Wind Direction (°)", "Wind Gust (km/h)");
    if (config.includeRainfall) headers.push("Rainfall (mm)");
    if (config.includeSolar) headers.push("Solar Radiation (W/m²)");

    const rows = weatherData.map((d) => {
      const row: string[] = [String(d.timestamp)];
      if (config.includeTemperature) row.push(d.temperature?.toString() || "");
      if (config.includeHumidity) row.push(d.humidity?.toString() || "");
      if (config.includePressure) row.push(d.pressure?.toString() || "");
      if (config.includeWind) {
        row.push(d.windSpeed?.toString() || "");
        row.push(d.windDirection?.toString() || "");
        row.push(d.windGust?.toString() || "");
      }
      if (config.includeRainfall) row.push(d.rainfall?.toString() || "");
      if (config.includeSolar) row.push(d.solarRadiation?.toString() || "");
      return row.join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weather-data-${selectedStation?.name?.replace(/\s+/g, "-") || "station"}-${config.startDate}-to-${config.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "CSV Exported",
      description: `Downloaded ${weatherData.length} records`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report Generator</CardTitle>
        <CardDescription>
          Create custom weather reports in PDF or CSV format
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Station</Label>
            <Select
              value={config.stationId.toString()}
              onValueChange={(v) => setConfig((c) => ({ ...c, stationId: parseInt(v) }))}
            >
              <SelectTrigger data-testid="select-report-station">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stations.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Report Type</Label>
            <Select
              value={config.reportType}
              onValueChange={(v: ReportConfig["reportType"]) => {
                const today = new Date();
                let start = today;
                
                if (v === "daily") {
                  start = today;
                } else if (v === "weekly") {
                  start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                } else if (v === "monthly") {
                  start = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
                }
                
                setConfig((c) => ({
                  ...c,
                  reportType: v,
                  startDate: format(start, "yyyy-MM-dd"),
                  endDate: format(today, "yyyy-MM-dd"),
                }));
              }}
            >
              <SelectTrigger data-testid="select-report-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={config.startDate}
              onChange={(e) => setConfig((c) => ({ ...c, startDate: e.target.value }))}
              data-testid="input-report-start"
            />
          </div>
          <div className="space-y-2">
            <Label>End Date</Label>
            <Input
              type="date"
              value={config.endDate}
              onChange={(e) => setConfig((c) => ({ ...c, endDate: e.target.value }))}
              data-testid="input-report-end"
            />
          </div>
        </div>

        <div className="space-y-3">
          <Label>Include in Report</Label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { key: "includeTemperature", label: "Temperature" },
              { key: "includeHumidity", label: "Humidity" },
              { key: "includePressure", label: "Pressure" },
              { key: "includeWind", label: "Wind" },
              { key: "includeRainfall", label: "Rainfall" },
              { key: "includeSolar", label: "Solar Radiation" },
              { key: "includeStatistics", label: "Statistics (PDF)" },
            ].map((item) => (
              <div key={item.key} className="flex items-center gap-2">
                <Checkbox
                  id={item.key}
                  checked={config[item.key as keyof ReportConfig] as boolean}
                  onCheckedChange={(checked) =>
                    setConfig((c) => ({ ...c, [item.key]: checked }))
                  }
                  data-testid={`checkbox-${item.key}`}
                />
                <Label htmlFor={item.key} className="text-sm font-normal cursor-pointer">
                  {item.label}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={generatePDFReport}
            disabled={isGenerating || weatherData.length === 0 || config.stationId === 0}
            data-testid="button-generate-pdf"
          >
            {isGenerating ? "Generating..." : "Generate PDF Report"}
          </Button>
          <Button
            variant="outline"
            onClick={generateCSVReport}
            disabled={weatherData.length === 0 || config.stationId === 0 || isLoadingData}
            data-testid="button-export-csv"
          >
            Export CSV Data
          </Button>
        </div>

        {/* Status feedback for users */}
        {config.stationId === 0 ? (
          <p className="text-sm text-amber-600">
            ⚠️ Please select a station to generate reports
          </p>
        ) : isLoadingData ? (
          <p className="text-sm text-muted-foreground">
            Loading data for selected period...
          </p>
        ) : isError ? (
          <p className="text-sm text-red-600">
            ❌ Error loading data: {(error as Error)?.message || 'Unknown error'}
          </p>
        ) : weatherData.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No data available for the selected period. Try adjusting the date range.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            ✓ {weatherData.length} records available for selected period
          </p>
        )}
      </CardContent>
    </Card>
  );
}
