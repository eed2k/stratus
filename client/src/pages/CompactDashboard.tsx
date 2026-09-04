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
import { CHART_COLORS } from "@shared/chartColors";
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

/** Stratus brand navy, matching the app sidebar. */
const STRATUS_NAVY = "#1e3a5f";

/**
 * Selectable chart windows, matching the shorter half of the full shared
 * dashboard's selector.
 *
 * Capped at 24 hours on purpose: this view already fetches exactly one 24-hour
 * window, so every option here is a filter over data that is present rather
 * than a new request. Offering 48h or 7d would mean refetching and would break
 * the single-screen, no-scroll budget the compact layout is built around.
 */
const COMPACT_RANGES = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
] as const;

/** Trim a set of readings to the last `hours` before the newest reading. */
const withinLastHours = (data: WeatherData[], hours: number): WeatherData[] => {
  if (data.length === 0 || hours >= 24) return data;
  // Measured from the newest reading rather than from now, so a station that
  // stopped reporting an hour ago still shows its last hour of data instead of
  // an empty chart.
  const latestTs = Math.max(...data.map((d) => new Date(d.timestamp).getTime()));
  const cutoff = latestTs - hours * 60 * 60 * 1000;
  return data.filter((d) => new Date(d.timestamp).getTime() >= cutoff);
};

// Primary metric tile styled like the standard dashboard (grayish infill)
interface PrimaryTileProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}
/**
 * One type size shared by a tile's label and its value.
 *
 * Declared once and used for both so they cannot drift apart: the label and the
 * reading are meant to read as a matched pair, distinguished by color rather
 * than by size.
 */
// Fixed size within the scaled design canvas (see DESIGN_W/DESIGN_H). Because
// the whole stage is uniformly scaled to fit the viewport, tile text no longer
// needs viewport units: it is sized once for the 1920x1080 canvas and scales
// with everything else.
const TILE_TEXT_SIZE = "1.34rem";

function PrimaryTile({ label, value, sub, valueColor }: PrimaryTileProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 flex flex-col items-center justify-center text-center overflow-hidden">
      {/* Label: bold, Stratus navy. Content is centered in the block, both
          horizontally and vertically. */}
      <p className="font-bold leading-tight"
         style={{ fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: TILE_TEXT_SIZE, color: STRATUS_NAVY }}>{label}</p>
      {/* Value: same size as the label but NOT bold, black. valueColor is only
          supplied where the reading itself carries a warning color, such as the
          fire danger index. */}
      <p className="font-normal leading-tight"
         style={{ fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: TILE_TEXT_SIZE, color: valueColor ?? "#000" }}>{value}</p>
      {/* Sub line (wind gust) at the same size as the value so it reads as
          another reading rather than a footnote. */}
      {sub && <p className="font-normal leading-tight"
                 style={{ fontFamily: 'Arial, Helvetica, sans-serif',
                          fontSize: TILE_TEXT_SIZE, color: "#000" }}>{sub}</p>}
    </div>
  );
}

/** One labeled field in the station info block. Sized to match the metric
 *  tiles: a navy bold label above a value, both at TILE_TEXT_SIZE. valueColor
 *  is used for the color-coded Status and Battery readings. */
function InfoField({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex flex-col leading-tight min-w-0">
      <span className="font-bold" style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: TILE_TEXT_SIZE, color: STRATUS_NAVY }}>{label}</span>
      <span className="font-normal truncate" style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: TILE_TEXT_SIZE, color: valueColor ?? '#000' }}>{value}</span>
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

/**
 * Design canvas for the compact wall display.
 *
 * The dashboard is laid out in "design units" a fixed DESIGN_H tall, and the
 * whole stage is then scaled to fill the actual screen. To maximize the use of
 * every display, the canvas WIDTH tracks the viewport's aspect ratio rather
 * than being a fixed 16:9 box: on a 16:9 monitor or TV it works out to 1920 and
 * fills edge to edge; on a 16:10 laptop or a 4:3 tablet it becomes narrower or
 * wider so the content still fills the screen instead of letterboxing. The
 * width is clamped so an extreme ultrawide or a near-square screen cannot push
 * the layout into something unusable. A 1080p screen renders 1:1, a 4K TV
 * scales up, a laptop scales down - the layout never reflows or clips, only its
 * overall size changes.
 */
const DESIGN_H = 1080;
const MIN_DESIGN_W = 1280;
const MAX_DESIGN_W = 3200;

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

interface Stage {
  /** Canvas width in design units (height is always DESIGN_H). */
  width: number;
  /** Factor that maps design units to CSS pixels. */
  scale: number;
}

