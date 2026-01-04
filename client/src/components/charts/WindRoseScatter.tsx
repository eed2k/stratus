import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Wind speed scatter point data - individual wind observations
 */
interface WindSpeedPoint {
  direction: number; // degrees (0-360)
  speed: number; // km/h
  timestamp?: Date;
}

interface WindRoseScatterProps {
  data: WindSpeedPoint[];
  title?: string;
  maxWindSpeed?: number;
  showLegend?: boolean;
}

/**
 * WMO (World Meteorological Organization) Standard Wind Speed Classes
 * Based on the Beaufort Scale with metric (km/h) values
 * Colors follow a proper thermal gradient progression:
 * - Blues for light winds (cool/calm)
 * - Greens for moderate winds (comfortable)
 * - Yellows/Oranges for strong winds (caution)
 * - Reds for severe winds (danger)
 */
const SPEED_COLOR_CLASSES = [
  { min: 0, max: 1, color: "#e0f2fe", label: "Calm (0-1 km/h)", beaufort: "0" },
  { min: 1, max: 6, color: "#bae6fd", label: "Light Air (1-6 km/h)", beaufort: "1" },
  { min: 6, max: 12, color: "#7dd3fc", label: "Light Breeze (6-12 km/h)", beaufort: "2" },
  { min: 12, max: 20, color: "#38bdf8", label: "Gentle Breeze (12-20 km/h)", beaufort: "3" },
  { min: 20, max: 29, color: "#0ea5e9", label: "Moderate (20-29 km/h)", beaufort: "4" },
  { min: 29, max: 39, color: "#22c55e", label: "Fresh (29-39 km/h)", beaufort: "5" },
  { min: 39, max: 50, color: "#84cc16", label: "Strong (39-50 km/h)", beaufort: "6" },
  { min: 50, max: 62, color: "#eab308", label: "Near Gale (50-62 km/h)", beaufort: "7" },
  { min: 62, max: 75, color: "#f97316", label: "Gale (62-75 km/h)", beaufort: "8" },
  { min: 75, max: 89, color: "#ef4444", label: "Strong Gale (75-89 km/h)", beaufort: "9" },
  { min: 89, max: 103, color: "#dc2626", label: "Storm (89-103 km/h)", beaufort: "10" },
  { min: 103, max: 118, color: "#b91c1c", label: "Violent Storm (103-118 km/h)", beaufort: "11" },
  { min: 118, max: Infinity, color: "#7f1d1d", label: "Hurricane (>118 km/h)", beaufort: "12" },
];

const DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/**
 * Get color for a given wind speed based on WMO classes
 */
const getSpeedColor = (speed: number): string => {
  const colorClass = SPEED_COLOR_CLASSES.find(c => speed >= c.min && speed < c.max);
  return colorClass?.color || "#dc2626";
};

/**
 * Calculate wind statistics from scatter data
 */
const calculateScatterStats = (data: WindSpeedPoint[]) => {
  if (data.length === 0) {
    return {
      avgSpeed: 0,
      maxSpeed: 0,
      minSpeed: 0,
      observations: 0,
      dominantDirection: "N",
    };
  }

  const speeds = data.map(d => d.speed);
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const maxSpeed = Math.max(...speeds);
  const minSpeed = Math.min(...speeds);

  // Find dominant direction by binning
  const dirBins = new Array(16).fill(0);
  data.forEach(d => {
    const binIndex = Math.round(d.direction / 22.5) % 16;
    dirBins[binIndex]++;
  });
  const dominantIndex = dirBins.indexOf(Math.max(...dirBins));

  return {
    avgSpeed,
    maxSpeed,
    minSpeed,
    observations: data.length,
    dominantDirection: DIRECTIONS[dominantIndex],
  };
};

/**
 * WindRoseScatter - Displays wind speed observations as colored dots on a polar chart
 * 
 * This component shows individual wind measurements plotted on a polar coordinate system
 * where the angle represents wind direction and the radius represents wind speed.
 * Points are color-coded according to WMO/Beaufort wind speed classifications.
 */
