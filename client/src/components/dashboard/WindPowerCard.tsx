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
    <Card data-testid="card-wind-power">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-muted-foreground">Wind Power</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal">{safeFixed(currentPower, 1)}</span>
            <span className="text-sm text-muted-foreground">W/m²</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Gust Power</p>
              <p className="text-lg font-normal">{safeFixed(gustPower, 1)} W/m²</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Air Density</p>
              <p className="text-lg font-normal">{safeFixed(airDensity, 3)} kg/m³</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Avg Speed (Recent)</p>
              <p className="text-lg font-normal">{safeFixed(avgSpeed, 1)} km/h</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Avg Power (Recent)</p>
              <p className="text-lg font-normal">{safeFixed(avgPower, 1)} W/m²</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