/**
 * Size the design canvas to the current viewport and return the scale that
 * fills the screen.
 *
 * The canvas width is DESIGN_H * aspectRatio (clamped), so for any ordinary
 * display the width and height ratios are equal and the stage fills the screen
 * exactly with no letterboxing. min() is still used for the scale so that when
 * the width is clamped at an extreme aspect ratio the stage shrinks to fit
 * rather than overflow.
 */
function useFitStage(): Stage {
  const measure = (): Stage => {
    if (typeof window === "undefined") return { width: 1920, scale: 1 };
    const vw = window.innerWidth;
    const vh = window.innerHeight || 1;
    const width = Math.max(
      MIN_DESIGN_W,
      Math.min(MAX_DESIGN_W, Math.round(DESIGN_H * (vw / vh))),
    );
    const scale = Math.min(vw / width, vh / DESIGN_H);
    return { width, scale };
  };
  const [stage, setStage] = useState<Stage>(measure);
  useEffect(() => {
    const onResize = () => setStage(measure());
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return stage;
}

export default function CompactDashboard() {
  // Parse token from URL: /shared/{token}/compact
  const path = window.location.pathname;
  const shareToken = path.replace("/shared/", "").replace(/\/compact$/, "");

  const isTooNarrow = useIsTooNarrow(COMPACT_MIN_WIDTH);
  const stage = useFitStage();

  const [sessionToken, setSessionToken] = useState<string | undefined>();
  // Chart window. 24h is the default so the page opens looking exactly as it
  // did before the selector existed.
  const [rangeHours, setRangeHours] = useState<number>(24);
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

  /**
   * The selected window, sliced out of the single 24-hour fetch.
   *
   * Everything time-scoped on this page reads from here rather than from
   * `recentData`, with two deliberate exceptions noted at their definitions:
   * the 1-hour wind rose, which is a fixed "right now" reference, and the
   * 24-hour rainfall total, which is a named 24-hour figure.
   */
  const rangeData = useMemo(() => withinLastHours(recentData, rangeHours), [recentData, rangeHours]);
  const rangeLabel = useMemo(
    () => COMPACT_RANGES.find((r) => r.hours === rangeHours)?.label ?? `${rangeHours}h`,
    [rangeHours],
  );

  const windRoseData = useMemo(() => processWindRoseData(rangeData, windSpeedUnit), [rangeData, windSpeedUnit]);

  // Fixed 1-hour wind rose, kept independent of the selector so there is always
  // a current-conditions reference beside the selected window.
  const windRoseData1h = useMemo(
    () => processWindRoseData(withinLastHours(recentData, 1), windSpeedUnit),
    [recentData, windSpeedUnit],
  );

  // A 30-minute rose, used only when the selected window is itself 1 hour.
  const windRoseData30m = useMemo(
    () => processWindRoseData(withinLastHours(recentData, 0.5), windSpeedUnit),
    [recentData, windSpeedUnit],
  );

  /**
   * The reference rose shown beside the selected window.
   *
   * With 1h selected, a fixed 1h reference would draw the same rose twice, which
   * tells the reader nothing. Dropping the reference to 30 minutes keeps the pair
   * showing two genuinely different periods at every setting.
   */
  const hourSelected = rangeHours === 1;
  const referenceRose = hourSelected ? windRoseData30m : windRoseData1h;
  const referenceRoseTitle = hourSelected ? "Wind Rose (30 min)" : "Wind Rose (1h)";

  const chartData = useMemo(() => {
    return rangeData
      .filter((d) => d.temperature != null || d.humidity != null)
      .map((d) => ({
        timestamp: new Date(d.timestamp).toISOString(),
        temperature: num(d.temperature),
        humidity: num(d.humidity),
      }));
  }, [rangeData]);

  // ET₀ (FAO-56 Penman-Monteith, per reading) vs solar irradiance.
  // ET₀ needs temperature, humidity, wind and solar together, so rows missing
  // any of those inputs yield a null ET₀ point while still plotting solar.
  const etoSolarData = useMemo(() => {
    const alt = station?.altitude != null ? Number(station.altitude) : 0;
    const lat = station?.latitude != null ? Number(station.latitude) : 0;
    return rangeData
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
  }, [rangeData, station?.altitude, station?.latitude, windSpeedUnit]);

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
   * total and displaying it as "Rain (24h)" showed hundreds of millimeters on a
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

  // Status is Live when a reading has arrived within the last two hours, else
  // Inactive. Battery is color-coded by state of charge for a 12 V system.
  const isLive = latest?.timestamp != null
    && (Date.now() - new Date(latest.timestamp).getTime()) < 2 * 60 * 60 * 1000;
  const statusText = isLive ? "Live" : "Inactive";
  const statusColor = isLive ? "#16a34a" : "#dc2626";
  const batteryColor = batteryVoltage == null ? "#000"
    : batteryVoltage >= 12.4 ? "#16a34a"
    : batteryVoltage >= 12.0 ? "#d97706"
    : "#dc2626";

  return (
    <div className="h-screen w-screen overflow-hidden bg-white">
      <DashboardLoadingOverlay ready={loadReady} total={loadSteps.length} done={loadDone} />
      {/* Design canvas sized to the viewport aspect ratio and scaled from the
          top-left to fill the screen. Anchoring top-left (rather than centering)
          means an ordinary display fills edge to edge with no letterbox; the
          layout is laid out once in design units and only its scale changes, so
          it looks identical on a 1080p monitor, a 4K TV, a laptop or a tablet. */}
      <div
        className="flex flex-col overflow-hidden bg-white"
        style={{
          width: stage.width,
          height: DESIGN_H,
          padding: 16,
          gap: 12,
          transform: `scale(${stage.scale})`,
          transformOrigin: "top left",
        }}
      >
      {/* Header: station identity and health on the left, branding pinned to the
          top right. Every item uses the same weight and size so the row reads as
          one line of information rather than a hierarchy. */}
      <div className="flex items-center justify-between gap-4 flex-shrink-0">
        {/* Chart window selector on the left; branding pinned right. The station
            identity now lives in the info block below, not on this strip. */}
        <div className="flex items-center gap-1 flex-shrink-0" role="group" aria-label="Chart time range">
          {COMPACT_RANGES.map(({ label, hours }) => (
            <Button
              key={hours}
              variant={rangeHours === hours ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-xs leading-none"
              style={rangeHours === hours ? { backgroundColor: STRATUS_NAVY } : undefined}
              aria-pressed={rangeHours === hours}
              onClick={() => setRangeHours(hours)}
            >
              {label}
            </Button>
          ))}
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
        {/* Top-left: a wide station-info block on top, then the metric tiles
            pushed down toward the wind roses. */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 grid grid-cols-3 gap-x-4 gap-y-1 flex-shrink-0">
            <InfoField label="Location" value={`${station?.name || shareInfo?.share?.name || "Weather Station"}${station?.location ? `, ${station.location}` : ""}`} />
            <InfoField label="Coordinates" value={`${latStr}, ${lngStr}`} />
            <InfoField label="AMSL" value={station?.altitude != null ? `${Math.round(Number(station.altitude))} m` : "--"} />
            <InfoField label="Status" value={statusText} valueColor={statusColor} />
            <InfoField label="Battery" value={`${fmt(batteryVoltage, 2)} V`} valueColor={batteryColor} />
            <InfoField label="Last Synced" value={lastSynced} />
          </div>
          <div className="grid grid-cols-4 auto-rows-min gap-2 content-start">
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
        </div>

        {/* Top-right: Temperature vs Humidity chart */}
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<ChartFallback />}>
            <WeatherChart
              title={`Temperature vs Humidity (${rangeLabel})`}
              data={chartData}
              heightClass="h-full"
              compact
              dualAxis
              zeroFloor={rangeHours < 24}
              series={[
                { dataKey: "temperature", name: "Temperature", color: CHART_COLORS.temperature, unit: "°C" },
                { dataKey: "humidity", name: "Humidity", color: CHART_COLORS.humidity, unit: "%" },
              ]}
            />
          </Suspense>
        </div>

        {/* Bottom-left: shared wind legend + 1h wind rose + 24h wind rose */}
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 min-h-0">
          {/* One shared legend for the wind rose colors */}
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
              <WindRose data={referenceRose} title={referenceRoseTitle} windSpeedUnit={windSpeedUnit} size={210} bare />
            </Suspense>
          </div>
          <div className="min-h-0 overflow-hidden">
            <Suspense fallback={<ChartFallback />}>
              <WindRose data={windRoseData} title={`Wind Rose (${rangeLabel})`} windSpeedUnit={windSpeedUnit} size={210} bare />
            </Suspense>
          </div>
        </div>

        {/* Bottom-right: ET₀ vs Solar Irradiance chart */}
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<ChartFallback />}>
            <WeatherChart
              title={`ET₀ vs Solar Irradiance (${rangeLabel})`}
              data={etoSolarData}
              heightClass="h-full"
              compact
              dualAxis
              zeroFloor={rangeHours < 24}
              series={[
                { dataKey: "eto", name: "ET₀", color: CHART_COLORS.eto, unit: "mm/d" },
                { dataKey: "solarRadiation", name: "Solar", color: CHART_COLORS.solarRadiation, unit: "W/m²" },
              ]}
            />
          </Suspense>
        </div>
      </div>
      {/* end scaled design canvas */}
      </div>
    </div>
  );
}
