// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useState, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/**
 * Format a number to a maximum of 3 decimal places
 * Removes trailing zeros for cleaner display
 */
const formatTooltipValue = (value: number | string): string => {
  if (typeof value === 'number') {
    return parseFloat(value.toFixed(3)).toString();
  }
  return String(value);
};

/**
 * Custom tooltip component with decimal precision control and daily aggregation support
 */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  
  const dataPoint = payload[0]?.payload;
  const isDailyAggregated = dataPoint?._readings != null;
  
  return (
    <div className="bg-card border border-border rounded-md p-2 shadow-md text-xs">
      <p className="font-medium mb-1">
        {label}{isDailyAggregated ? ` (${dataPoint._readings} readings)` : ''}
      </p>
      {payload.map((entry: any, index: number) => {
        const minKey = entry.dataKey + 'Min';
        const maxKey = entry.dataKey + 'Max';
        const hasMinMax = isDailyAggregated && dataPoint[minKey] != null && dataPoint[maxKey] != null;
        
        return (
          <div key={index}>
            <p style={{ color: entry.color }}>
              {isDailyAggregated ? `Avg ${entry.name}` : entry.name}: {formatTooltipValue(entry.value)} {entry.payload?.unit || ''}
            </p>
            {hasMinMax && (
              <p className="text-black ml-2" style={{ fontSize: '0.65rem' }}>
                Min: {formatTooltipValue(dataPoint[minKey])} / Max: {formatTooltipValue(dataPoint[maxKey])}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

interface ChartDataPoint {
  timestamp: string;
  [key: string]: string | number | null;
}

interface ChartSeries {
  dataKey: string;
  name: string;
  color: string;
  unit?: string;
}

interface WeatherChartProps {
  title: string;
  data: ChartDataPoint[];
  series: ChartSeries[];
  timeRanges?: string[];
  defaultRange?: string;
  onRangeChange?: (range: string) => void;
  heightClass?: string; // override chart area height, e.g. "h-full" for flexible layouts
  compact?: boolean; // hide legend, colour-code title by series, 6-hour time ticks
}

export const WeatherChart = memo(function WeatherChart({
  title,
  data,
  series,
  timeRanges = [],
  defaultRange = "24hr",
  onRangeChange,
  heightClass,
  compact = false,
}: WeatherChartProps) {
  const [selectedRange, setSelectedRange] = useState(defaultRange);

  const handleRangeChange = (range: string) => {
    setSelectedRange(range);
    onRangeChange?.(range);
  };

  // Format an ISO timestamp as HH:mm for compact axis ticks
  const formatTick = (ts: string) => {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // Coloured title: each series name in its own colour, joined by " vs "
  const colouredTitle = (
    <span>
      {series.map((s, i) => (
        <span key={s.dataKey}>
          {i > 0 && <span className="text-black"> vs </span>}
          <span style={{ color: s.color }}>{s.name}</span>
        </span>
      ))}
    </span>
  );

  return (
    <Card data-testid={`card-chart-${title.toLowerCase().replace(/\s+/g, '-')}`} className={heightClass ? "h-full flex flex-col" : undefined}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-2">
        <CardTitle className="text-lg font-normal">{compact ? colouredTitle : title}</CardTitle>
        <div className="flex flex-wrap gap-1">
          {timeRanges.map((range) => (
            <Button
              key={range}
              variant={selectedRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => handleRangeChange(range)}
              data-testid={`button-range-${range}`}
            >
              {range}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className={heightClass ? "flex-1 min-h-0" : undefined}>
        <div className={heightClass ?? "h-72"}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={compact ? formatTick : undefined}
                interval={compact ? "preserveStartEnd" : undefined}
                minTickGap={compact ? 60 : undefined}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} />
              {!compact && <Legend iconSize={0} />}
              {series.map((s) => (
                <Line
                  key={s.dataKey}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={true}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
});
