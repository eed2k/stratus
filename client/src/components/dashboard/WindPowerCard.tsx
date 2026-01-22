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
            <span className="font-mono text-3xl font-normal">{currentPower.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">W/m²</span>
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
