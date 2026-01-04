import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Sunrise, Sunset, Moon, Navigation2 } from "lucide-react";
import { useMemo } from "react";
import { getWindDirectionLabel } from "@/lib/windConstants";

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
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
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
                  {elevation.toFixed(1)}
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
                  {azimuth.toFixed(1)}
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
              className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 transition-all duration-500"
              style={sunPositionStyle}
            >
              {isDaytime ? (
                <Sun className="w-6 h-6 text-yellow-500 drop-shadow-lg" />
              ) : (
                <Moon className="w-6 h-6 text-gray-400" />
              )}
            </div>

            {/* Compass indicator */}
            <div className="absolute top-2 left-2 flex items-center gap-1 text-xs text-gray-500">
              <Navigation2 className="h-3 w-3" style={{ transform: `rotate(${azimuth}deg)` }} />
              <span>{getAzimuthDirection(azimuth)}</span>
            </div>
          </div>

          {/* Time information grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Nautical Dawn</p>
              <div className="flex items-center justify-center gap-1">
                <Moon className="h-3 w-3 text-blue-400" />
                <p className="text-sm font-normal text-black">{formatTime(nauticalDawn)}</p>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Sunrise</p>
              <div className="flex items-center justify-center gap-1">
                <Sunrise className="h-3 w-3 text-orange-400" />
                <p className="text-sm font-normal text-black">{formatTime(sunrise)}</p>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Solar Noon</p>
              <div className="flex items-center justify-center gap-1">
                <Sun className="h-3 w-3 text-yellow-500" />
                <p className="text-sm font-normal text-black">{formatTime(solarNoon)}</p>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Sunset</p>
              <div className="flex items-center justify-center gap-1">
                <Sunset className="h-3 w-3 text-orange-500" />
                <p className="text-sm font-normal text-black">{formatTime(sunset)}</p>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
              <p className="text-xs text-gray-500">Nautical Dusk</p>
              <div className="flex items-center justify-center gap-1">
                <Moon className="h-3 w-3 text-indigo-400" />
                <p className="text-sm font-normal text-black">{formatTime(nauticalDusk)}</p>
              </div>
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
