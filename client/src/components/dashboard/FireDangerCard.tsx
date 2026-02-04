import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { safeFixed } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import { 
  calculateFireDanger, 
  FIRE_DANGER_RATINGS,
  type FireDangerResult,
  type FireDangerRating 
} from "@shared/utils/calc";

interface FireDangerCardProps {
  temperature: number;
  humidity: number;
  windSpeed: number;
  rainfall7day?: number;
  rainfall30day?: number;
  daysSinceRain?: number;
  showDetailedInfo?: boolean;
}

/**
 * South African Fire Danger Index Card
 * 
 * Displays the Lowveld Fire Danger Index (FDI) as used by SAWS with:
 * - Visual gauge showing current danger level
 * - Color-coded rating (Blue/Green/Yellow/Orange/Red)
 * - Warning messages for elevated danger
 * - Supporting metrics (fuel moisture, spread potential)
 */
export function FireDangerCard({
  temperature,
  humidity,
  windSpeed,
  rainfall7day = 0,
  rainfall30day = 0,
  daysSinceRain = 7,
  showDetailedInfo = true,
}: FireDangerCardProps) {
  // Calculate fire danger
  const fireDanger = useMemo(() => {
    return calculateFireDanger(
      temperature,
      humidity,
      windSpeed,
      rainfall7day,
      rainfall30day,
      daysSinceRain
    );
  }, [temperature, humidity, windSpeed, rainfall7day, rainfall30day, daysSinceRain]);

  // Calculate gauge rotation (0-180 degrees for semicircle gauge)
  const gaugeRotation = useMemo(() => {
    // Clamp FDI to 0-100 for gauge display (SA FDI scale)
    const clampedFDI = Math.min(100, Math.max(0, fireDanger.ffdi));
    return (clampedFDI / 100) * 180;
  }, [fireDanger.ffdi]);

  // Get warning icon based on level
  const getWarningIcon = () => {
    switch (fireDanger.warningLevel) {
      case 3:
        return <AlertTriangle className="h-5 w-5 text-red-600 animate-pulse" />;
      case 2:
        return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      case 1:
        return <Info className="h-5 w-5 text-yellow-500" />;
      default:
        return null;
    }
  };

  return (
    <Card data-testid="card-fire-danger" className="relative overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal">
            FDI
          </CardTitle>
          <Badge 
            variant="outline" 
            style={{ 
              backgroundColor: fireDanger.rating.color + '20',
              borderColor: fireDanger.rating.color,
              color: fireDanger.rating.color 
            }}
          >
            {fireDanger.rating.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Warning Alert */}
        {fireDanger.warningLevel > 0 && fireDanger.warningMessage && (
          <Alert 
            variant={fireDanger.warningLevel >= 2 ? "destructive" : "default"}
            className={fireDanger.warningLevel === 1 ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" : ""}
          >
            {getWarningIcon()}
            <AlertTitle className="ml-2">
              {fireDanger.warningLevel === 3 ? "Emergency" : 
               fireDanger.warningLevel === 2 ? "Warning" : "Watch"}
            </AlertTitle>
            <AlertDescription className="ml-2">
              {fireDanger.warningMessage}
            </AlertDescription>
          </Alert>
        )}

        {/* Gauge Display */}
        <div className="flex flex-col items-center">
          <div className="relative w-48 h-24 overflow-hidden">
            {/* Gauge Background */}
            <svg viewBox="0 0 200 100" className="w-full h-full">
              {/* Background arc segments for each danger level (SA FDI scale 0-100) */}
              {FIRE_DANGER_RATINGS.map((rating: FireDangerRating) => {
                const startAngle = (rating.minValue / 100) * 180;
                const endAngle = Math.min((Math.min(rating.maxValue, 100) / 100) * 180, 180);
                const startRad = (startAngle * Math.PI) / 180;
                const endRad = (endAngle * Math.PI) / 180;
                
                const x1 = 100 - 80 * Math.cos(startRad);
                const y1 = 100 - 80 * Math.sin(startRad);
                const x2 = 100 - 80 * Math.cos(endRad);
                const y2 = 100 - 80 * Math.sin(endRad);
                
                const largeArcFlag = endAngle - startAngle > 90 ? 1 : 0;
                
                return (
                  <path
                    key={rating.level}
                    d={`M ${x1} ${y1} A 80 80 0 ${largeArcFlag} 1 ${x2} ${y2}`}
                    fill="none"
                    stroke={rating.color}
                    strokeWidth="12"
                    strokeLinecap="round"
                    opacity={0.3}
                  />
                );
              })}
              
              {/* Gauge needle */}
              <g transform={`rotate(${gaugeRotation - 180}, 100, 100)`}>
                <line
                  x1="100"
                  y1="100"
                  x2="100"
                  y2="25"
                  stroke={fireDanger.rating.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <circle cx="100" cy="100" r="8" fill={fireDanger.rating.color} />
                <circle cx="100" cy="100" r="4" fill="white" />
              </g>
              
              {/* Scale labels (SA FDI 0-100) */}
              <text x="20" y="95" className="text-[10px] fill-muted-foreground">0</text>
              <text x="90" y="20" className="text-[10px] fill-muted-foreground">50</text>
              <text x="170" y="95" className="text-[10px] fill-muted-foreground">100</text>
            </svg>
          </div>
          
          {/* FDI Value */}
          <div className="text-center mt-2">
            <div className="text-4xl font-bold" style={{ color: fireDanger.rating.color }}>
              {safeFixed(fireDanger.ffdi, 1)}
            </div>
            <div className="text-sm text-muted-foreground">SA Fire Danger Index</div>
          </div>
          
          {/* Rating Description */}
          <div className="text-center mt-2">
            <p className="text-sm font-medium" style={{ color: fireDanger.rating.color }}>
              {fireDanger.rating.description}
            </p>
          </div>
        </div>

        {/* Detailed Metrics */}
        {showDetailedInfo && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t">
            <div>
              <p className="text-xs text-muted-foreground">Fuel Moisture</p>
              <p className="text-sm font-medium">{fireDanger.fuelMoisture}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Spread Potential</p>
              <p className="text-sm font-medium capitalize">{fireDanger.spreadPotential}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grassland FDI</p>
              <p className="text-sm font-medium">{safeFixed(fireDanger.grasslandFDI, 1)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Drought Index</p>
              <p className="text-sm font-medium">{fireDanger.keetchByramIndex}</p>
            </div>
          </div>
        )}

        {/* Action Advice */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground">
            <strong>Action:</strong> {fireDanger.rating.actionAdvice}
          </p>
        </div>

        {/* Input conditions summary */}
        <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>{safeFixed(temperature, 1)}°C</span>
          <span>{safeFixed(humidity, 0)}% RH</span>
          <span>{safeFixed(windSpeed, 1)} km/h</span>
        </div>
      </CardContent>
    </Card>
  );
}

export { type FireDangerResult };
