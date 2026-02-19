import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo, memo } from "react";

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
  showChart?: boolean; // Control whether to show the mini chart
}

export const MetricCard = memo(function MetricCard({
  title,
  value,
  unit,
  trend,
  subMetrics,
  sparklineData,
  isFaulty = false,
  chartColor = "#3b82f6",
  showChart = true, // Default to showing chart for backward compatibility
}: MetricCardProps) {
  // Only use sparkline data if provided - no fake data generation
  const chartData = useMemo(() => {
    if (!showChart) return [];
    // Only use real data that was passed in
    if (sparklineData && sparklineData.length > 0) {
      // Filter out any zero or null values for cleaner display
      const validData = sparklineData.filter(v => v !== null && v !== undefined);
      return validData.length > 0 ? validData : [];
    }
    return [];
  }, [sparklineData, showChart]);

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

        {/* Mini chart - only show if enabled */}
        {showChart && chartData.length > 0 && (
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
        )}

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
});
