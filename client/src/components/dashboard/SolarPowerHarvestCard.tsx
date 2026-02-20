import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sun } from "lucide-react";
import { useMemo, useEffect } from "react";
import { safeFixed } from "@/lib/utils";

interface SolarPowerHarvestCardProps {
  /** Current solar radiation in W/m² */
  currentRadiation: number | null | undefined;
  /** Solar panel efficiency (default 18%) */
  panelEfficiency?: number;
  /** System losses (inverter, wiring, etc. - default 15%) */
  systemLosses?: number;
  /** Panel area in m² (default 1 for per-m² calculations) */
  panelArea?: number;
}

/**
 * Calculate harvestable solar energy from radiation data
 * Formula: Energy (kWh) = Radiation (W/m²) × Time (hours) × Panel Efficiency × (1 - System Losses) / 1000
 */
const calculateSolarEnergy = (
  radiationWm2: number,
  hours: number,
  efficiency: number,
  losses: number,
  area: number
): number => {
  return (radiationWm2 * hours * efficiency * (1 - losses) * area) / 1000;
};

/**
 * Convert W/m² to peak sun hours equivalent
 * 1 peak sun hour = 1000 W/m² for 1 hour
 */
const toPeakSunHours = (radiationWm2: number, hours: number): number => {
  return (radiationWm2 * hours) / 1000;
};

const STORAGE_KEY = "stratus_solar_last_estimates";

/** Load last non-zero estimates from localStorage */
function loadLastEstimates(): {
  dailyEnergy: number;
  weeklyEnergy: number;
  monthlyEnergy: number;
  yearlyEnergy: number;
  peakSunHours: number;
  currentPower: number;
  monthlyData: { month: string; energy: number; peakSunHours: number }[];
  savedAt: string;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Save non-zero estimates to localStorage */
function saveEstimates(data: {
  dailyEnergy: number;
  weeklyEnergy: number;
  monthlyEnergy: number;
  yearlyEnergy: number;
  peakSunHours: number;
  currentPower: number;
  monthlyData: { month: string; energy: number; peakSunHours: number }[];
}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
  } catch { /* ignore */ }
}

