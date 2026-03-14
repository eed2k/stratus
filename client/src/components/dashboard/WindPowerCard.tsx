// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Helper to safely convert to number and format
const safeFixed = (value: number | string | null | undefined, decimals: number = 1): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return (num != null && !isNaN(num)) ? num.toFixed(decimals) : '--';
};

interface WindPowerCardProps {
  currentPower: number;
  gustPower: number;
  airDensity: number;
  avgSpeed: number;
  avgPower: number;
  sparklineData?: number[];
}

export function WindPowerCard({
  currentPower,
  gustPower,
  airDensity,
  avgSpeed,
  avgPower,
  sparklineData: _sparklineData,
}: WindPowerCardProps) {
  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-wind-power">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Wind Power</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(currentPower, 1)}</span>
            <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>W/m²</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Gust Power</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(gustPower, 1)} W/m²</p>
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Air Density</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(airDensity, 3)} kg/m³</p>
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Speed (Recent)</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(avgSpeed, 1)} m/s</p>
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Power (Recent)</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(avgPower, 1)} W/m²</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
