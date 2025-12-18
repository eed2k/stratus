import { useMemo } from "react";

interface ContourPlotProps {
  data: Array<{
    x: number;
    y: number;
    value: number;
  }>;
  title: string;
  xLabel: string;
  yLabel: string;
  valueLabel: string;
  width?: number;
  height?: number;
}

const CONTOUR_COLORS = [
  "#1e3a8a",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#93c5fd",
  "#bfdbfe",
  "#fef3c7",
  "#fcd34d",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#dc2626",
];

function interpolateGrid(
  data: Array<{ x: number; y: number; value: number }>,
  gridSize: number
): number[][] {
  if (data.length === 0) {
    return Array(gridSize).fill(null).map(() => Array(gridSize).fill(0));
  }

  const xMin = Math.min(...data.map((d) => d.x));
  const xMax = Math.max(...data.map((d) => d.x));
  const yMin = Math.min(...data.map((d) => d.y));
  const yMax = Math.max(...data.map((d) => d.y));

  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const grid: number[][] = [];

  for (let j = 0; j < gridSize; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridSize; i++) {
      const targetX = xMin + (i / (gridSize - 1)) * xRange;
      const targetY = yMin + (j / (gridSize - 1)) * yRange;

      let weightedSum = 0;
      let weightSum = 0;

      data.forEach((point) => {
        const dx = point.x - targetX;
        const dy = point.y - targetY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const weight = 1 / (distance + 0.001);
        weightedSum += point.value * weight;
        weightSum += weight;
      });

      row.push(weightedSum / weightSum);
    }
    grid.push(row);
  }

  return grid;
}

export function ContourPlot({
  data,
  title,
  xLabel,
  yLabel,
  valueLabel,
  width = 400,
  height = 300,
}: ContourPlotProps) {
  const { grid, minValue, maxValue, xRange, yRange } = useMemo(() => {
    const gridSize = 20;
    const interpolated = interpolateGrid(data, gridSize);
    
    let min = Infinity;
    let max = -Infinity;
    
    interpolated.forEach((row) => {
      row.forEach((val) => {
        if (val < min) min = val;
        if (val > max) max = val;
      });
    });

    const xMin = data.length > 0 ? Math.min(...data.map((d) => d.x)) : 0;
    const xMax = data.length > 0 ? Math.max(...data.map((d) => d.x)) : 100;
    const yMin = data.length > 0 ? Math.min(...data.map((d) => d.y)) : 0;
    const yMax = data.length > 0 ? Math.max(...data.map((d) => d.y)) : 100;

    return {
      grid: interpolated,
      minValue: min === Infinity ? 0 : min,
      maxValue: max === -Infinity ? 100 : max,
      xRange: { min: xMin, max: xMax },
      yRange: { min: yMin, max: yMax },
    };
  }, [data]);

  const getColor = (value: number): string => {
    const range = maxValue - minValue || 1;
    const normalized = (value - minValue) / range;
    const colorIndex = Math.min(
      Math.floor(normalized * CONTOUR_COLORS.length),
      CONTOUR_COLORS.length - 1
    );
    return CONTOUR_COLORS[colorIndex];
  };

  const cellWidth = width / grid[0].length;
  const cellHeight = height / grid.length;

  if (data.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No data available for contour plot
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-medium">{title}</h3>

      <div className="flex gap-4">
        <div className="relative" style={{ width, height }}>
          <svg width={width} height={height} className="rounded">
            {grid.map((row, j) =>
              row.map((value, i) => (
                <rect
                  key={`${i}-${j}`}
                  x={i * cellWidth}
                  y={(grid.length - 1 - j) * cellHeight}
                  width={cellWidth + 1}
                  height={cellHeight + 1}
                  fill={getColor(value)}
                  className="transition-opacity hover:opacity-80"
                >
                  <title>
                    {xLabel}: {(xRange.min + (i / (grid[0].length - 1)) * (xRange.max - xRange.min)).toFixed(1)}
                    {"\n"}
                    {yLabel}: {(yRange.min + (j / (grid.length - 1)) * (yRange.max - yRange.min)).toFixed(1)}
                    {"\n"}
                    {valueLabel}: {value.toFixed(2)}
                  </title>
                </rect>
              ))
            )}
            
            {data.map((point, i) => {
              const x = ((point.x - xRange.min) / (xRange.max - xRange.min || 1)) * width;
              const y = height - ((point.y - yRange.min) / (yRange.max - yRange.min || 1)) * height;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={3}
                  fill="white"
                  stroke="black"
                  strokeWidth={1}
                />
              );
            })}
          </svg>

          <div className="absolute bottom-0 left-0 right-0 text-center text-xs text-muted-foreground mt-1">
            {xLabel}
          </div>
          <div
            className="absolute left-0 top-1/2 text-xs text-muted-foreground"
            style={{ transform: "rotate(-90deg) translateX(-50%)", transformOrigin: "left center" }}
          >
            {yLabel}
          </div>
        </div>

        <div className="flex flex-col justify-between py-2">
          <span className="text-xs text-muted-foreground">{maxValue.toFixed(1)}</span>
          <div className="flex flex-col h-full my-2">
            {CONTOUR_COLORS.slice().reverse().map((color, i) => (
              <div
                key={i}
                className="flex-1 w-4"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{minValue.toFixed(1)}</span>
          <span className="text-xs text-muted-foreground mt-1">{valueLabel}</span>
        </div>
      </div>
    </div>
  );
}
