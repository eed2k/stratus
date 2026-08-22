// Stratus Weather Server
// Created by Lukas Esterhuizen
// Compact shared dashboard - single desktop screen, no scroll, live sync data only.
// Scales to fit any desktop screen size (laptop, monitor, TV).
import { useMemo, useEffect, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import type { WeatherData } from "@shared/schema";
import { CHART_COLOURS } from "@shared/chartColours";
import { rainfallTotalFromRecords, type RainfallType } from "@shared/utils/rainfall";
import { DashboardLoadingOverlay } from "@/components/DashboardLoadingOverlay";
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

/** Shared type face for the header row, so every item matches exactly. */
const HEADER_FONT = { fontFamily: 'Arial, Helvetica, sans-serif' } as const;

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

/**
 * Smallest viewport the compact dashboard is designed for.
 *
 * This view deliberately packs a whole station onto one non-scrolling screen:
 * a 4x3 tile grid, two wind roses and two dual-axis charts. Below roughly a
 * tablet's width those elements cannot be read at all, so the page refuses to
 * render rather than presenting an unusable squashed layout. Viewers on a phone
 * are pointed at the full shared dashboard, which is responsive.
 */
const COMPACT_MIN_WIDTH = 900;

function useIsTooNarrow(minWidth: number): boolean {
  const [tooNarrow, setTooNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < minWidth,
  );
  useEffect(() => {
    const check = () => setTooNarrow(window.innerWidth < minWidth);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, [minWidth]);
  return tooNarrow;
}

export default function CompactDashboard() {
  // Parse token from URL: /shared/{token}/compact
  const path = window.location.pathname;
  const shareToken = path.replace("/shared/", "").replace(/\/compact$/, "");

  const isTooNarrow = useIsTooNarrow(COMPACT_MIN_WIDTH);

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
  const { data: stationData, isSuccess: stationReady } = useQuery<{ station: any }>({
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

  // Authoritative rainfall shape for this station. The shared station payload
  // omits connectionType, and auto-detection is unreliable on a short window
  // (a single cumulative reading of ~1000 mm looks like 1000 mm of fresh rain),
  // so read the configured type from the share's rainfall-config endpoint.
  const { data: rainfallConfig } = useQuery<{ type: RainfallType; tipFactor: number }>({
    queryKey: ["compact-rainfall-config", shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/rainfall-config`, { headers: shareHeaders });
      if (!res.ok) return { type: "auto", tipFactor: 0.2 };
      return res.json();
    },
    enabled: !!shareToken && !requiresPassword,
  });
  const rainfallType: RainfallType = rainfallConfig?.type ?? "auto";
  const rainfallTipFactor = rainfallConfig?.tipFactor ?? 0.2;

  // Latest reading (live sync data) - refreshes with station sync
  const { data: latest, isSuccess: latestReady } = useQuery<WeatherData>({
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
  const { data: recentData = [], isSuccess: recentReady } = useQuery<WeatherData[]>({
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

  // ET₀ (FAO-56 Penman-Monteith, per reading) vs solar irradiance.
  // ET₀ needs temperature, humidity, wind and solar together, so rows missing
  // any of those inputs yield a null ET₀ point while still plotting solar.
  const etoSolarData = useMemo(() => {
    const alt = station?.altitude != null ? Number(station.altitude) : 0;
    const lat = station?.latitude != null ? Number(station.latitude) : 0;
    return recentData
      .filter((d) => d.solarRadiation != null || (d.temperature != null && d.humidity != null))
      .map((d) => {
        const t = num(d.temperature);
        const h = num(d.humidity);
        const ws = num(d.windSpeed);
        const sr = num(d.solarRadiation);
        const wMs = ws != null ? (windSpeedUnit === "kmh" ? kmhToMs(ws) : ws) : null;
        const mj = sr != null ? wattsToMJPerDay(sr, 24) : null;
        const etoPoint =
          t != null && h != null && wMs != null && mj != null
            ? Math.round(calculateETo(t, h, wMs, mj, alt, lat, getDayOfYear(new Date(d.timestamp))) * 100) / 100
            : null;
        return {
          timestamp: new Date(d.timestamp).toISOString(),
          eto: etoPoint,
          solarRadiation: sr,
        };
      });
  }, [recentData, station?.altitude, station?.latitude, windSpeedUnit]);

  const fmt = (v: number | null, dec = 1): string => (v == null ? "--" : (Math.round(v * 10 ** dec) / 10 ** dec).toString());

  // Live values from latest reading
  const temp = num(latest?.temperature);
  const hum = num(latest?.humidity);
  const pressure = num(latest?.pressure);
  const windSpeed = num(latest?.windSpeed);
  const windGust = num(latest?.windGust);
  const windDir = num(latest?.windDirection);
  const solar = num(latest?.solarRadiation);
  /**
   * 24-hour rainfall, integrated over the window.
   *
   * Deliberately NOT `latest.rainfall`: RIKA stations report a cumulative
   * counter (mm since commissioning), so the latest raw reading is a lifetime
   * total and displaying it as "Rain (24h)" showed hundreds of millimetres on a
   * dry day. `recentData` is the same 24-hour window the charts use.
   */
  const rain24h = useMemo(
    () => rainfallTotalFromRecords(recentData, rainfallType, rainfallTipFactor),
    [recentData, rainfallType, rainfallTipFactor],
  );
  const batteryVoltage = num(latest?.batteryVoltage);
  const lastSynced = latest?.timestamp
    ? new Date(latest.timestamp).toLocaleString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "--";
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
  if (isTooNarrow) {
    // The full shared dashboard lives at the same token without /compact.
    const fullUrl = `/shared/${shareToken}`;
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-sm text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-full bg-[#1e3a5f] flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-white" />
          </div>
          <p className="text-base font-semibold text-black">Screen too small</p>
          <p className="text-sm text-black">
            The compact dashboard is a single-screen wall display built for a laptop,
            monitor or TV. Open the full dashboard instead, which is designed for
            phones and tablets.
          </p>
          <a
            href={fullUrl}
            className="inline-block rounded-md px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "#1e3a5f" }}
          >
            Open full dashboard
          </a>
        </div>
      </div>
    );
  }
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

  // Hold the loading overlay until the station, latest reading and 24h window
  // have all arrived, so the wall display never flashes half its tiles.
  const loadSteps = [stationReady, latestReady, recentReady];
  const loadReady = loadSteps.filter(Boolean).length;
  const loadDone = loadSteps.every(Boolean);

  return (
    <div className="h-screen w-screen overflow-hidden bg-white flex flex-col p-[0.8vw] gap-[1vh]">
      <DashboardLoadingOverlay ready={loadReady} total={loadSteps.length} done={loadDone} />
      {/* Header: station identity and health on the left, branding pinned to the
          top right. Every item uses the same weight and size so the row reads as
          one line of information rather than a hierarchy. */}
      <div className="flex items-start justify-between gap-4 flex-shrink-0">
        <div className="flex items-baseline gap-4 min-w-0 text-xs text-black font-normal" style={HEADER_FONT}>
          <span className="truncate">
            {station?.name || shareInfo?.share?.name || "Weather Station"}
            {station?.location ? `, ${station.location}` : ""} · {latStr}, {lngStr} · Live
          </span>
          <span className="whitespace-nowrap flex-shrink-0">Battery {fmt(batteryVoltage, 2)} V</span>
          <span className="whitespace-nowrap flex-shrink-0">Last synced {lastSynced}</span>
        </div>

        {/* Powered by Stratus / Metron, top right corner */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-black font-normal whitespace-nowrap" style={HEADER_FONT}>
            Powered by
          </span>
          {/* Stratus mark: dark blue circle with white dot (matches the app sidebar) */}
          <div className="w-6 h-6 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-sm border border-white/10 flex-shrink-0">
            <div className="w-2 h-2 rounded-full bg-white" />
          </div>
          <div className="inline-flex flex-col items-center flex-shrink-0">
            <span className="text-[13px] font-extrabold tracking-wide leading-none" style={{ fontFamily: 'Arial, sans-serif', color: '#1e3a5f' }}>STRATUS</span>
            <span className="text-[7px] font-bold tracking-wider mt-0.5" style={{ fontFamily: 'Arial, sans-serif', color: '#1e3a5f' }}>METRON (PTY) LTD</span>
          </div>
          {/* Metron company logo */}
          <img src="/metron-logo.png" alt="Metron" className="w-6 h-6 object-contain flex-shrink-0" />
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
              dualAxis
              series={[
                { dataKey: "temperature", name: "Temperature", color: CHART_COLOURS.temperature, unit: "°C" },
                { dataKey: "humidity", name: "Humidity", color: CHART_COLOURS.humidity, unit: "%" },
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

        {/* Bottom-right: ET₀ vs Solar Irradiance chart */}
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<ChartFallback />}>
            <WeatherChart
              title="ET₀ vs Solar Irradiance (24h)"
              data={etoSolarData}
              heightClass="h-full"
              compact
              dualAxis
              series={[
                { dataKey: "eto", name: "ET₀", color: CHART_COLOURS.eto, unit: "mm/d" },
                { dataKey: "solarRadiation", name: "Solar", color: CHART_COLOURS.solarRadiation, unit: "W/m²" },
              ]}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
