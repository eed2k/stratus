import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BatteryVoltageCardProps {
  voltage: number;             // Volts
  minVoltage?: number;         // Minimum acceptable voltage
  maxVoltage?: number;         // Maximum/charging voltage
  isCharging?: boolean;
  sparklineData?: number[];
  chartColor?: string;
}

function getBatteryStatus(voltage: number, min: number, max: number): { 
  status: string; 
  color: string; 
  percentage: number;
} {
  const percentage = Math.min(100, Math.max(0, ((voltage - min) / (max - min)) * 100));
  
  if (voltage < min) {
    return { status: "Critical", color: "text-red-500", percentage: 0 };
  }
  if (percentage < 20) {
    return { status: "Low", color: "text-orange-500", percentage };
  }
  if (percentage < 40) {
    return { status: "Fair", color: "text-yellow-500", percentage };
  }
  if (percentage < 80) {
    return { status: "Good", color: "text-green-500", percentage };
  }
  return { status: "Excellent", color: "text-emerald-500", percentage };
}

export function BatteryVoltageCard({
  voltage,
  minVoltage = 11.5,
  maxVoltage = 14.5,
  isCharging = false,
  sparklineData = [],
  chartColor = "#22c55e",
}: BatteryVoltageCardProps) {
  const status = getBatteryStatus(voltage, minVoltage, maxVoltage);
  
  // Generate sparkline if not provided
  const chartData = sparklineData.length > 0 
    ? sparklineData 
    : Array.from({ length: 24 }, () => voltage + (Math.random() - 0.5) * 0.3);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-battery-voltage">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Logger Battery Voltage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Main value */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {voltage.toFixed(2)}
              </span>
              <span className="text-sm font-normal text-gray-500">V</span>
            </div>
            {isCharging && (
              <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                Charging
              </span>
            )}
          </div>

          {/* Status bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className={`font-medium ${status.color}`}>{status.status}</span>
              <span className="text-gray-500">{status.percentage.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-500"
                style={{ 
                  width: `${status.percentage}%`,
                  backgroundColor: status.color.includes('red') ? '#ef4444' : 
                                   status.color.includes('orange') ? '#f97316' :
                                   status.color.includes('yellow') ? '#eab308' :
                                   status.color.includes('emerald') ? '#10b981' : '#22c55e'
                }}
              />
            </div>
          </div>

          {/* Voltage history chart */}
          <div className="h-16 flex items-end gap-0.5">
            {chartData.map((val, i) => {
              const max = Math.max(...chartData, maxVoltage);
              const min = Math.min(...chartData, minVoltage);
              const range = max - min || 1;
              const height = ((val - min) / range) * 100;
              const barColor = val < minVoltage ? '#ef4444' : 
                              val < minVoltage + 0.5 ? '#f97316' : chartColor;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm transition-all duration-300"
                  style={{ height: `${Math.max(height, 5)}%`, backgroundColor: barColor }}
                />
              );
            })}
          </div>

          {/* Voltage range info */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Min</p>
              <p className="text-sm font-normal text-red-500">{minVoltage.toFixed(1)}V</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Current</p>
              <p className="text-sm font-normal text-black">{voltage.toFixed(2)}V</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Max</p>
              <p className="text-sm font-normal text-green-500">{maxVoltage.toFixed(1)}V</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
