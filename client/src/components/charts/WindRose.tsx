import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface WindRoseData {
  direction: number;
  speeds: number[];
}

interface WindRoseProps {
  data: WindRoseData[];
  speedClasses?: { min: number; max: number; color: string; label: string; beaufort: string }[];
  title?: string;
  maxWindSpeed?: number;
  showWMOInfo?: boolean;
}

/**
 * WMO (World Meteorological Organization) Standard Wind Speed Classes
 * Based on the Beaufort Scale with metric (km/h) values
 * Reference: WMO-No. 8, Guide to Meteorological Instruments and Methods of Observation
 */
const WMO_SPEED_CLASSES = [
  { min: 0, max: 1, color: "#e0f2fe", label: "Calm", beaufort: "0", description: "Smoke rises vertically" },
  { min: 1, max: 6, color: "#bae6fd", label: "Light Air", beaufort: "1", description: "Direction shown by smoke drift" },
  { min: 6, max: 12, color: "#7dd3fc", label: "Light Breeze", beaufort: "2", description: "Wind felt on face, leaves rustle" },
  { min: 12, max: 20, color: "#38bdf8", label: "Gentle Breeze", beaufort: "3", description: "Leaves and small twigs in motion" },
  { min: 20, max: 29, color: "#0ea5e9", label: "Moderate Breeze", beaufort: "4", description: "Raises dust and loose paper" },
  { min: 29, max: 39, color: "#0284c7", label: "Fresh Breeze", beaufort: "5", description: "Small trees begin to sway" },
  { min: 39, max: 50, color: "#22c55e", label: "Strong Breeze", beaufort: "6", description: "Large branches in motion" },
  { min: 50, max: 62, color: "#eab308", label: "Near Gale", beaufort: "7", description: "Whole trees in motion" },
  { min: 62, max: 75, color: "#f97316", label: "Gale", beaufort: "8", description: "Twigs break off trees" },
  { min: 75, max: 89, color: "#ef4444", label: "Strong Gale", beaufort: "9", description: "Slight structural damage" },
  { min: 89, max: 103, color: "#dc2626", label: "Storm", beaufort: "10", description: "Trees uprooted" },
  { min: 103, max: 118, color: "#b91c1c", label: "Violent Storm", beaufort: "11", description: "Widespread damage" },
  { min: 118, max: Infinity, color: "#7f1d1d", label: "Hurricane", beaufort: "12", description: "Devastating damage" },
];

/**
 * Simplified WMO classes for wind rose display (6 categories)
 */
const WMO_SIMPLIFIED_CLASSES = [
  { min: 0, max: 6, color: "#bae6fd", label: "Calm/Light (0-6 km/h)", beaufort: "0-1" },
  { min: 6, max: 20, color: "#38bdf8", label: "Light/Gentle (6-20 km/h)", beaufort: "2-3" },
  { min: 20, max: 39, color: "#0284c7", label: "Moderate/Fresh (20-39 km/h)", beaufort: "4-5" },
  { min: 39, max: 62, color: "#22c55e", label: "Strong/Near Gale (39-62 km/h)", beaufort: "6-7" },
  { min: 62, max: 89, color: "#f97316", label: "Gale/Strong Gale (62-89 km/h)", beaufort: "8-9" },
  { min: 89, max: Infinity, color: "#dc2626", label: "Storm+ (>89 km/h)", beaufort: "10+" },
];

const DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/**
 * Get wind description based on WMO Beaufort scale
 */
const getWindDescription = (speed: number): string => {
  const wmoClass = WMO_SPEED_CLASSES.find(c => speed >= c.min && speed < c.max);
  return wmoClass?.label || "Unknown";
};

/**
 * Calculate wind statistics from data
 */
const calculateWindStats = (data: WindRoseData[]) => {
  let totalObservations = 0;
  let calmObservations = 0;
  let dominantDirection = 0;
  let maxDirectionCount = 0;

  data.forEach((d, idx) => {
    const total = d.speeds.reduce((a, b) => a + b, 0);
    totalObservations += total;
    calmObservations += d.speeds[0] || 0; // First speed class is typically calm
    
    if (total > maxDirectionCount) {
      maxDirectionCount = total;
      dominantDirection = idx;
    }
  });

  return {
    totalObservations,
    calmPercentage: totalObservations > 0 ? ((calmObservations / totalObservations) * 100).toFixed(1) : "0",
    dominantDirection: DIRECTIONS[dominantDirection],
    dominantPercentage: totalObservations > 0 ? ((maxDirectionCount / totalObservations) * 100).toFixed(1) : "0",
  };
};

