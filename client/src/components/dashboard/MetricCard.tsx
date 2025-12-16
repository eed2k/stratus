import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  unit: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  subMetrics?: {
    label: string;
    value: string | number;
  }[];
  sparklineData?: number[];
}

export function MetricCard({
  title,
  value,
  unit,
  icon: Icon,
  trend,
  subMetrics,
  sparklineData,
}: MetricCardProps) {
  return (
    <Card className="hover-elevate transition-shadow duration-200" data-testid={`card-metric-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-3xl font-bold tracking-tight" data-testid={`value-${title.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>

        {trend && (
          <p className={`mt-1 text-xs ${trend.value >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
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
                  className="flex-1 bg-primary/30 rounded-t-sm"
                  style={{ height: `${Math.max(height, 5)}%` }}
                />
              );
            })}
          </div>
        )}

        {subMetrics && subMetrics.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
            {subMetrics.map((sub, i) => (
              <div key={i} className="text-xs">
                <span className="text-muted-foreground">{sub.label}: </span>
                <span className="font-mono font-medium">{sub.value}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
