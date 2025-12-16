import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Droplet, Clock } from "lucide-react";

interface EToCardProps {
  dailyETo: number;
  weeklyETo: number;
  monthlyETo: number;
  irrigationTime: number;
}

export function EToCard({ dailyETo, weeklyETo, monthlyETo, irrigationTime }: EToCardProps) {
  return (
    <Card data-testid="card-eto">
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Droplet className="h-5 w-5 text-cyan-500" />
        <CardTitle className="text-lg font-medium">Evapotranspiration</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-4xl font-bold">{dailyETo.toFixed(2)}</span>
            <span className="text-sm text-muted-foreground">mm/day</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground">24h ETo</p>
              <p className="font-mono text-lg font-semibold">{dailyETo.toFixed(2)} mm</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground">7d ETo</p>
              <p className="font-mono text-lg font-semibold">{weeklyETo.toFixed(1)} mm</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-xs text-muted-foreground">30d ETo</p>
              <p className="font-mono text-lg font-semibold">{monthlyETo.toFixed(1)} mm</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-primary/10 p-3">
            <Clock className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Recommended Irrigation</p>
              <p className="font-mono text-lg font-semibold text-primary">{irrigationTime} min</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
