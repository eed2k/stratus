import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getWindDirectionLabel } from "@/lib/windConstants";
import { useState, useEffect, useMemo, memo } from "react";
import { AlertTriangle } from "lucide-react";

interface CurrentConditionsProps {
  stationName: string;
  lastUpdate: string;
  temperature?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  windSpeed?: number | null;
  windGust?: number | null;
  windDirection?: number | null;
  solarRadiation?: number | null;
  rainfall?: number | null;
  dewPoint?: number | null;
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

export const CurrentConditions = memo(function CurrentConditions({
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

  // Format current time in station's timezone using IANA timezone
  const getIANATimezone = () => {
    if (latitude !== undefined && longitude !== undefined) {
      // South Africa / Southern Africa
      if (latitude >= -35 && latitude <= -22 && longitude >= 16 && longitude <= 33) return 'Africa/Johannesburg';
      // East Africa
      if (latitude >= -12 && latitude <= 5 && longitude >= 29 && longitude <= 42) return 'Africa/Nairobi';
      // West Africa
      if (latitude >= -5 && latitude <= 13 && longitude >= -5 && longitude <= 15) return 'Africa/Lagos';
      // Central/Southern Africa
      if (latitude >= -22 && latitude <= -8 && longitude >= 12 && longitude <= 36) return 'Africa/Maputo';
    }
    // Default to SAST
    return 'Africa/Johannesburg';
  };

  // Parse the raw ISO timestamp for reliable staleness checking
  const lastUpdateDate = useMemo(() => {
    if (!lastUpdate || lastUpdate === "No data") return null;
    try {
      const d = new Date(lastUpdate);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }, [lastUpdate]);

  // Format the last update time for display using station timezone
  const formattedLastUpdate = useMemo(() => {
    if (!lastUpdateDate) return "No data";
    const tz = getIANATimezone();
    try {
      return lastUpdateDate.toLocaleString('en-ZA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
    } catch {
      return lastUpdateDate.toLocaleString();
    }
  }, [lastUpdateDate]);

  // Check if data is stale (no updates in expected time window)
  const dataStatus = useMemo(() => {
    if (!lastUpdateDate) {
      return { isStale: true, message: "No live data available", minutesAgo: null };
    }
    
    const now = new Date();
    const diffMs = now.getTime() - lastUpdateDate.getTime();
    
    // Guard against future timestamps or clock skew
    if (diffMs < 0) {
      return { isStale: false, message: null, minutesAgo: 0, timeAgo: 'just now' };
    }
    
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    
    // Stale threshold: 6 hours for Dropbox/HTTP sync, 3x sync interval, or 6 hours default
    const staleThresholdMs = syncInterval
      ? Math.max(syncInterval * 3, 6 * 60 * 60 * 1000)
      : 6 * 60 * 60 * 1000;
    const isStale = diffMs > staleThresholdMs;
    
    let timeAgo = '';
    if (diffMinutes < 1) {
      timeAgo = 'just now';
    } else if (diffMinutes < 60) {
      timeAgo = `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
      timeAgo = `${diffHours}h ${diffMinutes % 60}m ago`;
    } else {
      timeAgo = `${Math.floor(diffHours / 24)}d ${diffHours % 24}h ago`;
    }
    
    return {
      isStale,
      message: isStale ? `No live data - last update ${timeAgo}` : null,
      minutesAgo: diffMinutes,
      timeAgo
    };
  }, [lastUpdateDate, syncInterval, currentTime]);

  const formatLocalTime = () => {
    const tz = getIANATimezone();
    try {
      return currentTime.toLocaleTimeString('en-ZA', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }) + ' ' + timezoneInfo.timezone;
    } catch {
      // Fallback if timezone not supported
      return currentTime.toLocaleTimeString('en-ZA', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }
  };
  // Determine status label based on connection type and data staleness
  const getStatusInfo = () => {
    // If data is stale, show warning status regardless of connection type
    if (dataStatus.isStale) {
      return {
        label: 'Data Stale',
        className: 'bg-amber-500 text-white font-normal',
        isActive: false,
      };
    }
    
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
            Last update: {formattedLastUpdate}{dataStatus.timeAgo && !dataStatus.isStale ? ` (${dataStatus.timeAgo})` : ''}
          </p>
          <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="text-local-time">
            Local Time: {formatLocalTime()}
          </p>
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
      
      {/* Stale Data Warning */}
      {dataStatus.isStale && (
        <div className="px-6 pb-4">
          <Alert variant="default" className="border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 text-sm">
              {dataStatus.message}. Historical data is still available below.
            </AlertDescription>
          </Alert>
        </div>
      )}
      
      <CardContent>
        <div className="grid gap-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {temperature != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Temperature</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-temperature">{fmt(temperature, 1)}°C</p>
            </div>
            )}

            {humidity != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Humidity</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-humidity">{fmt(humidity, 1)}%</p>
            </div>
            )}

            {pressure != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Pressure</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-pressure">{fmt(pressure, 2)} hPa</p>
            </div>
            )}

            {windSpeed != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Wind</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-wind">{fmt(windSpeed, 1)} m/s</p>
              {windGust != null && <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Gust: {fmt(windGust, 1)} m/s</p>}
            </div>
            )}

            {windDirection != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Direction</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-direction">
                {getWindDirectionLabel(windDirection)} ({Math.round(windDirection)}°)
              </p>
            </div>
            )}

            {solarRadiation != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Solar</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-solar">{fmt(solarRadiation, 1)} W/m²</p>
            </div>
            )}

            {rainfall != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Rain (24h)</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-rain">{fmt(rainfall, 2)} mm</p>
            </div>
            )}

            {dewPoint != null && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Dew Point</p>
              <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid="value-dewpoint">{fmt(dewPoint, 1)}°C</p>
            </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
