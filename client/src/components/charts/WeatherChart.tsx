import { useState } from "react";
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

interface ChartDataPoint {
  timestamp: string;
  [key: string]: string | number;
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
}

export function WeatherChart({
  title,
  data,
  series,
  timeRanges = ["10min", "1hr", "24hr", "7d", "30d"],
  defaultRange = "24hr",
  onRangeChange,
}: WeatherChartProps) {
  const [selectedRange, setSelectedRange] = useState(defaultRange);

  const handleRangeChange = (range: string) => {
    setSelectedRange(range);
    onRangeChange?.(range);
  };

  return (
    <Card data-testid={`card-chart-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
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
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              />
              <Legend />
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
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
