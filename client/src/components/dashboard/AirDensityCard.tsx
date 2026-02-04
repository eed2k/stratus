import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

interface AirDensityCardProps {
  airDensity: number;           // kg/m³
  temperature?: number;         // °C
  pressure?: number;            // hPa
  humidity?: number;            // %
  standardDensity?: number;     // Reference at sea level (default 1.225)
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
}: AirDensityCardProps) {
  const densityStatus = getDensityStatus(airDensity);
  const deviationPercent = ((airDensity - standardDensity) / standardDensity) * 100;

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-air-density">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Air Density
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Main value */}
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {safeFixed(airDensity, 3)}
            </span>
            <span className="text-sm font-normal text-gray-500">kg/m³</span>
          </div>

          {/* Status indicator */}
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium ${densityStatus.color}`}>
              {densityStatus.status}
            </span>
            <span className={`text-sm ${deviationPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {deviationPercent >= 0 ? '+' : ''}{safeFixed(deviationPercent, 1)}% vs std
            </span>
          </div>

          {/* Contributing factors */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            {temperature !== undefined && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Temperature</p>
                <p className="text-sm font-normal text-black">{safeFixed(temperature, 1)}°C</p>
              </div>
            )}
            {pressure !== undefined && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Pressure</p>
                <p className="text-sm font-normal text-black">{safeFixed(pressure, 0)} hPa</p>
              </div>
            )}
            {humidity !== undefined && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Humidity</p>
                <p className="text-sm font-normal text-black">{safeFixed(humidity, 0)}%</p>
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
