// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

interface BatteryVoltageCardProps {
  voltage: number;             // Volts
  minVoltage?: number;         // Minimum acceptable voltage
  maxVoltage?: number;         // Maximum/charging voltage
  isCharging?: boolean;
}

function getBatteryStatus(voltage: number, min: number, max: number): { 
  status: string; 
  color: string; 
  percentage: number;
} {
  // LiFePO4 12V (4S): 10.0V empty – 14.6V full charge, nominal 12.8V
  const percentage = Math.min(100, Math.max(0, ((voltage - min) / (max - min)) * 100));
  
  if (voltage < min) {
    return { status: "Critical", color: "text-red-500", percentage: 0 };
  }
  if (percentage < 30) {
    return { status: "Low", color: "text-orange-500", percentage };
  }
  if (percentage < 50) {
    return { status: "Fair", color: "text-yellow-500", percentage };
  }
  if (percentage < 75) {
    return { status: "Good", color: "text-green-500", percentage };
  }
  return { status: "Excellent", color: "text-emerald-500", percentage };
}

export function BatteryVoltageCard({
  voltage,
  minVoltage = 10.0,
  maxVoltage = 14.6,
  isCharging = false,
}: BatteryVoltageCardProps) {
  const status = getBatteryStatus(voltage, minVoltage, maxVoltage);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-battery-voltage">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Logger Battery Voltage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Main value */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(voltage, 2)}
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
              <span className="text-gray-500">{safeFixed(status.percentage, 0)}%</span>
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

          {/* Voltage range info */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Min</p>
              <p className="text-sm font-normal text-red-500">{safeFixed(minVoltage, 1)}V</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Current</p>
              <p className="text-sm font-normal text-black">{safeFixed(voltage, 2)}V</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Max</p>
              <p className="text-sm font-normal text-green-500">{safeFixed(maxVoltage, 1)}V</p>
            </div>
          </div>

          {/* Battery technology note */}
          <p className="text-xs text-gray-400 italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Lead-acid batteries: 10.5V (empty) → 12.7V (full) → 14.4–14.8V (charging). Float voltage ~13.6V. Self-discharge ~3–5%/month. Typical lifespan 3–5 years.
            LiFePO₄ (lithium): 10.0V (empty) → 13.2V (full) → 14.2–14.6V (charging). Flat discharge curve holds ~13.0–13.2V for ~80% of capacity. Minimal self-discharge (~2%/month). Lifespan 8–10+ years, 2000+ cycles.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
