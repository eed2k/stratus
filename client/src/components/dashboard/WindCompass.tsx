// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Helper to safely convert to number and format
const safeFixed = (value: number | string | null | undefined, decimals: number = 1): string => {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return (num != null && !isNaN(num)) ? num.toFixed(decimals) : '--';
};

interface WindCompassProps {
  direction: number; // 0-360 degrees
  speed: number;
  gust?: number;
  unit?: string;
}

const getCardinalDirection = (degrees: number): string => {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
};

export function WindCompass({ direction, speed, gust, unit = "m/s" }: WindCompassProps) {
  const cardinal = getCardinalDirection(direction);
  const displayDirection = Math.round(direction); // No decimal places
  
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-normal">Wind Direction</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center p-4">
        {/* Compass Container */}
        <div className="relative w-48 h-48 sm:w-56 sm:h-56">
          {/* Outer Ring */}
          <svg viewBox="0 0 200 200" className="w-full h-full">
            {/* Background circle */}
            <circle 
              cx="100" 
              cy="100" 
              r="90" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              className="text-muted-foreground/20"
            />
            
            {/* Degree markers */}
            {Array.from({ length: 72 }, (_, i) => {
              const angle = i * 5;
              const radian = (angle - 90) * (Math.PI / 180);
              const isCardinal = angle % 90 === 0;
              const isIntercardinal = angle % 45 === 0 && !isCardinal;
              const isMajor = angle % 30 === 0;
              
              const innerR = isCardinal ? 70 : isIntercardinal ? 75 : isMajor ? 80 : 85;
              const outerR = 90;
              
              return (
                <line
                  key={i}
                  x1={100 + innerR * Math.cos(radian)}
                  y1={100 + innerR * Math.sin(radian)}
                  x2={100 + outerR * Math.cos(radian)}
                  y2={100 + outerR * Math.sin(radian)}
                  stroke="currentColor"
                  strokeWidth={isCardinal ? 2 : isIntercardinal ? 1.5 : 1}
                  className={isCardinal || isIntercardinal ? "text-foreground/60" : "text-muted-foreground/30"}
                />
              );
            })}
            
            {/* Cardinal direction labels */}
            {[
              { label: 'N', angle: 0 },
              { label: 'E', angle: 90 },
              { label: 'S', angle: 180 },
              { label: 'W', angle: 270 },
            ].map(({ label, angle }) => {
              const radian = (angle - 90) * (Math.PI / 180);
              const r = 60;
              return (
                <text
                  key={label}
                  x={100 + r * Math.cos(radian)}
                  y={100 + r * Math.sin(radian)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-foreground font-bold text-sm"
                  fontSize="14"
                >
                  {label}
                </text>
              );
            })}
            
            {/* Intercardinal direction labels */}
            {[
              { label: 'NE', angle: 45 },
              { label: 'SE', angle: 135 },
              { label: 'SW', angle: 225 },
              { label: 'NW', angle: 315 },
            ].map(({ label, angle }) => {
              const radian = (angle - 90) * (Math.PI / 180);
              const r = 60;
              return (
                <text
                  key={label}
                  x={100 + r * Math.cos(radian)}
                  y={100 + r * Math.sin(radian)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-muted-foreground text-xs"
                  fontSize="10"
                >
                  {label}
                </text>
              );
            })}
            
            {/* Center circle */}
            <circle 
              cx="100" 
              cy="100" 
              r="8" 
              className="fill-primary"
            />
            
            {/* Wind direction arrow */}
            <g transform={`rotate(${direction}, 100, 100)`}>
              {/* Arrow shaft */}
              <line
                x1="100"
                y1="100"
                x2="100"
                y2="25"
                stroke="currentColor"
                strokeWidth="3"
                className="text-primary"
                strokeLinecap="round"
              />
              {/* Arrow head */}
              <polygon
                points="100,15 92,35 108,35"
                className="fill-primary"
              />
              {/* Arrow tail (wind comes FROM this direction) */}
              <line
                x1="100"
                y1="100"
                x2="100"
                y2="130"
                stroke="currentColor"
                strokeWidth="2"
                className="text-primary/50"
                strokeLinecap="round"
              />
            </g>
          </svg>
        </div>
        
        {/* Wind info below compass */}
        <div className="mt-4 text-center space-y-1">
          <div className="flex items-baseline justify-center gap-2">
            <span className="text-3xl font-normal">{displayDirection}°</span>
            <span className="text-xl font-normal text-primary">{cardinal}</span>
          </div>
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <span>Speed: <span className="font-normal text-foreground">{safeFixed(speed, 1)} {unit}</span></span>
            {gust !== undefined && (
              <span>Gust: <span className="font-normal text-foreground">{safeFixed(gust, 1)} {unit}</span></span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
