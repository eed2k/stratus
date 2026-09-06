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
 * The chart window for this view, fixed at 24 hours.
 *
 * There is deliberately no selector. This is an unattended wall display: nobody
 * is standing at it to change a range, and a control that is never touched only
 * costs screen space. Every chart and rose states the period it covers in its
 * own title instead, and that reclaimed row is given back to the plots, which
 * is what allows the axis labels to be large enough to read from a distance.
 */
const WINDOW_HOURS = 24;
const WINDOW_LABEL = "24h";

/** How often the display re-reads the station. */
const REFRESH_MS = 60 * 1000;

/**
 * The only columns this view plots over the 24-hour window.
 *
 * Requested explicitly because a full reading carries about 120 columns, so the
 * 500-point window came back as roughly 880 KB of mostly nulls, once a minute,
 * for every viewer. These six cover both charts, both wind roses and the
 * 24-hour rainfall total; `timestamp` is always returned by the endpoint.
 *
 * The live tiles are NOT served from here, they read the latest reading, so
 * narrowing this list does not narrow what the screen shows. Wind gust is absent
 * for exactly that reason: it appears on the wind tile, which reads the latest
 * reading, and nothing plots it across the window.
 */
const WINDOW_FIELDS = [
  "temperature", "humidity", "windSpeed", "windDirection",
  "solarRadiation", "rainfall",
] as const;

/**
 * Polling options shared by every query on this page.
 *
 * This is an unattended wall display, so refreshing has to be unconditional:
 *
 * - `refetchInterval` keeps the screen current without anyone touching it.
 * - `refetchIntervalInBackground` matters because React Query stops its timers
 *   while the document is hidden. A display parked on a second tab, or a screen
 *   the operating system has dimmed, would otherwise quietly stop updating and
 *   then show hours-old readings the moment somebody glanced at it.
 * - `staleTime: 0` so a scheduled refetch actually goes to the network instead
 *   of being served from the cache under the global 30 second staleTime.
 */
const LIVE_QUERY = {
  refetchInterval: REFRESH_MS,
  refetchIntervalInBackground: true,
  staleTime: 0,
} as const;

/**
 * Statuses that mean the share link itself is unusable, as opposed to a request
 * that merely failed.
 *
 * 404 the token is unknown, 403 deactivated or expired, 410 gone.
 */
const SHARE_GONE_STATUSES = [403, 404, 410];

/**
 * A share that no longer exists, distinguished from a request that failed.
 *
 * The two were treated the same, and every failure rendered "Share link not
 * found or expired". A momentary fault on page load therefore accused the link
 * of being dead, and a fraction of a second later the retry succeeded and the
 * dashboard appeared, which is the flash that was reported. Only this error type
 * is allowed to produce that message, and only it skips the retry.
 */
class ShareGoneError extends Error {
  constructor(message?: string) {
    super(message || "This share link is no longer available.");
    this.name = "ShareGoneError";
  }
}

/**
 * A reading as the share endpoint returns it.
 *
 * The server stamps every row with `collectedAt`, the moment the record was
 * taken off the station, which is a different thing from `timestamp`, the moment
 * the logger recorded it. It is not part of the shared WeatherData type because
 * that type models the reading itself, so it is declared here where it is read.
 */
type SharedReading = WeatherData & { collectedAt?: string | Date | null };

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

/**
 * Type size for the shared wind legend under the roses.
 *
 * Matched to the rose and chart headings (0.95rem) rather than to the tiles: the
 * legend is a key, so it should read as a heading-weight label and not compete
 * with the readings themselves.
 */
const LEGEND_TEXT_SIZE = "0.95rem";

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
 * Smallest viewport the compact dashboard is designed for: a standard laptop.
 *
 * This view deliberately packs a whole station onto one non-scrolling screen:
 * a 4x3 tile grid, two wind roses and two dual-axis charts. It is a wall display
 * for a laptop, monitor or TV. Tablets and phones are excluded on purpose rather
 * than accommodated - at those sizes the tiles and axis labels shrink past
 * readability, and a cramped version of this screen is worse than the full
 * shared dashboard, which IS responsive and is where those viewers are sent.
 *
 * 1280x660 is the floor: the width of a standard laptop panel, and a height that
 * still admits a laptop with browser chrome while excluding phone landscape.
 */
