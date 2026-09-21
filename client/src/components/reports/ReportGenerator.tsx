// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { safeFixed } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import type { WeatherStation, WeatherData } from "@shared/schema";
// getSimplifiedClasses and WIND_DIRECTIONS went with the browser-side wind
// roses: the server renderer builds its own rose and scatter from the same
// constants, server side, so there is nothing left here to bin wind data for.
import { getWindUnitLabel, type WindSpeedUnit } from "@/lib/windConstants";
import { format } from "date-fns";

interface ReportConfig {
  stationId: number;
  startDate: string;
  endDate: string;
  reportType: "daily" | "weekly" | "monthly" | "custom";
  includeTemperature: boolean;
  includeHumidity: boolean;
  includeDewPoint: boolean;
  includePressure: boolean;
  includeWind: boolean;
  includeRainfall: boolean;
  includeSolar: boolean;
  includeUV: boolean;
  includeBattery: boolean;
  includeETo: boolean;
  includeSoilTemp: boolean;
  includeSoilMoisture: boolean;
  includePM10: boolean;
  includePM25: boolean;
  includeWaterLevel: boolean;
  includeLightning: boolean;
  includeVisibility: boolean;
  includeAirDensity: boolean;
  includeChargerVoltage: boolean;
  includePanelTemp: boolean;
  includeTemp8m: boolean;
  includeDeltaTemp: boolean;
  includeMPPT: boolean;
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
    includeDewPoint: false,
    includePressure: true,
    includeWind: true,
    includeRainfall: true,
    includeSolar: true,
    includeUV: false,
    includeBattery: false,
    includeETo: false,
    includeSoilTemp: false,
    includeSoilMoisture: false,
    includePM10: false,
    includePM25: false,
    includeWaterLevel: false,
    includeLightning: false,
    includeVisibility: false,
    includeAirDensity: false,
    includeChargerVoltage: false,
    includePanelTemp: false,
    includeTemp8m: false,
    includeDeltaTemp: false,
    includeMPPT: false,
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
  const stationWindUnit = (selectedStation as any)?.windSpeedUnit;
  const windUnitLabel = getWindUnitLabel((stationWindUnit as WindSpeedUnit) || 'ms');

  const calculateStatistics = (values: (number | null | undefined)[]) => {
    const valid = values.filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
    if (valid.length === 0) return { min: 0, max: 0, avg: 0, stdDev: 0, count: 0, total: values.length };
    
    let min = valid[0], max = valid[0], sum = 0;
    for (const v of valid) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    const avg = sum / valid.length;
    let sqDiffSum = 0;
    for (const v of valid) {
      sqDiffSum += (v - avg) ** 2;
    }
    const stdDev = Math.sqrt(sqDiffSum / valid.length);
    
    return { min, max, avg, stdDev, count: valid.length, total: values.length };
  };

