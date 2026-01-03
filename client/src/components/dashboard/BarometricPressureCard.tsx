import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge, ArrowUp, ArrowDown, Mountain } from "lucide-react";

interface BarometricPressureCardProps {
  stationPressure: number;      // hPa/mbar at station altitude
  seaLevelPressure?: number;    // hPa/mbar calibrated to sea level
  altitude?: number;            // meters
  temperature?: number;         // °C (for calculation if needed)
  trend?: number;               // Change in last 3 hours (hPa)
  sparklineDataStation?: number[];
  sparklineDataSeaLevel?: number[];
}

function getPressureTrend(trend: number): { label: string; icon: typeof ArrowUp; color: string } {
  if (trend > 2) return { label: "Rising Rapidly", icon: ArrowUp, color: "text-blue-500" };
  if (trend > 0.5) return { label: "Rising", icon: ArrowUp, color: "text-cyan-500" };
  if (trend < -2) return { label: "Falling Rapidly", icon: ArrowDown, color: "text-red-500" };
  if (trend < -0.5) return { label: "Falling", icon: ArrowDown, color: "text-orange-500" };
  return { label: "Steady", icon: ArrowUp, color: "text-green-500" };
}

function getWeatherOutlook(seaLevelPressure: number, trend: number): string {
  if (seaLevelPressure > 1025) {
    if (trend >= 0) return "Fair weather expected";
    return "Weather may change";
  }
  if (seaLevelPressure > 1013) {
    if (trend > 0) return "Weather improving";
    if (trend < 0) return "Weather may deteriorate";
    return "Stable conditions";
  }
  if (seaLevelPressure > 1000) {
    if (trend > 0) return "Weather improving";
    return "Unsettled weather";
  }
  return "Storm conditions possible";
}

export function BarometricPressureCard({
  stationPressure,
  seaLevelPressure,
  altitude = 0,
  temperature = 15,
  trend = 0,
  sparklineDataStation = [],
  sparklineDataSeaLevel = [],
}: BarometricPressureCardProps) {
  // Calculate sea level pressure if not provided
  const calculatedSeaLevel = seaLevelPressure ?? 
    stationPressure * Math.pow(1 - (0.0065 * altitude) / (temperature + 273.15 + 0.0065 * altitude), -5.257);
  
  const pressureTrend = getPressureTrend(trend);
  const TrendIcon = pressureTrend.icon;
  const weatherOutlook = getWeatherOutlook(calculatedSeaLevel, trend);

  // Generate sparkline data if not provided
  const stationChartData = sparklineDataStation.length > 0 
    ? sparklineDataStation 
    : Array.from({ length: 24 }, (_, i) => stationPressure + Math.sin(i / 4) * 2 + (Math.random() - 0.5) * 1);

  const seaLevelChartData = sparklineDataSeaLevel.length > 0 
    ? sparklineDataSeaLevel 
    : Array.from({ length: 24 }, (_, i) => calculatedSeaLevel + Math.sin(i / 4) * 2 + (Math.random() - 0.5) * 1);

  const renderSparkline = (data: number[], color: string) => {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    return (
      <div className="h-12 flex items-end gap-0.5">
        {data.map((val, i) => {
          const height = ((val - min) / range) * 100;
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-all duration-300"
              style={{ height: `${Math.max(height, 5)}%`, backgroundColor: color }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-barometric-pressure">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Barometric Pressure
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Dual pressure display */}
          <div className="grid grid-cols-2 gap-4">
            {/* Station Pressure */}
            <div className="space-y-2 p-3 rounded-lg border border-gray-200 bg-gray-50">
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Mountain className="h-3 w-3" />
                Station Level {altitude > 0 && `(${altitude}m)`}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {stationPressure.toFixed(1)}
                </span>
                <span className="text-sm text-gray-500">mbar</span>
              </div>
              {renderSparkline(stationChartData, "#8b5cf6")}
            </div>

            {/* Sea Level Pressure */}
            <div className="space-y-2 p-3 rounded-lg border border-gray-200 bg-blue-50">
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Gauge className="h-3 w-3" />
                Sea Level (QNH)
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {calculatedSeaLevel.toFixed(1)}
                </span>
                <span className="text-sm text-gray-500">mbar</span>
              </div>
              {renderSparkline(seaLevelChartData, "#3b82f6")}
            </div>
          </div>

          {/* Trend indicator */}
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <TrendIcon className={`h-4 w-4 ${pressureTrend.color} ${trend !== 0 ? 'animate-pulse' : ''}`} 
                         style={{ transform: trend < 0 ? 'rotate(180deg)' : undefined }} />
              <span className={`text-sm font-medium ${pressureTrend.color}`}>
                {pressureTrend.label}
              </span>
              <span className="text-xs text-gray-400">
                ({trend >= 0 ? '+' : ''}{trend.toFixed(1)} hPa/3h)
              </span>
            </div>
          </div>

          {/* Weather outlook */}
          <div className="text-center py-2 px-3 rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-100">
            <p className="text-sm text-gray-700">{weatherOutlook}</p>
          </div>

          {/* Conversion info */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200 text-xs text-gray-400">
            <div className="text-center">
              <p>Station: {(stationPressure * 0.02953).toFixed(2)} inHg</p>
            </div>
            <div className="text-center">
              <p>Sea Level: {(calculatedSeaLevel * 0.02953).toFixed(2)} inHg</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
