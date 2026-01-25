import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { Flame } from "lucide-react";
import { FIRE_DANGER_RATINGS, calculateFireDanger, type FireDangerRating } from "@shared/utils/calc";

interface FireDangerDataPoint {
  timestamp: string;
  temperature: number;
  humidity: number;
  windSpeed: number;
  ffdi?: number;
}

interface FireDangerChartProps {
  data: FireDangerDataPoint[];
  title?: string;
  showThresholds?: boolean;
  showStatistics?: boolean;
}

/**
 * Fire Danger Chart
 * 
 * Displays historical South African Fire Danger Index (FDI) values with:
 * - Color-coded danger zone backgrounds
 * - Reference lines for danger thresholds
 * - Statistics (max, min, avg FDI)
 */
export function FireDangerChart({
  data,
  title = "Fire Danger Index History",
  showThresholds = true,
  showStatistics = true,
}: FireDangerChartProps) {
  // Calculate FFDI for each data point
  const chartData = useMemo(() => {
    return data.map(point => {
      const danger = calculateFireDanger(
        point.temperature,
        point.humidity,
        point.windSpeed
      );
      return {
        ...point,
        ffdi: point.ffdi ?? danger.ffdi,
        rating: danger.rating.label,
        color: danger.rating.color,
      };
    });
  }, [data]);

  // Calculate statistics
  const statistics = useMemo(() => {
    if (chartData.length === 0) return null;
    
    const ffdiValues = chartData.map(d => d.ffdi);
    const max = Math.max(...ffdiValues);
    const min = Math.min(...ffdiValues);
    const avg = ffdiValues.reduce((a, b) => a + b, 0) / ffdiValues.length;
    const current = ffdiValues[ffdiValues.length - 1];
    
    // Find peak danger rating
    const peakRating = FIRE_DANGER_RATINGS.find(
      (r: FireDangerRating) => max >= r.minValue && max <= r.maxValue
    ) || FIRE_DANGER_RATINGS[0];
    
    // Count time in each danger zone
    const timeInDanger = FIRE_DANGER_RATINGS.map((rating: FireDangerRating) => ({
      ...rating,
      count: chartData.filter(d => 
        d.ffdi >= rating.minValue && d.ffdi <= rating.maxValue
      ).length,
      percentage: (chartData.filter(d => 
        d.ffdi >= rating.minValue && d.ffdi <= rating.maxValue
      ).length / chartData.length * 100).toFixed(1)
    }));
    
    return {
      max,
      min,
      avg,
      current,
      peakRating,
      timeInDanger,
    };
  }, [chartData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const data = payload[0].payload;
    const rating = FIRE_DANGER_RATINGS.find(
      (r: FireDangerRating) => data.ffdi >= r.minValue && data.ffdi <= r.maxValue
    );
    
    return (
      <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
        <p className="font-medium text-foreground">{label}</p>
        <div className="mt-2 space-y-1">
          <p style={{ color: rating?.color }}>
            <span className="font-semibold">FDI:</span> {data.ffdi.toFixed(1)}
          </p>
          <p style={{ color: rating?.color }}>
            <span className="font-semibold">Rating:</span> {rating?.label}
          </p>
          <div className="border-t pt-1 mt-1 text-muted-foreground">
            <p>Temp: {data.temperature.toFixed(1)}°C</p>
            <p>Humidity: {data.humidity.toFixed(0)}%</p>
            <p>Wind: {data.windSpeed.toFixed(1)} km/h</p>
          </div>
        </div>
      </div>
    );
  };

  // Dynamic Y-axis max based on data
  const yAxisMax = useMemo(() => {
    if (!statistics) return 100;
    return Math.max(100, Math.ceil(statistics.max / 25) * 25 + 25);
  }, [statistics]);

  return (
    <Card data-testid="card-fire-danger-chart">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            {title}
          </CardTitle>
          {statistics && (
            <Badge 
              variant="outline"
              style={{ 
                backgroundColor: statistics.peakRating.color + '20',
                borderColor: statistics.peakRating.color,
                color: statistics.peakRating.color 
              }}
            >
              Peak: {statistics.peakRating.label}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Statistics Row */}
        {showStatistics && statistics && (
          <div className="grid grid-cols-4 gap-4 mb-4 text-center">
            <div className="rounded bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="text-lg font-semibold">{statistics.current.toFixed(1)}</p>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">Max</p>
              <p className="text-lg font-semibold text-red-500">{statistics.max.toFixed(1)}</p>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">Min</p>
              <p className="text-lg font-semibold text-green-500">{statistics.min.toFixed(1)}</p>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">Average</p>
              <p className="text-lg font-semibold">{statistics.avg.toFixed(1)}</p>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="ffdiGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              
              <XAxis 
                dataKey="timestamp" 
                tick={{ fontSize: 10 }} 
                tickLine={false}
                axisLine={false}
              />
              
              <YAxis 
                domain={[0, yAxisMax]}
                tick={{ fontSize: 10 }} 
                tickLine={false}
                axisLine={false}
                width={35}
              />
              
              <Tooltip content={<CustomTooltip />} />
              
              {/* Danger zone backgrounds */}
              {showThresholds && (
                <>
                  {/* Low-Moderate zone */}
                  <ReferenceArea 
                    y1={0} 
                    y2={12} 
                    fill="#22c55e" 
                    fillOpacity={0.1}
                  />
                  {/* High zone */}
                  <ReferenceArea 
                    y1={12} 
                    y2={25} 
                    fill="#eab308" 
                    fillOpacity={0.1}
                  />
                  {/* Very High zone */}
                  <ReferenceArea 
                    y1={25} 
                    y2={50} 
                    fill="#f97316" 
                    fillOpacity={0.1}
                  />
                  {/* Severe zone */}
                  <ReferenceArea 
                    y1={50} 
                    y2={75} 
                    fill="#ef4444" 
                    fillOpacity={0.1}
                  />
                  {/* Extreme+ zone */}
                  <ReferenceArea 
                    y1={75} 
                    y2={yAxisMax} 
                    fill="#dc2626" 
                    fillOpacity={0.15}
                  />
                  
                  {/* Threshold lines */}
                  <ReferenceLine 
                    y={12} 
                    stroke="#eab308" 
                    strokeDasharray="5 5"
                    strokeWidth={1}
                  />
                  <ReferenceLine 
                    y={25} 
                    stroke="#f97316" 
                    strokeDasharray="5 5"
                    strokeWidth={1}
                  />
                  <ReferenceLine 
                    y={50} 
                    stroke="#ef4444" 
                    strokeDasharray="5 5"
                    strokeWidth={1}
                    label={{ value: 'Severe', position: 'right', fontSize: 9, fill: '#ef4444' }}
                  />
                  <ReferenceLine 
                    y={75} 
                    stroke="#dc2626" 
                    strokeDasharray="5 5"
                    strokeWidth={1}
                    label={{ value: 'Extreme', position: 'right', fontSize: 9, fill: '#dc2626' }}
                  />
                  <ReferenceLine 
                    y={100} 
                    stroke="#7f1d1d" 
                    strokeDasharray="5 5"
                    strokeWidth={1}
                    label={{ value: 'Catastrophic', position: 'right', fontSize: 9, fill: '#7f1d1d' }}
                  />
                </>
              )}
              
              <Area
                type="monotone"
                dataKey="ffdi"
                stroke="#ef4444"
                strokeWidth={2}
                fill="url(#ffdiGradient)"
                dot={false}
                activeDot={{ r: 4, fill: '#ef4444' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Time in danger zones */}
        {showStatistics && statistics && (
          <div className="mt-4 pt-3 border-t">
            <p className="text-xs text-muted-foreground mb-2">Time in danger zones:</p>
            <div className="flex flex-wrap gap-2">
              {statistics.timeInDanger
                .filter((t: FireDangerRating & { count: number }) => t.count > 0)
                .map((zone: FireDangerRating & { count: number; percentage: string }) => (
                  <Badge 
                    key={zone.level}
                    variant="outline"
                    className="text-xs"
                    style={{ 
                      backgroundColor: zone.color + '15',
                      borderColor: zone.color,
                      color: zone.color 
                    }}
                  >
                    {zone.label}: {zone.percentage}%
                  </Badge>
                ))
              }
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-3 flex flex-wrap justify-center gap-3 text-xs">
          {FIRE_DANGER_RATINGS.slice(0, 5).map((rating: FireDangerRating) => (
            <div key={rating.level} className="flex items-center gap-1">
              <div 
                className="w-3 h-3 rounded-sm" 
                style={{ backgroundColor: rating.color }}
              />
              <span className="text-muted-foreground">{rating.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
