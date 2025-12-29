import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
  sparklineData,
}: WindPowerCardProps) {
  // Generate default sparkline data if not provided
  const chartData = sparklineData && sparklineData.length > 0 
    ? sparklineData 
    : Array.from({ length: 12 }, () => currentPower * (0.7 + Math.random() * 0.6));

  return (
    <Card data-testid="card-wind-power">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-muted-foreground">Wind Power</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-normal">{currentPower.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">W/m²</span>
          </div>

          {/* Mini chart */}
          <div className="h-12 flex items-end gap-0.5">
            {chartData.map((val, i) => {
              const max = Math.max(...chartData);
              const min = Math.min(...chartData);
              const range = max - min || 1;
              const height = ((val - min) / range) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 bg-teal-500 rounded-t-sm"
                  style={{ height: `${Math.max(height, 5)}%` }}
                />
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Gust Power</p>
              <p className="font-mono text-lg font-normal">{gustPower.toFixed(1)} W/m²</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Air Density</p>
              <p className="font-mono text-lg font-normal">{airDensity.toFixed(3)} kg/m³</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Avg Speed (10m)</p>
              <p className="font-mono text-lg font-normal">{avgSpeed.toFixed(1)} km/h</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Avg Power (10m)</p>
              <p className="font-mono text-lg font-normal">{avgPower.toFixed(1)} W/m²</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
