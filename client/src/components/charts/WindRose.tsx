import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WindRoseData {
  direction: number;
  speeds: number[];
}

interface WindRoseProps {
  data: WindRoseData[];
  speedClasses?: { min: number; max: number; color: string; label: string }[];
  title?: string;
  maxWindSpeed?: number; // Optional: if not provided, will auto-calculate from data
}

/**
 * Generate dynamic speed classes based on max wind speed
 * Creates 6 equal-ish bands from 0 to maxSpeed
 */
const generateSpeedClasses = (maxSpeed: number) => {
  // Round up max speed to nearest nice number
  const niceMax = Math.ceil(maxSpeed / 5) * 5 || 10;
  const step = niceMax / 5;
  
  return [
    { min: 0, max: step, color: "#bfdbfe", label: `0-${step.toFixed(0)} km/h` },
    { min: step, max: step * 2, color: "#60a5fa", label: `${step.toFixed(0)}-${(step * 2).toFixed(0)} km/h` },
    { min: step * 2, max: step * 3, color: "#22c55e", label: `${(step * 2).toFixed(0)}-${(step * 3).toFixed(0)} km/h` },
    { min: step * 3, max: step * 4, color: "#facc15", label: `${(step * 3).toFixed(0)}-${(step * 4).toFixed(0)} km/h` },
    { min: step * 4, max: step * 5, color: "#f97316", label: `${(step * 4).toFixed(0)}-${(step * 5).toFixed(0)} km/h` },
    { min: step * 5, max: Infinity, color: "#dc2626", label: `>${(step * 5).toFixed(0)} km/h` },
  ];
};

const DEFAULT_SPEED_CLASSES = [
  { min: 0, max: 2, color: "#bfdbfe", label: "0-2 km/h" },
  { min: 2, max: 10, color: "#60a5fa", label: "2-10 km/h" },
  { min: 10, max: 25, color: "#22c55e", label: "10-25 km/h" },
  { min: 25, max: 50, color: "#facc15", label: "25-50 km/h" },
  { min: 50, max: 100, color: "#f97316", label: "50-100 km/h" },
  { min: 100, max: Infinity, color: "#dc2626", label: ">100 km/h" },
];

const DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function WindRose({ data, speedClasses, title = "Wind Rose", maxWindSpeed }: WindRoseProps) {
  // Calculate max wind speed from data if not provided
  const calculatedMaxSpeed = useMemo(() => {
    if (maxWindSpeed !== undefined) return maxWindSpeed;
    
    let maxSpeed = 0;
    data.forEach(d => {
      // Sum of all speed class counts weighted by their max values
      d.speeds.forEach((count, idx) => {
        if (count > 0) {
          // The actual max speed is approximated by looking at which speed classes have data
          const classMax = DEFAULT_SPEED_CLASSES[idx]?.max || 100;
          if (classMax !== Infinity && classMax > maxSpeed) {
            maxSpeed = classMax;
          }
        }
      });
    });
    return maxSpeed || 50; // Default to 50 if no data
  }, [data, maxWindSpeed]);

  // Use provided speed classes or generate dynamic ones based on max speed
  const activeSpeedClasses = useMemo(() => {
    if (speedClasses) return speedClasses;
    return generateSpeedClasses(calculatedMaxSpeed);
  }, [speedClasses, calculatedMaxSpeed]);

  const maxValue = useMemo(() => {
    let max = 0;
    data.forEach(d => {
      const total = d.speeds.reduce((a, b) => a + b, 0);
      if (total > max) max = total;
    });
    return max || 1;
  }, [data]);

  const size = 320;
  const center = size / 2;
  const maxRadius = size / 2 - 40;

  const polarToCart = (angle: number, radius: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  const createWedge = (dirIndex: number, innerRadius: number, outerRadius: number) => {
    const angleStart = dirIndex * 22.5 - 11.25;
    const angleEnd = dirIndex * 22.5 + 11.25;

    const p1 = polarToCart(angleStart, innerRadius);
    const p2 = polarToCart(angleStart, outerRadius);
    const p3 = polarToCart(angleEnd, outerRadius);
    const p4 = polarToCart(angleEnd, innerRadius);

    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${outerRadius} ${outerRadius} 0 0 1 ${p3.x} ${p3.y} L ${p4.x} ${p4.y} A ${innerRadius} ${innerRadius} 0 0 0 ${p1.x} ${p1.y} Z`;
  };

  return (
    <Card data-testid="card-wind-rose">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg width={size} height={size} className="overflow-visible">
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <circle
              key={ratio}
              cx={center}
              cy={center}
              r={maxRadius * ratio}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          ))}

          {DIRECTIONS.map((dir, i) => {
            const angle = i * 22.5;
            const pos = polarToCart(angle, maxRadius + 20);
            return (
              <text
                key={dir}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-xs font-medium"
              >
                {dir}
              </text>
            );
          })}

          {data.map((d, dirIndex) => {
            let currentRadius = 0;
            return d.speeds.map((count, speedIndex) => {
              // Round wind rose values to 3 decimals
              const roundedCount = Number(count.toFixed(3));
              const innerRadius = currentRadius;
              const height = (roundedCount / maxValue) * maxRadius;
              currentRadius += height;

              if (roundedCount === 0) return null;

              return (
                <path
                  key={`${dirIndex}-${speedIndex}`}
                  d={createWedge(dirIndex, innerRadius, currentRadius)}
                  fill={activeSpeedClasses[speedIndex]?.color || "#3b82f6"}
                  stroke="white"
                  strokeWidth={0.5}
                  opacity={0.85}
                />
              );
            });
          })}
        </svg>

        {/* Max wind speed indicator */}
        <div className="mt-2 text-center text-xs text-muted-foreground">
          Max: {calculatedMaxSpeed.toFixed(1)} km/h
        </div>

        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {activeSpeedClasses.map((sc) => (
            <div key={sc.label} className="flex items-center gap-1 text-xs">
              <div
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: sc.color }}
              />
              <span className="text-muted-foreground">{sc.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
