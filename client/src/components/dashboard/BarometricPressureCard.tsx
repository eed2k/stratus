// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

interface BarometricPressureCardProps {
  stationPressure: number;      // hPa/mbar at station altitude
  seaLevelPressure?: number;    // hPa/mbar calibrated to sea level
  altitude?: number;            // metres
  temperature?: number;         // °C (for calculation if needed)
  trend?: number;               // Change in last 3 hours (hPa)

}

function getPressureTrend(trend: number): { label: string; symbol: string; color: string } {
  if (trend > 2) return { label: "Rising Rapidly", symbol: "↑↑", color: "text-blue-500" };
  if (trend > 0.5) return { label: "Rising", symbol: "↑", color: "text-cyan-500" };
  if (trend < -2) return { label: "Falling Rapidly", symbol: "↓↓", color: "text-red-500" };
  if (trend < -0.5) return { label: "Falling", symbol: "↓", color: "text-orange-500" };
  return { label: "Steady", symbol: "→", color: "text-green-500" };
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

}: BarometricPressureCardProps) {
  // Calculate sea level pressure if not provided
  const calculatedSeaLevel = seaLevelPressure ?? 
    stationPressure * Math.pow(1 - (0.0065 * altitude) / (temperature + 273.15 + 0.0065 * altitude), -5.257);
  
  const pressureTrend = getPressureTrend(trend);
  const weatherOutlook = getWeatherOutlook(calculatedSeaLevel, trend);





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
              <div className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                Station Level {altitude > 0 && `(${altitude}m)`}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(stationPressure, 1)}
                </span>
                <span className="text-sm text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>hPa</span>
              </div>

            </div>

            {/* Sea Level Pressure */}
            <div className="space-y-2 p-3 rounded-lg border border-gray-200 bg-blue-50">
              <div className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                Sea Level (QNH)
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(calculatedSeaLevel, 1)}
                </span>
                <span className="text-sm text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>hPa</span>
              </div>

            </div>
          </div>

          {/* Trend indicator */}
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <span className={`text-lg font-normal ${pressureTrend.color}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {pressureTrend.symbol}
              </span>
              <span className={`text-sm font-normal ${pressureTrend.color}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {pressureTrend.label}
              </span>
              <span className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                ({trend >= 0 ? '+' : ''}{safeFixed(trend, 1)} hPa/3h)
              </span>
            </div>
          </div>

          {/* Weather outlook */}
          <div className="text-center py-2 px-3 rounded-lg bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-100">
            <p className="text-sm text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{weatherOutlook}</p>
          </div>

          {/* Conversion info */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200 text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            <div className="text-center">
              <p>Station: {safeFixed(stationPressure * 0.02953, 2)} inHg</p>
            </div>
            <div className="text-center">
              <p>Sea Level: {safeFixed(calculatedSeaLevel * 0.02953, 2)} inHg</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
