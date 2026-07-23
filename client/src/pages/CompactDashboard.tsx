// Stratus Weather Server
// Created by Lukas Esterhuizen
// Compact shared dashboard - single desktop screen, no scroll, live sync data only.
// Scales to fit any desktop screen size (laptop, monitor, TV).
import { useMemo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import type { WeatherData } from "@shared/schema";
import {
  calculateDewPoint,
  calculateETo,
  calculateHeatIndex,
  calculateWindChill,
  calculateFireDanger,
  getDayOfYear,
  kmhToMs,
  wattsToMJPerDay,
} from "@shared/utils/calc";
import {
  getSimplifiedClasses,
  getWindUnitLabel,
  getWindDirectionLabel,
  type WindSpeedUnit,
} from "@/lib/windConstants";

const WindRose = lazy(() => import("@/components/charts/WindRose").then(m => ({ default: m.WindRose })));
const WeatherChart = lazy(() => import("@/components/charts/WeatherChart").then(m => ({ default: m.WeatherChart })));

const ChartFallback = () => (
  <div className="flex items-center justify-center h-full bg-muted/20 rounded-lg animate-pulse">
    <Loader2 className="h-6 w-6 animate-spin text-black" />
  </div>
);

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? null : n;
};

// Build 16-sector wind rose data from a set of readings
const processWindRoseData = (data: WeatherData[], windUnit: WindSpeedUnit = "ms") => {
  const rose = Array.from({ length: 16 }, (_, i) => ({ direction: i * 22.5, speeds: [0, 0, 0, 0, 0, 0] }));
  const classes = getSimplifiedClasses(windUnit);
  data.forEach((d) => {
    if (d.windDirection == null || d.windSpeed == null) return;
    const bin = Math.round(d.windDirection / 22.5) % 16;
    let sc = 0;
    for (let i = classes.length - 1; i >= 0; i--) {
      if (d.windSpeed >= classes[i].min) { sc = i; break; }
    }
    rose[bin].speeds[sc]++;
  });
  return rose;
};

// Primary metric tile styled like the standard dashboard (greyish infill)
interface PrimaryTileProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}
function PrimaryTile({ label, value, sub, valueColor }: PrimaryTileProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-0.5 flex flex-col justify-center h-full">
      <p className="text-xs font-normal text-black leading-tight" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{label}</p>
      <p className="font-bold leading-tight" style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: "clamp(0.85rem, 1.15vw, 1.05rem)", color: valueColor ?? "#000" }}>{value}</p>
      {sub && <p className="text-xs font-normal text-black leading-tight" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{sub}</p>}
    </div>
  );
}

