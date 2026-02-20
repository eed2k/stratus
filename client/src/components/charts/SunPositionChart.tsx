import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";
import { safeFixed } from "@/lib/utils";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";

interface SunPositionChartProps {
  latitude: number;
  longitude: number;
  /** Current solar elevation in degrees */
  currentElevation: number;
  /** Current solar azimuth in degrees */
  currentAzimuth: number;
}

interface SunPoint {
  azimuth: number;
  elevation: number;
  hour: number;
  label: string;
  isCurrent: boolean;
  isNight: boolean;
}

/**
 * Sun Position Chart showing solar azimuth vs elevation trajectory for the current day.
 * The chart displays the sun's path across the sky dome, with the current position highlighted.
 */
export function SunPositionChart({
  latitude,
  longitude,
  currentElevation,
  currentAzimuth,
}: SunPositionChartProps) {
  const sunPath = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    const points: SunPoint[] = [];

    // Calculate sun position for every 15 minutes across the day
    for (let m = 0; m < 24 * 60; m += 15) {
      const h = m / 60;
      const time = new Date(now);
      time.setHours(Math.floor(h), (h % 1) * 60, 0, 0);

      const dayOfYear = Math.floor(
        (time.getTime() - new Date(time.getFullYear(), 0, 0).getTime()) / 86400000
      );
      const declination =
        23.45 * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180);

      // Equation of time (minutes)
      const B = ((360 / 365) * (dayOfYear - 81) * Math.PI) / 180;
      const eqOfTime =
        9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

      const timezoneOffset = -time.getTimezoneOffset() / 60;
      const trueSolarTime =
        ((h * 60 + eqOfTime + 4 * longitude - 60 * timezoneOffset) % 1440);
      const hourAngle = trueSolarTime / 4 < 0
        ? trueSolarTime / 4 + 180
        : trueSolarTime / 4 - 180;

      const latRad = (latitude * Math.PI) / 180;
      const decRad = (declination * Math.PI) / 180;
      const haRad = (hourAngle * Math.PI) / 180;

      const zenith = Math.acos(
        Math.sin(latRad) * Math.sin(decRad) +
          Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad)
      );
      const elevation = 90 - (zenith * 180) / Math.PI;

      // Azimuth
      let azimuth: number;
      const zenithDeg = zenith * 180 / Math.PI;
      if (hourAngle > 0) {
        azimuth =
          (Math.acos(
            (Math.sin(latRad) * Math.cos(zenith) - Math.sin(decRad)) /
              (Math.cos(latRad) * Math.sin(zenith))
          ) *
            180) /
            Math.PI +
          180;
        azimuth = azimuth % 360;
      } else {
        azimuth =
          540 -
          (Math.acos(
            (Math.sin(latRad) * Math.cos(zenith) - Math.sin(decRad)) /
              (Math.cos(latRad) * Math.sin(zenith))
          ) *
            180) /
            Math.PI;
        azimuth = azimuth % 360;
      }

      if (!isNaN(elevation) && !isNaN(azimuth)) {
        const hourInt = Math.floor(h);
        const minuteInt = Math.round((h % 1) * 60);
        points.push({
          azimuth: Math.round(azimuth * 10) / 10,
          elevation: Math.round(elevation * 10) / 10,
          hour: h,
          label: `${String(hourInt).padStart(2, "0")}:${String(minuteInt).padStart(2, "0")}`,
          isCurrent: Math.abs(h - currentHour) < 0.25,
          isNight: elevation < 0,
        });
      }
    }

    return points;
  }, [latitude, longitude]);

  // Separate daytime and nighttime points
  const daytimePoints = sunPath.filter((p) => !p.isNight);
  const currentPoint = sunPath.find((p) => p.isCurrent);

  // Find sunrise and sunset azimuths for reference
  const sunrisePoint = daytimePoints.length > 0 ? daytimePoints[0] : null;
  const sunsetPoint = daytimePoints.length > 0 ? daytimePoints[daytimePoints.length - 1] : null;
  const maxElevation = daytimePoints.length > 0 ? Math.max(...daytimePoints.map((p) => p.elevation)) : 0;

  return (
    <Card className="border border-gray-300 bg-white">
      <CardHeader className="pb-2">
        <CardTitle
          className="text-sm font-normal text-black"
          style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
        >
          Sun Position (Azimuth vs Elevation)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Key metrics */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-gray-200 bg-orange-50 p-2">
              <p className="text-[10px] text-orange-600" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>Azimuth</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                {safeFixed(currentAzimuth, 1)}°
              </p>
            </div>
            <div className="rounded border border-gray-200 bg-yellow-50 p-2">
              <p className="text-[10px] text-yellow-600" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>Elevation</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                {safeFixed(currentElevation, 1)}°
              </p>
            </div>
            <div className="rounded border border-gray-200 bg-amber-50 p-2">
              <p className="text-[10px] text-amber-600" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>Peak</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                {safeFixed(maxElevation, 1)}°
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  dataKey="azimuth"
                  name="Azimuth"
                  unit="°"
                  domain={[0, 360]}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  ticks={[0, 45, 90, 135, 180, 225, 270, 315, 360]}
                  tickFormatter={(v) => {
                    const labels: Record<number, string> = {
                      0: "N",
                      45: "NE",
                      90: "E",
                      135: "SE",
                      180: "S",
                      225: "SW",
                      270: "W",
                      315: "NW",
                      360: "N",
                    };
                    return labels[v] || `${v}°`;
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="elevation"
                  name="Elevation"
                  unit="°"
                  domain={[-5, (dataMax: number) => Math.max(dataMax + 5, 45)]}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: "#e5e7eb" }}
                  label={{
                    value: "Elevation (°)",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 10, fill: "#6b7280" },
                  }}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: "Horizon", fontSize: 9, fill: "#94a3b8" }} />
                <Tooltip
                  content={({ active, payload }: any) => {
                    if (active && payload && payload.length > 0) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded border border-gray-200 bg-white p-2 shadow-sm text-xs" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                          <p className="font-medium text-black">Time: {data.label}</p>
                          <p className="text-gray-600">Azimuth: {safeFixed(data.azimuth, 1)}°</p>
                          <p className="text-gray-600">Elevation: {safeFixed(data.elevation, 1)}°</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                {/* Sun path trajectory */}
                <Scatter
                  name="Sun Path"
                  data={daytimePoints}
                  fill="#fbbf24"
                  line={{ stroke: "#f59e0b", strokeWidth: 2 }}
                  lineType="fitting"
                >
                  {daytimePoints.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.isCurrent ? "#ef4444" : "#fbbf24"}
                      r={entry.isCurrent ? 7 : 3}
                      stroke={entry.isCurrent ? "#b91c1c" : "none"}
                      strokeWidth={entry.isCurrent ? 2 : 0}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Sunrise/Sunset info */}
          <div className="flex justify-between text-[10px] text-gray-500" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
            {sunrisePoint && (
              <span>Sunrise: {sunrisePoint.label} ({safeFixed(sunrisePoint.azimuth, 0)}°)</span>
            )}
            {sunsetPoint && (
              <span>Sunset: {sunsetPoint.label} ({safeFixed(sunsetPoint.azimuth, 0)}°)</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
