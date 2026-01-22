import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Area,
  AreaChart,
  BarChart,
  Bar,
} from "recharts";
import { Maximize2, Minimize2, TrendingUp, TrendingDown } from "lucide-react";

/**
 * Format numbers with appropriate decimal precision
 */
const formatValue = (value: number | string, decimals: number = 2): string => {
  if (typeof value === 'number') {
    return parseFloat(value.toFixed(decimals)).toString();
  }
  return String(value);
};

/**
 * Custom tooltip for charts
 */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  
  return (
    <div className="bg-card border border-border rounded-md p-3 shadow-lg text-sm">
      <p className="font-medium mb-2 text-foreground">{label}</p>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium" style={{ color: entry.color }}>
            {formatValue(entry.value)} {entry.payload?.unit || ''}
          </span>
        </div>
      ))}
    </div>
  );
};

interface ChartDataPoint {
  timestamp: string;
  [key: string]: string | number;
}

interface DataSeries {
  dataKey: string;
  name: string;
  color: string;
  unit?: string;
}

type ChartType = "line" | "area" | "bar";

interface DataBlockChartProps {
  /** Chart title */
  title: string;
  /** Data points for the chart */
  data: ChartDataPoint[];
  /** Series configuration */
  series: DataSeries[];
  /** Chart type */
  chartType?: ChartType;
  /** X-axis label */
  xAxisLabel?: string;
  /** Y-axis label */
  yAxisLabel?: string;
  /** Show average reference line */
  showAverage?: boolean;
  /** Show min/max values */
  showMinMax?: boolean;
  /** Current value to display */
  currentValue?: number;
  /** Trend compared to previous period */
  trend?: {
    value: number;
    label: string;
  };
  /** Compact mode for inline display */
  compact?: boolean;
  /** Time range options - empty by default, use dashboard config for global control */
  timeRanges?: string[];
  /** Default time range */
  defaultRange?: string;
  /** Callback when time range changes */
  onRangeChange?: (range: string) => void;
  /** Custom height in pixels */
  height?: number;
}

/**
 * Expandable chart component for data blocks
 * Features:
 * - Line, Area, or Bar chart types
 * - Proper X/Y axis with labels
 * - Expandable to full width
 * - Time range selector
 * - Current value display with trend
 * - Min/Max/Average statistics
 */
export function DataBlockChart({
  title,
  data,
  series,
  chartType = "line",
  xAxisLabel = "Time",
  yAxisLabel,
  showAverage = false,
  showMinMax = false,
  currentValue,
  trend,
  compact = false,
  timeRanges = [],
  defaultRange = "24hr",
  onRangeChange,
  height = 250,
}: DataBlockChartProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedRange, setSelectedRange] = useState(defaultRange);

  // Calculate statistics
  const primaryDataKey = series[0]?.dataKey;
  const values = data.map(d => Number(d[primaryDataKey] || 0));
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;

  const handleRangeChange = (range: string) => {
    setSelectedRange(range);
    onRangeChange?.(range);
  };

  const chartHeight = compact ? 150 : (isExpanded ? 400 : height);
  const primaryUnit = series[0]?.unit || "";

  // Render chart based on type
  const renderChart = () => {
    const commonProps = {
      data,
      margin: { top: 10, right: 20, left: yAxisLabel ? 60 : 45, bottom: xAxisLabel ? 45 : 20 },
    };

    const xAxisProps = {
      dataKey: "timestamp",
      tick: { fontSize: 9, angle: data.length > 100 ? -45 : 0, textAnchor: (data.length > 100 ? 'end' : 'middle') as 'start' | 'middle' | 'end' },
      tickLine: false,
      axisLine: { stroke: 'hsl(var(--border))' },
      interval: data.length > 200 ? Math.floor(data.length / 8) : (data.length > 50 ? Math.floor(data.length / 6) : 0) as number,
      label: !compact && xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5, fontSize: 11, fill: 'hsl(var(--muted-foreground))' } : undefined,
      height: data.length > 100 ? 60 : 30,
    };

    const yAxisProps = {
      tick: { fontSize: 10 },
      tickLine: false,
      axisLine: { stroke: 'hsl(var(--border))' },
      width: yAxisLabel ? 55 : 40,
      label: yAxisLabel && !compact ? { 
        value: primaryUnit ? `${yAxisLabel} (${primaryUnit})` : yAxisLabel, 
        angle: -90, 
        position: 'insideLeft',
        offset: 5,
        fontSize: 10,
        fill: 'hsl(var(--muted-foreground))',
        style: { textAnchor: 'middle' }
      } : undefined,
    };

    switch (chartType) {
      case "area":
        return (
          <AreaChart {...commonProps}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.dataKey} id={`gradient-${s.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={s.color} stopOpacity={0.05}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip content={<CustomTooltip />} />
            {!compact && <Legend wrapperStyle={{ paddingTop: 20 }} />}
            {showAverage && (
              <ReferenceLine 
                y={avg} 
                stroke="#6b7280" 
                strokeDasharray="5 5" 
                label={{ value: `Avg: ${formatValue(avg)}`, position: 'right', fontSize: 10 }} 
              />
            )}
            {series.map((s) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                fill={`url(#gradient-${s.dataKey})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        );

      case "bar":
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip content={<CustomTooltip />} />
            {!compact && <Legend wrapperStyle={{ paddingTop: 20 }} />}
            {series.map((s) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.name}
                fill={s.color}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );

      default: // line
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip content={<CustomTooltip />} />
            {!compact && <Legend wrapperStyle={{ paddingTop: 20 }} />}
            {showAverage && (
              <ReferenceLine 
                y={avg} 
                stroke="#6b7280" 
                strokeDasharray="5 5"
              />
            )}
            {series.map((s) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        );
    }
  };

  return (
    <Card 
      className={`transition-all duration-300 ${isExpanded ? "col-span-full" : ""}`}
      data-testid={`chart-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <CardHeader className={compact ? "pb-1 pt-3 px-3" : "pb-2"}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <CardTitle className={`${compact ? "text-sm" : "text-lg"} font-normal`}>
              {title}
            </CardTitle>
            {currentValue !== undefined && (
              <Badge variant="secondary" className="text-xs">
                {formatValue(currentValue)} {primaryUnit}
              </Badge>
            )}
            {trend && (
              <div className={`flex items-center gap-1 text-xs ${
                trend.value >= 0 ? 'text-green-500' : 'text-red-500'
              }`}>
                {trend.value >= 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                <span>{trend.value >= 0 ? '+' : ''}{formatValue(trend.value, 1)}%</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {!compact && timeRanges.length > 0 && (
              <div className="flex gap-1">
                {timeRanges.map((range) => (
                  <Button
                    key={range}
                    variant={selectedRange === range ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleRangeChange(range)}
                  >
                    {range}
                  </Button>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Collapse chart" : "Expand chart"}
            >
              {isExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        
        {/* Statistics row */}
        {showMinMax && !compact && (
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span>Min: <span className="font-medium text-foreground">{formatValue(min)} {primaryUnit}</span></span>
            <span>Max: <span className="font-medium text-foreground">{formatValue(max)} {primaryUnit}</span></span>
            {showAverage && (
              <span>Avg: <span className="font-medium text-foreground">{formatValue(avg)} {primaryUnit}</span></span>
            )}
          </div>
        )}
      </CardHeader>
      
      <CardContent className={compact ? "px-3 pb-3" : ""}>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default DataBlockChart;
