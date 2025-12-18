import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SolarRadiationCardProps {
  currentRadiation: number;
  peakRadiation: number;
  dailyEnergy: number;
  avgRadiation: number;
  panelTemperature?: number;
}

export function SolarRadiationCard({
  currentRadiation,
  peakRadiation,
  dailyEnergy,
  avgRadiation,
  panelTemperature,
}: SolarRadiationCardProps) {
  return (
    <Card data-testid="card-solar-radiation">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Solar Radiation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold">{currentRadiation.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">W/m²</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Peak Today</p>
              <p className="font-mono text-lg font-semibold">{peakRadiation.toFixed(1)} W/m²</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Daily Energy</p>
              <p className="font-mono text-lg font-semibold">{dailyEnergy.toFixed(1)} MJ/m²</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Avg Today</p>
              <p className="font-mono text-lg font-semibold">{avgRadiation.toFixed(1)} W/m²</p>
            </div>

            {panelTemperature !== undefined && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Panel Temp</p>
                <p className="font-mono text-lg font-semibold">{panelTemperature.toFixed(1)} °C</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
