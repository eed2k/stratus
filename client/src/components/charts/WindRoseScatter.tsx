// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useMemo, useRef, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeFixed } from "@/lib/utils";
import { exportChartPng } from "@/lib/svgChartExport";
import { WIND_DIRECTIONS, getSpeedColor, getWindUnitLabel, getFullSpeedClasses, type WindSpeedUnit } from "@/lib/windConstants";

/**
 * Wind speed scatter point data - individual wind observations
 */
interface WindSpeedPoint {
  direction: number; // degrees (0-360)
  speed: number; // m/s
  timestamp?: Date;
}

interface WindRoseScatterProps {
  data: WindSpeedPoint[];
  title?: string;
  maxWindSpeed?: number;
  showLegend?: boolean;
  windSpeedUnit?: WindSpeedUnit;
}

/**
 * Calculate wind statistics from scatter data
 */
const calculateScatterStats = (data: WindSpeedPoint[]) => {
  if (data.length === 0) {
    return {
      avgSpeed: 0,
      maxSpeed: 0,
      minSpeed: 0,
      observations: 0,
      dominantDirection: "N",
    };
  }

  const speeds = data.map(d => d.speed);
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const maxSpeed = Math.max(...speeds);
  const minSpeed = Math.min(...speeds);

  // Find dominant direction by binning
  const dirBins = new Array(16).fill(0);
  data.forEach(d => {
    const binIndex = Math.round(d.direction / 22.5) % 16;
    dirBins[binIndex]++;
  });
  const dominantIndex = dirBins.indexOf(Math.max(...dirBins));

  return {
    avgSpeed,
    maxSpeed,
    minSpeed,
    observations: data.length,
    dominantDirection: WIND_DIRECTIONS[dominantIndex],
  };
};

/**
 * WindRoseScatter - Displays wind speed observations as colored dots on a polar chart
 * 
 * This component shows individual wind measurements plotted on a polar coordinate system
 * where the angle represents wind direction and the radius represents wind speed.
 * Points are color-coded according to WMO/Beaufort wind speed classifications.
 */
