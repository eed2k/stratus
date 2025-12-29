import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";

interface MetricCardProps {
  title: string;
  value: string | number;
  unit: string;
  trend?: {
    value: number;
    label: string;
  };
  subMetrics?: {
    label: string;
    value: string | number;
  }[];
  sparklineData?: number[];
  isFaulty?: boolean;
  chartColor?: string;
}

// Generate default sparkline data if none provided
const generateDefaultSparkline = (currentValue: number): number[] => {
  const data: number[] = [];
  const variation = currentValue * 0.1 || 5;
  for (let i = 0; i < 12; i++) {
    data.push(currentValue + (Math.random() - 0.5) * variation);
  }
  return data;
};

export function MetricCard({
  title,
  value,
  unit,
  trend,
  subMetrics,
  sparklineData,
  isFaulty = false,
  chartColor = "#3b82f6",
}: MetricCardProps) {
  // Always generate sparkline data if not provided
  const chartData = useMemo(() => {
    if (sparklineData && sparklineData.length > 0) return sparklineData;
    const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    return generateDefaultSparkline(numValue);
  }, [sparklineData, value]);

  if (isFaulty) {
    return (
      <Card 
        className="bg-yellow-500 border-yellow-400" 
        data-testid={`card-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-normal text-white">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <span className="text-xl font-normal text-white">SENSOR FAULTY</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover-elevate transition-shadow duration-200 border border-gray-300 bg-white" data-testid={`card-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-normal tracking-tight text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid={`value-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </span>
          <span className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{unit}</span>
        </div>

        {trend && (
          <p className={`mt-1 text-xs font-normal ${trend.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            {trend.value >= 0 ? '+' : ''}{trend.value} {trend.label}
          </p>
        )}

        {/* Always show mini chart */}
        <div className="mt-3 h-12 flex items-end gap-0.5">
          {chartData.map((val, i) => {
            const max = Math.max(...chartData);
            const min = Math.min(...chartData);
            const range = max - min || 1;
            const height = ((val - min) / range) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{ height: `${Math.max(height, 5)}%`, backgroundColor: chartColor }}
              />
            );
          })}
        </div>

        {subMetrics && subMetrics.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-300 pt-3">
            {subMetrics.map((sub, i) => (
              <div key={i} className="text-xs" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                <span className="font-normal text-black">{sub.label}: </span>
                <span className="font-normal text-black">{sub.value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
