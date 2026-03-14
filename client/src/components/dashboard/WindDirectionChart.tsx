// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { safeFixed } from "@/lib/utils";

interface WindDirectionChartProps {
  /** Current wind direction in degrees (0-360) */
  currentDirection: number | null | undefined;
  /** Current wind speed */
  currentSpeed?: number | null;
  /** Historical wind direction data */
  historicalData?: Array<{
    timestamp: string;
    windDirection: number;
    windSpeed?: number;
  }>;
  /** Time period label */
  period?: string;
}

// 16-point compass for degree conversion
const DIRECTION_LABELS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// 8-point compass directions for the wind rose (WMO standard)
const DIRECTION_LABELS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Angles for 8-point compass (clockwise from North)
const DIRECTION_ANGLES_8 = [0, 45, 90, 135, 180, 225, 270, 315];

const degreesToDirection = (degrees: number): string => {
  const index = Math.round(degrees / 22.5) % 16;
  return DIRECTION_LABELS_16[index];
};

const degreesToIndex8 = (degrees: number): number => {
  return Math.round(degrees / 45) % 8;
};

/**
 * WMO-compliant Wind Rose — polar bar chart (SVG)
 * Each bar extends outward from center proportional to frequency %
 * 8 cardinal/intercardinal directions, N at top
 */
function WMOWindRose({ data, maxPercent }: { data: { direction: string; percentage: number }[]; maxPercent: number }) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 105;
  const innerR = 18;
  const labelR = outerR + 16;

  // Scale: maxRadius maps to the rounded-up max percentage
  const scaleMax = Math.max(10, Math.ceil(maxPercent / 10) * 10);

  // Concentric reference rings
  const rings: { r: number; pct: number }[] = [];
  const ringCount = Math.min(4, scaleMax / 10);
  for (let i = 1; i <= ringCount; i++) {
    const r = innerR + ((outerR - innerR) * i) / ringCount;
    const pct = (scaleMax * i) / ringCount;
    rings.push({ r, pct });
  }

  // Bar half-width in degrees
  const barHalfAngle = 18;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" style={{ maxHeight: 260 }}>
      {/* Background circle */}
      <circle cx={cx} cy={cy} r={outerR} fill="#f9fafb" stroke="#e5e7eb" strokeWidth={1} />

      {/* Concentric rings with labels */}
      {rings.map((ring, i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={ring.r} fill="none" stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray="3 3" />
          <text x={cx + 4} y={cy - ring.r + 12} fontSize={8} fill="#9ca3af" fontFamily="Arial, sans-serif">
            {ring.pct}%
          </text>
        </g>
      ))}

      {/* Center circle */}
      <circle cx={cx} cy={cy} r={innerR} fill="white" stroke="#d1d5db" strokeWidth={0.5} />

      {/* Radial guide lines */}
      {DIRECTION_ANGLES_8.map((angle, i) => {
        const rad = ((angle - 90) * Math.PI) / 180;
        const x2 = cx + outerR * Math.cos(rad);
        const y2 = cy + outerR * Math.sin(rad);
        return (
          <line key={i} x1={cx} y1={cy} x2={x2} y2={y2} stroke="#e5e7eb" strokeWidth={0.5} />
        );
      })}

      {/* Frequency bars — polar wedge/sector for each direction */}
      {data.map((d, i) => {
        if (d.percentage <= 0) return null;
        const angleDeg = DIRECTION_ANGLES_8[i];
        const barR = innerR + ((outerR - innerR) * d.percentage) / scaleMax;

        // Build a wedge path (arc sector from innerR to barR)
        const a1 = ((angleDeg - barHalfAngle - 90) * Math.PI) / 180;
        const a2 = ((angleDeg + barHalfAngle - 90) * Math.PI) / 180;

        const x1o = cx + barR * Math.cos(a1);
        const y1o = cy + barR * Math.sin(a1);
        const x2o = cx + barR * Math.cos(a2);
        const y2o = cy + barR * Math.sin(a2);
        const x1i = cx + innerR * Math.cos(a1);
        const y1i = cy + innerR * Math.sin(a1);
        const x2i = cx + innerR * Math.cos(a2);
        const y2i = cy + innerR * Math.sin(a2);

        const largeArc = barHalfAngle * 2 > 180 ? 1 : 0;

        const path = [
          `M ${x1i} ${y1i}`,
          `L ${x1o} ${y1o}`,
          `A ${barR} ${barR} 0 ${largeArc} 1 ${x2o} ${y2o}`,
          `L ${x2i} ${y2i}`,
          `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1i} ${y1i}`,
          'Z',
        ].join(' ');

        // Color: blue gradient by intensity
        const intensity = Math.min(d.percentage / scaleMax, 1);
        const opacity = 0.3 + intensity * 0.6;

        return (
          <path
            key={d.direction}
            d={path}
            fill="#3b82f6"
            fillOpacity={opacity}
            stroke="#2563eb"
            strokeWidth={0.8}
          >
            <title>{d.direction}: {d.percentage.toFixed(1)}%</title>
          </path>
        );
      })}

      {/* Direction labels */}
      {DIRECTION_LABELS_8.map((label, i) => {
        const angleDeg = DIRECTION_ANGLES_8[i];
        const rad = ((angleDeg - 90) * Math.PI) / 180;
        const x = cx + labelR * Math.cos(rad);
        const y = cy + labelR * Math.sin(rad);
        return (
          <text
            key={label}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={11}
            fontWeight={label === 'N' ? 700 : 500}
            fill={label === 'N' ? '#1e3a5f' : '#374151'}
            fontFamily="Arial, sans-serif"
          >
            {label}
          </text>
        );
      })}

      {/* Center label */}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={9} fill="#6b7280" fontFamily="Arial, sans-serif">
        CALM
      </text>
    </svg>
  );
}

