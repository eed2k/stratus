import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMemo } from "react";
import { safeFixed } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
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
 * Line chart with azimuth on X-axis and elevation on Y-axis, blue line.
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

  // Only daytime points for the line chart
  const daytimePoints = sunPath.filter((p) => !p.isNight);

  // Find sunrise and sunset azimuths for reference
  const sunrisePoint = daytimePoints.length > 0 ? daytimePoints[0] : null;
  const sunsetPoint = daytimePoints.length > 0 ? daytimePoints[daytimePoints.length - 1] : null;
  const maxElevation = daytimePoints.length > 0 ? Math.max(...daytimePoints.map((p) => p.elevation)) : 0;

  // Custom dot to highlight current position
  const renderDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.isCurrent) {
      return (
        <circle cx={cx} cy={cy} r={6} fill="#1d4ed8" stroke="#1e3a5f" strokeWidth={2} />
      );
    }
    return null;
  };

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
            <div className="rounded border border-gray-300 bg-white p-2">
              <p className="text-[10px] text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>Azimuth</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                {safeFixed(currentAzimuth, 1)}Â°
              </p>
            </div>
            <div className="rounded border border-gray-300 bg-white p-2">
              <p className="text-[10px] text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>Elevation</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                {safeFixed(currentElevation, 1)}Â°
              </p>
            </div>
            <div className="rounded border border-gray-300 bg-white p-2">
              <p className="text-[10px] text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>Peak</p>
              <p className="text-sm font-normal text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                {safeFixed(maxElevation, 1)}Â°
              </p>
            </div>
          </div>

          {/* Line Chart - Azimuth (X) vs Elevation (Y), blue line */}
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daytimePoints} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="azimuth"
                  type="number"
                  name="Azimuth"
                  domain={[
                    (dataMin: number) => Math.floor(dataMin / 10) * 10,
                    (dataMax: number) => Math.ceil(dataMax / 10) * 10,
                  ]}
                  tick={{ fontSize: 10, fill: "#000" }}
                  tickLine={false}
                  axisLine={{ stroke: "#d1d5db" }}
                  label={{
                    value: "Azimuth (Â°)",
                    position: "insideBottom",
                    offset: -5,
                    style: { fontSize: 10, fill: "#000" },
                  }}
                />
                <YAxis
                  dataKey="elevation"
                  type="number"
                  name="Elevation"
                  domain={[0, (dataMax: number) => Math.max(dataMax + 5, 45)]}
                  tick={{ fontSize: 10, fill: "#000" }}
                  tickLine={false}
                  axisLine={{ stroke: "#d1d5db" }}
                  label={{
                    value: "Elevation (Â°)",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 10, fill: "#000" },
                  }}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: "Horizon", fontSize: 9, fill: "#94a3b8" }} />
                <Tooltip
                  content={({ active, payload }: any) => {
                    if (active && payload && payload.length > 0) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded border border-gray-300 bg-white p-2 shadow-sm text-xs" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
                          <p className="text-black">Time: {data.label}</p>
                          <p className="text-black">Azimuth: {safeFixed(data.azimuth, 1)}Â°</p>
                          <p className="text-black">Elevation: {safeFixed(data.elevation, 1)}Â°</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="elevation"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={renderDot as any}
                  activeDot={{ r: 5, fill: "#1d4ed8", stroke: "#1e3a5f", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Sunrise/Sunset info */}
          <div className="flex justify-between text-[10px] text-black" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
            {sunrisePoint && (
              <span>Sunrise: {sunrisePoint.label} ({safeFixed(sunrisePoint.azimuth, 0)}Â°)</span>
            )}
            {sunsetPoint && (
              <span>Sunset: {sunsetPoint.label} ({safeFixed(sunsetPoint.azimuth, 0)}Â°)</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
