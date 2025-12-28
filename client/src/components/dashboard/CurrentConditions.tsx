import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CurrentConditionsProps {
  stationName: string;
  lastUpdate: string;
  temperature: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  windGust: number;
  windDirection: number;
  solarRadiation: number;
  rainfall: number;
  dewPoint: number;
  isOnline?: boolean;
}

/**
 * Format number to max 3 decimal places, removing trailing zeros
 */
const fmt = (value: number, maxDecimals: number = 1): string => {
  return parseFloat(value.toFixed(maxDecimals)).toString();
};

const getWindDirectionLabel = (deg: number): string => {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(deg / 22.5) % 16;
  return directions[index];
};

export function CurrentConditions({
  stationName,
  lastUpdate,
  temperature,
  humidity,
  pressure,
  windSpeed,
  windGust,
  windDirection,
  solarRadiation,
  rainfall,
  dewPoint,
  isOnline = true,
}: CurrentConditionsProps) {
  return (
    <Card className="w-full border border-gray-300 bg-white" data-testid="card-current-conditions">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="text-station-name">
            {stationName}
          </CardTitle>
          <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="text-last-update">
            Last update: {lastUpdate}
          </p>
        </div>
        <Badge
          variant={isOnline ? "default" : "secondary"}
          className={isOnline ? "bg-green-600 text-white font-bold" : "font-bold"}
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
          data-testid="badge-station-status"
        >
          {isOnline ? "Online" : "Offline"}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6">
          <div>
            <p className="text-5xl font-bold tracking-tight text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-temperature">
              {fmt(temperature, 1)}
              <span className="text-2xl text-black">°C</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Humidity</p>
              <p className="text-lg font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-humidity">{fmt(humidity, 1)}%</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Pressure</p>
              <p className="text-lg font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-pressure">{fmt(pressure, 2)} hPa</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Wind</p>
              <p className="text-lg font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-wind">{fmt(windSpeed, 1)} km/h</p>
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Gust: {fmt(windGust, 1)} km/h</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Direction</p>
              <p className="text-lg font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-direction">
                {getWindDirectionLabel(windDirection)} ({Math.round(windDirection)}°)
              </p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar</p>
              <p className="text-lg font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-solar">{fmt(solarRadiation, 1)} W/m²</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Rain (24h)</p>
              <p className="text-lg font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-rain">{fmt(rainfall, 2)} mm</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Dew Point</p>
              <p className="text-lg font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-dewpoint">{fmt(dewPoint, 1)}°C</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
