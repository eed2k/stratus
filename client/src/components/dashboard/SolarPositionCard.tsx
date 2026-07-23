// Stratus Weather Server
// Created by Lukas Esterhuizen
// v3.5 - sun arc with live time, hover tooltip (azimuth/elevation), taller, day=yellow night=navy dark blue

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo, useRef, useState, useEffect, useId } from "react";
import { getWindDirectionLabel } from "@/lib/windConstants";

// --- Home Assistant sun-card geometry (viewBox 0 0 550 150) ---
const SUN_ARC = {
  EVENT_X: { dayStart: 5, sunrise: 101, sunset: 449, dayEnd: 545 },
  HORIZON_Y: 108,
  SUN_RADIUS: 17,
  PATH: "M5,146 C29,153 73,128 101,108 C276,-29 342,23 449,108 C473,123 509,150 545,146",
};

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  return typeof value === "string" ? new Date(value) : value;
}

function minutesSinceDayStart(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// Helper to safely convert to number and format
const safeFixed = (value: number | string | null | undefined, decimals: number = 1): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return (num != null && !isNaN(num)) ? num.toFixed(decimals) : '--';
};

interface SolarPositionCardProps {
  elevation: number;         // degrees above horizon
  azimuth: number;           // degrees from north
  latitude: number;          // station latitude for sun path
  longitude: number;         // station longitude for sun path
  sunrise?: Date | string;
  sunset?: Date | string;
  nauticalDawn?: Date | string;
  nauticalDusk?: Date | string;
  civilDawn?: Date | string;
  civilDusk?: Date | string;
  solarNoon?: Date | string;
  dayLength?: number;        // minutes
}

