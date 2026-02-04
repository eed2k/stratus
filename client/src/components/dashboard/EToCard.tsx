import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

interface EToCardProps {
  dailyETo: number;
  weeklyETo: number;
  monthlyETo: number;
}

export function EToCard({ dailyETo, weeklyETo, monthlyETo }: EToCardProps) {
  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-eto">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Evapotranspiration</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyETo, 2)}</span>
            <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>mm/day</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-center">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>24h ETo</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyETo, 2)} mm</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-center">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>7d ETo</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(weeklyETo, 1)} mm</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3 text-center">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>30d ETo</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(monthlyETo, 1)} mm</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
