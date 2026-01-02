import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wind } from "lucide-react";

interface AirDensityCardProps {
  airDensity: number;           // kg/m³
  temperature?: number;         // °C
  pressure?: number;            // hPa
  humidity?: number;            // %
  standardDensity?: number;     // Reference at sea level (default 1.225)
  sparklineData?: number[];
}

function getDensityStatus(density: number): { status: string; color: string } {
  if (density < 1.1) return { status: "Very Low", color: "text-blue-500" };
  if (density < 1.2) return { status: "Low", color: "text-cyan-500" };
  if (density < 1.25) return { status: "Normal", color: "text-green-500" };
  if (density < 1.3) return { status: "High", color: "text-orange-500" };
  return { status: "Very High", color: "text-red-500" };
}

export function AirDensityCard({
  airDensity,
  temperature,
  pressure,
  humidity,
  standardDensity = 1.225,
  sparklineData = [],
}: AirDensityCardProps) {
  const densityStatus = getDensityStatus(airDensity);
  const deviationPercent = ((airDensity - standardDensity) / standardDensity) * 100;
  
  // Generate sparkline if not provided
  const chartData = sparklineData.length > 0 
    ? sparklineData 
    : Array.from({ length: 12 }, () => airDensity + (Math.random() - 0.5) * 0.02);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-air-density">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black flex items-center gap-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          <Wind className="h-4 w-4 text-blue-500" />
          Air Density
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Main value */}
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {airDensity.toFixed(3)}
            </span>
            <span className="text-sm font-normal text-gray-500">kg/m³</span>
          </div>

          {/* Status indicator */}
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium ${densityStatus.color}`}>
              {densityStatus.status}
            </span>
            <span className={`text-sm ${deviationPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {deviationPercent >= 0 ? '+' : ''}{deviationPercent.toFixed(1)}% vs std
            </span>
          </div>

          {/* Mini sparkline chart */}
          <div className="h-12 flex items-end gap-0.5">
            {chartData.map((val, i) => {
              const max = Math.max(...chartData);
              const min = Math.min(...chartData);
              const range = max - min || 0.01;
              const height = ((val - min) / range) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm bg-blue-500 transition-all duration-300"
                  style={{ height: `${Math.max(height, 5)}%` }}
                />
              );
            })}
          </div>

          {/* Contributing factors */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            {temperature !== undefined && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Temperature</p>
                <p className="text-sm font-normal text-black">{temperature.toFixed(1)}°C</p>
              </div>
            )}
            {pressure !== undefined && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Pressure</p>
                <p className="text-sm font-normal text-black">{pressure.toFixed(0)} hPa</p>
              </div>
            )}
            {humidity !== undefined && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Humidity</p>
                <p className="text-sm font-normal text-black">{humidity.toFixed(0)}%</p>
              </div>
            )}
          </div>

          {/* Standard reference */}
          <div className="text-center pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-400">
              Standard sea level: {standardDensity} kg/m³ (15°C, 1013.25 hPa)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