export function WindRose({ 
  data, 
  speedClasses, 
  title = "Wind Rose", 
  maxWindSpeed,
  showWMOInfo = true 
}: WindRoseProps) {
  // Calculate max wind speed from data if not provided
  const calculatedMaxSpeed = useMemo(() => {
    if (maxWindSpeed !== undefined) return maxWindSpeed;
    
    let maxSpeed = 0;
    data.forEach(d => {
      d.speeds.forEach((count, idx) => {
        if (count > 0) {
          const classMax = WMO_SIMPLIFIED_CLASSES[idx]?.max || 100;
          if (classMax !== Infinity && classMax > maxSpeed) {
            maxSpeed = classMax;
          }
        }
      });
    });
    return maxSpeed || 50;
  }, [data, maxWindSpeed]);

  // Use WMO simplified classes by default
  const activeSpeedClasses = useMemo(() => {
    return speedClasses || WMO_SIMPLIFIED_CLASSES;
  }, [speedClasses]);

  // Calculate wind statistics
  const windStats = useMemo(() => calculateWindStats(data), [data]);

  const maxValue = useMemo(() => {
    let max = 0;
    data.forEach(d => {
      const total = d.speeds.reduce((a, b) => a + b, 0);
      if (total > max) max = total;
    });
    return max || 1;
  }, [data]);

  const size = 320;
  const center = size / 2;
  const maxRadius = size / 2 - 40;

  const polarToCart = (angle: number, radius: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  const createWedge = (dirIndex: number, innerRadius: number, outerRadius: number) => {
    const angleStart = dirIndex * 22.5 - 11.25;
    const angleEnd = dirIndex * 22.5 + 11.25;

    const p1 = polarToCart(angleStart, innerRadius);
    const p2 = polarToCart(angleStart, outerRadius);
    const p3 = polarToCart(angleEnd, outerRadius);
    const p4 = polarToCart(angleEnd, innerRadius);

    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${outerRadius} ${outerRadius} 0 0 1 ${p3.x} ${p3.y} L ${p4.x} ${p4.y} A ${innerRadius} ${innerRadius} 0 0 0 ${p1.x} ${p1.y} Z`;
  };

  return (
    <Card data-testid="card-wind-rose">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal">{title}</CardTitle>
          {showWMOInfo && (
            <Badge variant="outline" className="text-xs">WMO/Beaufort</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg width={size} height={size} className="overflow-visible">
          {/* Concentric circles with percentage labels */}
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <g key={ratio}>
              <circle
                cx={center}
                cy={center}
                r={maxRadius * ratio}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeWidth={1}
              />
              <text
                x={center + 5}
                y={center - maxRadius * ratio + 12}
                className="fill-muted-foreground text-[10px]"
              >
                {(ratio * 100).toFixed(0)}%
              </text>
            </g>
          ))}

          {/* Direction labels */}
          {DIRECTIONS.map((dir, i) => {
            const angle = i * 22.5;
            const pos = polarToCart(angle, maxRadius + 20);
            return (
              <text
                key={dir}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-xs font-normal"
              >
                {dir}
              </text>
            );
          })}

          {/* Wind rose petals */}
          {data.map((d, dirIndex) => {
            let currentRadius = 0;
            return d.speeds.map((count, speedIndex) => {
              const roundedCount = Number(count.toFixed(3));
              const innerRadius = currentRadius;
              const height = (roundedCount / maxValue) * maxRadius;
              currentRadius += height;

              if (roundedCount === 0) return null;

              return (
                <path
                  key={`${dirIndex}-${speedIndex}`}
                  d={createWedge(dirIndex, innerRadius, currentRadius)}
                  fill={activeSpeedClasses[speedIndex]?.color || "#3b82f6"}
                  stroke="white"
                  strokeWidth={0.5}
                  opacity={0.85}
                />
              );
            });
          })}

          {/* Center calm circle */}
          <circle
            cx={center}
            cy={center}
            r={8}
            fill="currentColor"
            className="text-muted-foreground/30"
          />
        </svg>

        {/* Wind Statistics */}
        {showWMOInfo && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-center w-full">
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Dominant</div>
              <div className="font-normal">{windStats.dominantDirection} ({windStats.dominantPercentage}%)</div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Calm</div>
              <div className="font-normal">{windStats.calmPercentage}%</div>
            </div>
          </div>
        )}

        {/* Max wind speed and current classification */}
        <div className="mt-2 text-center text-xs text-muted-foreground">
          Max: {calculatedMaxSpeed.toFixed(1)} km/h ({getWindDescription(calculatedMaxSpeed)})
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {activeSpeedClasses.map((sc) => (
            <div key={sc.label} className="flex items-center gap-1 text-[10px]">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: sc.color }}
              />
              <span className="text-muted-foreground">{sc.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export { WMO_SPEED_CLASSES, WMO_SIMPLIFIED_CLASSES, getWindDescription };
