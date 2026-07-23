// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { getBeaufortScale, type BeaufortResult } from "@shared/utils/calc";

interface BeaufortCardProps {
  windSpeed: number;  // m/s
}

export function BeaufortCard({ windSpeed }: BeaufortCardProps) {
  const result: BeaufortResult = getBeaufortScale(windSpeed);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-beaufort">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Beaufort Scale & Sea State
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Beaufort force + description */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className="text-3xl font-bold w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: result.color + '30', color: result.force >= 8 ? 'white' : '#111', fontFamily: 'Arial, Helvetica, sans-serif', ...(result.force >= 8 ? { backgroundColor: result.color } : {}) }}
              >
                {result.force}
              </span>
              <div>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {result.description}
                </p>
                <p className="text-xs text-black">{safeFixed(windSpeed, 1)} m/s ({safeFixed(windSpeed * 1.94384, 0)} kt)</p>
              </div>
            </div>
            {result.smallCraftAdvisory && (
              <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                Small Craft Advisory
              </span>
            )}
          </div>

          {/* Beaufort scale bar */}
          <div className="flex gap-0.5 pt-2">
            {Array.from({ length: 13 }, (_, i) => {
              const isActive = i === result.force;
              const forceColors = ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#dc2626', '#b91c1c', '#7f1d1d'];
              return (
                <div
                  key={i}
                  className="flex-1 text-center rounded"
                  style={{
                    height: isActive ? '20px' : '12px',
                    backgroundColor: isActive ? forceColors[i] : '#f3f4f6',
                    transition: 'all 0.3s',
                    marginTop: isActive ? '0' : '4px',
                  }}
                  title={`Force ${i}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-black px-0.5">
            <span>0</span>
            <span>3</span>
            <span>6</span>
            <span>9</span>
            <span>12</span>
          </div>

          {/* Sea state */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">Sea State</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.seaState}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Wave Height</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.probableWaveHeight, 1)} m
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Max Wave</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.maxWaveHeight, 1)} m
              </p>
            </div>
          </div>

          {/* Land effect */}
          <div className="pt-2 border-t border-gray-200">
            <p className="text-xs text-black mb-1">Effect on Land</p>
            <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {result.landEffect}
            </p>
          </div>

          <p className="text-xs text-black italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Beaufort Scale (WMO) classifies wind conditions from Force 0 (calm) to Force 12 (hurricane).
            Wave heights are for open ocean; coastal and sheltered waters will differ.
            Small craft advisory issued at Force 6+ (Strong Breeze, &gt;10.8 m/s).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
