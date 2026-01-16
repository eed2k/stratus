import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EvapotranspirationCardProps {
  currentETo: number;           // mm/hour (instantaneous rate)
  dailyETo: number;             // mm/day
  weeklyETo?: number;           // mm (cumulative 7 days)
  monthlyETo?: number;          // mm (cumulative 30 days)
  yearlyETo?: number;           // mm (cumulative year)
  cropCoefficient?: number;     // Kc value for ETc calculation
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
  sparklineData = [],
}: EvapotranspirationCardProps) {
  const status = getEToStatus(dailyETo);
  
  // Calculate ETc (Crop Evapotranspiration)
  const dailyETc = dailyETo * cropCoefficient;
  
  // Generate sparkline if not provided
  const chartData = sparklineData.length > 0 
    ? sparklineData 
    : Array.from({ length: 24 }, (_, i) => {
        // Simulate daily ETo pattern (low at night, peak at midday)
        const hour = i;
        const peak = Math.sin((hour - 6) * Math.PI / 12);
        return Math.max(0, dailyETo / 10 * Math.max(0, peak) + Math.random() * 0.1);
      });

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
                  {dailyETo.toFixed(2)}
                </span>
                <span className="text-sm font-normal text-gray-500">mm/day</span>
              </div>
              <p className={`text-sm ${status.color}`}>{status.status}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Current Rate</p>
              <p className="text-lg font-normal text-black">{currentETo.toFixed(3)} mm/hr</p>
            </div>
          </div>

          {/* Status description */}
          <div className="p-2 rounded-lg bg-gray-50 border border-gray-200">
            <p className="text-xs text-gray-600">{status.description}</p>
          </div>

          {/* Hourly ETo chart */}
          <div className="space-y-1">
            <p className="text-xs text-gray-500">24-Hour Pattern</p>
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
          </div>

          {/* Cumulative values */}
          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">24h</p>
              <p className="text-sm font-normal text-black">{dailyETo.toFixed(1)} mm</p>
            </div>
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">7d</p>
              <p className="text-sm font-normal text-black">{(weeklyETo ?? dailyETo * 7).toFixed(1)} mm</p>
            </div>
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">30d</p>
              <p className="text-sm font-normal text-black">{(monthlyETo ?? dailyETo * 30).toFixed(0)} mm</p>
            </div>
            <div className="text-center p-2 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-xs text-gray-500">Year</p>
              <p className="text-sm font-normal text-black">{(yearlyETo ?? dailyETo * 180).toFixed(0)} mm</p>
            </div>
          </div>

          {/* ETc calculation */}
          {cropCoefficient !== 1.0 && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-200">
              <div className="flex items-center justify-between">
                <span className="text-sm text-green-700">Crop ET (ETc)</span>
                <span className="text-sm font-medium text-green-700">
                  {dailyETc.toFixed(2)} mm/day
                </span>
              </div>
              <p className="text-xs text-green-600 mt-1">
                Kc = {cropCoefficient.toFixed(2)} applied
              </p>
            </div>
          )}

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
