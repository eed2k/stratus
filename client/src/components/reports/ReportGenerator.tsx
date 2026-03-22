// Stratus Weather System
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
import { getWindUnitLabel, getSimplifiedClasses, WIND_DIRECTIONS, type WindSpeedUnit } from "@/lib/windConstants";
import { format } from "date-fns";
import jsPDF from "jspdf";

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
      if (selectedStation?.latitude != null && selectedStation?.longitude != null) {
        doc.text(`Coordinates: ${safeFixed(selectedStation.latitude, 4)}, ${safeFixed(selectedStation.longitude, 4)}`, 20, y);
        y += 7;
      }
      if (selectedStation?.altitude != null) {
        doc.text(`Altitude: ${safeFixed(selectedStation.altitude, 0)} m`, 20, y);
        y += 7;
      }
      doc.text(`Period: ${config.startDate} to ${config.endDate}`, 20, y);
      y += 7;
      doc.text(`Generated: ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}`, 20, y);
      y += 15;

      doc.setLineWidth(0.5);
      doc.line(20, y, pageWidth - 20, y);
      y += 10;

      const allSections: Array<{
        title: string;
        enabled: boolean;
        getValue: (d: WeatherData) => number | null;
        unit: string;
      }> = [
        { title: "Temperature", enabled: config.includeTemperature, getValue: (d) => d.temperature, unit: "°C" },
        { title: "Humidity", enabled: config.includeHumidity, getValue: (d) => d.humidity, unit: "%" },
        { title: "Dew Point", enabled: config.includeDewPoint, getValue: (d) => d.dewPoint, unit: "°C" },
        { title: "Pressure", enabled: config.includePressure, getValue: (d) => d.pressure, unit: "hPa" },
        { title: "Wind Speed", enabled: config.includeWind, getValue: (d) => d.windSpeed, unit: windUnitLabel },
        { title: "Wind Direction", enabled: config.includeWind, getValue: (d) => d.windDirection, unit: "°" },
        { title: "Wind Gust", enabled: config.includeWind, getValue: (d) => d.windGust, unit: windUnitLabel },
        { title: "Rainfall", enabled: config.includeRainfall, getValue: (d) => d.rainfall, unit: "mm" },
        { title: "Solar Radiation", enabled: config.includeSolar, getValue: (d) => d.solarRadiation, unit: "W/m2" },
        { title: "UV Index", enabled: config.includeUV, getValue: (d) => (d as any).uvIndex, unit: "" },
        { title: "Battery Voltage", enabled: config.includeBattery, getValue: (d) => d.batteryVoltage, unit: "V" },
        { title: "Evapotranspiration (ETo)", enabled: config.includeETo, getValue: (d) => d.eto, unit: "mm/day" },
        { title: "Soil Temperature", enabled: config.includeSoilTemp, getValue: (d) => d.soilTemperature, unit: "°C" },
        { title: "Soil Moisture", enabled: config.includeSoilMoisture, getValue: (d) => d.soilMoisture, unit: "%" },
        { title: "PM10", enabled: config.includePM10, getValue: (d) => d.pm10, unit: "ug/m3" },
        { title: "PM2.5", enabled: config.includePM25, getValue: (d) => d.pm25, unit: "ug/m3" },
        { title: "Water Level", enabled: config.includeWaterLevel, getValue: (d) => d.waterLevel, unit: "m" },
        { title: "Lightning Strikes", enabled: config.includeLightning, getValue: (d) => d.lightning, unit: "" },
        { title: "Lightning Distance", enabled: config.includeLightning, getValue: (d) => d.lightningDistance, unit: "km" },
        { title: "Lightning Energy", enabled: config.includeLightning, getValue: (d) => d.lightningEnergy, unit: "" },
        { title: "Lightning Raw", enabled: config.includeLightning, getValue: (d) => d.lightningRaw, unit: "mA" },
        { title: "Visibility", enabled: config.includeVisibility, getValue: (d) => d.visibility, unit: "km" },
        { title: "Visibility Volt", enabled: config.includeVisibility, getValue: (d) => d.visibilityVolt, unit: "V" },
        { title: "Air Density", enabled: config.includeAirDensity, getValue: (d) => d.airDensity, unit: "kg/m3" },
        { title: "Charger Voltage", enabled: config.includeChargerVoltage, getValue: (d) => d.chargerVoltage, unit: "V" },
        { title: "Panel Temperature", enabled: config.includePanelTemp, getValue: (d) => d.panelTemperature, unit: "°C" },
        { title: "Temperature 8m", enabled: config.includeTemp8m, getValue: (d) => d.temperature8m, unit: "°C" },
        { title: "Delta Temperature", enabled: config.includeDeltaTemp, getValue: (d) => d.deltaTemperature, unit: "°C" },
        { title: "MPPT Solar Power", enabled: config.includeMPPT, getValue: (d) => d.mpptSolarPower, unit: "W" },
        { title: "MPPT Battery Voltage", enabled: config.includeMPPT, getValue: (d) => d.mpptBatteryVoltage, unit: "V" },
        { title: "MPPT Solar Voltage", enabled: config.includeMPPT, getValue: (d) => d.mpptSolarVoltage, unit: "V" },
      ];

      // Filter: only include sections that are enabled AND have actual data
      const sections = allSections.filter(section => {
        if (!section.enabled) return false;
        const values = weatherData.map(section.getValue).filter((v): v is number => v !== null && v !== undefined);
        return values.length > 0;
      });

      for (const section of sections) {
        if (y > 250) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(section.title, 20, y);
        y += 8;

        if (config.includeStatistics) {
          const values = weatherData.map(section.getValue);
          const stats = calculateStatistics(values);

          doc.setFontSize(10);
          doc.setFont("helvetica", "normal");
          doc.text(`Minimum: ${safeFixed(stats.min, 2)} ${section.unit}`, 25, y);
          y += 5;
          doc.text(`Maximum: ${safeFixed(stats.max, 2)} ${section.unit}`, 25, y);
          y += 5;
          doc.text(`Average: ${safeFixed(stats.avg, 2)} ${section.unit}`, 25, y);
          y += 5;
          doc.text(`Std Dev: ${safeFixed(stats.stdDev, 3)} ${section.unit}`, 25, y);
          y += 10;
        }
      }

      // --- Wind Rose Diagrams (24H, 7D, 30D) as PNG images ---
      if (config.includeWind && weatherData.length > 0) {
        const windUnit = (stationWindUnit as WindSpeedUnit) || 'ms';
        const classes = getSimplifiedClasses(windUnit);
        const classColors = ['#a8d5e2', '#6bb8d6', '#3b82f6', '#f59e0b', '#ef4444', '#7c3aed'];
        const now = new Date(weatherData[weatherData.length - 1].timestamp).getTime();
        const periods = [
          { label: '24 Hour', hours: 24 },
          { label: '7 Day', hours: 168 },
          { label: '30 Day', hours: 720 },
        ];

        const processWindData = (subset: WeatherData[]) => {
          const bins = Array.from({ length: 16 }, () => new Array(classes.length).fill(0));
          subset.forEach(d => {
            if (d.windDirection == null || d.windSpeed == null) return;
            const dirBin = Math.round(d.windDirection / 22.5) % 16;
            let sc = 0;
            for (let i = classes.length - 1; i >= 0; i--) {
              if (d.windSpeed >= classes[i].min) { sc = i; break; }
            }
            bins[dirBin][sc]++;
          });
          return bins;
        };

        // Build a self-contained SVG string for a wind rose
        const buildWindRoseSVG = (bins: number[][], label: string): string => {
          const sz = 320;
          const ctr = sz / 2;
          const mxR = sz / 2 - 40;
          const dirs = WIND_DIRECTIONS;

          let maxValue = 0;
          bins.forEach(b => { const t = b.reduce((a, v) => a + v, 0); if (t > maxValue) maxValue = t; });
          if (maxValue === 0) maxValue = 1;

          const polar = (deg: number, r: number) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            return { x: ctr + r * Math.cos(rad), y: ctr + r * Math.sin(rad) };
          };
          const wedgePath = (di: number, ir: number, or2: number) => {
            const a1 = di * 22.5 - 11.25, a2 = di * 22.5 + 11.25;
            const p1 = polar(a1, ir), p2 = polar(a1, or2), p3 = polar(a2, or2), p4 = polar(a2, ir);
            return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${or2} ${or2} 0 0 1 ${p3.x} ${p3.y} L ${p4.x} ${p4.y} A ${ir} ${ir} 0 0 0 ${p1.x} ${p1.y} Z`;
          };

          let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}">`;
          s += `<rect width="${sz}" height="${sz}" fill="white"/>`;

          // Concentric guide circles with % labels
          [0.25, 0.5, 0.75, 1].forEach(ratio => {
            s += `<circle cx="${ctr}" cy="${ctr}" r="${mxR * ratio}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
            s += `<text x="${ctr + 4}" y="${ctr - mxR * ratio + 12}" font-size="10" fill="#999" font-family="Arial,sans-serif">${Math.round(ratio * 100)}%</text>`;
          });

          // Direction labels
          dirs.forEach((d, i) => {
            const p = polar(i * 22.5, mxR + 20);
            s += `<text x="${p.x}" y="${p.y}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#333" font-family="Arial,sans-serif">${d}</text>`;
          });

          // Stacked wedges per direction
          bins.forEach((dirBins, di) => {
            let curR = 0;
            dirBins.forEach((count, si) => {
              if (count === 0) return;
              const inner = curR;
              const height = (count / maxValue) * mxR;
              curR += height;
              s += `<path d="${wedgePath(di, inner, curR)}" fill="${classColors[si] || '#3b82f6'}" stroke="white" stroke-width="0.5" opacity="0.85"/>`;
            });
          });

          // Calm center
          s += `<circle cx="${ctr}" cy="${ctr}" r="8" fill="#ccc" opacity="0.3"/>`;
          // Title at top
          s += `<text x="${ctr}" y="18" text-anchor="middle" font-size="14" font-weight="bold" fill="#333" font-family="Arial,sans-serif">${label}</text>`;
          s += '</svg>';
          return s;
        };

        // Convert SVG string to PNG data URL via canvas
        const svgToPng = (svg: string, w: number, h: number): Promise<string> =>
          new Promise((resolve, reject) => {
            const b64 = btoa(unescape(encodeURIComponent(svg)));
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              const scale = 2;
              c.width = w * scale; c.height = h * scale;
              const ctx = c.getContext('2d');
              if (!ctx) { reject(new Error('no ctx')); return; }
              ctx.scale(scale, scale);
              ctx.drawImage(img, 0, 0, w, h);
              resolve(c.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('SVG render failed'));
            img.src = `data:image/svg+xml;base64,${b64}`;
          });

        // Generate all 3 wind rose PNGs
        const rosePngs = await Promise.all(periods.map(p => {
          const cutoff = now - p.hours * 60 * 60 * 1000;
          const subset = weatherData.filter(d => new Date(d.timestamp).getTime() > cutoff);
          const bins = processWindData(subset);
          return svgToPng(buildWindRoseSVG(bins, `${p.label} Wind Rose`), 320, 320);
        }));

        doc.addPage();
        y = 20;
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("Wind Rose Analysis", pageWidth / 2, y, { align: "center" });
        y += 5;

        const roseImgW = 55;
        const roseImgH = 55;
        const spacing = (pageWidth - 40) / 3;
        rosePngs.forEach((png, idx) => {
          const x = 20 + spacing * idx + (spacing - roseImgW) / 2;
          doc.addImage(png, 'PNG', x, y, roseImgW, roseImgH);
        });
        y += roseImgH + 5;

        // Speed class legend
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        const legendY = y;
        classes.forEach((cls, i) => {
          const h = classColors[i] || '#999';
          const hr = h.replace('#', '');
          doc.setFillColor(parseInt(hr.substring(0, 2), 16), parseInt(hr.substring(2, 4), 16), parseInt(hr.substring(4, 6), 16));
          const lx = 25 + (i % 3) * 60;
          const ly = legendY + Math.floor(i / 3) * 8;
          doc.rect(lx, ly - 3, 4, 4, 'F');
          doc.text(`${cls.min}-${cls.max === Infinity ? '+' : cls.max} ${windUnitLabel}`, lx + 6, ly);
        });
        y = legendY + Math.ceil(classes.length / 3) * 8 + 10;
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

    // --- Metadata Header Block ---
    lines.push("# Stratus Weather Server - Data Export");
    lines.push(`# Station: ${csvVal(selectedStation?.name || "Unknown")}`);
    lines.push(`# Location: ${csvVal(selectedStation?.location || "N/A")}`);
    if (selectedStation?.latitude != null && selectedStation?.longitude != null) {
      lines.push(`# Coordinates: ${safeFixed(selectedStation.latitude, 6)}, ${safeFixed(selectedStation.longitude, 6)}`);
    }
    if (selectedStation?.altitude != null) {
      lines.push(`# Altitude: ${safeFixed(selectedStation.altitude, 1)} m`);
    }
    lines.push(`# Period: ${config.startDate} to ${config.endDate}`);
    lines.push(`# Export Date: ${new Date().toISOString()}`);
    lines.push(`# Total Records: ${weatherData.length}`);
    lines.push(`# Parameters: ${columns.length}`);
    lines.push(`# Timestamp Format: ISO 8601 (UTC)`);
    lines.push(`# Missing Values: (empty)`);
    lines.push("#");

    // --- Column Headers ---
    const headers = ["Timestamp_UTC", ...columns.map(c => c.header)];
    lines.push(headers.map(csvVal).join(","));

    // --- Data Rows ---
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
      lines.push(vals.join(","));
    }

    // --- Statistics Summary Block ---
    if (config.includeStatistics) {
      lines.push("#");
      lines.push("# --- Statistics Summary ---");
      const statRows: { label: string; fn: (stats: ReturnType<typeof calculateStatistics>, col: typeof columns[0]) => string }[] = [
        { label: "# Minimum", fn: (s, c) => s.count > 0 ? Number(s.min).toFixed(c.decimals) : "" },
        { label: "# Maximum", fn: (s, c) => s.count > 0 ? Number(s.max).toFixed(c.decimals) : "" },
        { label: "# Mean", fn: (s, c) => s.count > 0 ? Number(s.avg).toFixed(c.decimals) : "" },
        { label: "# Std Dev", fn: (s, c) => s.count > 0 ? Number(s.stdDev).toFixed(c.decimals + 1) : "" },
        { label: "# Completeness (%)", fn: (s) => s.total > 0 ? ((s.count / s.total) * 100).toFixed(1) : "0.0" },
      ];
      for (const sr of statRows) {
        const vals = [sr.label];
        for (const col of columns) {
          const rawVals = weatherData.map(col.getValue);
          const stats = calculateStatistics(rawVals);
          vals.push(sr.fn(stats, col));
        }
        lines.push(vals.join(","));
      }
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