export default function CompactDashboard() {
  // Parse token from URL: /shared/{token}/compact
  const path = window.location.pathname;
  const shareToken = path.replace("/shared/", "").replace(/\/compact$/, "");

  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const shareHeaders: HeadersInit = sessionToken ? { "X-Share-Session": sessionToken } : {};

  // Share info (name + password requirement)
  const { data: shareInfo, isLoading: loadingShare, error: shareError } = useQuery({
    queryKey: ["compact-share-info", shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}`);
      if (!res.ok) throw new Error("Share not found");
      return res.json();
    },
    enabled: !!shareToken,
    retry: false,
  });

  const requiresPassword = shareInfo?.share?.requiresPassword && !sessionToken;

  // Station info
  const { data: stationData } = useQuery<{ station: any }>({
    queryKey: ["compact-station", shareToken, sessionToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/station`, { headers: shareHeaders });
      if (!res.ok) throw new Error("Station not found");
      return res.json();
    },
    enabled: !!shareToken && !requiresPassword,
  });
  const station = stationData?.station;
  const windSpeedUnit: WindSpeedUnit = station?.windSpeedUnit === "kmh" ? "kmh" : "ms";
  const windUnitLabel = getWindUnitLabel(windSpeedUnit);

  // Latest reading (live sync data) - refreshes with station sync
  const { data: latest } = useQuery<WeatherData>({
    queryKey: ["compact-latest", shareToken, sessionToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/data/latest`, { headers: shareHeaders });
      if (!res.ok) throw new Error("latest");
      return res.json();
    },
    enabled: !!shareToken && !requiresPassword,
    refetchInterval: 60000,
  });

  // Recent 24h window for wind rose + temp/humidity chart (fixed, no user options)
  const { data: recentData = [] } = useQuery<WeatherData[]>({
    queryKey: ["compact-recent", shareToken, sessionToken, latest?.timestamp],
    queryFn: async () => {
      const endTime = latest?.timestamp ? new Date(latest.timestamp) : new Date();
      const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}&limit=500`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!shareToken && !requiresPassword,
    refetchInterval: 60000,
  });

  const handlePasswordSubmit = async () => {
    setPasswordError(null);
    try {
      const res = await fetch(`/api/shares/${shareToken}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPasswordError(data.error || "Invalid password");
        return;
      }
      setSessionToken(data.sessionToken || "public");
    } catch {
      setPasswordError("Failed to validate password");
    }
  };

  const windRoseData = useMemo(() => processWindRoseData(recentData, windSpeedUnit), [recentData, windSpeedUnit]);

  // 1-hour wind rose: filter the same readings to the last hour before the latest timestamp
  const windRoseData1h = useMemo(() => {
    if (recentData.length === 0) return processWindRoseData([], windSpeedUnit);
    const latestTs = Math.max(...recentData.map((d) => new Date(d.timestamp).getTime()));
    const cutoff = latestTs - 60 * 60 * 1000;
    const lastHour = recentData.filter((d) => new Date(d.timestamp).getTime() >= cutoff);
    return processWindRoseData(lastHour, windSpeedUnit);
  }, [recentData, windSpeedUnit]);

  const chartData = useMemo(() => {
    return recentData
      .filter((d) => d.temperature != null || d.humidity != null)
      .map((d) => ({
        timestamp: new Date(d.timestamp).toISOString(),
        temperature: num(d.temperature),
        humidity: num(d.humidity),
      }));
  }, [recentData]);

  const batterySolarData = useMemo(() => {
    return recentData
      .filter((d) => d.batteryVoltage != null || d.solarRadiation != null)
      .map((d) => ({
        timestamp: new Date(d.timestamp).toISOString(),
        batteryVoltage: num(d.batteryVoltage),
        solarRadiation: num(d.solarRadiation),
      }));
  }, [recentData]);

  const fmt = (v: number | null, dec = 1): string => (v == null ? "--" : (Math.round(v * 10 ** dec) / 10 ** dec).toString());

  // Live values from latest reading
  const temp = num(latest?.temperature);
  const hum = num(latest?.humidity);
  const pressure = num(latest?.pressure);
  const windSpeed = num(latest?.windSpeed);
  const windGust = num(latest?.windGust);
  const windDir = num(latest?.windDirection);
  const solar = num(latest?.solarRadiation);
  const rain24h = num(latest?.rainfall);
  const dewPoint = temp != null && hum != null ? calculateDewPoint(temp, hum) : null;
  const windDirLabel = windDir != null ? getWindDirectionLabel(windDir) : "--";

  // Derived indices for third row
  const altitude = station?.altitude != null ? Number(station.altitude) : 0;
  const latitude = station?.latitude != null ? Number(station.latitude) : 0;
  const windMs = windSpeed != null ? (windSpeedUnit === "kmh" ? kmhToMs(windSpeed) : windSpeed) : null;
  const solarMJ = solar != null ? wattsToMJPerDay(solar, 24) : null;
  const eto = temp != null && hum != null && windMs != null && solarMJ != null
    ? calculateETo(temp, hum, windMs, solarMJ, altitude, latitude, getDayOfYear())
    : null;
  const heatIndex = temp != null && hum != null ? calculateHeatIndex(temp, hum) : null;
  const windChill = temp != null && windMs != null ? calculateWindChill(temp, windMs) : null;
  const fdiResult = temp != null && hum != null && windMs != null
    ? calculateFireDanger(temp, hum, windMs)
    : null;
  const fdi = fdiResult ? fdiResult.ffdi : null;
  const fdiColor = fdiResult?.rating?.color;

  // ---- Render states ----
  if (!shareToken) {
    return <div className="h-screen flex items-center justify-center text-black">Invalid link</div>;
  }
  if (loadingShare) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-black" />
      </div>
    );
  }
  if (shareError) {
    return <div className="h-screen flex items-center justify-center text-black">Share link not found or expired.</div>;
  }
  if (requiresPassword) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-black">
              <Lock className="h-5 w-5" />
              <span className="font-semibold">Password Required</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw" className="text-black">Enter password to view</Label>
              <Input
                id="pw"
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePasswordSubmit()}
              />
              {passwordError && <div className="text-xs text-red-600">{passwordError}</div>}
            </div>
            <Button className="w-full" onClick={handlePasswordSubmit}>Unlock</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const latStr = station?.latitude != null ? `${Number(station.latitude).toFixed(6)}°` : "--";
  const lngStr = station?.longitude != null ? `${Number(station.longitude).toFixed(6)}°` : "--";

  return (
    <div className="h-screen w-screen overflow-hidden bg-white flex flex-col p-[0.8vw] gap-[1vh]">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-bold text-black truncate" style={{ fontSize: "clamp(0.95rem, 1.5vw, 1.3rem)" }}>
            {station?.name || shareInfo?.share?.name || "Weather Station"}
          </h1>
          <p className="text-xs text-black truncate">
            {station?.location || ""} · {latStr}, {lngStr} · Live
          </p>
        </div>
      </div>

      {/* Main 2x2 area below header */}
      <div className="grid grid-cols-2 grid-rows-2 gap-2 flex-1 min-h-0">
        {/* Top-left: primary metric tiles (4 x 3) - greyish infill like standard dashboard */}
        <div className="grid grid-cols-4 grid-rows-3 gap-2 min-h-0">
          <PrimaryTile label="Temperature" value={`${fmt(temp)}°C`} />
          <PrimaryTile label="Humidity" value={`${fmt(hum)}%`} />
          <PrimaryTile label="Pressure" value={`${fmt(pressure, 2)} hPa`} />
          <PrimaryTile label="Wind" value={`${fmt(windSpeed)} ${windUnitLabel}`} sub={windGust != null ? `Gust: ${fmt(windGust)} ${windUnitLabel}` : undefined} />
          <PrimaryTile label="Direction" value={`${windDirLabel} (${fmt(windDir, 0)}°)`} />
          <PrimaryTile label="Solar" value={`${fmt(solar, 0)} W/m²`} />
          <PrimaryTile label="Rain (24h)" value={`${fmt(rain24h, 2)} mm`} />
          <PrimaryTile label="Dew Point" value={`${fmt(dewPoint)}°C`} />
          <PrimaryTile label="ET₀" value={`${fmt(eto, 2)} mm/d`} />
          <PrimaryTile label="Heat Index" value={`${fmt(heatIndex)}°C`} />
          <PrimaryTile label="Wind Chill" value={`${fmt(windChill)}°C`} />
          <PrimaryTile label="FDI" value={fdi != null ? `${fmt(fdi, 0)}` : "--"} valueColor={fdiColor} />
        </div>

        {/* Top-right: Temperature vs Humidity chart */}
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<ChartFallback />}>
            <WeatherChart
              title="Temperature vs Humidity (24h)"
              data={chartData}
              heightClass="h-full"
              compact
              series={[
                { dataKey: "temperature", name: "Temperature", color: "#ef4444", unit: "°C" },
                { dataKey: "humidity", name: "Humidity", color: "#3b82f6", unit: "%" },
              ]}
            />
          </Suspense>
        </div>

        {/* Bottom-left: shared wind legend + 1h wind rose + 24h wind rose */}
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 min-h-0">
          {/* One shared legend for the wind rose colours */}
          <Card className="min-h-0 overflow-hidden">
            <CardContent className="p-1.5 h-full flex flex-col justify-center gap-0.5">
              <div className="text-xs text-black font-medium mb-0.5">Wind ({windUnitLabel})</div>
              {getSimplifiedClasses(windSpeedUnit).map((sc) => (
                <div key={sc.label} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: sc.color }} />
                  <span className="text-[10px] text-black leading-tight">{sc.label}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="min-h-0 overflow-hidden">
            <Suspense fallback={<ChartFallback />}>
              <WindRose data={windRoseData1h} title="Wind Rose (1h)" windSpeedUnit={windSpeedUnit} size={210} bare />
            </Suspense>
          </div>
          <div className="min-h-0 overflow-hidden">
            <Suspense fallback={<ChartFallback />}>
              <WindRose data={windRoseData} title="Wind Rose (24h)" windSpeedUnit={windSpeedUnit} size={210} bare />
            </Suspense>
          </div>
        </div>

        {/* Bottom-right: Battery Voltage vs Solar Irradiance chart */}
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<ChartFallback />}>
            <WeatherChart
              title="Battery Voltage vs Solar Irradiance (24h)"
              data={batterySolarData}
              heightClass="h-full"
              compact
              series={[
                { dataKey: "batteryVoltage", name: "Battery", color: "#16a34a", unit: "V" },
                { dataKey: "solarRadiation", name: "Solar", color: "#f59e0b", unit: "W/m²" },
              ]}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
