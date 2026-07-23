// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateCrosswind, type CrosswindResult } from "@shared/utils/calc";
import { useState } from "react";

interface CrosswindCardProps {
  windSpeed: number;       // m/s
  windDirection: number;   // degrees
  defaultRunwayHeading?: number;
}

export function CrosswindCard({ windSpeed, windDirection, defaultRunwayHeading = 0 }: CrosswindCardProps) {
  const [runwayHeading, setRunwayHeading] = useState(defaultRunwayHeading);

  const result: CrosswindResult = calculateCrosswind(windSpeed, windDirection, runwayHeading);
  const windKt = windSpeed * 1.94384;

  // Crosswind limits (FAA typical)
  const lightLimit = 15; // kt
  const mediumLimit = 20;
  const heavyLimit = 33;

  let limitWarning = '';
  let limitColor = '#22c55e';
  if (result.crosswind > heavyLimit) {
    limitWarning = 'Exceeds limits for all aircraft';
    limitColor = '#991b1b';
  } else if (result.crosswind > mediumLimit) {
    limitWarning = 'Exceeds light/medium aircraft limits';
    limitColor = '#ef4444';
  } else if (result.crosswind > lightLimit) {
    limitWarning = 'Exceeds light aircraft limits';
    limitColor = '#f97316';
  }

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-crosswind">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Crosswind Calculator
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Runway heading input */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-black whitespace-nowrap" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Runway Heading:
            </label>
            <input
              type="number"
              min="0"
              max="360"
              value={runwayHeading}
              onChange={e => setRunwayHeading(Math.max(0, Math.min(360, Number(e.target.value) || 0)))}
              className="w-20 text-sm border border-gray-300 rounded px-2 py-1 text-black"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
            />
            <span className="text-sm font-medium text-black">(°)</span>
          </div>

          {/* Wind components */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200">
            <div className="text-center rounded-lg border p-3" style={{ borderColor: result.tailwind ? '#ef4444' : '#22c55e' }}>
              <p className="text-xs text-black">
                {result.tailwind ? 'Tailwind' : 'Headwind'}
              </p>
              <p className={`text-2xl font-normal ${result.tailwind ? 'text-red-500' : 'text-green-600'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(Math.abs(result.headwind), 1)}
              </p>
              <p className="text-xs text-black">kt</p>
            </div>
            <div className="text-center rounded-lg border p-3" style={{ borderColor: limitColor }}>
              <p className="text-xs text-black">
                Crosswind ({result.crosswindSide})
              </p>
              <p className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: result.crosswind > lightLimit ? limitColor : undefined }}>
                {safeFixed(result.crosswind, 1)}
              </p>
              <p className="text-xs text-black">kt</p>
            </div>
          </div>

          {/* Wind info */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">Wind</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {Math.round(windDirection)}° / {safeFixed(windKt, 0)} kt
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Angle Off</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(Math.abs(((windDirection - runwayHeading + 540) % 360) - 180), 0)}°
              </p>
            </div>
          </div>

          {/* Limit warning */}
          {limitWarning && (
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs font-medium" style={{ color: limitColor, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {limitWarning}
              </p>
            </div>
          )}

          {/* Crosswind limits reference */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-black">Light</p>
              <p className="text-xs text-black">{lightLimit} kt</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Medium</p>
              <p className="text-xs text-black">{mediumLimit} kt</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-black">Heavy</p>
              <p className="text-xs text-black">{heavyLimit} kt</p>
            </div>
          </div>

          <p className="text-xs text-black italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Crosswind limits are advisory. Actual limits vary by aircraft type, pilot experience, and runway conditions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