const COMPACT_MIN_WIDTH = 1280;
const COMPACT_MIN_HEIGHT = 660;

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

function useIsTooSmall(minWidth: number, minHeight: number): boolean {
  const measure = () =>
    typeof window !== "undefined"
    && (window.innerWidth < minWidth || window.innerHeight < minHeight);
  const [tooSmall, setTooSmall] = useState(measure);
  useEffect(() => {
    const check = () => setTooSmall(measure());
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minWidth, minHeight]);
  return tooSmall;
}

interface Stage {
  /** Canvas width in design units (height is always DESIGN_H). */
  width: number;
  /** Factor that maps design units to CSS pixels. */
  scale: number;
  /** Pixels to shift the scaled stage by, to center it if it cannot fill. */
  offsetX: number;
  offsetY: number;
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
    if (typeof window === "undefined") {
      return { width: 1920, scale: 1, offsetX: 0, offsetY: 0 };
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight || 1;
    const width = Math.max(
      MIN_DESIGN_W,
      Math.min(MAX_DESIGN_W, Math.round(DESIGN_H * (vw / vh))),
    );
    const scale = Math.min(vw / width, vh / DESIGN_H);
    // For any ordinary display the width tracks the aspect ratio exactly, both
    // ratios are equal and these are zero, so the stage fills the screen. They
    // only become non-zero at the clamped extremes (for example a 32:9
    // ultrawide), where centering the leftover space looks deliberate whereas
    // pinning to the top left would look like a rendering fault.
    const offsetX = Math.max(0, (vw - width * scale) / 2);
    const offsetY = Math.max(0, (vh - DESIGN_H * scale) / 2);
    return { width, scale, offsetX, offsetY };
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

  const isTooNarrow = useIsTooSmall(COMPACT_MIN_WIDTH, COMPACT_MIN_HEIGHT);
  const stage = useFitStage();

  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const shareHeaders: HeadersInit = sessionToken ? { "X-Share-Session": sessionToken } : {};

  // Share info (name + password requirement)
  const {
    data: shareInfo,
    isLoading: loadingShare,
    error: shareError,
  } = useQuery({
    queryKey: ["compact-share-info", shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}`);
      // A status that describes the LINK is terminal: no amount of retrying
      // will bring back a share that was deleted, deactivated or has expired.
      if (SHARE_GONE_STATUSES.includes(res.status)) {
        const body = await res.json().catch(() => ({}));
        throw new ShareGoneError(body?.error);
      }
      // Anything else is a fault in the request, not a verdict on the link, so
      // it is allowed to be retried.
      if (!res.ok) throw new Error(`Share lookup failed with ${res.status}`);
      return res.json();
    },
    enabled: !!shareToken,
    // Retry transient faults; fail fast when the link itself is gone.
    retry: (failureCount, error) => !(error instanceof ShareGoneError) && failureCount < 3,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4000),
    // Keep trying in the background so an unattended display recovers by itself
    // once the server is reachable again, instead of sitting on an error screen
    // until somebody walks over and reloads it.
    ...LIVE_QUERY,
  });

  const requiresPassword = shareInfo?.share?.requiresPassword && !sessionToken;

  // Station info.
  //
  // Polled rather than fetched once: the sync time and the active/inactive state
  // are read from here, so a static copy would freeze them on screen. slim=1
  // drops the station photo from the reply, which this view does not display and
  // which would otherwise add about 64 KB to every poll.
  const { data: stationData, isSuccess: stationReady } = useQuery<{ station: any }>({
    queryKey: ["compact-station", shareToken, sessionToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/station?slim=1`, { headers: shareHeaders });
      if (!res.ok) throw new Error("Station not found");
      return res.json();
    },
    enabled: !!shareToken && !requiresPassword,
    placeholderData: (prev) => prev,
    ...LIVE_QUERY,
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
  const { data: latest, isSuccess: latestReady } = useQuery<SharedReading>({
    queryKey: ["compact-latest", shareToken, sessionToken],
    queryFn: async () => {
      const res = await fetch(`/api/shares/${shareToken}/data/latest`, { headers: shareHeaders });
      if (!res.ok) throw new Error("latest");
      return res.json();
    },
    enabled: !!shareToken && !requiresPassword,
    placeholderData: (prev) => prev,
    ...LIVE_QUERY,
  });

  // Recent 24h window for wind rose + temp/humidity chart (fixed, no user options)
  const { data: recentData = [], isSuccess: recentReady } = useQuery<WeatherData[]>({
    queryKey: ["compact-recent", shareToken, sessionToken, latest?.timestamp],
    queryFn: async () => {
      const endTime = latest?.timestamp ? new Date(latest.timestamp) : new Date();
      const startTime = new Date(endTime.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
      const res = await fetch(
        `/api/shares/${shareToken}/data?startTime=${startTime.toISOString()}`
        + `&endTime=${endTime.toISOString()}&limit=500&fields=${WINDOW_FIELDS.join(",")}`,
        { headers: shareHeaders }
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!shareToken && !requiresPassword,
    // The key contains the newest reading's timestamp, so every sync creates a
    // fresh cache entry. Without carrying the previous result over, the charts
    // and both wind roses would empty out for as long as the new window takes to
    // arrive - a visible blink on the wall every time data lands.
    placeholderData: (prev) => prev,
    ...LIVE_QUERY,
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
   * The chart window. The fetch and the window are both 24 hours, so this is
   * simply everything that was fetched; it stays a named value because the
   * charts, the roses and the rainfall total all have to agree on one period.
   */
  const rangeData = recentData;

  const windRoseData = useMemo(() => processWindRoseData(rangeData, windSpeedUnit), [rangeData, windSpeedUnit]);

  /**
   * A fixed 1-hour rose, shown beside the 24-hour one.
   *
   * The pair is the point: the 24-hour rose gives the prevailing pattern and the
   * 1-hour rose gives what the wind is doing right now, so a viewer can see at a
   * glance whether conditions have turned.
   */
  const referenceRose = useMemo(
    () => processWindRoseData(withinLastHours(recentData, 1), windSpeedUnit),
    [recentData, windSpeedUnit],
  );
  const referenceRoseTitle = "Wind Rose (1h)";

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
  /**
   * When the server last took data off this station.
   *
   * This is deliberately NOT the newest reading's timestamp. A logger stamps a
   * record at, say, 20:40 and the file carrying it is collected at 21:23, so the
   * reading timestamp can sit close to an hour behind the actual sync and this
   * screen disagreed with every other view in the app.
   *
   * The precedence matches Stations and StationSelector so all three agree:
   * the station's own last-connected time, then the ingest time stamped on the
   * newest reading, then the reading's own time as a last resort for a station
   * whose sync time was never recorded.
   */
  const lastSyncedAt = station?.lastConnected ?? latest?.collectedAt ?? latest?.timestamp ?? null;
  const lastSynced = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("en-ZA", {
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
            The compact dashboard is a single-screen wall display and needs a
            laptop screen or larger (at least {COMPACT_MIN_WIDTH} by{" "}
            {COMPACT_MIN_HEIGHT}). Open the full dashboard instead, which is
            designed for tablets and phones.
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
  /**
   * Only take over the screen when there is genuinely nothing to show.
   *
   * `shareInfo` is kept by the query cache across a failed refetch, so a single
   * dropped poll on a display that has been running for hours no longer wipes it
   * and replaces it with an error. And the wording now follows the actual cause:
   * a deleted or expired link says so, while a request that failed says it is
   * retrying, because it is - see the retry and refetch settings on the query.
   */
  if (shareError && !shareInfo) {
    const gone = shareError instanceof ShareGoneError;
    return (
      <div className="h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-sm text-center space-y-2">
          <p className="text-base font-semibold text-black">
            {gone ? "Share link not available" : "Cannot reach the server"}
          </p>
          <p className="text-sm text-black">
            {gone
              ? shareError.message
              : "This dashboard could not load its data. It keeps retrying and will "
                + "appear on its own once the connection is back."}
          </p>
        </div>
      </div>
    );
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

  // Status is Active when the station has synced within the last two hours, else
  // Inactive. Judged on the same timestamp shown as "Last Synced" so the two
  // fields cannot contradict each other: a station that synced five minutes ago
  // reads Active even when its newest record is older, which is normal for a
  // logger that reports in batches. Battery is color-coded by state of charge for
  // a 12 V system.
  const isLive = lastSyncedAt != null
    && (Date.now() - new Date(lastSyncedAt).getTime()) < 2 * 60 * 60 * 1000;
  const statusText = isLive ? "Active" : "Inactive";
  const statusColor = isLive ? "#16a34a" : "#dc2626";
  const batteryColor = batteryVoltage == null ? "#000"
    : batteryVoltage >= 12.4 ? "#16a34a"
    : batteryVoltage >= 12.0 ? "#d97706"
    : "#dc2626";

  return (
    <div className="h-screen w-screen overflow-hidden bg-white">
      <DashboardLoadingOverlay ready={loadReady} total={loadSteps.length} done={loadDone} />
      {/* Design canvas sized to the viewport aspect ratio and scaled to fill the
          screen. The layout is written once in design units and only its scale
          changes, so it looks identical on a 1080p monitor, a 4K TV, a laptop or
          a landscape tablet, and it never reflows or clips. The translate is
          zero on ordinary displays and only centers the stage at the clamped
          extreme aspect ratios. */}
      <div
        className="flex flex-col overflow-hidden bg-white"
        style={{
          width: stage.width,
          height: DESIGN_H,
          padding: 16,
          gap: 12,
          transform: `translate(${stage.offsetX}px, ${stage.offsetY}px) scale(${stage.scale})`,
          transformOrigin: "top left",
        }}
      >
      {/* No header row. The window selector is gone and the branding has moved
          into the station-info block, so the entire canvas height belongs to the
          content: that is what makes room for taller charts and larger axis
          labels. */}
      <div className="grid grid-cols-2 grid-rows-2 gap-2 flex-1 min-h-0">
        {/* Top-left: a wide station-info block on top, then the metric tiles
            pushed down toward the wind roses. */}
        <div className="flex flex-col gap-2 min-h-0">
          <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-stretch gap-5 flex-shrink-0">
            {/* Station identity and health in two columns, so AMSL and Last
                Synced fall under Status and Battery. Two columns rather than
                three deliberately: it gives the width back to the branding
                beside it, and makes this block tall enough to sit against the
                metric tiles instead of leaving a gap above them. */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 flex-1 min-w-0">
              <InfoField label="Location" value={`${station?.name || shareInfo?.share?.name || "Weather Station"}${station?.location ? `, ${station.location}` : ""}`} />
              <InfoField label="Coordinates" value={`${latStr}, ${lngStr}`} />
              <InfoField label="Status" value={statusText} valueColor={statusColor} />
              <InfoField label="Battery" value={`${fmt(batteryVoltage, 2)} V`} valueColor={batteryColor} />
              <InfoField label="AMSL" value={station?.altitude != null ? `${Math.round(Number(station.altitude))} m` : "--"} />
              <InfoField label="Last Synced" value={lastSynced} />
            </div>
            {/* Branding: the credit on top, both marks side by side underneath.
                It occupies this side of the info block on its own. */}
            <div className="flex flex-col items-center justify-center gap-2 flex-shrink-0 self-stretch border-l border-gray-200 pl-5">
              <span className="text-black font-bold whitespace-nowrap"
                    style={{ ...HEADER_FONT, fontSize: LEGEND_TEXT_SIZE }}>
                Powered by
              </span>
              <div className="flex items-center gap-3">
                {/* Stratus mark: dark blue circle with white dot (matches the app sidebar) */}
                <div className="w-10 h-10 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-sm border border-white/10 flex-shrink-0">
                  <div className="w-3 h-3 rounded-full bg-white" />
                </div>
                <div className="inline-flex flex-col items-center flex-shrink-0">
                  <span className="text-[20px] font-extrabold tracking-wide leading-none" style={{ fontFamily: 'Arial, sans-serif', color: '#1e3a5f' }}>STRATUS</span>
                  <span className="text-[10px] font-bold tracking-wider mt-1" style={{ fontFamily: 'Arial, sans-serif', color: '#1e3a5f' }}>METRON (PTY) LTD</span>
                </div>
                {/* Metron company logo */}
                <img src="/metron-logo.png" alt="Metron" className="w-10 h-10 object-contain flex-shrink-0" />
              </div>
            </div>
          </div>
          {/* Tiles follow the info block directly. They were previously pushed
              to the bottom of the cell with mt-auto, which opened a large empty
              band between the two blocks; the taller two-column info block plus
              normal flow keeps them together. */}
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
              title={`Temperature vs Humidity (${WINDOW_LABEL})`}
              data={chartData}
              heightClass="h-full"
              compact
              dualAxis
              series={[
                { dataKey: "temperature", name: "Temperature", color: CHART_COLORS.temperature, unit: "°C" },
                { dataKey: "humidity", name: "Humidity", color: CHART_COLORS.humidity, unit: "%" },
              ]}
            />
          </Suspense>
        </div>

        {/* Bottom-left: the two wind roses side by side with one shared legend
            underneath them.
            The legend used to be a narrow card to the LEFT of the roses, which
            cost horizontal space and forced its labels down to 10px. Moving it
            below frees that column: the roses shift left, gain the gap between
            them, and pull up toward the metric tiles, while the legend gets the
            full width to lay its classes out in a single readable row. */}
        <div className="flex flex-col min-h-0 gap-1">
          <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
            <div className="min-h-0 overflow-hidden">
              <Suspense fallback={<ChartFallback />}>
                <WindRose data={referenceRose} title={referenceRoseTitle} windSpeedUnit={windSpeedUnit} size={210} bare />
              </Suspense>
            </div>
            <div className="min-h-0 overflow-hidden">
              <Suspense fallback={<ChartFallback />}>
                <WindRose data={windRoseData} title={`Wind Rose (${WINDOW_LABEL})`} windSpeedUnit={windSpeedUnit} size={210} bare />
              </Suspense>
            </div>
          </div>
          {/* Shared legend, bottom left. One horizontal run of swatches, sized to
              match the rose and chart headings so it reads as part of the same
              family rather than as fine print. */}
          <div className="flex-shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
            <span className="font-semibold leading-none"
                  style={{ fontFamily: 'Arial, Helvetica, sans-serif',
                           fontSize: LEGEND_TEXT_SIZE, color: STRATUS_NAVY }}>
              Wind ({windUnitLabel})
            </span>
            {getSimplifiedClasses(windSpeedUnit).map((sc) => (
              <span key={sc.label} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: sc.color }} />
                <span className="leading-none whitespace-nowrap"
                      style={{ fontFamily: 'Arial, Helvetica, sans-serif',
                               fontSize: LEGEND_TEXT_SIZE, color: '#000' }}>
                  {sc.label}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Bottom-right: ET₀ vs Solar Irradiance chart */}
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<ChartFallback />}>
            <WeatherChart
              title={`ET₀ vs Solar Irradiance (${WINDOW_LABEL})`}
              data={etoSolarData}
              heightClass="h-full"
              compact
              dualAxis
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
