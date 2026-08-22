// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useState, useMemo, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/**
 * Format a number to a maximum of 3 decimal places
 * Removes trailing zeros for cleaner display
 */
const formatTooltipValue = (value: number | string): string => {
  if (typeof value === 'number') {
    return parseFloat(value.toFixed(3)).toString();
  }
  return String(value);
};

/**
 * Custom tooltip component with decimal precision control and daily aggregation support
 */
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  
  const dataPoint = payload[0]?.payload;
  const isDailyAggregated = dataPoint?._readings != null;

  // Compact charts use a numeric (epoch ms) x-axis, so the raw label is a
  // number. Render it as a local date/time rather than a bare millisecond count.
  const headline = typeof label === 'number'
    ? new Date(label).toLocaleString([], {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : label;

  return (
    <div className="bg-card border border-border rounded-md p-2 shadow-md text-xs">
      <p className="font-medium mb-1">
        {headline}{isDailyAggregated ? ` (${dataPoint._readings} readings)` : ''}
      </p>
      {payload.map((entry: any, index: number) => {
        const minKey = entry.dataKey + 'Min';
        const maxKey = entry.dataKey + 'Max';
        const hasMinMax = isDailyAggregated && dataPoint[minKey] != null && dataPoint[maxKey] != null;
        
        return (
          <div key={index}>
            <p style={{ color: entry.color }}>
              {isDailyAggregated ? `Avg ${entry.name}` : entry.name}: {formatTooltipValue(entry.value)} {entry.payload?.unit || ''}
            </p>
            {hasMinMax && (
              <p className="text-black ml-2" style={{ fontSize: '0.65rem' }}>
                Min: {formatTooltipValue(dataPoint[minKey])} / Max: {formatTooltipValue(dataPoint[maxKey])}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Gutter reserved for each y-axis in compact mode.
 *
 * Wide enough for four significant figures at 8px (e.g. "846.2", "100") so the
 * left and right value columns both render in a half-width dashboard cell
 * instead of being clipped. The HTML time-label row below the plot uses the
 * same figure for its padding, which is what keeps the labels aligned with the
 * plotting area.
 */
const COMPACT_AXIS_W = 30;

interface ChartDataPoint {
  timestamp: string;
  [key: string]: string | number | null;
}

interface ChartSeries {
  dataKey: string;
  name: string;
  color: string;
  unit?: string;
}

interface WeatherChartProps {
  title: string;
  data: ChartDataPoint[];
  series: ChartSeries[];
  timeRanges?: string[];
  defaultRange?: string;
  onRangeChange?: (range: string) => void;
  heightClass?: string; // override chart area height, e.g. "h-full" for flexible layouts
  compact?: boolean; // hide legend, colour-code title by series, 6-hour time ticks
  /**
   * Give the second and later series their own axis on the right.
   *
   * Without this, pairing quantities of different magnitude (ET0 around 5 mm/day
   * against solar irradiance in the hundreds of W/m2) squashes the smaller one
   * flat against the baseline and it reads as a dead sensor. Each axis is tinted
   * to match its series so it is obvious which scale belongs to which line.
   */
  dualAxis?: boolean;
}

export const WeatherChart = memo(function WeatherChart({
  title,
  data,
  series,
  timeRanges = [],
  defaultRange = "24hr",
  onRangeChange,
  heightClass,
  compact = false,
  dualAxis = false,
}: WeatherChartProps) {
  // A second axis only makes sense when there is a second series to put on it.
  const useDualAxis = dualAxis && series.length > 1;
  const leftColour = series[0]?.color;
  const rightColour = series[1]?.color;
  const [selectedRange, setSelectedRange] = useState(defaultRange);

  const handleRangeChange = (range: string) => {
    setSelectedRange(range);
    onRangeChange?.(range);
  };

  /**
   * Compact charts plot against a NUMERIC time axis.
   *
   * The default x-axis is a *category* axis keyed on the ISO timestamp string.
   * Recharts derives category ticks from the domain and thins them with
   * `interval`; it does not honour an explicit `ticks` list, and `interval={0}`
   * means "label every category" - roughly 500 labels inside a 200px compact
   * cell, which collapses into an unreadable smear. That is why the compact
   * charts appeared to have no x-axis values at all.
   *
   * A numeric axis fixes it properly: `domain` and `ticks` are respected
   * exactly, so we choose a handful of evenly spaced instants and Recharts
   * draws precisely those. `__t` is epoch milliseconds derived from the
   * timestamp; it is added only in compact mode so the standard dashboard
   * keeps its existing category behaviour.
   */
  const compactData = useMemo(() => {
    if (!compact) return data;
    return data.map((d) => ({ ...d, __t: new Date(String(d.timestamp)).getTime() }));
  }, [compact, data]);

  const compactDomain = useMemo<[number, number] | undefined>(() => {
    if (!compact) return undefined;
    const ts = (compactData as Array<{ __t?: number }>)
      .map((d) => d.__t)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (ts.length === 0) return undefined;
    return [Math.min(...ts), Math.max(...ts)];
  }, [compact, compactData]);

  /** Four evenly spaced instants across the window, ends included. */
  const compactTicks = useMemo(() => {
    if (!compact || !compactDomain) return undefined;
    const [lo, hi] = compactDomain;
    if (hi <= lo) return [lo];
    const want = 4;
    const out: number[] = [];
    for (let i = 0; i < want; i++) {
      out.push(Math.round(lo + ((hi - lo) * i) / (want - 1)));
    }
    return out;
  }, [compact, compactDomain]);

  /** Epoch millis -> HH:mm for the compact axis. */
  const formatTimeTick = (t: number) => {
    const d = new Date(t);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // Coloured title: each series name in its own colour, joined by " vs "
  const colouredTitle = (
    <span>
      {series.map((s, i) => (
        <span key={s.dataKey}>
          {i > 0 && <span className="text-black"> vs </span>}
          <span style={{ color: s.color }}>{s.name}</span>
        </span>
      ))}
    </span>
  );

  return (
    <Card data-testid={`card-chart-${title.toLowerCase().replace(/\s+/g, '-')}`} className={heightClass ? "h-full flex flex-col" : undefined}>
      {/* Compact cells are short, so the card chrome is trimmed hard: shadcn's
          default p-6 padding plus an 18px title would eat most of the height
          the plot and its axis need. */}
      <CardHeader className={compact
        ? "flex flex-row flex-wrap items-center justify-between gap-2 p-2 pb-0 space-y-0"
        : "flex flex-row flex-wrap items-center justify-between gap-4 pb-2"}>
        <CardTitle className={compact ? "text-xs font-normal leading-tight" : "text-lg font-normal"}>
          {compact ? colouredTitle : title}
        </CardTitle>
        <div className="flex flex-wrap gap-1">
          {timeRanges.map((range) => (
            <Button
              key={range}
              variant={selectedRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => handleRangeChange(range)}
              data-testid={`button-range-${range}`}
            >
              {range}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent
        className={compact
          ? "flex-1 min-h-0 p-2 pt-1 flex flex-col"
          : (heightClass ? "flex-1 min-h-0" : undefined)}
      >
        <div className={compact ? "flex-1 min-h-0" : (heightClass ?? "h-72")}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={compactData}
              margin={compact
                ? { top: 2, right: useDualAxis ? 2 : 8, left: 0, bottom: 0 }
                : { top: 5, right: useDualAxis ? 4 : 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              {compact ? (
                /**
                 * Compact: the axis is kept for scaling but NOT drawn.
                 *
                 * Three separate attempts to make Recharts draw readable tick
                 * labels in these short cells failed (category axis ignores an
                 * explicit `ticks` list; `interval={0}` labels all ~500 points;
                 * a reserved `height` still got squeezed). The labels are now
                 * rendered as ordinary HTML directly under the plot, which does
                 * not depend on Recharts' layout heuristics at all - so they
                 * cannot silently disappear, and their height is known exactly,
                 * which keeps the single-screen layout fitting.
                 */
                <XAxis
                  dataKey="__t"
                  type="number"
                  scale="time"
                  domain={compactDomain ?? ['dataMin', 'dataMax']}
                  ticks={compactTicks}
                  tickFormatter={formatTimeTick}
                  tick={{ fontSize: 8 }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={2}
                  height={14}
                  allowDataOverflow={false}
                />
              ) : (
                <XAxis
                  dataKey="timestamp"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
              )}
              {/*
                * The two axes are returned as an ARRAY, never a Fragment.
                *
                * Recharts discovers its axes by walking the chart's direct
                * children and matching component types. React.Children flattens
                * arrays but treats a Fragment as one opaque child, so axes
                * wrapped in <>...</> are invisible to Recharts: it silently
                * renders the chart with no y-axis at all. That is exactly why
                * every dual-axis chart here was missing its value labels.
                */}
              {useDualAxis ? [
                // Compact: narrower gutters and a smaller face so both value
                // columns fit inside a half-width grid cell without clipping.
                <YAxis
                  key="y-left"
                  yAxisId="left"
                  tick={{ fontSize: compact ? 8 : 11, fill: leftColour }}
                  tickLine={false}
                  axisLine={false}
                  width={compact ? COMPACT_AXIS_W : 40}
                  tickCount={compact ? 4 : undefined}
                  domain={["auto", "auto"]}
                />,
                <YAxis
                  key="y-right"
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: compact ? 8 : 11, fill: rightColour }}
                  tickLine={false}
                  axisLine={false}
                  width={compact ? COMPACT_AXIS_W : 44}
                  tickCount={compact ? 4 : undefined}
                  domain={["auto", "auto"]}
                />,
              ] : (
                <YAxis
                  tick={{ fontSize: compact ? 8 : 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={compact ? COMPACT_AXIS_W : 40}
                  tickCount={compact ? 4 : undefined}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              {compact ? (
                // Compact dashboards still need a legend so viewers can tell the
                // lines apart. Pin it to the TOP: a bottom legend sits underneath
                // the x-axis and, in these short cells, steals the space the time
                // labels need - which is why the compact charts previously showed
                // neither a legend nor an x-axis.
                <Legend
                  verticalAlign="top"
                  align="center"
                  height={12}
                  iconType="plainline"
                  iconSize={10}
                  wrapperStyle={{ fontSize: 9, lineHeight: "10px" }}
                />
              ) : (
                <Legend iconSize={0} />
              )}
              {series.map((s, i) => (
                <Line
                  key={s.dataKey}
                  {...(useDualAxis ? { yAxisId: i === 0 ? "left" : "right" } : {})}
                  type="monotone"
                  dataKey={s.dataKey}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={true}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
});
