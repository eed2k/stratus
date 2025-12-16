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
}

const DEFAULT_SPEED_CLASSES = [
  { min: 0, max: 2, color: "#93c5fd", label: "0-2 km/h" },
  { min: 2, max: 5, color: "#60a5fa", label: "2-5 km/h" },
  { min: 5, max: 10, color: "#3b82f6", label: "5-10 km/h" },
  { min: 10, max: 20, color: "#2563eb", label: "10-20 km/h" },
  { min: 20, max: 35, color: "#1d4ed8", label: "20-35 km/h" },
  { min: 35, max: Infinity, color: "#1e40af", label: ">35 km/h" },
];

const DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function WindRose({ data, speedClasses = DEFAULT_SPEED_CLASSES, title = "Wind Rose" }: WindRoseProps) {
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
              const innerRadius = currentRadius;
              const height = (count / maxValue) * maxRadius;
              currentRadius += height;

              if (count === 0) return null;

              return (
                <path
                  key={`${dirIndex}-${speedIndex}`}
                  d={createWedge(dirIndex, innerRadius, currentRadius)}
                  fill={speedClasses[speedIndex]?.color || "#3b82f6"}
                  stroke="white"
                  strokeWidth={0.5}
                  opacity={0.85}
                />
              );
            });
          })}
        </svg>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {speedClasses.map((sc) => (
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
