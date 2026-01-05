import { useMemo } from "react";

interface HeatMapProps {
  data: Array<{
    timestamp: string;
    value: number;
  }>;
  title: string;
  unit: string;
  colorScale?: "temperature" | "humidity" | "pressure" | "wind" | "rain";
}

const COLOR_SCALES = {
  temperature: [
    { threshold: -10, color: "#1e3a8a" },
    { threshold: 0, color: "#3b82f6" },
    { threshold: 10, color: "#22c55e" },
    { threshold: 20, color: "#eab308" },
    { threshold: 30, color: "#f97316" },
    { threshold: 40, color: "#dc2626" },
  ],
  humidity: [
    { threshold: 0, color: "#fef3c7" },
    { threshold: 20, color: "#fcd34d" },
    { threshold: 40, color: "#34d399" },
    { threshold: 60, color: "#22d3ee" },
    { threshold: 80, color: "#3b82f6" },
    { threshold: 100, color: "#1e3a8a" },
  ],
  pressure: [
    { threshold: 980, color: "#7c3aed" },
    { threshold: 1000, color: "#3b82f6" },
    { threshold: 1013, color: "#22c55e" },
    { threshold: 1020, color: "#eab308" },
    { threshold: 1040, color: "#f97316" },
  ],
  wind: [
    { threshold: 0, color: "#e0f2fe" },
    { threshold: 10, color: "#7dd3fc" },
    { threshold: 20, color: "#38bdf8" },
    { threshold: 30, color: "#0284c7" },
    { threshold: 50, color: "#7c3aed" },
    { threshold: 80, color: "#dc2626" },
  ],
  rain: [
    { threshold: 0, color: "#fef3c7" },
    { threshold: 1, color: "#bef264" },
    { threshold: 5, color: "#22c55e" },
    { threshold: 10, color: "#0ea5e9" },
    { threshold: 25, color: "#3b82f6" },
    { threshold: 50, color: "#1e3a8a" },
  ],
};

function getColorForValue(value: number, scale: typeof COLOR_SCALES.temperature): string {
  for (let i = scale.length - 1; i >= 0; i--) {
    if (value >= scale[i].threshold) {
      return scale[i].color;
    }
  }
  return scale[0].color;
}

export function HeatMap({ data, title, unit, colorScale = "temperature" }: HeatMapProps) {
  const { grid, hours, minValue, maxValue } = useMemo(() => {
    const hourlyData: Record<string, Record<number, number[]>> = {};
    let min = Infinity;
    let max = -Infinity;

    data.forEach((item) => {
      const date = new Date(item.timestamp);
      const dayKey = date.toISOString().split("T")[0];
      const hour = date.getHours();

      if (!hourlyData[dayKey]) {
        hourlyData[dayKey] = {};
      }
      if (!hourlyData[dayKey][hour]) {
        hourlyData[dayKey][hour] = [];
      }
      hourlyData[dayKey][hour].push(item.value);
      
      if (item.value < min) min = item.value;
      if (item.value > max) max = item.value;
    });

    const sortedDays = Object.keys(hourlyData).sort().slice(-7);
    const hoursArray = Array.from({ length: 24 }, (_, i) => i);

    const gridData = sortedDays.map((day) => ({
      day,
      hours: hoursArray.map((hour) => {
        const values = hourlyData[day]?.[hour] || [];
        return values.length > 0
          ? values.reduce((a, b) => a + b, 0) / values.length
          : null;
      }),
    }));

    return {
      grid: gridData,
      days: sortedDays,
      hours: hoursArray,
      minValue: min === Infinity ? 0 : min,
      maxValue: max === -Infinity ? 100 : max,
    };
  }, [data]);

  const scale = COLOR_SCALES[colorScale];

  const formatDay = (day: string) => {
    const date = new Date(day);
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const formatHour = (hour: number) => {
    return `${hour.toString().padStart(2, "0")}:00`;
  };

  if (data.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No data available for heat map
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{title}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{minValue.toFixed(1)}</span>
          <div className="flex h-3 w-24 rounded overflow-hidden">
            {scale.map((s, i) => (
              <div
                key={i}
                className="flex-1"
                style={{ backgroundColor: s.color }}
              />
            ))}
          </div>
          <span>{maxValue.toFixed(1)} {unit}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="flex">
            <div className="w-20 shrink-0" />
            <div className="flex flex-1">
              {hours.filter((_, i) => i % 3 === 0).map((hour) => (
                <div
                  key={hour}
                  className="flex-1 text-center text-xs text-muted-foreground"
                  style={{ minWidth: "12px" }}
                >
                  {formatHour(hour)}
                </div>
              ))}
            </div>
          </div>

          {grid.map((row) => (
            <div key={row.day} className="flex items-center">
              <div className="w-20 shrink-0 text-xs text-muted-foreground pr-2 text-right">
                {formatDay(row.day)}
              </div>
              <div className="flex flex-1 gap-px">
                {row.hours.map((value, hourIndex) => (
                  <div
                    key={hourIndex}
                    className="flex-1 h-6 rounded-sm transition-opacity hover:opacity-80"
                    style={{
                      backgroundColor: value !== null
                        ? getColorForValue(value, scale)
                        : "transparent",
                      minWidth: "12px",
                    }}
                    title={value !== null
                      ? `${formatDay(row.day)} ${formatHour(hourIndex)}: ${value.toFixed(1)} ${unit}`
                      : "No data"
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
