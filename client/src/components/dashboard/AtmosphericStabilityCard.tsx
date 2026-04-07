// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculatePasquillGifford, type StabilityResult } from "@shared/utils/calc";

interface AtmosphericStabilityCardProps {
  windSpeed: number;
  solarRadiation: number;
  cloudCover?: number | null;
  deltaTemperature?: number | null;
}

export function AtmosphericStabilityCard({ windSpeed, solarRadiation, cloudCover, deltaTemperature }: AtmosphericStabilityCardProps) {
  const result: StabilityResult = calculatePasquillGifford(
    windSpeed, solarRadiation, undefined, cloudCover, deltaTemperature
  );

  return (
    <Card className="border border-blue-200 bg-blue-50" data-testid="card-atmospheric-stability">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Atmospheric Stability
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Stability class badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className="text-3xl font-bold w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: result.color + '20', color: result.color, fontFamily: 'Arial, Helvetica, sans-serif' }}
              >
                {result.stabilityClass}
              </span>
              <div>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {result.description}
                </p>
                <p className="text-xs text-gray-500">Pasquill-Gifford Class</p>
              </div>
            </div>
          </div>

          {/* Stability class scale A-F */}
          <div className="flex gap-1 pt-2">
            {(['A', 'B', 'C', 'D', 'E', 'F'] as const).map(cls => {
              const colors: Record<string, string> = {
                A: '#ef4444', B: '#f97316', C: '#eab308', D: '#6b7280', E: '#3b82f6', F: '#7c3aed',
              };
              const isActive = cls === result.stabilityClass;
              return (
                <div
                  key={cls}
                  className="flex-1 text-center py-1 rounded text-xs font-medium"
                  style={{
                    backgroundColor: isActive ? colors[cls] : '#f3f4f6',
                    color: isActive ? 'white' : '#9ca3af',
                    fontFamily: 'Arial, Helvetica, sans-serif',
                  }}
                >
                  {cls}
                </div>
              );
            })}
          </div>

          {/* Dispersion conditions */}
          <div className="pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-700" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {result.dispersionCondition}
            </p>
          </div>

          {/* Mixing height & inversion */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Mixing Height</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                ~{result.mixingHeight} m
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Inversion</p>
              <p className={`text-sm font-normal ${result.inversionDetected ? 'text-red-500' : 'text-green-600'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.inversionDetected ? 'Detected' : 'None'}
              </p>
            </div>
          </div>

          {/* Inversion detail if deltaTemperature provided */}
          {deltaTemperature != null && (
            <div className="pt-2 border-t border-gray-200">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">ΔT (8m − 2m)</span>
                <span className={`font-normal ${deltaTemperature > 0 ? 'text-red-500' : 'text-green-600'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {deltaTemperature > 0 ? '+' : ''}{safeFixed(deltaTemperature, 2)} °C
                </span>
              </div>
            </div>
          )}

          {/* Input values */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Wind Speed</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(windSpeed, 1)} m/s
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Solar Radiation</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(solarRadiation, 0)} W/m²
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-400 italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Pasquill-Gifford stability classification for atmospheric dispersion. Class A (extremely unstable) favours 
            rapid pollutant dispersion, Class F (stable) indicates pollutant trapping. Used for mining blast planning, 
            industrial emissions monitoring, and air quality management.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