export function SolarPowerHarvestCard({
  currentRadiation,
  panelEfficiency = 0.18, // 18% typical for modern panels
  systemLosses = 0.15, // 15% typical system losses
  panelArea = 1, // Per m² by default
}: SolarPowerHarvestCardProps) {
  // Check if we have valid data
  const hasData = currentRadiation !== null && currentRadiation !== undefined;
  const isZero = !hasData || (currentRadiation ?? 0) === 0;

  // Calculate energy estimates based on current radiation
  const estimates = useMemo(() => {
    if (!hasData || (currentRadiation ?? 0) === 0) {
      return {
        dailyEnergy: 0,
        weeklyEnergy: 0,
        monthlyEnergy: 0,
        yearlyEnergy: 0,
        peakSunHours: 0,
        currentPower: 0,
      };
    }

    const radiation = currentRadiation || 0;

    // Estimate average daily radiation (assuming current is representative)
    const avgDaylightHours = 10;

    // Current instantaneous power output (kW)
    const currentPower = (radiation * panelEfficiency * (1 - systemLosses) * panelArea) / 1000;

    // Daily energy (kWh) - using average radiation over daylight hours
    const avgRadiation = radiation * 0.5;
    const dailyEnergy = calculateSolarEnergy(avgRadiation, avgDaylightHours, panelEfficiency, systemLosses, panelArea);

    // Weekly, monthly, yearly extrapolations
    const weeklyEnergy = dailyEnergy * 7;
    const monthlyEnergy = dailyEnergy * 30;
    const yearlyEnergy = dailyEnergy * 365 * 0.85; // 85% to account for weather variations

    // Peak sun hours (daily equivalent)
    const peakSunHours = toPeakSunHours(avgRadiation, avgDaylightHours);

    return {
      dailyEnergy,
      weeklyEnergy,
      monthlyEnergy,
      yearlyEnergy,
      peakSunHours,
      currentPower,
    };
  }, [currentRadiation, hasData, panelEfficiency, systemLosses, panelArea]);

  // Generate chart data for energy potential over months
  const monthlyChartData = useMemo(() => {
    const baseMonthlyEnergy = estimates.monthlyEnergy;
    const basePeakSunHours = estimates.peakSunHours;

    // Seasonal variation factors (Southern hemisphere - SA stations)
    const seasonalFactors = [
      { month: 'Jan', factor: 1.0 },
      { month: 'Feb', factor: 0.95 },
      { month: 'Mar', factor: 0.85 },
      { month: 'Apr', factor: 0.7 },
      { month: 'May', factor: 0.55 },
      { month: 'Jun', factor: 0.45 },
      { month: 'Jul', factor: 0.5 },
      { month: 'Aug', factor: 0.6 },
      { month: 'Sep', factor: 0.75 },
      { month: 'Oct', factor: 0.85 },
      { month: 'Nov', factor: 0.95 },
      { month: 'Dec', factor: 1.0 },
    ];

    return seasonalFactors.map(({ month, factor }) => ({
      month,
      energy: baseMonthlyEnergy * factor,
      peakSunHours: basePeakSunHours * factor * 30,
    }));
  }, [estimates.monthlyEnergy, estimates.peakSunHours]);

  // Determine display values: if current is zero, use last saved non-zero values
  const lastSaved = useMemo(() => loadLastEstimates(), []);
  const usingLastValues = isZero && lastSaved !== null;

  const displayEstimates = usingLastValues
    ? {
        dailyEnergy: lastSaved!.dailyEnergy,
        weeklyEnergy: lastSaved!.weeklyEnergy,
        monthlyEnergy: lastSaved!.monthlyEnergy,
        yearlyEnergy: lastSaved!.yearlyEnergy,
        peakSunHours: lastSaved!.peakSunHours,
        currentPower: lastSaved!.currentPower,
      }
    : estimates;

  const displayMonthly = usingLastValues && lastSaved!.monthlyData
    ? lastSaved!.monthlyData
    : monthlyChartData;

  const displayRadiation = usingLastValues
    ? 0
    : (currentRadiation ?? 0);

  // Save non-zero values for future fallback
  useEffect(() => {
    if (!isZero && estimates.dailyEnergy > 0) {
      saveEstimates({
        ...estimates,
        monthlyData: monthlyChartData,
      });
    }
  }, [isZero, estimates, monthlyChartData]);

  // No data at all and no saved values
  if (!hasData && !lastSaved) {
    return (
      <Card className="border border-black bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Solar Power Harvesting Potential
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm font-normal text-black">No Data</p>
            <p className="text-xs text-black mt-1">
              Solar radiation data is not available for this station
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-black bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Solar Power Harvesting Potential
          <Badge variant="outline" className="ml-auto text-xs border-black text-black">
            {safeFixed(panelEfficiency * 100, 0)}% efficiency
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Last values notice */}
          {usingLastValues && (
            <div className="rounded border border-black bg-white p-2">
              <p className="text-[10px] text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                Showing last calculated daily average values. Updates on next day cycle.
              </p>
            </div>
          )}

          {/* Current Power Output */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {safeFixed(displayEstimates.currentPower * 1000, 0)}
            </span>
            <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              W/m² (current output)
            </span>
          </div>

          {/* Energy Estimates Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-black bg-white p-3">
              <p className="text-xs font-normal text-black mb-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Daily</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(displayEstimates.dailyEnergy, 2)}
              </p>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>kWh/m²</p>
            </div>

            <div className="rounded-lg border border-black bg-white p-3">
              <p className="text-xs font-normal text-black mb-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Weekly</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(displayEstimates.weeklyEnergy, 1)}
              </p>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>kWh/m²</p>
            </div>

            <div className="rounded-lg border border-black bg-white p-3">
              <p className="text-xs font-normal text-black mb-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Monthly</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(displayEstimates.monthlyEnergy, 1)}
              </p>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>kWh/m²</p>
            </div>

            <div className="rounded-lg border border-black bg-white p-3">
              <p className="text-xs font-normal text-black mb-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Yearly</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(displayEstimates.yearlyEnergy, 0)}
              </p>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>kWh/m²</p>
            </div>
          </div>

          {/* Peak Sun Hours */}
          <div className="rounded-lg border border-black bg-white p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Peak Sun Hours (Daily Avg)</p>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(displayEstimates.peakSunHours, 1)} hours
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Current Radiation</p>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(displayRadiation, 0)} W/m²
                </p>
              </div>
            </div>
          </div>

          {/* Monthly Energy Potential - Data Cards */}
          <div className="space-y-2">
            <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Monthly Energy Potential (kWh/m²)</p>
            <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
              {displayMonthly.map(({ month, energy }) => (
                <div key={month} className="rounded border border-black bg-white p-2 text-center">
                  <p className="text-[10px] font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{month}</p>
                  <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                    {safeFixed(energy, 1)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Info Text */}
          <p className="text-[10px] text-black text-center" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Estimates based on {safeFixed(panelEfficiency * 100, 0)}% panel efficiency, {safeFixed(systemLosses * 100, 0)}% system losses.
            Actual output varies with weather, shading, and panel orientation.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