  /**
   * Download the PDF from the server renderer.
   *
   * THIS USED TO BUILD ITS OWN PDF IN THE BROWSER WITH jsPDF, and that was the
   * problem. There were two unrelated implementations of "the weather report":
   * this one, and the pdfkit renderer the scheduler attaches to email. They
   * shared no code and agreed on almost nothing. The scheduled PDF leads with a
   * station heading, a labelled site list, a satellite view and a six-column
   * statistics table, then wind analysis and time-series graphs, with a page
   * footer throughout. The browser one emitted a centred title, per-parameter
   * text blocks carrying a standard deviation, three wind roses rasterised to
   * PNG, and no maps, no graphs and no footer. Which document you got depended
   * on which button you pressed.
   *
   * So this now calls GET /api/reports/pdf, the same endpoint the Report
   * Scheduling page downloads from and the same buildSchedulePdfBuffer the
   * scheduler emails. One renderer, one format, and a change to the report is
   * made in one place instead of two.
   */
  const generatePDFReport = async () => {
    if (!selectedStation) {
      toast({
        title: "No station selected",
        description: "Pick a station before generating a report.",
        variant: "destructive",
      });
      return;
    }

    /**
     * This page's per-parameter switches, translated to the aggregate keys the
     * server report selects on.
     *
     * The renderer works in REPORT_FIELDS keys ("temp_min", "wind_gust_max",
     * "rainfall_total"), never in bare parameter names, so the two vocabularies
     * have to be mapped explicitly. Asking for "temperature" would match
     * nothing and silently produce a table with no rows in it.
     */
    const FIELD_KEY_MAP: Array<{ flag: keyof ReportConfig; keys: string[] }> = [
      { flag: "includeTemperature", keys: ["temp_min", "temp_avg", "temp_max"] },
      { flag: "includeHumidity",    keys: ["humidity_avg"] },
      { flag: "includePressure",    keys: ["pressure_avg"] },
      { flag: "includeWind",        keys: ["wind_avg", "wind_max", "wind_gust_max"] },
      { flag: "includeRainfall",    keys: ["rainfall_total"] },
      { flag: "includeSolar",       keys: ["solar_avg", "solar_total"] },
      { flag: "includeETo",         keys: ["eto_total"] },
      { flag: "includeBattery",     keys: ["battery_min", "battery_avg"] },
      { flag: "includeLightning",   keys: [
        "lightning_strikes", "lightning_dist_min", "lightning_dist_avg",
        "lightning_energy_max", "lightning_energy_avg",
      ] },
    ];

    /**
     * Switches on this page that the report does not carry at all.
     *
     * These have no aggregate key, so there is no way to ask the renderer for
     * them. Rather than drop them without a word, a ticked one is named in the
     * completion message and the reader is pointed at the CSV export, which does
     * include every column. Dew point is deliberately absent from this list: it
     * has no table row either, but it is always plotted on the graphs page.
     */
    const UNMAPPED_PARAMETERS: Array<{ flag: keyof ReportConfig; label: string }> = [
      { flag: "includeUV",             label: "UV index" },
      { flag: "includeSoilTemp",       label: "soil temperature" },
      { flag: "includeSoilMoisture",   label: "soil moisture" },
      { flag: "includePM10",           label: "PM10" },
      { flag: "includePM25",           label: "PM2.5" },
      { flag: "includeWaterLevel",     label: "water level" },
      { flag: "includeVisibility",     label: "visibility" },
      { flag: "includeAirDensity",     label: "air density" },
      { flag: "includeChargerVoltage", label: "charger voltage" },
      { flag: "includePanelTemp",      label: "panel temperature" },
      { flag: "includeTemp8m",         label: "temperature at 8 m" },
      { flag: "includeDeltaTemp",      label: "delta temperature" },
      { flag: "includeMPPT",           label: "MPPT charger" },
    ];

    setIsGenerating(true);
    try {
      // Whole days, matching the dates picked above and the window the on-screen
      // data query already uses, so the PDF covers exactly what the page shows.
      const fromISO = new Date(`${config.startDate}T00:00:00`).toISOString();
      const toISO = new Date(`${config.endDate}T23:59:59`).toISOString();

      const fields = FIELD_KEY_MAP
        .filter((m) => config[m.flag] === true)
        .flatMap((m) => m.keys);

      const params = new URLSearchParams({
        stationIds: String(config.stationId),
        from: fromISO,
        to: toISO,
        title: `${selectedStation.name || "Station"} Weather Data Report`,
      });
      /**
       * Only send `fields` when something is actually selected.
       *
       * An empty list means "every field" on the server side, which is the right
       * outcome for a report with nothing ticked. Sending `fields=` explicitly
       * would be indistinguishable from that but relies on the endpoint's
       * filtering of blank entries, so the intent is stated here instead.
       */
      if (fields.length > 0) params.set("fields", fields.join(","));

      const res = await authFetch(`/api/reports/pdf?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      const blob = await res.blob();

      const safeName = (selectedStation.name || "station").replace(/[^a-z0-9._-]+/gi, "-");
      const filename = `weather-report-${safeName}-${config.startDate}-to-${config.endDate}.pdf`;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);

      const skipped = UNMAPPED_PARAMETERS
        .filter((p) => config[p.flag] === true)
        .map((p) => p.label);
      toast({
        title: "Report Generated",
        description: skipped.length > 0
          ? `Downloaded ${filename}. This report does not cover ${skipped.join(", ")}; the CSV export includes those columns.`
          : `Downloaded ${filename}`,
      });
    } catch (err) {
      console.error("PDF generation error:", err);
      toast({
        title: "Error",
        description: `Failed to generate report: ${err instanceof Error ? err.message : String(err)}`,
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const generateCSVReport = () => {
    // Helper: properly quote CSV values (RFC 4180 compliant)
    const csvVal = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    // Define all possible columns with consistent precision per parameter type
    const allColumns: Array<{
      key: string;
      header: string;
      enabled: boolean;
      getValue: (d: WeatherData) => number | null | undefined;
      decimals: number;
    }> = [
      { key: "temperature", header: "Temperature (°C)", enabled: config.includeTemperature, getValue: (d) => d.temperature, decimals: 2 },
      { key: "humidity", header: "Humidity (%)", enabled: config.includeHumidity, getValue: (d) => d.humidity, decimals: 1 },
      { key: "dewPoint", header: "Dew Point (°C)", enabled: config.includeDewPoint, getValue: (d) => d.dewPoint, decimals: 2 },
      { key: "pressure", header: "Pressure (hPa)", enabled: config.includePressure, getValue: (d) => d.pressure, decimals: 2 },
      { key: "windSpeed", header: `Wind Speed (${windUnitLabel})`, enabled: config.includeWind, getValue: (d) => d.windSpeed, decimals: 2 },
      { key: "windDirection", header: "Wind Direction (deg)", enabled: config.includeWind, getValue: (d) => d.windDirection, decimals: 0 },
      { key: "windGust", header: `Wind Gust (${windUnitLabel})`, enabled: config.includeWind, getValue: (d) => d.windGust, decimals: 2 },
      { key: "rainfall", header: "Rainfall (mm)", enabled: config.includeRainfall, getValue: (d) => d.rainfall, decimals: 2 },
      { key: "solarRadiation", header: "Solar Radiation (W/m2)", enabled: config.includeSolar, getValue: (d) => d.solarRadiation, decimals: 1 },
      { key: "uvIndex", header: "UV Index", enabled: config.includeUV, getValue: (d) => (d as any).uvIndex, decimals: 1 },
      { key: "batteryVoltage", header: "Battery Voltage (V)", enabled: config.includeBattery, getValue: (d) => d.batteryVoltage, decimals: 3 },
      { key: "eto", header: "ETo (mm/day)", enabled: config.includeETo, getValue: (d) => d.eto, decimals: 3 },
      { key: "soilTemperature", header: "Soil Temperature (°C)", enabled: config.includeSoilTemp, getValue: (d) => d.soilTemperature, decimals: 2 },
      { key: "soilMoisture", header: "Soil Moisture (%)", enabled: config.includeSoilMoisture, getValue: (d) => d.soilMoisture, decimals: 2 },
      { key: "pm10", header: "PM10 (ug/m3)", enabled: config.includePM10, getValue: (d) => d.pm10, decimals: 1 },
      { key: "pm25", header: "PM2.5 (ug/m3)", enabled: config.includePM25, getValue: (d) => d.pm25, decimals: 1 },
      { key: "waterLevel", header: "Water Level (m)", enabled: config.includeWaterLevel, getValue: (d) => d.waterLevel, decimals: 3 },
      { key: "lightning", header: "Lightning Strikes", enabled: config.includeLightning, getValue: (d) => d.lightning, decimals: 0 },
      { key: "lightningDistance", header: "Lightning Distance (km)", enabled: config.includeLightning, getValue: (d) => d.lightningDistance, decimals: 1 },
      { key: "lightningEnergy", header: "Lightning Energy", enabled: config.includeLightning, getValue: (d) => d.lightningEnergy, decimals: 0 },
      { key: "lightningRaw", header: "Lightning Raw (mA)", enabled: config.includeLightning, getValue: (d) => d.lightningRaw, decimals: 3 },
      { key: "visibility", header: "Visibility (km)", enabled: config.includeVisibility, getValue: (d) => d.visibility, decimals: 2 },
      { key: "visibilityVolt", header: "Visibility Volt (V)", enabled: config.includeVisibility, getValue: (d) => d.visibilityVolt, decimals: 3 },
      { key: "airDensity", header: "Air Density (kg/m3)", enabled: config.includeAirDensity, getValue: (d) => d.airDensity, decimals: 4 },
      { key: "chargerVoltage", header: "Charger Voltage (V)", enabled: config.includeChargerVoltage, getValue: (d) => d.chargerVoltage, decimals: 3 },
      { key: "panelTemperature", header: "Panel Temperature (°C)", enabled: config.includePanelTemp, getValue: (d) => d.panelTemperature, decimals: 2 },
      { key: "temperature8m", header: "Temperature 8m (°C)", enabled: config.includeTemp8m, getValue: (d) => d.temperature8m, decimals: 2 },
      { key: "deltaTemperature", header: "Delta Temperature (°C)", enabled: config.includeDeltaTemp, getValue: (d) => d.deltaTemperature, decimals: 3 },
      { key: "mpptSolarPower", header: "MPPT Solar Power (W)", enabled: config.includeMPPT, getValue: (d) => d.mpptSolarPower, decimals: 2 },
      { key: "mpptBatteryVoltage", header: "MPPT Battery Voltage (V)", enabled: config.includeMPPT, getValue: (d) => d.mpptBatteryVoltage, decimals: 3 },
      { key: "mpptSolarVoltage", header: "MPPT Solar Voltage (V)", enabled: config.includeMPPT, getValue: (d) => d.mpptSolarVoltage, decimals: 3 },
    ];

    // Filter: only include columns that are enabled AND have actual data
    const columns = allColumns.filter(col => {
      if (!col.enabled) return false;
      return weatherData.some(d => {
        const v = col.getValue(d);
        return v !== null && v !== undefined;
      });
    });

    const lines: string[] = [];

    /**
     * Column headers go on line 1, and the provenance block moves to the end.
     *
     * The metadata used to be written first, as a dozen lines each prefixed with
     * "#". That convention comes from tools that treat "#" as a comment; a
     * spreadsheet does not. Excel and Sheets read line 1 as the header row, so
     * every export opened with "# Stratus Weather Server - Data Export" sitting
     * where the column names belong and the real headings buried on row 13. That
     * is also why a reader ends up navigating by column letter instead of by
     * name.
     *
     * Header first means the file opens with named columns, and sorting,
     * filtering and pivot tables all work on the data range without the reader
     * having to strip anything. The provenance is still in the file, just below
     * the data where it cannot be mistaken for a header.
     */
    const headerCells = ["Timestamp_UTC", ...columns.map(c => c.header)].map(csvVal);

    // --- Data Rows ---
    const dataRows: string[][] = [];
    for (const d of weatherData) {
      const ts = new Date(d.timestamp).toISOString();
      const vals: string[] = [ts];
      for (const col of columns) {
        const v = col.getValue(d);
        if (v === null || v === undefined) {
          vals.push("");
        } else {
          vals.push(Number(v).toFixed(col.decimals));
        }
      }
      dataRows.push(vals);
    }

    /**
     * Statistics rows are built before anything is written, not after.
     *
     * They share the column grid with the data, so their cell contents have to be
     * known before the widths can be worked out. "# Completeness (%)" is the
     * longest label in the first column and would otherwise be the one thing that
     * did not line up.
     */
    const statRowCells: string[][] = [];
    if (config.includeStatistics) {
      const statSpecs: Array<{
        label: string;
        fn: (stats: ReturnType<typeof calculateStatistics>, col: typeof columns[0]) => string;
      }> = [
        { label: "# Minimum", fn: (s, c) => s.count > 0 ? Number(s.min).toFixed(c.decimals) : "" },
        { label: "# Maximum", fn: (s, c) => s.count > 0 ? Number(s.max).toFixed(c.decimals) : "" },
        { label: "# Mean", fn: (s, c) => s.count > 0 ? Number(s.avg).toFixed(c.decimals) : "" },
        { label: "# Std Dev", fn: (s, c) => s.count > 0 ? Number(s.stdDev).toFixed(c.decimals + 1) : "" },
        { label: "# Completeness (%)", fn: (s) => s.total > 0 ? ((s.count / s.total) * 100).toFixed(1) : "0.0" },
      ];
      // One pass per column rather than per column per row: calculateStatistics
      // walks every reading, so doing it inside the row loop repeated the whole
      // scan five times over.
      const perColumn = columns.map(col => calculateStatistics(weatherData.map(col.getValue)));
      for (const spec of statSpecs) {
        statRowCells.push([
          spec.label,
          ...columns.map((col, i) => spec.fn(perColumn[i], col)),
        ]);
      }
    }

    /**
     * Pad every cell so the columns line up under their headings.
     *
     * Without this the file is valid CSV that is unreadable as text: a heading
     * like "Solar Radiation (W/m2)" is 22 characters and its values are 5, so
     * nothing below row 1 sits under the name it belongs to and the file can only
     * be read in a spreadsheet.
     *
     * Two deliberate choices:
     *
     *  - Padding goes on the RIGHT, so the value still begins immediately after
     *    its comma. Spaces inside a field are part of the field under RFC 4180,
     *    and a numeric column with LEADING spaces is what makes Excel import the
     *    column as text. Trailing spaces are trimmed when a cell is coerced to a
     *    number, so this stays machine-readable.
     *  - The last column is not padded, because trailing whitespace at the end of
     *    a line buys no alignment and some diff and lint tools flag it.
     *
     * The provenance block is left unpadded: those lines are prose, not table
     * rows, and stretching them to the data grid would only misalign them.
     */
    const colCount = headerCells.length;
    const widths = new Array<number>(colCount).fill(0);
    for (const row of [headerCells, ...dataRows, ...statRowCells]) {
      for (let i = 0; i < colCount; i++) {
        const len = (row[i] ?? "").length;
        if (len > widths[i]) widths[i] = len;
      }
    }
    const padCell = (s: string, i: number): string =>
      i === colCount - 1 ? s : s + " ".repeat(Math.max(0, widths[i] - s.length));
    const formatRow = (row: string[]): string =>
      row.map((cell, i) => padCell(cell ?? "", i)).join(",");

    lines.push(formatRow(headerCells));
    for (const row of dataRows) lines.push(formatRow(row));

    /**
     * Provenance block, after the data.
     *
     * A blank line separates it so a spreadsheet's "current region" detection
     * stops at the end of the readings, which keeps autofilter and sort ranges
     * clean. The "#" prefix is kept as a visual marker that these rows are not
     * observations.
     */
    lines.push("");
    lines.push("# Stratus Weather Server - Data Export");
    lines.push(`# Station: ${csvVal(selectedStation?.name || "Unknown")}`);
    lines.push(`# Location: ${csvVal(selectedStation?.location || "N/A")}`);
    if (selectedStation?.latitude != null && selectedStation?.longitude != null) {
      lines.push(`# Coordinates: ${safeFixed(selectedStation.latitude, 6)}, ${safeFixed(selectedStation.longitude, 6)}`);
    }
    if (selectedStation?.altitude != null) {
      lines.push(`# Altitude: ${safeFixed(selectedStation.altitude, 1)} m AMSL`);
    }
    lines.push(`# Period: ${config.startDate} to ${config.endDate}`);
    lines.push(`# Export Date: ${new Date().toISOString()}`);
    lines.push(`# Total Records: ${weatherData.length}`);
    lines.push(`# Parameters: ${columns.length}`);
    lines.push(`# Timestamp Format: ISO 8601 (UTC)`);
    lines.push(`# Missing Values: (empty)`);

    // --- Statistics Summary Block ---
    // Built above, alongside the data, so it shares the same column widths.
    if (statRowCells.length > 0) {
      lines.push("#");
      lines.push("# --- Statistics Summary ---");
      for (const row of statRowCells) lines.push(formatRow(row));
    }

    // UTF-8 BOM for Excel compatibility + CSV content
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weather-data-${selectedStation?.name?.replace(/\s+/g, "-") || "station"}-${config.startDate}-to-${config.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "CSV Exported",
      description: `Downloaded ${weatherData.length} records, ${columns.length} parameters`,
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
              { key: "includeDewPoint", label: "Dew Point" },
              { key: "includePressure", label: "Pressure" },
              { key: "includeWind", label: "Wind" },
              { key: "includeRainfall", label: "Rainfall" },
              { key: "includeSolar", label: "Solar Radiation" },
              { key: "includeUV", label: "UV Index" },
              { key: "includeBattery", label: "Battery Voltage" },
              { key: "includeETo", label: "Evapotranspiration (ETo)" },
              { key: "includeSoilTemp", label: "Soil Temperature" },
              { key: "includeSoilMoisture", label: "Soil Moisture" },
              { key: "includePM10", label: "PM10 (Air Quality)" },
              { key: "includePM25", label: "PM2.5 (Air Quality)" },
              { key: "includeWaterLevel", label: "Water Level" },
              { key: "includeLightning", label: "Lightning" },
              { key: "includeVisibility", label: "Visibility" },
              { key: "includeAirDensity", label: "Air Density" },
              { key: "includeChargerVoltage", label: "Charger Voltage" },
              { key: "includePanelTemp", label: "Panel Temperature" },
              { key: "includeTemp8m", label: "Temperature 8m" },
              { key: "includeDeltaTemp", label: "Delta Temperature" },
              { key: "includeMPPT", label: "MPPT Solar Charger" },
              // CSV only. The PDF's statistics table is the core of that
              // document and is always present, so this switch no longer has
              // anything to do with it.
              { key: "includeStatistics", label: "Statistics summary (CSV)" },
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
