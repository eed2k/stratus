// Stratus Weather System
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface YearlyRainfall {
  year: number;
  total: number;
  readings: number;
  isCurrent: boolean;
}

interface RainfallYearlyCardProps {
  yearlyData: YearlyRainfall[];
}

export function RainfallYearlyCard({ yearlyData }: RainfallYearlyCardProps) {
  if (!yearlyData || yearlyData.length === 0) return null;

  // Show max 6 years, chronological order for chart (oldest → newest)
  const displayData = yearlyData.slice(0, 6).sort((a, b) => a.year - b.year);

  // Chart data: year on x-axis, total on y-axis
  const chartData = displayData.map(d => ({
    year: d.year.toString(),
    total: d.total,
    isCurrent: d.isCurrent,
  }));

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-rainfall-yearly">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Rainfall Totals (Yearly)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Grid display */}
          <div className={`grid gap-2 ${displayData.length <= 3 ? 'grid-cols-3' : displayData.length === 4 ? 'grid-cols-4' : displayData.length === 5 ? 'grid-cols-5' : 'grid-cols-6'}`}>
            {displayData.map(({ year, total, isCurrent }) => (
              <div key={year} className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-center">
                <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {year}{isCurrent ? ' *' : ''}
                </p>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(total, 1)} mm
                </p>
              </div>
            ))}
          </div>

          {/* Line chart comparison */}
          {displayData.length > 1 && (
          <div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 11, fill: '#374151', fontFamily: 'Arial, Helvetica, sans-serif' }}
                  tickLine={false}
                  axisLine={{ stroke: '#d1d5db' }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6b7280', fontFamily: 'Arial, Helvetica, sans-serif' }}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                  tickFormatter={(v: number) => `${v}`}
                />
                <Tooltip
                  formatter={(value: number) => [`${safeFixed(value, 1)} mm`, 'Rainfall']}
                  contentStyle={{ fontSize: 12, fontFamily: 'Arial, Helvetica, sans-serif', borderRadius: 6, border: '1px solid #d1d5db' }}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 4, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#2563eb' }}
                />
              </LineChart>
            </ResponsiveContainer>
            {displayData.some(d => d.isCurrent) && (
              <p className="text-[9px] text-gray-400 text-right mt-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                * year to date
              </p>
            )}
          </div>
          )}

          {yearlyData.length > 6 && (
            <p className="text-[10px] text-gray-400 text-center" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Showing 6 of {yearlyData.length} years
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