export function WindRoseScatter({ 
  data, 
  title = "Wind Speed Scatter", 
  maxWindSpeed,
  showLegend = true 
}: WindRoseScatterProps) {
  // Calculate max speed for scaling
  const calculatedMaxSpeed = useMemo(() => {
    if (maxWindSpeed !== undefined) return maxWindSpeed;
    if (data.length === 0) return 50;
    return Math.max(...data.map(d => d.speed), 20) * 1.1;
  }, [data, maxWindSpeed]);

  // Calculate statistics
  const stats = useMemo(() => calculateScatterStats(data), [data]);

  // Identify which speed classes are present in data
  const activeClasses = useMemo(() => {
    const present = new Set<number>();
    data.forEach(d => {
      const idx = SPEED_COLOR_CLASSES.findIndex(c => d.speed >= c.min && d.speed < c.max);
      if (idx >= 0) present.add(idx);
    });
    return SPEED_COLOR_CLASSES.filter((_, i) => present.has(i));
  }, [data]);

  const size = 320;
  const center = size / 2;
  const maxRadius = size / 2 - 45;

  // Convert polar to cartesian coordinates - clamp to stay inside circle
  const polarToCart = (direction: number, speed: number, clampToCircle: boolean = false) => {
    // Direction: 0° = North (up), clockwise
    const rad = ((direction - 90) * Math.PI) / 180;
    let radius = (speed / calculatedMaxSpeed) * maxRadius;
    // Clamp radius to ensure points stay inside the outer circle
    if (clampToCircle) {
      radius = Math.min(radius, maxRadius);
    }
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  // Generate speed circles for legend
  const speedCircles = useMemo(() => {
    const circles = [];
    const step = calculatedMaxSpeed / 4;
    for (let i = 1; i <= 4; i++) {
      circles.push({
        speed: step * i,
        radius: (step * i / calculatedMaxSpeed) * maxRadius,
      });
    }
    return circles;
  }, [calculatedMaxSpeed, maxRadius]);

  return (
    <Card data-testid="card-wind-rose-scatter">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal">{title}</CardTitle>
          <Badge variant="outline" className="text-xs">
            {stats.observations} points
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg width={size} height={size} className="overflow-visible">
          {/* Background circles with speed labels */}
          {speedCircles.map((circle, i) => (
            <g key={i}>
              <circle
                cx={center}
                cy={center}
                r={circle.radius}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={1}
                strokeDasharray={i === speedCircles.length - 1 ? "none" : "4 4"}
              />
              <text
                x={center + 5}
                y={center - circle.radius + 12}
                className="fill-muted-foreground text-[9px]"
              >
                {circle.speed.toFixed(0)} km/h
              </text>
            </g>
          ))}

          {/* Direction lines and labels */}
          {DIRECTIONS.map((dir, i) => {
            const angle = i * 22.5;
            const endPos = polarToCart(angle, calculatedMaxSpeed);
            const labelPos = polarToCart(angle, calculatedMaxSpeed * 1.15);
            const isCardinal = i % 4 === 0;
            
            return (
              <g key={dir}>
                <line
                  x1={center}
                  y1={center}
                  x2={endPos.x}
                  y2={endPos.y}
                  stroke="currentColor"
                  strokeOpacity={isCardinal ? 0.2 : 0.08}
                  strokeWidth={isCardinal ? 1 : 0.5}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`fill-foreground ${isCardinal ? 'text-xs font-medium' : 'text-[10px]'}`}
                >
                  {dir}
                </text>
              </g>
            );
          })}

          {/* Data points - colored by speed, clamped to circle boundary */}
          {data.map((point, i) => {
            const pos = polarToCart(point.direction, point.speed, true); // Clamp to circle
            const color = getSpeedColor(point.speed);
            return (
              <circle
                key={i}
                cx={pos.x}
                cy={pos.y}
                r={3}
                fill={color}
                stroke="white"
                strokeWidth={0.5}
                opacity={0.85}
                className="transition-opacity hover:opacity-100"
              >
                <title>
                  {point.speed.toFixed(1)} km/h @ {point.direction.toFixed(0)}°
                  {point.timestamp && `\n${point.timestamp.toLocaleTimeString()}`}
                </title>
              </circle>
            );
          })}

          {/* Center dot */}
          <circle
            cx={center}
            cy={center}
            r={4}
            fill="currentColor"
            className="text-muted-foreground/50"
          />
        </svg>

        {/* Statistics */}
        <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-center w-full">
          <div className="rounded bg-muted/50 p-2">
            <div className="text-muted-foreground">Avg</div>
            <div className="font-normal">{stats.avgSpeed.toFixed(1)} km/h</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-muted-foreground">Max</div>
            <div className="font-normal">{stats.maxSpeed.toFixed(1)} km/h</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-muted-foreground">Min</div>
            <div className="font-normal">{stats.minSpeed.toFixed(1)} km/h</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-muted-foreground">Dominant</div>
            <div className="font-normal">{stats.dominantDirection}</div>
          </div>
        </div>

        {/* Legend */}
        {showLegend && activeClasses.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1">
            {activeClasses.map((sc) => (
              <div key={sc.label} className="flex items-center gap-1 text-[10px]">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: sc.color }}
                />
                <span className="text-muted-foreground">{sc.label}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { SPEED_COLOR_CLASSES, getSpeedColor };
