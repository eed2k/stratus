import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { safeFixed } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import { 
  calculateFireDanger, 
  type FireDangerResult 
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
    <Card data-testid="card-fire-danger" className="relative overflow-hidden border border-gray-300 bg-white">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
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

        {/* FDI Value Display (no gauge) */}
        <div className="flex flex-col items-center">
          <div className="text-center">
            <div className="text-4xl font-normal" style={{ color: fireDanger.rating.color, fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {safeFixed(fireDanger.ffdi, 1)}
            </div>
            <div className="text-sm text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>SA Fire Danger Index</div>
          </div>
          
          {/* Rating Description */}
          <div className="text-center mt-2">
            <p className="text-sm font-normal" style={{ color: fireDanger.rating.color, fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {fireDanger.rating.description}
            </p>
          </div>
        </div>

        {/* Detailed Metrics */}
        {showDetailedInfo && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t rounded-lg bg-gray-50 border border-gray-200 p-3">
            <div>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Fuel Moisture</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{fireDanger.fuelMoisture}%</p>
            </div>
            <div>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Spread Potential</p>
              <p className="text-sm font-normal text-black capitalize" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{fireDanger.spreadPotential}</p>
            </div>
            <div>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Grassland FDI</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(fireDanger.grasslandFDI, 1)}</p>
            </div>
            <div>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Drought Index</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{fireDanger.keetchByramIndex}</p>
            </div>
          </div>
        )}

        {/* Action Advice */}
        <div className="pt-2 border-t">
          <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            <strong>Action:</strong> {fireDanger.rating.actionAdvice}
          </p>
        </div>

        {/* Input conditions summary */}
        <div className="flex justify-between text-xs text-black pt-2 border-t" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          <span>{safeFixed(temperature, 1)}°C</span>
          <span>{safeFixed(humidity, 0)}% RH</span>
          <span>{safeFixed(windSpeed, 1)} m/s</span>
        </div>
      </CardContent>
    </Card>
  );
}

export { type FireDangerResult };
