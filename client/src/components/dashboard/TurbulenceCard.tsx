// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateTurbulenceIntensity, type TurbulenceResult } from "@shared/utils/calc";

interface TurbulenceCardProps {
  /** Standard deviation of wind speed over averaging period (m/s) */
  windStdDev: number;
  /** Mean wind speed over same period (m/s) */
  meanWindSpeed: number;
  /** Optional: representative TI at 15 m/s for site classification */
  representativeTI15?: number;
}

export function TurbulenceCard({ windStdDev, meanWindSpeed, representativeTI15 }: TurbulenceCardProps) {
  const result: TurbulenceResult = calculateTurbulenceIntensity(windStdDev, meanWindSpeed);

  // Gauge bar: TI 0 to 0.30 mapped to 0-100%
  const gaugePercent = Math.min(100, Math.max(0, (result.ti / 0.30) * 100));

  // IEC reference lines (TI at 15 m/s thresholds)
  const iecLines = [
    { label: 'A', ti: 0.16, color: '#dc2626' },
    { label: 'B', ti: 0.14, color: '#f59e0b' },
    { label: 'C', ti: 0.12, color: '#22c55e' },
  ];

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-turbulence">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Turbulence Intensity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Main TI value */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.tiPercent, 1)}
              </span>
              <span className="text-sm font-normal text-black">% TI</span>
            </div>
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: result.iecColor + '20', color: result.iecColor }}
            >
              IEC {result.iecCategory}
            </span>
          </div>

          {/* TI gauge bar with IEC reference markers */}
          <div className="space-y-1">
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${gaugePercent}%`, backgroundColor: result.iecColor }}
              />
              {/* IEC threshold markers */}
              {iecLines.map(line => (
                <div
                  key={line.label}
                  className="absolute top-0 h-full w-0.5"
                  style={{ left: `${(line.ti / 0.30) * 100}%`, backgroundColor: line.color }}
                  title={`IEC ${line.label}: ${(line.ti * 100).toFixed(0)}%`}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <span>0%</span>
              <span>C (12%)</span>
              <span>B (14%)</span>
              <span>A (16%)</span>
              <span>30%</span>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Mean Wind</p>
              <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(meanWindSpeed, 1)} m/s
              </p>
            </div>
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Std Dev (σ)</p>
              <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(windStdDev, 2)} m/s
              </p>
            </div>
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>TI (σ/Ū)</p>
              <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.ti, 3)}
              </p>
            </div>
          </div>

          {/* Classification */}
          <div className="pt-2 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <span className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.classification}
              </span>
              {representativeTI15 != null && (
                <span className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  Rep. TI@15 m/s: {safeFixed(representativeTI15 * 100, 1)}%
                </span>
              )}
            </div>
            <p className="text-xs text-black mt-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Per IEC 61400-1 Ed.3 - TI = σᵤ / Ū
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
