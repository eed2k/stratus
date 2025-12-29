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
    <Card className="border border-gray-300 bg-white" data-testid="card-solar-radiation">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar Radiation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{currentRadiation.toFixed(1)}</span>
            <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>W/m²</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Peak Today</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{peakRadiation.toFixed(1)} W/m²</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Daily Energy</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{dailyEnergy.toFixed(1)} MJ/m²</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Avg Today</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{avgRadiation.toFixed(1)} W/m²</p>
            </div>

            {panelTemperature !== undefined && (
              <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
                <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Panel Temp</p>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{panelTemperature.toFixed(1)} °C</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
