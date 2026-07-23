// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateWBGT, type WBGTResult } from "@shared/utils/calc";

interface HeatStressCardProps {
  temperature: number;
  humidity: number;
  solarRadiation?: number;
  windSpeed?: number;
}

export function HeatStressCard({ temperature, humidity, solarRadiation, windSpeed }: HeatStressCardProps) {
  const result: WBGTResult = calculateWBGT(temperature, humidity, solarRadiation ?? 0, windSpeed ?? 0);

  // Visual gauge percentage (WBGT range roughly 10-40°C mapped to 0-100%)
  const gaugePercent = Math.min(100, Math.max(0, ((result.wbgt - 10) / 30) * 100));

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-heat-stress">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Heat Stress (WBGT)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Main WBGT value */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.wbgt, 1)}
              </span>
              <span className="text-sm font-normal text-black">°C WBGT</span>
            </div>
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: result.color + '20', color: result.color }}
            >
              {result.category}
            </span>
          </div>

          {/* WBGT gauge bar */}
          <div className="space-y-1">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${gaugePercent}%`, backgroundColor: result.color }}
              />
            </div>
            {/* Scale labels */}
            <div className="flex justify-between text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <span>Safe</span>
              <span>Caution</span>
              <span>Warning</span>
              <span>Danger</span>
              <span>Extreme</span>
            </div>
          </div>

          {/* Work-rest recommendation */}
          <div className="pt-2 border-t border-gray-200">
            <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {result.recommendation}
            </p>
          </div>

          {/* Work-rest details */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">Rest Required</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.restPercentage}% / hr
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Max Exposure</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.maxExposureMinutes === null ? 'Unlimited' : result.maxExposureMinutes === 0 ? 'None' : `${result.maxExposureMinutes} min`}
              </p>
            </div>
          </div>

          {/* Input values */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">Air Temp</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(temperature, 1)} °C
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Humidity</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(humidity, 0)}%
              </p>
            </div>
          </div>

          <p className="text-xs text-black italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            WBGT (Wet Bulb Globe Temperature) is used for occupational heat stress screening per the OHS Act. 
            Work-rest ratios are for heavy physical work. Light work allows higher thresholds.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
