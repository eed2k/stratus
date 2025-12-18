import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, TrendingUp, Zap, Thermometer } from "lucide-react";

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
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Sun className="h-5 w-5 text-yellow-500" />
        <CardTitle className="text-lg font-medium">Solar Radiation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl font-bold">{currentRadiation.toFixed(1)}</span>
            <span className="text-sm text-muted-foreground">W/m²</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                <span>Peak Today</span>
              </div>
              <p className="font-mono text-lg font-semibold">{peakRadiation.toFixed(1)} W/m²</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3" />
                <span>Daily Energy</span>
              </div>
              <p className="font-mono text-lg font-semibold">{dailyEnergy.toFixed(1)} MJ/m²</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Avg Today</p>
              <p className="font-mono text-lg font-semibold">{avgRadiation.toFixed(1)} W/m²</p>
            </div>

            {panelTemperature !== undefined && (
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Thermometer className="h-3 w-3" />
                  <span>Panel Temp</span>
                </div>
                <p className="font-mono text-lg font-semibold">{panelTemperature.toFixed(1)} °C</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
