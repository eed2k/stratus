import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Helper to safely convert to number and format
const safeFixed = (value: number | string | null | undefined, decimals: number = 1): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return (num != null && !isNaN(num)) ? num.toFixed(decimals) : '--';
};

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
    <Card className="border border-gray-300 bg-white" data-testid="card-solar-radiation">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar Radiation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(currentRadiation, 1)}</span>
            <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>W/m²</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Peak Today</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(peakRadiation, 1)} W/m²</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Daily Energy</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(dailyEnergy, 1)} MJ/m²</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Today</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(avgRadiation, 1)} W/m²</p>
            </div>

            {panelTemperature !== undefined && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Panel Temp</p>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(panelTemperature, 1)} °C</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
