// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateDataCompleteness, type DataCompletenessResult } from "@shared/utils/calc";

interface DataCompletenessCardProps {
  actualReadings: number;
  expectedReadings: number;
  /** Array of gap durations in minutes */
  gaps?: number[];
  /** Period label e.g. "30 days" */
  periodLabel?: string;
}

export function DataCompletenessCard({
  actualReadings,
  expectedReadings,
  gaps = [],
  periodLabel = '30 days',
}: DataCompletenessCardProps) {
  const result: DataCompletenessResult = calculateDataCompleteness(actualReadings, expectedReadings, gaps);

  // Color based on completeness
  const getColor = (pct: number) => {
    if (pct >= 99) return '#22c55e';
    if (pct >= 95) return '#86efac';
    if (pct >= 90) return '#f59e0b';
    if (pct >= 80) return '#f97316';
    return '#dc2626';
  };

  const color = getColor(result.overallPercent);
  const gaugePercent = Math.min(100, result.overallPercent);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-data-completeness">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Data Completeness
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Main percentage */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(result.overallPercent, 1)}
              </span>
              <span className="text-sm font-normal text-black">%</span>
            </div>
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: color + '20', color }}
            >
              {result.overallPercent >= 99 ? 'Excellent' : result.overallPercent >= 95 ? 'Good' : result.overallPercent >= 90 ? 'Fair' : 'Poor'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${gaugePercent}%`, backgroundColor: color }}
              />
            </div>
            <div className="flex justify-between text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <span>{periodLabel}</span>
              <span>{result.actualReadings} / {result.expectedReadings} readings</span>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Missing</p>
              <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.expectedReadings - result.actualReadings}
              </p>
            </div>
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Gaps</p>
              <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.gapCount}
              </p>
            </div>
            <div className="text-center p-1.5 bg-gray-50 rounded">
              <p className="text-xs text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Longest Gap</p>
              <p className="text-xs font-medium text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {result.longestGapMinutes >= 60
                  ? `${safeFixed(result.longestGapMinutes / 60, 1)} hrs`
                  : `${result.longestGapMinutes} min`}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
