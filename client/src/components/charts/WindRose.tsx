import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  WIND_DIRECTIONS, 
  WMO_SIMPLIFIED_CLASSES, 
  getWindDescription,
  type WindSpeedClass 
} from "@/lib/windConstants";

interface WindRoseData {
  direction: number;
  speeds: number[];
}

interface WindRoseProps {
  data: WindRoseData[];
  speedClasses?: WindSpeedClass[];
  title?: string;
  maxWindSpeed?: number;
  showWMOInfo?: boolean;
}

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
    dominantDirection: WIND_DIRECTIONS[dominantDirection],
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
          {WIND_DIRECTIONS.map((dir, i) => {
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

// Re-export constants from shared module for backward compatibility
export { WMO_SPEED_CLASSES, WMO_SIMPLIFIED_CLASSES, getWindDescription } from "@/lib/windConstants";
