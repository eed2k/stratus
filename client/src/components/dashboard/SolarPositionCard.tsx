// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";
import { getWindDirectionLabel } from "@/lib/windConstants";
import { calculateSolarPosition } from "../../../../shared/utils/calc";

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

  // Compute the full-day sun path in polar coordinates
  const pathPoints = useMemo(() => {
    const pts: { x: number; y: number; el: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let m = 0; m < 1440; m += 10) {
      const t = new Date(today.getTime() + m * 60000);
      const sp = calculateSolarPosition(latitude, longitude, t);
      if (sp.elevation > -2) {
        // Polar mapping: center=zenith(90°), outer ring=horizon(0°)
        const r = ((90 - Math.max(0, sp.elevation)) / 90) * 80;
        const angle = ((sp.azimuth - 90) * Math.PI) / 180; // rotate so N=up
        const x = 100 + r * Math.cos(angle);
        const y = 100 + r * Math.sin(angle);
        pts.push({ x, y, el: sp.elevation });
      }
    }
    return pts;
  }, [latitude, longitude]);

  // Current sun position in polar
  const sunPos = useMemo(() => {
    if (elevation < -5) return null;
    const r = ((90 - Math.max(0, elevation)) / 90) * 80;
    const angle = ((azimuth - 90) * Math.PI) / 180;
    return { x: 100 + r * Math.cos(angle), y: 100 + r * Math.sin(angle) };
  }, [elevation, azimuth]);

  const pathD = pathPoints.length > 1
    ? pathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-solar-position">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Solar Position
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Main metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs font-normal text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Elevation</p>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(elevation, 1)}
                </span>
                <span className="text-sm text-gray-500">°</span>
              </div>
              <p className="text-xs text-gray-400">
                {isDaytime ? (isGoldenHour ? "Golden Hour" : "Above Horizon") : (isNauticalTwilight ? "Twilight" : "Below Horizon")}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-normal text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Azimuth</p>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(azimuth, 1)}
                </span>
                <span className="text-sm text-gray-500">°</span>
              </div>
              <p className="text-xs text-gray-400">{getAzimuthDirection(azimuth)}</p>
            </div>
          </div>

          {/* Polar compass sun track */}
          <svg viewBox="0 0 200 200" className="w-full mx-auto" style={{ maxHeight: 200 }}>
            <defs>
              <radialGradient id="compassSky">
                <stop offset="0%" stopColor="#87ceeb" />
                <stop offset="70%" stopColor="#b8d8ec" />
                <stop offset="100%" stopColor="#dce8ef" />
              </radialGradient>
              <filter id="sunGlow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Sky background */}
            <circle cx="100" cy="100" r="90" fill="url(#compassSky)" stroke="#ccc" strokeWidth="0.5" />

            {/* Elevation rings */}
            {[0, 15, 30, 45, 60, 75].map(el => {
              const r = ((90 - el) / 90) * 80;
              return (
                <g key={el}>
                  <circle cx="100" cy="100" r={r} fill="none" stroke="#00000010" strokeWidth="0.5" strokeDasharray={el === 0 ? "none" : "2,3"} />
                  {el > 0 && el % 30 === 0 && (
                    <text x={100 + r + 2} y={99} fill="#aaa" fontSize="6" dominantBaseline="middle">{el}°</text>
                  )}
                </g>
              );
            })}

            {/* Cardinal direction lines + labels */}
            {([
              { label: "N", angle: -90 },
              { label: "E", angle: 0 },
              { label: "S", angle: 90 },
              { label: "W", angle: 180 },
            ] as const).map(d => {
              const rad = (d.angle * Math.PI) / 180;
              return (
                <g key={d.label}>
                  <line
                    x1={100 + 4 * Math.cos(rad)} y1={100 + 4 * Math.sin(rad)}
                    x2={100 + 82 * Math.cos(rad)} y2={100 + 82 * Math.sin(rad)}
                    stroke="#00000008" strokeWidth="0.5"
                  />
                  <text
                    x={100 + 88 * Math.cos(rad)} y={100 + 88 * Math.sin(rad)}
                    fill="#888" fontSize="8" fontWeight="bold"
                    textAnchor="middle" dominantBaseline="middle"
                  >
                    {d.label}
                  </text>
                </g>
              );
            })}

            {/* Sun path arc */}
            {pathD && (
              <path d={pathD} fill="none" stroke="#e8960066" strokeWidth="2.5" strokeLinecap="round" />
            )}

            {/* Current sun position */}
            {sunPos && (
              <g>
                <circle cx={sunPos.x} cy={sunPos.y} r="8" fill={isDaytime ? "#FFD700" : "#9aa8b4"} filter="url(#sunGlow)" opacity="0.85">
                  <animate attributeName="r" values="7;9;7" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx={sunPos.x} cy={sunPos.y} r="4" fill={isDaytime ? "#FF8C00" : "#778899"} />
              </g>
            )}

            {/* Center label */}
            <text x="100" y="100" fill="#aaa" fontSize="6" textAnchor="middle" dominantBaseline="middle">Zenith</text>
          </svg>

          {/* Time information grid */}
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Nautical Dawn</p>
              <p className="text-sm font-normal text-black">{formatTime(nauticalDawn)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Civil Dawn</p>
              <p className="text-sm font-normal text-black">{formatTime(civilDawn)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Sunrise</p>
              <p className="text-sm font-normal text-black">{formatTime(sunrise)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Solar Noon</p>
              <p className="text-sm font-normal text-black">{formatTime(solarNoon)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Sunset</p>
              <p className="text-sm font-normal text-black">{formatTime(sunset)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Civil Dusk</p>
              <p className="text-sm font-normal text-black">{formatTime(civilDusk)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Nautical Dusk</p>
              <p className="text-sm font-normal text-black">{formatTime(nauticalDusk)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Day Length</p>
              <p className="text-sm font-normal text-black">{formatDayLength(dayLength)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
