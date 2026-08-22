// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { fitWeibull, calculateAEP, type WeibullResult, type AEPResult } from "@shared/utils/calc";
import { useState, useMemo } from "react";

interface WeibullCardProps {
  /** Array of historical wind speed readings in m/s */
  windSpeeds: number[];
}

const TURBINE_PRESETS = [
  { label: '2 kW Small', capacity: 2, cutIn: 3, cutOut: 25, rated: 12 },
  { label: '10 kW Farm', capacity: 10, cutIn: 3, cutOut: 25, rated: 11 },
  { label: '100 kW Community', capacity: 100, cutIn: 3.5, cutOut: 25, rated: 13 },
  { label: '2 MW Utility', capacity: 2000, cutIn: 3, cutOut: 25, rated: 12 },
];

export function WeibullCard({ windSpeeds }: WeibullCardProps) {
  const [turbineIdx, setTurbineIdx] = useState(0);
  const turbine = TURBINE_PRESETS[turbineIdx];

  const weibull: WeibullResult = useMemo(() => fitWeibull(windSpeeds), [windSpeeds]);
  const insufficientData = weibull.histogram.length === 0;
  const aep: AEPResult = useMemo(
    () => calculateAEP(weibull.k, weibull.c, turbine.capacity, turbine.cutIn, turbine.cutOut, turbine.rated),
    [weibull.k, weibull.c, turbine]
  );

  // Histogram bar chart max
  const maxCount = Math.max(...weibull.histogram.map(h => Math.max(h.count, h.weibullPdf)), 1);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-weibull">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Weibull Wind Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Key parameters */}
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>k (shape)</p>
              <p className="text-sm font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(weibull.k, 2)}
              </p>
            </div>
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>c (scale)</p>
              <p className="text-sm font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(weibull.c, 2)} m/s
              </p>
            </div>
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Mean</p>
              <p className="text-sm font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(weibull.meanSpeed, 1)} m/s
              </p>
            </div>
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Power Density</p>
              <p className="text-sm font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(weibull.meanPowerDensity, 0)} W/m²
              </p>
            </div>
          </div>

          {/* IEC class */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              IEC Wind Resource Class
            </span>
            <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-700">
              {weibull.windResourceClass}
            </span>
          </div>

          {/* Histogram */}
          {insufficientData ? (
          <div className="flex items-center justify-center h-20 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Insufficient data ({windSpeeds.length} readings). Minimum 10 required for Weibull fit.
          </div>
          ) : (
          <div className="space-y-1">
            <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Wind Speed Distribution ({windSpeeds.length} readings)
            </p>
            <div className="flex items-end gap-px h-20">
              {weibull.histogram.slice(0, 25).map((h, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full relative" title={`${h.bin} to ${h.bin + 1} m/s: ${h.count} readings`}>
                  {/* Actual bar */}
                  <div
                    className="w-full bg-emerald-500 rounded-t-sm absolute bottom-0"
                    style={{ height: `${(h.count / maxCount) * 100}%`, opacity: 0.6 }}
                  />
                  {/* Weibull overlay */}
                  <div
                    className="w-full bg-blue-500 rounded-t-sm absolute bottom-0"
                    style={{ height: `${(h.weibullPdf / maxCount) * 100}%`, opacity: 0.4, maxWidth: '60%', left: '20%' }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <span>0</span>
              <span>{Math.min(25, weibull.histogram.length)} m/s</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-black">
              <span><span className="inline-block w-2 h-2 bg-emerald-500 rounded-sm mr-1" style={{ opacity: 0.6 }}></span>Measured</span>
              <span><span className="inline-block w-2 h-2 bg-blue-500 rounded-sm mr-1" style={{ opacity: 0.4 }}></span>Weibull fit</span>
            </div>
          </div>
          )}

          {/* AEP Estimate */}
          {!insufficientData && (
          <div className="pt-2 border-t border-gray-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                Energy Estimate
              </span>
              <div className="flex gap-1">
                {TURBINE_PRESETS.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setTurbineIdx(i)}
                    className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                      turbineIdx === i
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-black border-gray-300 hover:border-blue-400'
                    }`}
                    style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-1.5 bg-gray-50 rounded">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>AEP</p>
                <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {aep.aep >= 1000000 ? `${safeFixed(aep.aep / 1000000, 1)} GWh` : aep.aep >= 1000 ? `${safeFixed(aep.aep / 1000, 1)} MWh` : `${aep.aep} kWh`}
                </p>
              </div>
              <div className="text-center p-1.5 bg-gray-50 rounded">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Capacity Factor</p>
                <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(aep.capacityFactor * 100, 1)}%
                </p>
              </div>
              <div className="text-center p-1.5 bg-gray-50 rounded">
                <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Equiv. Hours</p>
                <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {aep.equivalentHours} h/yr
                </p>
              </div>
            </div>
          </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
