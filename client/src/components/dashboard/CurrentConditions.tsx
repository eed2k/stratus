import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWindDirectionLabel } from "@/lib/windConstants";
import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

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
  connectionType?: string; // 'dropbox', 'http', 'tcp', etc.
  syncInterval?: number; // in milliseconds
  latitude?: number;
  longitude?: number;
}

/**
 * Format number to max 3 decimal places, removing trailing zeros
 */
const fmt = (value: number, maxDecimals: number = 1): string => {
  return parseFloat(value.toFixed(maxDecimals)).toString();
};

/**
 * Get timezone info based on coordinates
 */
const getTimezoneInfo = (lat?: number, lon?: number) => {
  // Default to SAST (South Africa)
  let timezone = 'SAST';
  let offset = 2; // UTC+2
  
  if (lat !== undefined && lon !== undefined) {
    // South Africa and southern Africa: SAST (UTC+2)
    if (lat >= -35 && lat <= -22 && lon >= 16 && lon <= 33) {
      timezone = 'SAST';
      offset = 2;
    }
    // East Africa: EAT (UTC+3)
    else if (lat >= -12 && lat <= 5 && lon >= 29 && lon <= 42) {
      timezone = 'EAT';
      offset = 3;
    }
    // West Africa: WAT (UTC+1)
    else if (lat >= -5 && lat <= 13 && lon >= -5 && lon <= 15) {
      timezone = 'WAT';
      offset = 1;
    }
    // Central/Southern Africa: CAT (UTC+2)
    else if (lat >= -22 && lat <= -8 && lon >= 12 && lon <= 36) {
      timezone = 'CAT';
      offset = 2;
    }
  }
  
  return { timezone, offset };
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
  connectionType,
  syncInterval,
  latitude,
  longitude,
}: CurrentConditionsProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const timezoneInfo = getTimezoneInfo(latitude, longitude);
  
  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Format current time in local timezone
  const formatLocalTime = () => {
    const utcTime = currentTime.getTime();
    const localTime = new Date(utcTime + timezoneInfo.offset * 3600000);
    const hours = String(localTime.getUTCHours()).padStart(2, '0');
    const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(localTime.getUTCSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds} ${timezoneInfo.timezone}`;
  };
  // Determine status label based on connection type
  const getStatusInfo = () => {
    const isDropboxSync = connectionType === 'http' || connectionType === 'dropbox';
    if (isDropboxSync) {
      const intervalHours = syncInterval ? Math.round(syncInterval / 3600000) : 1;
      return {
        label: `Syncing (${intervalHours}h)`,
        className: 'bg-blue-600 text-white font-normal',
        isActive: true,
      };
    }
    return {
      label: isOnline ? 'Online' : 'Offline',
      className: isOnline ? 'bg-green-600 text-white font-normal' : 'font-normal',
      isActive: isOnline,
    };
  };
  
  const statusInfo = getStatusInfo();
  
  return (
    <Card className="w-full border border-gray-300 bg-white" data-testid="card-current-conditions">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="text-station-name">
            {stationName}
          </CardTitle>
          <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="text-last-update">
            Last update: {lastUpdate}
          </p>
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-600" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="text-local-time">
            <Clock className="h-4 w-4" />
            <span>{formatLocalTime()}</span>
          </div>
        </div>
        <Badge
          variant={statusInfo.isActive ? "default" : "secondary"}
          className={statusInfo.className}
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
          data-testid="badge-station-status"
        >
          {statusInfo.label}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6">
          <div>
            <p className="text-5xl font-normal tracking-tight text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-temperature">
              {fmt(temperature, 1)}
              <span className="text-2xl text-black">°C</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Humidity</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-humidity">{fmt(humidity, 1)}%</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Pressure</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-pressure">{fmt(pressure, 2)} hPa</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Wind</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-wind">{fmt(windSpeed, 1)} km/h</p>
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Gust: {fmt(windGust, 1)} km/h</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Direction</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-direction">
                {getWindDirectionLabel(windDirection)} ({Math.round(windDirection)}°)
              </p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-solar">{fmt(solarRadiation, 1)} W/m²</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Rain (24h)</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-rain">{fmt(rainfall, 2)} mm</p>
            </div>

            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Dew Point</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-dewpoint">{fmt(dewPoint, 1)}°C</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
