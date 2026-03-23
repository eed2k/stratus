// Stratus Weather System
// Created by Lukas Esterhuizen

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
          Air Density (ρ, Rho)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {/* Main value */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {safeFixed(airDensity, 3)}
            </span>
            <span className="text-sm font-normal text-gray-500">kg/m³</span>
          </div>

          {/* Status indicator */}
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium ${densityStatus.color}`}>
              {densityStatus.status}
            </span>
            <span className={`text-xs ${deviationPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {deviationPercent >= 0 ? '+' : ''}{safeFixed(deviationPercent, 1)}% vs std ({standardDensity})
            </span>
          </div>

          {/* Contributing factors */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-100">
            {temperature !== undefined && (
              <div className="text-center">
                <p className="text-[10px] text-gray-400" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Temperature</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(temperature, 1)}°C</p>
              </div>
            )}
            {pressure !== undefined && (
              <div className="text-center">
                <p className="text-[10px] text-gray-400" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Pressure</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(pressure, 0)} hPa</p>
              </div>
            )}
            {humidity !== undefined && (
              <div className="text-center">
                <p className="text-[10px] text-gray-400" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Humidity</p>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(humidity, 0)}%</p>
              </div>
            )}
          </div>

          {/* Formula */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-[10px] text-gray-400 text-center" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              ρ = P / (R<sub>d</sub> · T) · (1 − 0.378 · e/P)
            </p>
            <p className="text-[9px] text-gray-300 text-center mt-0.5" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              R<sub>d</sub> = 287.05 J/(kg·K), e = vapour pressure
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
