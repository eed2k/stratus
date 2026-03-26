// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

interface EToCardProps {
  dailyETo: number;
  weeklyETo: number;
  monthlyETo: number;
}

export function EToCard({ dailyETo, weeklyETo, monthlyETo }: EToCardProps) {
  // Don't render if there's no data at all
  if (dailyETo === 0 && weeklyETo === 0 && monthlyETo === 0) return null;

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-eto">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Reference ET₀ (Calculated)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyETo, 2)}</span>
            <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>mm/day</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-center">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>24h ETo</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyETo, 2)} mm</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-center">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>7d ETo</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(weeklyETo, 1)} mm</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-center">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>30d ETo</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(monthlyETo, 1)} mm</p>
            </div>
          </div>

          {/* FAO Penman-Monteith Formula */}
          <div className="pt-3 border-t border-gray-200">
            <p className="text-[10px] text-black text-center mb-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              FAO-56 Penman-Monteith Reference Evapotranspiration
            </p>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-center text-black" style={{ fontFamily: 'Times New Roman, serif' }}>
                <div className="text-center text-sm leading-relaxed">
                  <span className="italic">ET</span><sub>0</sub>
                  <span className="mx-1.5">=</span>
                  <span className="inline-flex flex-col items-center align-middle mx-1">
                    <span className="text-xs border-b border-black px-2 pb-0.5">
                      0.408 Δ(<span className="italic">R<sub>n</sub></span> − <span className="italic">G</span>) + γ
                      <span className="inline-flex flex-col items-center align-middle mx-0.5">
                        <span className="text-[10px] border-b border-black px-1">900</span>
                        <span className="text-[10px] px-1"><span className="italic">T</span> + 273</span>
                      </span>
                      <span className="italic">u</span><sub>2</sub>(<span className="italic">e<sub>s</sub></span> − <span className="italic">e<sub>a</sub></span>)
                    </span>
                    <span className="text-xs px-2 pt-0.5">
                      Δ + γ(1 + 0.34 <span className="italic">u</span><sub>2</sub>)
                    </span>
                  </span>
                </div>
              </div>
              <div className="flex justify-center gap-4 mt-2 text-[9px] text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                <span>Δ = slope vapour pressure curve</span>
                <span>γ = psychrometric constant</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
