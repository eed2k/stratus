// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";
import { getWindDirectionLabel } from "@/lib/windConstants";

// Helper to safely convert to number and format
const safeFixed = (value: number | string | null | undefined, decimals: number = 1): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return (num != null && !isNaN(num)) ? num.toFixed(decimals) : '--';
};

interface SolarPositionCardProps {
  elevation: number;         // degrees above horizon
  azimuth: number;           // degrees from north
  sunrise?: Date | string;
  sunset?: Date | string;
  nauticalDawn?: Date | string;
  nauticalDusk?: Date | string;
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
  sunrise,
  sunset,
  nauticalDawn,
  nauticalDusk,
  solarNoon,
  dayLength,
}: SolarPositionCardProps) {
  const isDaytime = elevation > 0;
  const isGoldenHour = elevation > 0 && elevation < 6;
  const isNauticalTwilight = elevation <= 0 && elevation > -12;

  const sunPositionStyle = useMemo(() => {
    // Create a visual representation of sun position on arc
    const normalizedElevation = Math.max(-20, Math.min(90, elevation));
    const percentage = ((normalizedElevation + 20) / 110) * 100;
    return {
      left: `${50 + (azimuth > 180 ? -1 : 1) * Math.min(40, Math.abs(azimuth - 180) / 4.5)}%`,
      bottom: `${percentage}%`,
    };
  }, [elevation, azimuth]);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-solar-position">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Solar Position
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
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

          {/* Sun position visualization */}
          <div className="relative h-20 bg-gradient-to-b from-blue-100 to-blue-50 rounded-lg overflow-hidden">
            {/* Horizon line */}
            <div className="absolute bottom-[18%] left-0 right-0 h-px bg-gray-400" />
            <div className="absolute bottom-[18%] right-2 text-xs text-gray-400">Horizon</div>
            
            {/* Sun indicator */}
            <div 
              className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 transition-all duration-500 flex items-center justify-center"
              style={sunPositionStyle}
            >
              <span className={`text-sm font-bold ${isDaytime ? 'text-yellow-500' : 'text-gray-400'}`}>
                {isDaytime ? '●' : '○'}
              </span>
            </div>

            {/* Compass indicator */}
            <div className="absolute top-2 left-2 flex items-center gap-1 text-xs text-gray-500">
              <span>{getAzimuthDirection(azimuth)}</span>
            </div>
          </div>

          {/* Time information grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Nautical Dawn</p>
              <p className="text-sm font-normal text-black">{formatTime(nauticalDawn)}</p>
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