export function WindDirectionChart({
  currentDirection,
  currentSpeed,
  historicalData = [],
  period = "Today",
}: WindDirectionChartProps) {
  const hasData = currentDirection !== null && currentDirection !== undefined;

  // Calculate direction frequency distribution
  const directionStats = useMemo(() => {
    if (!hasData && historicalData.length === 0) {
      return {
        distribution: DIRECTION_LABELS_8.map(dir => ({ direction: dir, frequency: 0, percentage: 0 })),
        dominantDirection: 'N/A',
        dominantPercentage: 0,
        totalObservations: 0,
        calmPercentage: 0,
      };
    }

    const counts: number[] = new Array(8).fill(0);
    let totalCount = 0;
    let calmCount = 0;

    if (historicalData.length > 0) {
      historicalData.forEach(d => {
        if (d.windDirection !== null && d.windDirection !== undefined) {
          // WMO: calm = wind speed < 0.5 m/s
          if (d.windSpeed !== undefined && d.windSpeed !== null && d.windSpeed < 0.5) {
            calmCount++;
          } else {
            const index = degreesToIndex8(d.windDirection);
            counts[index]++;
          }
          totalCount++;
        }
      });
    } else if (hasData) {
      const index = degreesToIndex8(currentDirection!);
      counts[index] = 1;
      totalCount = 1;
    }

    const distribution = DIRECTION_LABELS_8.map((dir, idx) => ({
      direction: dir,
      frequency: counts[idx],
      percentage: totalCount > 0 ? (counts[idx] / totalCount) * 100 : 0,
    }));

    const maxIndex = counts.indexOf(Math.max(...counts));
    const dominantDirection = DIRECTION_LABELS_8[maxIndex];
    const dominantPercentage = totalCount > 0 ? (counts[maxIndex] / totalCount) * 100 : 0;

    return {
      distribution,
      dominantDirection,
      dominantPercentage,
      totalObservations: totalCount,
      calmPercentage: totalCount > 0 ? (calmCount / totalCount) * 100 : 0,
    };
  }, [currentDirection, hasData, historicalData]);

  const maxPercent = Math.max(...directionStats.distribution.map(d => d.percentage), 5);

  // No data state
  if (!hasData && historicalData.length === 0) {
    return (
      <Card className="border border-gray-300 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Wind Direction Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm font-medium text-muted-foreground">No Data</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Wind direction data is not available for this station
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-gray-300 bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Wind Rose
          <Badge variant="outline" className="ml-auto text-xs">
            {period}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Current Direction Display */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {hasData ? degreesToDirection(currentDirection!) : '--'}
              </span>
              <span className="text-sm font-normal text-muted-foreground" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                ({hasData ? `${safeFixed(currentDirection, 0)}°` : '--'})
              </span>
            </div>
            {currentSpeed !== null && currentSpeed !== undefined && (
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>{safeFixed(currentSpeed, 1)} m/s</p>
                <p className="text-xs text-muted-foreground" style={{ fontFamily: 'Arial, sans-serif' }}>Current Speed</p>
              </div>
            )}
          </div>

          {/* Stats Bar */}
          <div className="flex items-center gap-4 p-3 rounded-lg border border-gray-200 bg-gray-50">
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-600" style={{ fontFamily: 'Arial, sans-serif' }}>Dominant</p>
              <p className="text-lg font-semibold text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>
                {directionStats.dominantDirection}
              </p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-xs font-medium text-gray-600" style={{ fontFamily: 'Arial, sans-serif' }}>Frequency</p>
              <p className="text-lg font-semibold text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>
                {safeFixed(directionStats.dominantPercentage, 1)}%
              </p>
            </div>
            <div className="flex-1 text-right">
              <p className="text-xs font-medium text-gray-600" style={{ fontFamily: 'Arial, sans-serif' }}>Obs</p>
              <p className="text-lg font-semibold text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>
                {directionStats.totalObservations}
              </p>
            </div>
            {directionStats.calmPercentage > 0 && (
              <div className="flex-1 text-right">
                <p className="text-xs font-medium text-gray-600" style={{ fontFamily: 'Arial, sans-serif' }}>Calm</p>
                <p className="text-lg font-semibold text-gray-900" style={{ fontFamily: 'Arial, sans-serif' }}>
                  {safeFixed(directionStats.calmPercentage, 1)}%
                </p>
              </div>
            )}
          </div>

          {/* WMO Wind Rose (polar bar chart) */}
          <div className="flex justify-center">
            <WMOWindRose data={directionStats.distribution} maxPercent={maxPercent} />
          </div>

          {/* Direction frequency legend — compact grid */}
          <div className="grid grid-cols-4 gap-1.5 text-center">
            {directionStats.distribution.map((d) => (
              <div
                key={d.direction}
                className="rounded border border-gray-200 px-2 py-1"
              >
                <p className="text-xs font-semibold text-gray-700" style={{ fontFamily: 'Arial, sans-serif' }}>
                  {d.direction}
                </p>
                <p className="text-[10px] text-gray-500" style={{ fontFamily: 'Arial, sans-serif' }}>
                  {safeFixed(d.percentage, 1)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
