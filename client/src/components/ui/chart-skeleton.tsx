// Stratus Weather System - UI Component
// Source: Library (shadcn/ui)

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartSkeletonProps {
  height?: number;
  showHeader?: boolean;
  title?: string;
}

/**
 * Loading skeleton for chart components
 * Displays while chart data is being fetched or processed
 */
export function ChartSkeleton({ 
  height = 288, // h-72 = 18rem = 288px
  showHeader = true,
  title 
}: ChartSkeletonProps) {
  return (
    <Card>
      {showHeader && (
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          {title ? (
            <span className="text-lg font-normal">{title}</span>
          ) : (
            <Skeleton className="h-6 w-32" />
          )}
          <div className="flex gap-1">
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-8 w-12" />
            <Skeleton className="h-8 w-12" />
          </div>
        </CardHeader>
      )}
      <CardContent>
        <div 
          className="relative overflow-hidden rounded-md bg-muted/30"
          style={{ height }}
        >
          {/* Animated shimmer effect */}
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          
          {/* Chart placeholder lines */}
          <svg 
            className="h-full w-full text-muted-foreground/20" 
            preserveAspectRatio="none"
            viewBox="0 0 400 200"
          >
            {/* Grid lines */}
            {[0, 1, 2, 3, 4].map(i => (
              <line 
                key={`h-${i}`}
                x1="40" 
                y1={40 + i * 30} 
                x2="380" 
                y2={40 + i * 30}
                stroke="currentColor"
                strokeDasharray="4 4"
              />
            ))}
            
            {/* Placeholder data line */}
            <path
              d="M40 120 Q100 80, 160 100 T280 90 T360 110"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeOpacity="0.4"
            />
          </svg>
          
          {/* Loading indicator */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading chart...
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Loading skeleton for map components
 */
export function MapSkeleton({ height = 256 }: { height?: number }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <span className="text-lg font-normal">Station Location</span>
          <Skeleton className="h-6 w-32" />
        </div>
      </CardHeader>
      <CardContent>
        <div 
          className="relative overflow-hidden rounded-md bg-muted/30"
          style={{ height }}
        >
          {/* Map placeholder with grid pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(var(--muted)/0.3)_1px,transparent_1px),linear-gradient(to_bottom,rgb(var(--muted)/0.3)_1px,transparent_1px)] bg-[size:20px_20px]" />
          
          {/* Center marker placeholder */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-8 w-8 animate-pulse rounded-full bg-primary/30" />
          </div>
          
          {/* Loading indicator */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading map...
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Loading skeleton for wind rose
 */
export function WindRoseSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <span className="text-lg font-normal">Wind Rose</span>
        <Skeleton className="h-5 w-20" />
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        {/* Circular placeholder */}
        <div className="relative h-80 w-80">
          <svg viewBox="0 0 320 320" className="h-full w-full">
            {/* Concentric circles */}
            {[0.25, 0.5, 0.75, 1].map((r, i) => (
              <circle
                key={i}
                cx="160"
                cy="160"
                r={120 * r}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.2"
                className="text-muted-foreground"
              />
            ))}
            {/* Direction lines */}
            {[0, 45, 90, 135].map(angle => (
              <line
                key={angle}
                x1="160"
                y1="160"
                x2={160 + 120 * Math.cos((angle - 90) * Math.PI / 180)}
                y2={160 + 120 * Math.sin((angle - 90) * Math.PI / 180)}
                stroke="currentColor"
                strokeOpacity="0.2"
                className="text-muted-foreground"
              />
            ))}
          </svg>
          
          {/* Loading indicator */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading...
            </div>
          </div>
        </div>
        
        {/* Legend placeholder */}
        <div className="mt-3 flex gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-4 w-12" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
