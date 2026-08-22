// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useMemo, useRef, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeFixed } from "@/lib/utils";
import { exportChartPng } from "@/lib/svgChartExport";
import { 
  WIND_DIRECTIONS, 
  getWindDescription,
  getWindUnitLabel,
  getSimplifiedClasses,
  type WindSpeedClass,
  type WindSpeedUnit,
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
  windSpeedUnit?: WindSpeedUnit;
  size?: number;
  bare?: boolean; // render only the rose svg + small title (for compact layouts)
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
    calmPercentage: totalObservations > 0 ? safeFixed((calmObservations / totalObservations) * 100, 1) : "0",
    dominantDirection: WIND_DIRECTIONS[dominantDirection],
    dominantPercentage: totalObservations > 0 ? safeFixed((maxDirectionCount / totalObservations) * 100, 1) : "0",
  };
};

export const WindRose = memo(function WindRose({
  data,
  speedClasses,
  title = "Wind Rose",
  maxWindSpeed,
  showWMOInfo = true,
  windSpeedUnit = 'ms',
  size: sizeProp,
  bare = false,
}: WindRoseProps) {
  const unitLabel = getWindUnitLabel(windSpeedUnit);
  // Calculate max wind speed from data if not provided
  const calculatedMaxSpeed = useMemo(() => {
    if (maxWindSpeed !== undefined) return maxWindSpeed;
    
    let maxSpeed = 0;
    const classes = getSimplifiedClasses(windSpeedUnit);
    data.forEach(d => {
      d.speeds.forEach((count, idx) => {
        if (count > 0) {
          const classMax = classes[idx]?.max || 100;
          if (classMax !== Infinity && classMax > maxSpeed) {
            maxSpeed = classMax;
          }
        }
      });
    });
    return maxSpeed || 50;
  }, [data, maxWindSpeed, windSpeedUnit]);

  // Use WMO simplified classes by default
  const activeSpeedClasses = useMemo(() => {
    return speedClasses || getSimplifiedClasses(windSpeedUnit);
  }, [speedClasses, windSpeedUnit]);

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

  const size = sizeProp ?? 320;
  const center = size / 2;
  const maxRadius = size / 2 - 40;

  const cardRef = useRef<HTMLDivElement>(null);

  const handleExportImage = useCallback(() => {
    const svgEl = cardRef.current?.querySelector('svg[data-windrose]') as SVGSVGElement | null;
    if (!svgEl) return;

    // Stats + legend are DOM siblings of the plot, so they are passed in
    // explicitly and drawn into the exported image.
    const stats: string[] = [];
    if (showWMOInfo) {
      stats.push(`Dominant: ${windStats.dominantDirection} (${windStats.dominantPercentage}%)   |   Calm: ${windStats.calmPercentage}%`);
    }
    stats.push(`Max: ${safeFixed(calculatedMaxSpeed, 1)} ${unitLabel} (${getWindDescription(calculatedMaxSpeed, windSpeedUnit)})`);

    exportChartPng({
      svg: svgEl,
      title,
      width: size,
      height: size,
      stats,
      legend: activeSpeedClasses.map((sc) => ({ label: sc.label, color: sc.color, shape: 'rect' as const })),
      captions: [`Wind speed classes in ${unitLabel}. Petal length = frequency of observations per direction.`],
      filename: title,
    });
  }, [title, size, activeSpeedClasses, windStats, showWMOInfo, calculatedMaxSpeed, unitLabel, windSpeedUnit]);

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

  if (bare) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full">
        <div className="text-xs text-black font-medium mb-0.5">{title}</div>
        <svg data-windrose width={size} height={size} className="overflow-visible">
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <g key={ratio}>
              <circle cx={center} cy={center} r={maxRadius * ratio} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />
              <text x={center + 5} y={center - maxRadius * ratio + 12} className="fill-muted-foreground text-xs">{safeFixed(ratio * 100, 0)}%</text>
            </g>
          ))}
          {WIND_DIRECTIONS.map((dir, i) => {
            const pos = polarToCart(i * 22.5, maxRadius + 20);
            return (<text key={dir} x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-xs font-normal">{dir}</text>);
          })}
          {data.map((d, dirIndex) => {
            let currentRadius = 0;
            return d.speeds.map((count, speedIndex) => {
              const roundedCount = Number(safeFixed(count, 3));
              const innerRadius = currentRadius;
              const height = (roundedCount / maxValue) * maxRadius;
              currentRadius += height;
              if (roundedCount === 0) return null;
              return (<path key={`${dirIndex}-${speedIndex}`} d={createWedge(dirIndex, innerRadius, currentRadius)} fill={activeSpeedClasses[speedIndex]?.color || "#3b82f6"} stroke="white" strokeWidth={0.5} opacity={0.85} />);
            });
          })}
          <circle cx={center} cy={center} r={8} fill="currentColor" className="text-black/30" />
        </svg>
      </div>
    );
  }

  return (
    <Card ref={cardRef} data-testid="card-wind-rose">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-black hover:text-foreground"
              onClick={handleExportImage}
              title="Export as image"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              PNG
            </Button>
            {showWMOInfo && (
              <Badge variant="outline" className="text-xs">WMO/Beaufort</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg data-windrose width={size} height={size} className="overflow-visible">
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
                className="fill-muted-foreground text-xs"
              >
                {safeFixed(ratio * 100, 0)}%
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
              const roundedCount = Number(safeFixed(count, 3));
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
            className="text-black/30"
          />
        </svg>

        {/* Wind Statistics */}
        {showWMOInfo && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-center w-full">
            <div className="rounded bg-muted/50 p-2">
              <div className="text-black">Dominant</div>
              <div className="font-normal">{windStats.dominantDirection} ({windStats.dominantPercentage}%)</div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-black">Calm</div>
              <div className="font-normal">{windStats.calmPercentage}%</div>
            </div>
          </div>
        )}

        {/* Max wind speed and current classification */}
        <div className="mt-2 text-center text-xs text-black">
          Max: {safeFixed(calculatedMaxSpeed, 1)} {unitLabel} ({getWindDescription(calculatedMaxSpeed, windSpeedUnit)})
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {activeSpeedClasses.map((sc) => (
            <div key={sc.label} className="flex items-center gap-1 text-xs">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: sc.color }}
              />
              <span className="text-black">{sc.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
);

// Re-export constants from shared module for backward compatibility
export { WMO_SPEED_CLASSES, WMO_SIMPLIFIED_CLASSES, getWindDescription } from "@/lib/windConstants";
