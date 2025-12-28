import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
}

export function MetricCard({
  title,
  value,
  unit,
  trend,
  subMetrics,
  sparklineData,
  isFaulty = false,
}: MetricCardProps) {
  if (isFaulty) {
    return (
      <Card 
        className="bg-yellow-500 border-yellow-600" 
        data-testid={`card-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-white">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <span className="text-xl font-bold text-white">SENSOR FAULTY</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover-elevate transition-shadow duration-200 border-2 border-black bg-white" data-testid={`card-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tracking-tight text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }} data-testid={`value-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </span>
          <span className="text-sm font-bold text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{unit}</span>
        </div>

        {trend && (
          <p className={`mt-1 text-xs font-bold ${trend.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`} style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            {trend.value >= 0 ? '+' : ''}{trend.value} {trend.label}
          </p>
        )}

        {sparklineData && sparklineData.length > 0 && (
          <div className="mt-3 h-12 flex items-end gap-0.5">
            {sparklineData.map((val, i) => {
              const max = Math.max(...sparklineData);
              const min = Math.min(...sparklineData);
              const range = max - min || 1;
              const height = ((val - min) / range) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 bg-black rounded-t-sm"
                  style={{ height: `${Math.max(height, 5)}%` }}
                />
              );
            })}
          </div>
        )}

        {subMetrics && subMetrics.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-black pt-3">
            {subMetrics.map((sub, i) => (
              <div key={i} className="text-xs" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                <span className="font-bold text-black">{sub.label}: </span>
                <span className="font-bold text-black">{sub.value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