function formatTime(date: Date | string | undefined): string {
  if (!date) return "--:--";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDayLength(minutes: number | undefined): string {
  if (!minutes) return "--:--";
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

function getAzimuthDirection(azimuth: number): string {
  return getWindDirectionLabel(azimuth);
}

export function SolarPositionCard({
  elevation,
  azimuth,
  latitude,
  longitude,
  sunrise,
  sunset,
  nauticalDawn,
  nauticalDusk,
  civilDawn,
  civilDusk,
  solarNoon,
  dayLength,
}: SolarPositionCardProps) {
    const isDaytime = elevation > 0;
  const isGoldenHour = elevation > 0 && elevation < 6;
  const isNauticalTwilight = elevation <= 0 && elevation > -12;

  // --- Home Assistant style sun arc (replaces the old polar compass) ---
  const pathRef = useRef<SVGPathElement | null>(null);
  // unique gradient ids so multiple cards on one page don't collide
  const rawId = useId().replace(/:/g, "");
  const sunGradId = `sun-${rawId}`;
  const dawnGradId = `dawn-${rawId}`;
  const dayGradId = `day-${rawId}`;
  const duskGradId = `dusk-${rawId}`;

    // tick every second so the live clock updates smoothly
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Hover state for tooltip
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; el: number; az: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [pathReady, setPathReady] = useState(false);
  useEffect(() => {
    if (pathRef.current) setPathReady(true);
  }, []);

    const arc = useMemo(() => {
    const sunriseDate = toDate(sunrise);
    const sunsetDate = toDate(sunset);
    const path = pathRef.current;
    if (!path || !sunriseDate || !sunsetDate) {
      return null;
    }

    const eventsAt = {
      dayStart: 0,
      sunrise: minutesSinceDayStart(sunriseDate),
      sunset: minutesSinceDayStart(sunsetDate),
      dayEnd: 23 * 60 + 59,
    };

    const minutesNow = minutesSinceDayStart(now);

    // Dawn section position [0 - 105]
    const dawnSectionPosition =
      eventsAt.sunrise > 0
        ? (Math.min(minutesNow, eventsAt.sunrise) * 105) / eventsAt.sunrise
        : 0;

    // Day section position [106 - 499]
    const daySpan = Math.max(eventsAt.sunset - eventsAt.sunrise, 1);
    const minutesSinceDay = Math.max(minutesNow - eventsAt.sunrise, 0);
    const daySectionPosition = (Math.min(minutesSinceDay, daySpan) * (499 - 106)) / daySpan;

    // Dusk section position [500 - 605]
    const duskSpan = Math.max(eventsAt.dayEnd - eventsAt.sunset, 1);
    const minutesSinceDusk = Math.max(minutesNow - eventsAt.sunset, 0);
    const duskSectionPosition = (minutesSinceDusk * (605 - 500)) / duskSpan;

    const position = dawnSectionPosition + daySectionPosition + duskSectionPosition;
    const sunPosition = path.getPointAtLength(position);

    const { dayStart, sunrise: sunriseX, sunset: sunsetX, dayEnd } = SUN_ARC.EVENT_X;
    const dawnProgressPercent = (100 * (sunPosition.x - dayStart)) / (sunriseX - dayStart);
    const dayProgressPercent = (100 * (sunPosition.x - sunriseX)) / (sunsetX - sunriseX);
    const duskProgressPercent = (100 * (sunPosition.x - sunsetX)) / (dayEnd - sunsetX);

    const sunYTop = sunPosition.y - SUN_ARC.SUN_RADIUS;
    const yOver = SUN_ARC.HORIZON_Y - sunYTop;
    let sunPercentOverHorizon = 0;
    if (yOver > 0) {
      sunPercentOverHorizon = Math.min((100 * yOver) / (2 * SUN_ARC.SUN_RADIUS), 100);
    }

    return {
      dawnProgressPercent: Math.max(0, Math.min(100, dawnProgressPercent)),
      dayProgressPercent: Math.max(0, Math.min(100, dayProgressPercent)),
      duskProgressPercent: Math.max(0, Math.min(100, duskProgressPercent)),
      sunPercentOverHorizon,
      sunPosition: { x: sunPosition.x, y: sunPosition.y },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sunrise, sunset, now, pathReady]);


  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-solar-position" data-v="3.4">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Solar Position
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex gap-2">
          {/* Left: Data blocks (55%) */}
          <div className="w-[55%] space-y-1">
            {/* Elevation & Azimuth */}
            <div className="grid grid-cols-2 gap-1">
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-1 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Elevation</p>
                <div className="flex items-baseline justify-center gap-0.5">
                  <span className="text-base font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(elevation, 1)}</span>
                  <span className="text-xs text-black">°</span>
                </div>
                <span className="text-xs text-black">
                  {isDaytime ? (isGoldenHour ? "Golden Hour" : "Above Horizon") : (isNauticalTwilight ? "Twilight" : "Below Horizon")}
                </span>
              </div>
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-1 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Azimuth</p>
                <div className="flex items-baseline justify-center gap-0.5">
                  <span className="text-base font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(azimuth, 1)}</span>
                  <span className="text-xs text-black">°</span>
                </div>
                <span className="text-xs text-black">{getAzimuthDirection(azimuth)}</span>
              </div>
            </div>

            {/* Sunrise / Sunset */}
            <div className="grid grid-cols-2 gap-1">
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Sunrise</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatTime(sunrise)}</p>
              </div>
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Sunset</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatTime(sunset)}</p>
              </div>
            </div>

            {/* Solar Noon / Day Length */}
            <div className="grid grid-cols-2 gap-1">
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar Noon</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatTime(solarNoon)}</p>
              </div>
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Day Length</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatDayLength(dayLength)}</p>
              </div>
            </div>

            {/* Nautical Dawn/Dusk */}
            <div className="grid grid-cols-2 gap-1">
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Naut. Dawn</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatTime(nauticalDawn)}</p>
              </div>
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Naut. Dusk</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatTime(nauticalDusk)}</p>
              </div>
            </div>

            {/* Civil Dawn/Dusk */}
            <div className="grid grid-cols-2 gap-1">
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Civil Dawn</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatTime(civilDawn)}</p>
              </div>
              <div className="rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-center">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Civil Dusk</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{formatTime(civilDusk)}</p>
              </div>
            </div>
          </div>

                              {/* Right: Sun arc animation with live time + hover tooltip (45%) */}
          <div className="w-[45%] flex flex-col items-center justify-start pt-1">
            {/* Live time display */}
            <p className="text-base font-normal text-black mb-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </p>

            {/* SVG sun arc - taller viewBox (200 instead of 150) */}
            <div className="relative w-full" style={{ maxWidth: '400px' }}>
              <svg
                ref={svgRef}
                viewBox="0 0 550 200"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full"
                style={{ ['--sun-card-lines' as any]: '#d0d0d0' }}
                onMouseMove={(e) => {
                  if (!svgRef.current || !pathRef.current) return;
                  const rect = svgRef.current.getBoundingClientRect();
                  const scaleX = 550 / rect.width;
                  const scaleY = 200 / rect.height;
                  const svgX = (e.clientX - rect.left) * scaleX;
                  const svgY = (e.clientY - rect.top) * scaleY;
                  // Map x position to time-of-day and compute approximate elevation
                  const { dayStart, sunrise: sunriseX, sunset: sunsetX, dayEnd } = SUN_ARC.EVENT_X;
                  const horizonY = SUN_ARC.HORIZON_Y + 25; // offset for taller viewBox
                  // Estimate azimuth: 0° (N) at sunrise, 180° at noon, 360° at sunset (simplified)
                  let approxAz = 90; // default east
                  if (svgX <= sunriseX) {
                    approxAz = 90 - ((sunriseX - svgX) / (sunriseX - dayStart)) * 45; // pre-sunrise: ~45-90
                  } else if (svgX <= (sunriseX + sunsetX) / 2) {
                    approxAz = 90 + ((svgX - sunriseX) / ((sunriseX + sunsetX) / 2 - sunriseX)) * 90; // morning: 90-180
                  } else if (svgX <= sunsetX) {
                    approxAz = 180 + ((svgX - (sunriseX + sunsetX) / 2) / (sunsetX - (sunriseX + sunsetX) / 2)) * 90; // afternoon: 180-270
                  } else {
                    approxAz = 270 + ((svgX - sunsetX) / (dayEnd - sunsetX)) * 45; // post-sunset: 270-315
                  }
                  // Estimate elevation from y: above horizon = positive, below = negative
                  const approxEl = ((horizonY - svgY) / horizonY) * 90; // rough: 0 at horizon, 90 at top
                  setHoverInfo({ x: e.clientX - rect.left, y: e.clientY - rect.top, el: Math.max(-18, Math.min(90, approxEl)), az: approxAz % 360 });
                }}
                onMouseLeave={() => setHoverInfo(null)}
              >
                <defs>
                  {/* Sun gradient (yellow) */}
                  <linearGradient id={sunGradId} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style={{ stopColor: '#ffd60a', stopOpacity: 1 }} />
                    <stop offset={`${arc?.sunPercentOverHorizon ?? 0}%`} style={{ stopColor: '#ffd60a', stopOpacity: 1 }} />
                    <stop offset={`${arc?.sunPercentOverHorizon ?? 0}%`} style={{ stopColor: 'rgb(0,0,0,0)', stopOpacity: 1 }} />
                  </linearGradient>

                  {/* Dawn = navy dark blue */}
                  <linearGradient id={dawnGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: '#0a1a3f', stopOpacity: 1 }} />
                    <stop offset={`${arc?.dawnProgressPercent ?? 0}%`} style={{ stopColor: '#0a1a3f', stopOpacity: 1 }} />
                    <stop offset={`${arc?.dawnProgressPercent ?? 0}%`} style={{ stopColor: 'rgb(0,0,0,0)', stopOpacity: 1 }} />
                  </linearGradient>

                  {/* Day = yellow */}
                  <linearGradient id={dayGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: '#ffd60a', stopOpacity: 1 }} />
                    <stop offset={`${arc?.dayProgressPercent ?? 0}%`} style={{ stopColor: '#ffd60a', stopOpacity: 1 }} />
                    <stop offset={`${arc?.dayProgressPercent ?? 0}%`} style={{ stopColor: 'rgb(0,0,0,0)', stopOpacity: 1 }} />
                  </linearGradient>

                  {/* Dusk = navy dark blue */}
                  <linearGradient id={duskGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style={{ stopColor: '#0a1a3f', stopOpacity: 1 }} />
                    <stop offset={`${arc?.duskProgressPercent ?? 0}%`} style={{ stopColor: '#0a1a3f', stopOpacity: 1 }} />
                    <stop offset={`${arc?.duskProgressPercent ?? 0}%`} style={{ stopColor: 'rgb(0,0,0,0)', stopOpacity: 1 }} />
                  </linearGradient>
                </defs>

                {/* Shift all paths down by 25 to centre in the taller viewBox */}
                <g transform="translate(0, 25)">
                  <path ref={pathRef} d={SUN_ARC.PATH} fill="none" stroke="var(--sun-card-lines)" strokeWidth="2" shapeRendering="geometricPrecision" />
                  <path d="M5,146 C29,153 73,128 101,108 L 5 108" fill={`url(#${dawnGradId})`} opacity={arc?.dawnProgressPercent ? 1 : 0} stroke={`url(#${dawnGradId})`} shapeRendering="geometricPrecision" />
                  <path d="M101,108 C276,-29 342,23 449,108 L 104,108" fill={`url(#${dayGradId})`} opacity={arc?.dayProgressPercent ? 1 : 0} stroke={`url(#${dayGradId})`} shapeRendering="geometricPrecision" />
                  <path d="M449,108 C473,123 509,150 545,146 L 545 108" fill={`url(#${duskGradId})`} opacity={arc?.duskProgressPercent ? 1 : 0} stroke={`url(#${duskGradId})`} shapeRendering="geometricPrecision" />
                  <line x1="5" y1="108" x2="545" y2="108" stroke="var(--sun-card-lines)" strokeWidth="1" />
                  <line x1="101" y1="30" x2="101" y2="100" stroke="var(--sun-card-lines)" strokeWidth="1" strokeDasharray="4,2" />
                  <line x1="449" y1="30" x2="449" y2="100" stroke="var(--sun-card-lines)" strokeWidth="1" strokeDasharray="4,2" />
                  {/* Sunrise / Sunset labels */}
                  <text x="101" y="22" textAnchor="middle" fill="#000" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">{formatTime(sunrise)}</text>
                  <text x="449" y="22" textAnchor="middle" fill="#000" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">{formatTime(sunset)}</text>
                  {/* Sun circle */}
                  <circle cx={arc?.sunPosition.x ?? 0} cy={arc?.sunPosition.y ?? 0} r={SUN_ARC.SUN_RADIUS} opacity={arc ? 1 : 0} stroke="#e6b800" strokeWidth="2" fill={`url(#${sunGradId})`} shapeRendering="geometricPrecision" />
                </g>
              </svg>

              {/* Hover tooltip */}
              {hoverInfo && (
                <div
                  className="absolute pointer-events-none bg-black/80 text-white text-xs px-2 py-1 rounded shadow"
                  style={{ left: hoverInfo.x + 10, top: hoverInfo.y - 30, fontFamily: 'Arial, Helvetica, sans-serif' }}
                >
                  El: {hoverInfo.el.toFixed(1)}° &nbsp; Az: {hoverInfo.az.toFixed(1)}°
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
