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
    <Card className="w-full" data-testid="card-current-conditions">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl font-semibold" data-testid="text-station-name">
            {stationName}
          </CardTitle>
          <p className="text-xs text-muted-foreground" data-testid="text-last-update">
            Last update: {lastUpdate}
          </p>
        </div>
        <Badge
          variant={isOnline ? "default" : "secondary"}
          className={isOnline ? "bg-green-600 text-white" : ""}
          data-testid="badge-station-status"
        >
          {isOnline ? "Online" : "Offline"}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6">
          <div>
            <p className="font-mono text-5xl font-bold tracking-tight" data-testid="value-temperature">
              {temperature.toFixed(1)}
              <span className="text-2xl text-muted-foreground">°C</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Humidity</p>
              <p className="font-mono text-lg font-semibold" data-testid="value-humidity">{humidity}%</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Pressure</p>
              <p className="font-mono text-lg font-semibold" data-testid="value-pressure">{pressure} hPa</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Wind</p>
              <p className="font-mono text-lg font-semibold" data-testid="value-wind">{windSpeed} km/h</p>
              <p className="text-xs text-muted-foreground">Gust: {windGust} km/h</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Direction</p>
              <p className="font-mono text-lg font-semibold" data-testid="value-direction">
                {getWindDirectionLabel(windDirection)} ({windDirection}°)
              </p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Solar</p>
              <p className="font-mono text-lg font-semibold" data-testid="value-solar">{solarRadiation} W/m²</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Rain (24h)</p>
              <p className="font-mono text-lg font-semibold" data-testid="value-rain">{rainfall} mm</p>
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Dew Point</p>
              <p className="font-mono text-lg font-semibold" data-testid="value-dewpoint">{dewPoint.toFixed(1)}°C</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
