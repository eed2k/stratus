// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";

// Helper to safely convert to number and format
const safeFixed = (value: number | string | null | undefined, decimals: number = 1): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return (num != null && !isNaN(num)) ? num.toFixed(decimals) : '--';
};

/**
 * Calculate harvestable solar energy from radiation data
 * Formula: Energy (kWh) = Radiation (W/m²) × Time (hours) × Panel Efficiency × (1 - System Losses) / 1000
 */
export const calculateSolarEnergy = (
  radiationWm2: number,
  hours: number,
  efficiency: number,
  losses: number,
  area: number = 1
): number => {
  return (radiationWm2 * hours * efficiency * (1 - losses) * area) / 1000;
};

/**
 * Calculate solar harvesting estimates from radiation
 */
export function calculateSolarEstimates(
  estimateRadiation: number,
  panelEfficiency: number = 0.20,
  systemLosses: number = 0.15,
  panelArea: number = 1,
) {
  if (estimateRadiation === 0) {
    return { dailyEnergy: 0, weeklyEnergy: 0, monthlyEnergy: 0, yearlyEnergy: 0, peakSunHours: 0 };
  }
  const avgDaylightHours = 10;
  const avgRadiation = estimateRadiation * 0.5;
  const dailyEnergy = calculateSolarEnergy(avgRadiation, avgDaylightHours, panelEfficiency, systemLosses, panelArea);
  const weeklyEnergy = dailyEnergy * 7;
  const monthlyEnergy = dailyEnergy * 30;
  const yearlyEnergy = dailyEnergy * 365 * 0.85;
  const peakSunHours = (avgRadiation * avgDaylightHours) / 1000;
  return { dailyEnergy, weeklyEnergy, monthlyEnergy, yearlyEnergy, peakSunHours };
}

interface SolarPowerHarvestCardProps {
  currentRadiation: number | null | undefined;
  dailyAverageRadiation?: number | null;
  panelEfficiency?: number;
  systemLosses?: number;
  panelArea?: number;
  sparklineData?: number[];
}

/**
 * Solar Power Harvesting card — matches WindPowerCard layout.
 * Shows current output + 2x2 grid of key metrics.
 */
export function SolarPowerHarvestCard({
  currentRadiation,
  dailyAverageRadiation,
  panelEfficiency = 0.20,
  systemLosses = 0.15,
  panelArea = 1,
  sparklineData: _sparklineData,
}: SolarPowerHarvestCardProps) {
  const hasData = currentRadiation !== null && currentRadiation !== undefined;
  const hasAverage = dailyAverageRadiation != null && dailyAverageRadiation > 0;
  const estimateRadiation = hasAverage ? dailyAverageRadiation : (currentRadiation ?? 0);

  const currentOutput = useMemo(() => {
    const rad = currentRadiation ?? 0;
    return rad * panelEfficiency * (1 - systemLosses) * panelArea;
  }, [currentRadiation, panelEfficiency, systemLosses, panelArea]);

  const estimates = useMemo(
    () => calculateSolarEstimates(estimateRadiation, panelEfficiency, systemLosses, panelArea),
    [estimateRadiation, panelEfficiency, systemLosses, panelArea],
  );

  if (!hasData && !hasAverage) {
    return (
      <Card className="border border-gray-300 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Solar Power
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm font-normal text-black">No Data</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-solar-power">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar Power</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(currentOutput, 1)}</span>
            <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>W/m²</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Current Radiation</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(currentRadiation ?? 0, 0)} W/m²</p>
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Panel Efficiency</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(panelEfficiency * 100, 0)}%</p>
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Peak Sun Hours</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(estimates.peakSunHours, 1)} hrs</p>
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Radiation</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(estimateRadiation, 0)} W/m²</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
