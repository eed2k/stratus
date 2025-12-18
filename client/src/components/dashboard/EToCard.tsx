import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EToCardProps {
  dailyETo: number;
  weeklyETo: number;
  monthlyETo: number;
}

export function EToCard({ dailyETo, weeklyETo, monthlyETo }: EToCardProps) {
  return (
    <Card data-testid="card-eto">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Evapotranspiration</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold">{dailyETo.toFixed(2)}</span>
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
        </div>
      </CardContent>
    </Card>
  );
}
