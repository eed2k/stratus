// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateRoadWeather, type RoadWeatherResult } from "@shared/utils/calc";

interface RoadWeatherCardProps {
  temperature: number;   // °C
  dewPoint?: number;     // °C
  windSpeed?: number;    // m/s
  humidity?: number;     // %
  rainfall?: number;     // mm (recent)
}

export function RoadWeatherCard({ temperature, dewPoint, windSpeed, humidity, rainfall }: RoadWeatherCardProps) {
  const result: RoadWeatherResult = calculateRoadWeather(
    temperature, dewPoint ?? temperature - 3, windSpeed ?? 0, humidity ?? 50, rainfall ?? 0
  );

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-road-weather">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Road Weather
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Overall condition badge */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                Road Conditions
              </p>
              <p className="text-xs text-gray-500">Surface & visibility assessment</p>
            </div>
            <span
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{ backgroundColor: result.overallColor + '20', color: result.overallColor }}
            >
              {result.overallCondition}
            </span>
          </div>

          {/* Risk gauges */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200">
            {/* Icing risk */}
            <div className="rounded-lg border p-3 text-center" style={{ borderColor: result.icingRiskColor + '40' }}>
              <p className="text-xs text-gray-500">Black Ice Risk</p>
              <p className="text-lg font-normal" style={{ color: result.icingRiskColor, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.icingRisk}
              </p>
            </div>
            {/* Fog risk */}
            <div className="rounded-lg border p-3 text-center" style={{ borderColor: result.fogRiskColor + '40' }}>
              <p className="text-xs text-gray-500">Fog Risk</p>
              <p className="text-lg font-normal" style={{ color: result.fogRiskColor, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.fogRisk}
              </p>
            </div>
          </div>

          {/* Road surface and dew point spread */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Est. Road Surface</p>
              <p className={`text-sm font-normal ${result.roadSurfaceTemp <= 0 ? 'text-blue-500' : result.roadSurfaceTemp <= 3 ? 'text-orange-500' : 'text-black'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.roadSurfaceTemp, 1)} °C
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Dew Point Spread</p>
              <p className={`text-sm font-normal ${result.dewPointSpread < 2 ? 'text-orange-500' : 'text-black'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.dewPointSpread, 1)} °C
              </p>
            </div>
          </div>

          {/* Input conditions */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
            <div className="text-center">
              <p className="text-xs text-gray-500">Air Temp</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(temperature, 1)} °C
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Dew Point</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(dewPoint, 1)} °C
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Wind</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(windSpeed ?? 0, 1)} m/s
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-400 italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Road surface temperature is estimated from air temperature and wind speed. 
            Black ice forms when road surface ≤ 0°C with moisture present. 
            Fog is likely when dew point spread &lt; 1°C with light winds.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
