import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMemo } from "react";
import { safeFixed } from "@/lib/utils";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

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

// Direction labels for 16-point compass
const DIRECTION_LABELS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

// Direction labels for 8-point compass (simpler view)
const DIRECTION_LABELS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Convert degrees to compass direction
 */
const degreesToDirection = (degrees: number): string => {
  const index = Math.round(degrees / 22.5) % 16;
  return DIRECTION_LABELS[index];
};

/**
 * Get 8-point direction index from degrees
 */
const degreesToIndex8 = (degrees: number): number => {
  return Math.round(degrees / 45) % 8;
};

/**
 * Get color based on frequency percentage
 */
const getFrequencyColor = (percentage: number): string => {
  if (percentage >= 25) return '#ef4444'; // Red - Very frequent
  if (percentage >= 15) return '#f97316'; // Orange - Frequent
  if (percentage >= 10) return '#eab308'; // Yellow - Moderate
  if (percentage >= 5) return '#22c55e';  // Green - Some
  return '#3b82f6'; // Blue - Rare
};

export function WindDirectionChart({
  currentDirection,
  currentSpeed,
  historicalData = [],
  period = "Today",
}: WindDirectionChartProps) {
  // Check if we have valid data
  const hasData = currentDirection !== null && currentDirection !== undefined;

  // Calculate direction frequency distribution
  const directionStats = useMemo(() => {
    if (!hasData && historicalData.length === 0) {
      return {
        distribution: DIRECTION_LABELS_8.map(dir => ({ direction: dir, frequency: 0, percentage: 0 })),
        dominantDirection: 'N/A',
        dominantPercentage: 0,
        totalObservations: 0,
      };
    }

    // Initialize counts for 8 directions
    const counts: number[] = new Array(8).fill(0);
    let totalCount = 0;

    // Count from historical data if available
    if (historicalData.length > 0) {
      historicalData.forEach(d => {
        if (d.windDirection !== null && d.windDirection !== undefined) {
          const index = degreesToIndex8(d.windDirection);
          counts[index]++;
          totalCount++;
        }
      });
    } else if (hasData) {
      // Use current direction as single data point
      const index = degreesToIndex8(currentDirection!);
      counts[index] = 1;
      totalCount = 1;
    }

    // Calculate percentages
    const distribution = DIRECTION_LABELS_8.map((dir, idx) => ({
      direction: dir,
      frequency: counts[idx],
      percentage: totalCount > 0 ? (counts[idx] / totalCount) * 100 : 0,
    }));

    // Find dominant direction
    const maxIndex = counts.indexOf(Math.max(...counts));
    const dominantDirection = DIRECTION_LABELS_8[maxIndex];
    const dominantPercentage = totalCount > 0 ? (counts[maxIndex] / totalCount) * 100 : 0;

    return {
      distribution,
      dominantDirection,
      dominantPercentage,
      totalObservations: totalCount,
    };
  }, [currentDirection, hasData, historicalData]);

  // Radar chart data
  const radarData = useMemo(() => {
    return directionStats.distribution.map(d => ({
      direction: d.direction,
      frequency: d.percentage,
      fullMark: 100,
    }));
  }, [directionStats.distribution]);

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
          Wind Direction Distribution
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
                <p className="text-sm font-medium text-gray-900">{safeFixed(currentSpeed, 1)} km/h</p>
                <p className="text-xs text-muted-foreground">Current Speed</p>
              </div>
            )}
          </div>

          {/* Dominant Direction Info */}
          <div className="flex items-center gap-4 p-3 rounded-lg border border-gray-200 bg-gray-50">
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-600">Dominant Direction</p>
              <p className="text-lg font-semibold text-gray-900">
                {directionStats.dominantDirection}
              </p>
            </div>
            <div className="flex-1 text-right">
              <p className="text-xs font-medium text-gray-600">Frequency</p>
              <p className="text-lg font-semibold text-gray-900">
                {safeFixed(directionStats.dominantPercentage, 1)}%
              </p>
            </div>
            <div className="flex-1 text-right">
              <p className="text-xs font-medium text-gray-600">Observations</p>
              <p className="text-lg font-semibold text-gray-900">
                {directionStats.totalObservations}
              </p>
            </div>
          </div>

          {/* Radar Chart - Wind Rose Style */}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis
                  dataKey="direction"
                  tick={{ fontSize: 11, fill: '#374151' }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, Math.max(30, Math.ceil(Math.max(...radarData.map(d => d.frequency)) / 10) * 10)]}
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Radar
                  name="Wind Frequency"
                  dataKey="frequency"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.5}
                  strokeWidth={2}
                />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)}%`, 'Frequency']}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* Bar Chart - Direction Breakdown */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">Direction Breakdown</p>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={directionStats.distribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="direction"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'Frequency']}
                    labelFormatter={(label) => `Direction: ${label}`}
                  />
                  <Bar
                    dataKey="percentage"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Direction Legend */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {directionStats.distribution.map((d) => (
              <div
                key={d.direction}
                className="rounded-lg border border-gray-200 p-2"
                style={{ backgroundColor: `${getFrequencyColor(d.percentage)}10` }}
              >
                <p className="text-xs font-semibold" style={{ color: getFrequencyColor(d.percentage) }}>
                  {d.direction}
                </p>
                <p className="text-[10px] text-gray-600">
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
