// Stratus Weather System
// Created by Lukas Esterhuizen

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { safeFixed } from "@/lib/utils";
import { 
  calculateFireDanger, 
  calculateBurningIndex,
  calculateWindFactor,
  getRainCorrectionFactor,
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

// Lowveld Fire Danger Index Card
// Displays the official LFDI as used by SAWS and Namibia AFIS.
// Formula: LFDI = (BI + WF) x RCF
export function FireDangerCard({
  temperature,
  humidity,
  windSpeed,
  rainfall7day = 0,
  rainfall30day = 0,
  daysSinceRain = 7,
  showDetailedInfo = true,
}: FireDangerCardProps) {
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

  // Compute LFDI components for the formula display
  const bi = calculateBurningIndex(temperature, humidity);
  const wf = calculateWindFactor(windSpeed * 3.6);
  const rcf = getRainCorrectionFactor(rainfall7day, daysSinceRain);

  return (
    <Card data-testid="card-fire-danger" className="relative overflow-hidden border border-gray-300 bg-white">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Lowveld Fire Danger Index
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
        {/* LFDI Value Display */}
        <div className="flex flex-col items-center">
          <div className="text-center">
            <div className="text-4xl font-normal" style={{ color: fireDanger.rating.color, fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {safeFixed(fireDanger.ffdi, 1)}
            </div>
            <div className="text-sm text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>LFDI</div>
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
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Rain Correction</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(rcf, 2)}</p>
            </div>
            <div>
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Days Since Rain</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{daysSinceRain}d</p>
            </div>
          </div>
        )}

        {/* LFDI Formula Breakdown: (BI + WF) x RCF = LFDI */}
        <div className="pt-2 border-t">
          <div className="flex items-center justify-center gap-1 text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            <span className="text-muted-foreground italic">LFDI</span>
            <span className="text-muted-foreground">=</span>
            <span className="text-muted-foreground">(</span>
            <span className="font-medium bg-gray-100 rounded px-1.5 py-0.5">{safeFixed(bi, 1)}</span>
            <span className="text-muted-foreground">+</span>
            <span className="font-medium bg-gray-100 rounded px-1.5 py-0.5">{safeFixed(wf, 1)}</span>
            <span className="text-muted-foreground">)</span>
            <span className="text-muted-foreground">×</span>
            <span className="font-medium bg-gray-100 rounded px-1.5 py-0.5">{safeFixed(rcf, 2)}</span>
            <span className="text-muted-foreground">=</span>
            <span className="font-semibold" style={{ color: fireDanger.rating.color }}>{safeFixed(fireDanger.ffdi, 1)}</span>
          </div>
          <div className="flex items-center justify-center gap-4 mt-1 text-[10px] text-muted-foreground" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            <span>BI</span>
            <span>WF</span>
            <span>RCF</span>
          </div>
        </div>

        {/* Input conditions summary */}
        <div className="flex justify-between text-xs text-black pt-2 border-t" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          <span>{safeFixed(temperature, 1)} °C</span>
          <span>{safeFixed(humidity, 0)}% RH</span>
          <span>{safeFixed(windSpeed, 1)} m/s</span>
        </div>
      </CardContent>
    </Card>
  );
}

export { type FireDangerResult };
