import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

interface EvapotranspirationCardProps {
  currentETo: number;           // mm/hour (instantaneous rate)
  dailyETo: number;             // mm/day
  weeklyETo?: number;           // mm (cumulative 7 days)
  monthlyETo?: number;          // mm (cumulative 30 days)
  yearlyETo?: number;           // mm (cumulative year)
  cropCoefficient?: number;     // Kc value for ETc calculation
  dailyRain?: number;           // mm/day rainfall
  valveFlowRate?: number;       // mm/hour valve delivery rate (default 5 mm/hr typical drip)
  sparklineData?: number[];
}

function getEToStatus(dailyETo: number): { status: string; color: string; description: string } {
  if (dailyETo < 2) return { 
    status: "Low", 
    color: "text-blue-500", 
    description: "Low water demand" 
  };
  if (dailyETo < 4) return { 
    status: "Moderate", 
    color: "text-green-500", 
    description: "Normal conditions" 
  };
  if (dailyETo < 6) return { 
    status: "High", 
    color: "text-orange-500", 
    description: "Increased irrigation may be needed" 
  };
  return { 
    status: "Very High", 
    color: "text-red-500", 
    description: "High water demand - monitor crops closely" 
  };
}

export function EvapotranspirationCard({
  currentETo,
  dailyETo,
  weeklyETo,
  monthlyETo,
  yearlyETo,
  cropCoefficient = 1.0,
  dailyRain = 0,
  valveFlowRate = 5,
  sparklineData = [],
}: EvapotranspirationCardProps) {
  const status = getEToStatus(dailyETo);
  
  // Calculate ETc (Crop Evapotranspiration)
  const dailyETc = dailyETo * cropCoefficient;
  
  // Calculate irrigation requirement: (ETo - rain) * crop factor
  // If rain exceeds ETo, no irrigation needed
  const netIrrigationNeed = Math.max((dailyETo - dailyRain) * cropCoefficient, 0);
  // Irrigation time = net need (mm) / valve flow rate (mm/hr)
  const irrigationTimeHours = valveFlowRate > 0 ? netIrrigationNeed / valveFlowRate : 0;
  const irrigationMinutes = Math.round(irrigationTimeHours * 60);
  
  // Only use sparkline data if provided - no fake data generation
  const chartData = sparklineData.length > 0 ? sparklineData : [];

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-evapotranspiration">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Reference Evapotranspiration (ETo)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Main daily ETo value */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(dailyETo, 2)}
                </span>
                <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>mm/day</span>
              </div>
              <p className={`text-sm ${status.color}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{status.status}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Current Rate</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(currentETo, 3)} mm/hr</p>
            </div>
          </div>

          {/* Status description */}
          <div className="p-2 rounded-lg bg-gray-50 border border-gray-200">
            <p className="text-xs text-gray-600" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{status.description}</p>
          </div>

          {/* Hourly ETo chart */}
          <div className="space-y-1">
            <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>24-Hour Pattern</p>
            {chartData.length > 0 ? (
              <div className="h-12 flex items-end gap-0.5">
                {chartData.map((val, i) => {
                  const max = Math.max(...chartData, 0.1);
                  const height = (val / max) * 100;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm bg-cyan-500 transition-all duration-300"
                      style={{ height: `${Math.max(height, 2)}%` }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="h-12 flex items-center justify-center text-xs text-gray-400">
                No historical data available
              </div>
            )}
          </div>

          {/* Cumulative values */}
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>24h</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyETo, 1)} mm</p>
            </div>
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>7d</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(weeklyETo ?? dailyETo * 7, 1)} mm</p>
            </div>
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>30d</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(monthlyETo ?? dailyETo * 30, 0)} mm</p>
            </div>
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Year</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(yearlyETo ?? dailyETo * 365, 0)} mm</p>
            </div>
          </div>

          {/* ETc calculation */}
          {cropCoefficient !== 1.0 && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-200">
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-700">Crop ET (ETc)</span>
                <span className="text-sm font-medium text-green-700">
                  {safeFixed(dailyETc, 2)} mm/day
                </span>
              </div>
              <p className="text-xs text-green-600 mt-1">
                Kc = {safeFixed(cropCoefficient, 2)} applied
              </p>
            </div>
          )}

          {/* Irrigation Time Estimate */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-normal text-blue-800" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Irrigation Time</span>
              <span className="text-sm font-medium text-blue-800" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {irrigationMinutes > 0 ? (
                  irrigationTimeHours >= 1 
                    ? `${Math.floor(irrigationTimeHours)}h ${irrigationMinutes % 60}min`
                    : `${irrigationMinutes} min`
                ) : 'None needed'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-center">
                <p className="text-xs text-blue-600" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Net Need</p>
                <p className="text-xs font-normal text-blue-800" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(netIrrigationNeed, 2)} mm</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-blue-600" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Rain</p>
                <p className="text-xs font-normal text-blue-800" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyRain, 1)} mm</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-blue-600" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Flow Rate</p>
                <p className="text-xs font-normal text-blue-800" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(valveFlowRate, 1)} mm/hr</p>
              </div>
            </div>
            <p className="text-xs text-blue-500 mt-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              (ETo − Rain) × Kc ÷ Flow Rate
            </p>
          </div>

          {/* FAO method note */}
          <div className="text-center pt-2 border-t border-gray-200">
            <p className="text-xs text-gray-400">
              FAO Penman-Monteith Method
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
