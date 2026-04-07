// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { calculateGDD, accumulateGDD, calculateChillUnit } from "@shared/utils/calc";
import { useState } from "react";

interface GrowingDegreeDaysCardProps {
  /** Array of daily min/max readings for the season so far */
  dailyData?: { min: number; max: number; date: string }[];
  /** Current temperature (for chill unit display even without daily data) */
  currentTemperature?: number;
  /** Current daily min */
  todayMin?: number;
  /** Current daily max */
  todayMax?: number;
}

const TBASE_OPTIONS = [
  { label: '5 °C', value: 5, crops: 'Cool-season grasses', tCap: 25 },
  { label: '8 °C', value: 8, crops: 'Wheat, barley', tCap: 30 },
  { label: '10 °C', value: 10, crops: 'Maize, sorghum', tCap: 30 },
  { label: '12 °C', value: 12, crops: 'Cotton, rice', tCap: 35 },
];

const CROP_MILESTONES: Record<number, { name: string; stages: { gdd: number; label: string }[] }> = {
  10: {
    name: 'Maize',
    stages: [
      { gdd: 60, label: 'Emergence' },
      { gdd: 200, label: 'V6' },
      { gdd: 475, label: 'Tasselling' },
      { gdd: 660, label: 'Silking' },
      { gdd: 1100, label: 'Dent' },
      { gdd: 1400, label: 'Maturity' },
    ],
  },
  8: {
    name: 'Wheat',
    stages: [
      { gdd: 100, label: 'Emergence' },
      { gdd: 450, label: 'Tillering' },
      { gdd: 800, label: 'Stem extension' },
      { gdd: 1050, label: 'Heading' },
      { gdd: 1500, label: 'Maturity' },
    ],
  },
};

export function GrowingDegreeDaysCard({
  dailyData,
  currentTemperature,
  todayMin,
  todayMax,
}: GrowingDegreeDaysCardProps) {
  const [tBase, setTBase] = useState(10);

  // Lookup tCap for selected tBase
  const tCap = TBASE_OPTIONS.find(o => o.value === tBase)?.tCap ?? 30;

  // Today's GDD
  const todayGDD = todayMin != null && todayMax != null
    ? calculateGDD(todayMin, todayMax, tBase, tCap)
    : null;

  // Cumulative from daily data
  const cumulativeArray = dailyData && dailyData.length > 0
    ? accumulateGDD(dailyData.map(d => ({ min: d.min, max: d.max })), tBase, tCap)
    : [];
  const totalGDD = cumulativeArray.length > 0 ? cumulativeArray[cumulativeArray.length - 1] : 0;

  // Chill unit for current hour
  const currentCU = currentTemperature != null ? calculateChillUnit(currentTemperature) : null;

  // Milestones for selected Tbase
  const milestones = CROP_MILESTONES[tBase];

  // Find current stage
  const currentStage = milestones
    ? milestones.stages.filter(s => totalGDD >= s.gdd).pop()
    : null;
  const nextStage = milestones
    ? milestones.stages.find(s => totalGDD < s.gdd)
    : null;

  // Progress bar: % to final milestone
  const maxGDD = milestones ? milestones.stages[milestones.stages.length - 1].gdd : 1400;
  const progressPct = Math.min(100, (totalGDD / maxGDD) * 100);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-gdd">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Growing Degree Days
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Tbase selector */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-gray-500 mr-1" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>T<sub>base</sub>:</span>
            {TBASE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTBase(opt.value)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  tBase === opt.value
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                }`}
                style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
                title={opt.crops}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Main value */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {safeFixed(totalGDD, 0)}
              </span>
              <span className="text-sm font-normal text-gray-500">°Cd cumulative</span>
            </div>
            {todayGDD != null && (
              <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                +{safeFixed(todayGDD, 1)} today
              </span>
            )}
          </div>

          {/* Season progress bar */}
          {milestones && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-gray-400" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              <span>{milestones.name} season progress</span>
              <span>{safeFixed(progressPct, 0)}%</span>
            </div>
            <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-500 bg-green-500"
                style={{ width: `${progressPct}%` }}
              />
              {/* Milestone markers */}
              {milestones.stages.map(s => (
                <div
                  key={s.gdd}
                  className="absolute top-0 h-full w-px bg-gray-400"
                  style={{ left: `${(s.gdd / maxGDD) * 100}%` }}
                  title={`${s.label} (${s.gdd} °Cd)`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-gray-400" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              {milestones.stages.map(s => (
                <span key={s.gdd} className={totalGDD >= s.gdd ? 'text-green-600 font-medium' : ''}>
                  {s.label}
                </span>
              ))}
            </div>
          </div>
          )}

          {/* Current & next stage */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 bg-gray-50 rounded">
              <p className="text-[10px] text-gray-400 mb-0.5" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Current Stage</p>
              <p className="text-sm text-black font-medium" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {currentStage ? currentStage.label : 'Pre-emergence'}
              </p>
            </div>
            <div className="p-2 bg-gray-50 rounded">
              <p className="text-[10px] text-gray-400 mb-0.5" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Next Stage</p>
              <p className="text-sm text-black font-medium" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {nextStage ? `${nextStage.label} (${nextStage.gdd - Math.round(totalGDD)} °Cd)` : 'Complete'}
              </p>
            </div>
          </div>

          {/* Chill unit indicator */}
          {currentCU != null && (
          <div className="pt-2 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                Chill Unit (Infruitec)
              </p>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  currentCU > 0 ? 'bg-blue-100 text-blue-700' : currentCU < 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {currentCU > 0 ? `+${currentCU}` : currentCU} CU/hr
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Based on current temperature ({safeFixed(currentTemperature!, 1)} °C). Positive accumulation between 2.5–9 °C.
            </p>
          </div>
          )}

          {/* No season data message */}
          {(!dailyData || dailyData.length === 0) && (
          <p className="text-xs text-gray-400 italic" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Season data (daily min/max) required for cumulative GDD tracking.
            {todayGDD != null && ` Today's GDD: ${safeFixed(todayGDD, 1)} °Cd.`}
          </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
