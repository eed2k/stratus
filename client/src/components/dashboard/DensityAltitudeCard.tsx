// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateDensityAltitude, type DensityAltitudeResult } from "@shared/utils/calc";

interface DensityAltitudeCardProps {
  stationPressure: number;  // hPa
  temperature: number;      // °C
  dewPoint?: number;        // °C
  stationElevation?: number; // meters
}

export function DensityAltitudeCard({ stationPressure, temperature, dewPoint, stationElevation }: DensityAltitudeCardProps) {
  const result: DensityAltitudeResult = calculateDensityAltitude(
    stationPressure, temperature, dewPoint ?? 0, stationElevation ?? 0
  );

  // Altimeter in inHg (A2992 format) - 1 hPa = 0.02953 inHg
  const altimeterInHg = stationPressure * 0.02953;
  const altimeterFmt = `A${Math.round(altimeterInHg * 100)}`;

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-density-altitude">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Density Altitude
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Main density altitude */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.densityAltitude.toLocaleString()}
              </span>
              <span className="text-sm font-normal text-black">ft</span>
            </div>
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: result.color + '20', color: result.color }}
            >
              {result.performanceImpact}
            </span>
          </div>

          {/* Altitude details */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">Pressure Altitude</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.pressureAltitude.toLocaleString()} ft
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">ISA Deviation</p>
              <p className={`text-sm font-normal ${result.isaDeviation > 0 ? 'text-red-500' : 'text-blue-500'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.isaDeviation > 0 ? '+' : ''}{safeFixed(result.isaDeviation, 1)} °C
              </p>
            </div>
          </div>

          {/* Altimeter settings */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">QNH</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {Math.round(stationPressure)} hPa
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Altimeter</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {altimeterFmt}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">inHg</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(altimeterInHg, 2)}
              </p>
            </div>
          </div>

          {/* Input conditions */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">OAT</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(temperature, 1)} °C
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Dew Point</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(dewPoint ?? 0, 1)} °C
              </p>
            </div>
            {stationElevation != null && (
              <div className="text-center">
                <p className="text-xs text-black">Elevation</p>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {Math.round(stationElevation)} m
                </p>
              </div>
            )}
          </div>

          <p className="text-xs text-black italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Density altitude affects aircraft performance: higher DA = reduced lift, longer take-off roll, reduced climb rate.
            Hot, humid, high-elevation conditions increase density altitude significantly.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
