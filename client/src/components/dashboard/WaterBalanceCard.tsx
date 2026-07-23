// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateRainfallIntensity, calculateWaterBalance, type RainfallIntensityResult, type WaterBalanceResult } from "@shared/utils/calc";

interface WaterBalanceCardProps {
  /** Current interval rainfall mm */
  currentRainfall?: number | null;
  /** Interval duration in minutes (for intensity calc) */
  intervalMinutes?: number;
  /** Cumulative rainfall for the period (mm) */
  totalRainfall: number;
  /** Cumulative reference ET₀ for the period (mm) */
  totalETo: number;
  /** Period label */
  periodLabel?: string;
  /** Monthly data for bar chart */
  monthlyData?: { month: string; rainfall: number; eto: number }[];
}

export function WaterBalanceCard({
  currentRainfall,
  intervalMinutes = 60,
  totalRainfall,
  totalETo,
  periodLabel = '30 days',
  monthlyData,
}: WaterBalanceCardProps) {
  const intensity: RainfallIntensityResult = calculateRainfallIntensity(currentRainfall ?? 0, intervalMinutes);
  const balance: WaterBalanceResult = calculateWaterBalance(totalRainfall, totalETo);

  // Bar chart scaling
  const maxVal = monthlyData ? Math.max(...monthlyData.map(d => Math.max(d.rainfall, d.eto)), 1) : 1;

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-water-balance">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Water Balance &amp; Rainfall Intensity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Balance headline */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {balance.balance > 0 ? '+' : ''}{safeFixed(balance.balance, 1)}
              </span>
              <span className="text-sm font-normal text-black">mm</span>
            </div>
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: balance.color + '20', color: balance.color }}
            >
              {balance.status}
            </span>
          </div>

          {/* Rainfall vs ET₀ */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-blue-50 rounded">
              <p className="text-xs text-black mb-0.5" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Total Rainfall</p>
              <p className="text-sm font-medium text-blue-700" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(totalRainfall, 1)} mm
              </p>
            </div>
            <div className="p-2 bg-orange-50 rounded">
              <p className="text-xs text-black mb-0.5" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Total ET₀</p>
              <p className="text-sm font-medium text-orange-700" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(totalETo, 1)} mm
              </p>
            </div>
          </div>

          {/* Current intensity */}
          {currentRainfall != null && currentRainfall > 0 && (
          <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <div>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Current Intensity</p>
              <p className="text-sm font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(intensity.ratePerHour, 1)} mm/hr
              </p>
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: intensity.color + '20', color: intensity.color }}
            >
              {intensity.classification}
            </span>
          </div>
          )}

          {/* Monthly bar chart */}
          {monthlyData && monthlyData.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-gray-200">
            <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Rainfall vs ET₀ ({periodLabel})
            </p>
            <div className="flex items-end gap-1 h-16">
              {monthlyData.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-px">
                  <div className="w-full flex gap-px justify-center">
                    <div
                      className="w-1/2 bg-blue-400 rounded-t-sm"
                      style={{ height: `${(d.rainfall / maxVal) * 64}px` }}
                      title={`Rain: ${safeFixed(d.rainfall, 1)} mm`}
                    />
                    <div
                      className="w-1/2 bg-orange-400 rounded-t-sm"
                      style={{ height: `${(d.eto / maxVal) * 64}px` }}
                      title={`ET₀: ${safeFixed(d.eto, 1)} mm`}
                    />
                  </div>
                  <span className="text-xs text-black">{d.month}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-black">
              <span><span className="inline-block w-2 h-2 bg-blue-400 rounded-sm mr-1"></span>Rainfall</span>
              <span><span className="inline-block w-2 h-2 bg-orange-400 rounded-sm mr-1"></span>ET₀</span>
            </div>
          </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