export const WindRoseScatter = memo(function WindRoseScatter({ 
  data, 
  title = "Wind Speed Scatter", 
  maxWindSpeed,
  showLegend = true,
  windSpeedUnit = 'ms',
}: WindRoseScatterProps) {
  const unitLabel = getWindUnitLabel(windSpeedUnit);
  const speedClasses = getFullSpeedClasses(windSpeedUnit);
  // Calculate max speed for scaling
  const calculatedMaxSpeed = useMemo(() => {
    if (maxWindSpeed !== undefined) return maxWindSpeed;
    if (data.length === 0) return 50;
    return Math.max(...data.map(d => d.speed), 20) * 1.1;
  }, [data, maxWindSpeed]);

  // Calculate statistics
  const stats = useMemo(() => calculateScatterStats(data), [data]);

  // Identify which speed classes are present in data
  const activeClasses = useMemo(() => {
    const present = new Set<number>();
    data.forEach(d => {
      const idx = speedClasses.findIndex(c => d.speed >= c.min && d.speed < c.max);
      if (idx >= 0) present.add(idx);
    });
    return speedClasses.filter((_, i) => present.has(i));
  }, [data, speedClasses]);

  const size = 320;
  const center = size / 2;
  const maxRadius = size / 2 - 45;

  const cardRef = useRef<HTMLDivElement>(null);

  const handleExportImage = useCallback(() => {
    const svgEl = cardRef.current?.querySelector('svg[data-windrose-scatter]') as SVGSVGElement | null;
    if (!svgEl) return;

    // The stat tiles and legend live in the DOM next to the plot, so they are
    // rebuilt inside the exported image here.
    const statLines = [
      `Avg: ${safeFixed(stats.avgSpeed, 1)} ${unitLabel}   |   Max: ${safeFixed(stats.maxSpeed, 1)} ${unitLabel}   |   Min: ${safeFixed(stats.minSpeed, 1)} ${unitLabel}`,
      `Dominant: ${stats.dominantDirection}   |   Observations: ${stats.observations}`,
    ];

    exportChartPng({
      svg: svgEl,
      title,
      width: size,
      height: size,
      stats: statLines,
      legend: showLegend
        ? activeClasses.map((sc) => ({ label: sc.label, color: sc.color, shape: 'circle' as const }))
        : [],
      captions: [`Radius = wind speed (${unitLabel}), angle = direction of origin. Point colour follows the WMO/Beaufort class.`],
      filename: title,
    });
  }, [title, size, stats, unitLabel, showLegend, activeClasses]);

  // Convert polar to cartesian coordinates - clamp to stay inside circle
  const polarToCart = (direction: number, speed: number, clampToCircle: boolean = false) => {
    // Direction: 0° = North (up), clockwise
    const rad = ((direction - 90) * Math.PI) / 180;
    let radius = (speed / calculatedMaxSpeed) * maxRadius;
    // Clamp radius to ensure points stay inside the outer circle
    if (clampToCircle) {
      radius = Math.min(radius, maxRadius);
    }
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  // Generate speed circles for legend
  const speedCircles = useMemo(() => {
    const circles = [];
    const step = calculatedMaxSpeed / 4;
    for (let i = 1; i <= 4; i++) {
      circles.push({
        speed: step * i,
        radius: (step * i / calculatedMaxSpeed) * maxRadius,
      });
    }
    return circles;
  }, [calculatedMaxSpeed, maxRadius]);

  return (
    <Card data-testid="card-wind-rose-scatter" ref={cardRef}>
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
            <Badge variant="outline" className="text-xs">
              {stats.observations} points
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg data-windrose-scatter width={size} height={size} className="overflow-visible">
          {/* Background circles with speed labels */}
          {speedCircles.map((circle, i) => (
            <g key={i}>
              <circle
                cx={center}
                cy={center}
                r={circle.radius}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={1}
                strokeDasharray={i === speedCircles.length - 1 ? "none" : "4 4"}
              />
              <text
                x={center + 5}
                y={center - circle.radius + 12}
                className="fill-muted-foreground text-xs"
              >
                {safeFixed(circle.speed, 0)} {unitLabel}
              </text>
            </g>
          ))}

          {/* Direction labels (no radial lines) */}
          {WIND_DIRECTIONS.map((dir, i) => {
            const angle = i * 22.5;
            const labelPos = polarToCart(angle, calculatedMaxSpeed * 1.15);
            const isCardinal = i % 4 === 0;
            
            return (
              <g key={dir}>
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`fill-foreground ${isCardinal ? 'text-xs font-medium' : 'text-xs'}`}
                >
                  {dir}
                </text>
              </g>
            );
          })}

          {/* Data points - colored by speed, clamped to circle boundary */}
          {data.map((point, i) => {
            const pos = polarToCart(point.direction, point.speed, true); // Clamp to circle
            const color = getSpeedColor(point.speed, windSpeedUnit);
            return (
              <circle
                key={i}
                cx={pos.x}
                cy={pos.y}
                r={3}
                fill={color}
                stroke="white"
                strokeWidth={0.5}
                opacity={0.85}
                className="transition-opacity hover:opacity-100"
              >
                <title>
                  {safeFixed(point.speed, 1)} {unitLabel} @ {safeFixed(point.direction, 0)}°
                  {point.timestamp && `\n${point.timestamp.toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false })}`}
                </title>
              </circle>
            );
          })}

          {/* Center dot */}
          <circle
            cx={center}
            cy={center}
            r={4}
            fill="currentColor"
            className="text-black/50"
          />
        </svg>

        {/* Statistics */}
        <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-center w-full">
          <div className="rounded bg-muted/50 p-2">
            <div className="text-black">Avg</div>
            <div className="font-normal">{safeFixed(stats.avgSpeed, 1)} {unitLabel}</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-black">Max</div>
            <div className="font-normal">{safeFixed(stats.maxSpeed, 1)} {unitLabel}</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-black">Min</div>
            <div className="font-normal">{safeFixed(stats.minSpeed, 1)} {unitLabel}</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-black">Dominant</div>
            <div className="font-normal">{stats.dominantDirection}</div>
          </div>
        </div>

        {/* Legend */}
        {showLegend && activeClasses.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1">
            {activeClasses.map((sc) => (
              <div key={sc.label} className="flex items-center gap-1 text-xs">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: sc.color }}
                />
                <span className="text-black">{sc.label}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
);

// Re-export constants from shared module for backward compatibility
export { WMO_SPEED_CLASSES as SPEED_COLOR_CLASSES, getSpeedColor } from "@/lib/windConstants";
