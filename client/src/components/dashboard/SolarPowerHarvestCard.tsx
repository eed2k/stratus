import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sun, Zap, TrendingUp, Calendar } from "lucide-react";
import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

interface SolarPowerHarvestCardProps {
  /** Current solar radiation in W/m² */
  currentRadiation: number | null | undefined;
  /** Historical radiation data for calculations */
  historicalData?: Array<{
    timestamp: string;
    solarRadiation: number;
  }>;
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

export function SolarPowerHarvestCard({
  currentRadiation,
  panelEfficiency = 0.18, // 18% typical for modern panels
  systemLosses = 0.15, // 15% typical system losses
  panelArea = 1, // Per m² by default
}: SolarPowerHarvestCardProps) {
  // Check if we have valid data
  const hasData = currentRadiation !== null && currentRadiation !== undefined;
  
  // Calculate energy estimates based on current radiation
  const estimates = useMemo(() => {
    if (!hasData) {
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
    // Typical daylight hours: 8-12 hours depending on season
    const avgDaylightHours = 10;
    
    // Current instantaneous power output (kW)
    const currentPower = (radiation * panelEfficiency * (1 - systemLosses) * panelArea) / 1000;
    
    // Daily energy (kWh) - using average radiation over daylight hours
    // Assume current radiation is peak, average is about 50% of peak
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
    if (!hasData) return [];
    
    // Seasonal variation factors (Northern hemisphere, adjust for location)
    const seasonalFactors = [
      { month: 'Jan', factor: 0.5 },
      { month: 'Feb', factor: 0.6 },
      { month: 'Mar', factor: 0.75 },
      { month: 'Apr', factor: 0.85 },
      { month: 'May', factor: 0.95 },
      { month: 'Jun', factor: 1.0 },
      { month: 'Jul', factor: 1.0 },
      { month: 'Aug', factor: 0.95 },
      { month: 'Sep', factor: 0.85 },
      { month: 'Oct', factor: 0.7 },
      { month: 'Nov', factor: 0.55 },
      { month: 'Dec', factor: 0.45 },
    ];
    
    const baseMonthlyEnergy = estimates.monthlyEnergy;
    
    return seasonalFactors.map(({ month, factor }) => ({
      month,
      energy: baseMonthlyEnergy * factor,
      peakSunHours: estimates.peakSunHours * factor * 30,
    }));
  }, [hasData, estimates.monthlyEnergy, estimates.peakSunHours]);

  // Daily energy chart (hourly breakdown)
  const dailyChartData = useMemo(() => {
    if (!hasData) return [];
    
    const hours = [];
    for (let h = 5; h <= 20; h++) {
      // Simplified solar curve (bell curve peaking at noon)
      const hourFromNoon = Math.abs(h - 12);
      const factor = Math.max(0, Math.cos(hourFromNoon * Math.PI / 14));
      const radiation = (currentRadiation || 0) * factor;
      const power = (radiation * panelEfficiency * (1 - systemLosses) * panelArea) / 1000;
      
      hours.push({
        hour: `${h}:00`,
        radiation: Math.round(radiation),
        power: power,
      });
    }
    return hours;
  }, [currentRadiation, hasData, panelEfficiency, systemLosses, panelArea]);

  // No data state
  if (!hasData) {
    return (
      <Card className="border border-gray-300 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-black flex items-center gap-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            <Sun className="h-4 w-4 text-yellow-500" />
            Solar Power Harvesting Potential
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sun className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No Data</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Solar radiation data is not available for this station
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-gray-300 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black flex items-center gap-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          <Sun className="h-4 w-4 text-yellow-500" />
          Solar Power Harvesting Potential
          <Badge variant="outline" className="ml-auto text-xs">
            {(panelEfficiency * 100).toFixed(0)}% efficiency
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Current Power Output */}
          <div className="flex items-baseline gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {(estimates.currentPower * 1000).toFixed(0)}
            </span>
            <span className="text-sm font-normal text-muted-foreground" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              W/m² (current output)
            </span>
          </div>

          {/* Energy Estimates Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-yellow-50 to-orange-50 p-3">
              <div className="flex items-center gap-1 mb-1">
                <Calendar className="h-3 w-3 text-yellow-600" />
                <p className="text-xs font-medium text-yellow-700">Daily</p>
              </div>
              <p className="text-lg font-semibold text-yellow-900">
                {estimates.dailyEnergy.toFixed(2)}
              </p>
              <p className="text-xs text-yellow-600">kWh/m²</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-orange-50 to-amber-50 p-3">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="h-3 w-3 text-orange-600" />
                <p className="text-xs font-medium text-orange-700">Weekly</p>
              </div>
              <p className="text-lg font-semibold text-orange-900">
                {estimates.weeklyEnergy.toFixed(1)}
              </p>
              <p className="text-xs text-orange-600">kWh/m²</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-3">
              <div className="flex items-center gap-1 mb-1">
                <Calendar className="h-3 w-3 text-amber-600" />
                <p className="text-xs font-medium text-amber-700">Monthly</p>
              </div>
              <p className="text-lg font-semibold text-amber-900">
                {estimates.monthlyEnergy.toFixed(1)}
              </p>
              <p className="text-xs text-amber-600">kWh/m²</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gradient-to-br from-green-50 to-emerald-50 p-3">
              <div className="flex items-center gap-1 mb-1">
                <Sun className="h-3 w-3 text-green-600" />
                <p className="text-xs font-medium text-green-700">Yearly</p>
              </div>
              <p className="text-lg font-semibold text-green-900">
                {estimates.yearlyEnergy.toFixed(0)}
              </p>
              <p className="text-xs text-green-600">kWh/m²</p>
            </div>
          </div>

          {/* Peak Sun Hours */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600">Peak Sun Hours (Daily Avg)</p>
                <p className="text-lg font-semibold text-gray-900">
                  {estimates.peakSunHours.toFixed(1)} hours
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-gray-600">Current Radiation</p>
                <p className="text-lg font-semibold text-gray-900">
                  {(currentRadiation || 0).toFixed(0)} W/m²
                </p>
              </div>
            </div>
          </div>

          {/* Daily Power Curve Chart */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">Daily Power Generation Curve</p>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyChartData}>
                  <defs>
                    <linearGradient id="powerGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    tickFormatter={(v) => `${(v * 1000).toFixed(0)}W`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${(value * 1000).toFixed(0)} W`, 'Power']}
                    labelFormatter={(label) => `Time: ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="power"
                    stroke="#f59e0b"
                    fill="url(#powerGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly Energy Potential Chart */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">Monthly Energy Potential (kWh/m²)</p>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value.toFixed(1)} kWh/m²`, 'Energy']}
                  />
                  <Bar
                    dataKey="energy"
                    fill="#22c55e"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Info Text */}
          <p className="text-[10px] text-muted-foreground text-center">
            Estimates based on {(panelEfficiency * 100).toFixed(0)}% panel efficiency, {(systemLosses * 100).toFixed(0)}% system losses.
            Actual output varies with weather, shading, and panel orientation.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
