import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WindRoseData {
  direction: number;
  speeds: number[];
}

interface WindRose3DProps {
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

export function WindRose3D({ data, speedClasses = DEFAULT_SPEED_CLASSES, title = "Wind Rose 3D" }: WindRose3DProps) {
  const [rotationX, setRotationX] = useState(55);
  const [rotationZ, setRotationZ] = useState(0);

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
  const maxRadius = size / 2 - 50;
  const barHeight = 80;

  const polarToCart3D = (angle: number, radius: number, height: number = 0) => {
    const rad = ((angle - 90 + rotationZ) * Math.PI) / 180;
    const tiltRad = (rotationX * Math.PI) / 180;
    
    const x = radius * Math.cos(rad);
    const y = radius * Math.sin(rad);
    const z = height;
    
    const yTilted = y * Math.cos(tiltRad) - z * Math.sin(tiltRad);
    const zTilted = y * Math.sin(tiltRad) + z * Math.cos(tiltRad);
    
    return {
      x: center + x,
      y: center + yTilted * 0.7,
      z: zTilted,
    };
  };

  const create3DBar = (dirIndex: number, speedIndex: number, value: number, cumulativeValue: number) => {
    const angleCenter = dirIndex * 22.5;
    const angleStart = angleCenter - 10;
    const angleEnd = angleCenter + 10;
    
    const innerRadius = 20 + (speedIndex * 15);
    const outerRadius = innerRadius + 12;
    const baseHeight = (cumulativeValue / maxValue) * barHeight;
    const topHeight = baseHeight + (value / maxValue) * barHeight;

    const p1b = polarToCart3D(angleStart, innerRadius, baseHeight);
    const p2b = polarToCart3D(angleStart, outerRadius, baseHeight);
    const p3b = polarToCart3D(angleEnd, outerRadius, baseHeight);
    const p4b = polarToCart3D(angleEnd, innerRadius, baseHeight);
    
    const p1t = polarToCart3D(angleStart, innerRadius, topHeight);
    const p2t = polarToCart3D(angleStart, outerRadius, topHeight);
    const p3t = polarToCart3D(angleEnd, outerRadius, topHeight);
    const p4t = polarToCart3D(angleEnd, innerRadius, topHeight);

    const topFace = `M ${p1t.x} ${p1t.y} L ${p2t.x} ${p2t.y} L ${p3t.x} ${p3t.y} L ${p4t.x} ${p4t.y} Z`;
    
    const outerFace = `M ${p2b.x} ${p2b.y} L ${p3b.x} ${p3b.y} L ${p3t.x} ${p3t.y} L ${p2t.x} ${p2t.y} Z`;
    
    const leftFace = `M ${p1b.x} ${p1b.y} L ${p2b.x} ${p2b.y} L ${p2t.x} ${p2t.y} L ${p1t.x} ${p1t.y} Z`;
    
    const rightFace = `M ${p3b.x} ${p3b.y} L ${p4b.x} ${p4b.y} L ${p4t.x} ${p4t.y} L ${p3t.x} ${p3t.y} Z`;

    return { topFace, outerFace, leftFace, rightFace, avgZ: (p1t.z + p2t.z + p3t.z + p4t.z) / 4 };
  };

  const allBars = useMemo(() => {
    const bars: { 
      path: string; 
      color: string; 
      type: string; 
      z: number; 
      opacity: number;
    }[] = [];

    data.forEach((d, dirIndex) => {
      let cumulativeValue = 0;
      d.speeds.forEach((count, speedIndex) => {
        if (count > 0) {
          const bar = create3DBar(dirIndex, speedIndex, count, cumulativeValue);
          const baseColor = speedClasses[speedIndex]?.color || "#3b82f6";
          
          bars.push({ path: bar.leftFace, color: baseColor, type: 'left', z: bar.avgZ - 0.2, opacity: 0.6 });
          bars.push({ path: bar.rightFace, color: baseColor, type: 'right', z: bar.avgZ - 0.1, opacity: 0.7 });
          bars.push({ path: bar.outerFace, color: baseColor, type: 'outer', z: bar.avgZ, opacity: 0.85 });
          bars.push({ path: bar.topFace, color: baseColor, type: 'top', z: bar.avgZ + 0.3, opacity: 1 });
        }
        cumulativeValue += count;
      });
    });

    return bars.sort((a, b) => a.z - b.z);
  }, [data, rotationX, rotationZ, speedClasses, maxValue]);

  const baseCirclePoints = useMemo(() => {
    const points: string[] = [];
    for (let i = 0; i <= 360; i += 5) {
      const p = polarToCart3D(i, maxRadius + 10, 0);
      points.push(`${p.x},${p.y}`);
    }
    return points.join(' ');
  }, [rotationX, rotationZ]);

  return (
    <Card data-testid="card-wind-rose-3d">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg 
          width={size} 
          height={size} 
          className="overflow-visible cursor-grab active:cursor-grabbing"
          onMouseMove={(e) => {
            if (e.buttons === 1) {
              setRotationZ(prev => prev + e.movementX * 0.5);
              setRotationX(prev => Math.max(20, Math.min(80, prev - e.movementY * 0.3)));
            }
          }}
        >
          <ellipse
            cx={center}
            cy={center}
            rx={maxRadius + 10}
            ry={(maxRadius + 10) * Math.cos((rotationX * Math.PI) / 180) * 0.7}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={1}
          />

          {[0.33, 0.66, 1].map((ratio, i) => (
            <ellipse
              key={ratio}
              cx={center}
              cy={center}
              rx={(maxRadius + 10) * ratio}
              ry={(maxRadius + 10) * ratio * Math.cos((rotationX * Math.PI) / 180) * 0.7}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          ))}

          {DIRECTIONS.filter((_, i) => i % 2 === 0).map((dir, i) => {
            const angle = i * 45;
            const pos = polarToCart3D(angle, maxRadius + 25, 0);
            return (
              <text
                key={dir}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-xs font-medium select-none"
              >
                {dir}
              </text>
            );
          })}

          {allBars.map((bar, i) => (
            <path
              key={i}
              d={bar.path}
              fill={bar.color}
              opacity={bar.opacity}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={0.5}
            />
          ))}
        </svg>

        <p className="text-xs text-muted-foreground mt-2 mb-3">Drag to rotate</p>

        <div className="flex flex-wrap justify-center gap-2">
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
