// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { memo } from "react";

interface MpptChargerCardProps {
  solarVoltage: number | null;
  solarCurrent: number | null;
  solarPower: number | null;
  loadVoltage: number | null;
  loadCurrent: number | null;
  batteryVoltage: number | null;
  chargerState: number | null;
  mpptAbsiAvg: number | null;
  boardTemp?: number | null;
  mode?: number | null;
  label?: string;
  bulkFloatVoltage?: number | null;
  floatVoltage?: number | null;
  currentLimit?: number | null;
  absorbTimeLimit?: number | null;
  absorbFullCurrent?: number | null;
  vCalSlope?: number | null;
  iCalSlope?: number | null;
  /** Suffix for the test id so two regulators stay individually addressable. */
  testIdSuffix?: string;
}

// Victron MPPT charger state codes
const CHARGER_STATES: Record<number, { label: string; color: string; description: string }> = {
  0: { label: "Off", color: "text-black", description: "No charging - panel voltage too low or charger disabled" },
  2: { label: "Fault", color: "text-red-500", description: "Charger fault detected" },
  3: { label: "Bulk", color: "text-yellow-500", description: "Maximum current charging - battery below ~80% SOC" },
  4: { label: "Absorption", color: "text-orange-500", description: "Constant voltage (14.4V) - battery ~80-100% SOC" },
  5: { label: "Float", color: "text-green-500", description: "Maintenance voltage (13.8V) - battery fully charged" },
  6: { label: "Storage", color: "text-blue-400", description: "Reduced voltage - battery in long-term storage mode" },
  7: { label: "Equalize", color: "text-blue-500", description: "Controlled overcharge to balance cells" },
  252: { label: "Ext. Control", color: "text-teal-600", description: "Charger controlled by external device" },
};

function getChargerStateLabel(state: number | null): { label: string; color: string; description: string } {
  if (state === null || state === undefined) return { label: "Unknown", color: "text-black", description: "No data available" };
  const rounded = Math.round(state);
  return CHARGER_STATES[rounded] || { label: `State ${state}`, color: "text-black", description: "Unknown charger state" };
}

/**
 * Work out where the energy is going.
 *
 * The regulator reports panel input and load output but not battery current, so
 * the net flow into (or out of) the bank is derived: anything the panel supplies
 * that the load does not consume is charging the battery, and a shortfall is
 * being drawn from it. Values are in watts, battery current in amps.
 */
function getPowerFlow(
  solarVoltage: number | null,
  solarCurrent: number | null,
  solarPower: number | null,
  loadVoltage: number | null,
  loadCurrent: number | null,
  batteryVoltage: number | null,
): {
  inputPower: number | null;
  loadPower: number | null;
  netPower: number | null;
  batteryCurrent: number | null;
  status: "Charging" | "Discharging" | "Balanced" | "No data";
  color: string;
} {
  const inputPower = solarPower != null
    ? solarPower
    : (solarVoltage != null && solarCurrent != null ? solarVoltage * solarCurrent : null);
  const loadPower = loadVoltage != null && loadCurrent != null ? loadVoltage * loadCurrent : null;

  if (inputPower == null && loadPower == null) {
    return { inputPower, loadPower, netPower: null, batteryCurrent: null, status: "No data", color: "text-black" };
  }

  const netPower = (inputPower ?? 0) - (loadPower ?? 0);
  const batteryCurrent = batteryVoltage != null && batteryVoltage > 0 ? netPower / batteryVoltage : null;

  // A small dead band keeps sensor noise from flipping the label constantly.
  if (netPower > 0.25) return { inputPower, loadPower, netPower, batteryCurrent, status: "Charging", color: "text-green-600" };
  if (netPower < -0.25) return { inputPower, loadPower, netPower, batteryCurrent, status: "Discharging", color: "text-orange-500" };
  return { inputPower, loadPower, netPower, batteryCurrent, status: "Balanced", color: "text-black" };
}

/**
 * MPPT headroom: how far the panel sits above the battery.
 * A boost-less MPPT regulator needs the panel meaningfully above the bank
 * voltage before it can push current into it, so a low headroom in daylight
 * points at shading, a dirty panel or wiring loss rather than a flat battery.
 */
function getHeadroom(solarVoltage: number | null, batteryVoltage: number | null): {
  value: number | null;
  note: string;
  color: string;
} {
  if (solarVoltage == null || batteryVoltage == null || batteryVoltage <= 0) {
    return { value: null, note: "Needs both panel and battery voltage", color: "text-black" };
  }
  const value = solarVoltage - batteryVoltage;
  if (value < 1) return { value, note: "Too low to charge, check shading, soiling and wiring", color: "text-red-500" };
  if (value < 3) return { value, note: "Marginal, charging only in good light", color: "text-orange-500" };
  return { value, note: "Adequate for charging", color: "text-green-600" };
}

/** Board temperature bands. Regulators derate their output when they run hot. */
function getBoardTempStatus(temp: number | null | undefined): { note: string; color: string } {
  if (temp == null) return { note: "", color: "text-black" };
  if (temp >= 70) return { note: "Very hot, output is being derated", color: "text-red-500" };
  if (temp >= 55) return { note: "Hot, check ventilation", color: "text-orange-500" };
  if (temp <= -10) return { note: "Very cold, lithium charging may be inhibited", color: "text-blue-500" };
  return { note: "Normal", color: "text-green-600" };
}

function getBatteryHealth(voltage: number | null): { label: string; color: string; percentage: number } {
  if (voltage === null || voltage === undefined || voltage === 0) {
    return { label: "No Data", color: "text-black", percentage: 0 };
  }
  // 12V LiFePO4 (4S) battery range: 10.0V (empty) - 14.6V (full charge)
  const min = 10.0;
  const max = 14.6;
  const pct = Math.min(100, Math.max(0, ((voltage - min) / (max - min)) * 100));
  if (pct < 15) return { label: "Critical", color: "text-red-500", percentage: pct };
  if (pct < 30) return { label: "Low", color: "text-orange-500", percentage: pct };
  if (pct < 60) return { label: "Fair", color: "text-yellow-500", percentage: pct };
  if (pct < 85) return { label: "Good", color: "text-green-500", percentage: pct };
  return { label: "Full", color: "text-emerald-500", percentage: pct };
}

export const MpptChargerCard = memo(function MpptChargerCard({
  solarVoltage,
  solarCurrent,
  solarPower,
  loadVoltage,
  loadCurrent,
  batteryVoltage,
  chargerState,
  mpptAbsiAvg: _mpptAbsiAvg,
  boardTemp,
  mode,
  label,
  bulkFloatVoltage,
  floatVoltage,
  currentLimit,
  absorbTimeLimit,
  absorbFullCurrent,
  vCalSlope,
  iCalSlope,
  testIdSuffix = "",
}: MpptChargerCardProps) {
  const stateInfo = getChargerStateLabel(chargerState);
  const batteryHealth = getBatteryHealth(batteryVoltage);
  const flow = getPowerFlow(solarVoltage, solarCurrent, solarPower, loadVoltage, loadCurrent, batteryVoltage);
  const headroom = getHeadroom(solarVoltage, batteryVoltage);
  const boardTempStatus = getBoardTempStatus(boardTemp);
  const cardTitle = label || 'MPPT Solar Charge Controller';

  const FONT = { fontFamily: 'Arial, Helvetica, sans-serif' } as const;
  const HEADING = "text-sm font-semibold text-black";
  const LABEL = "text-xs font-normal text-black";
  const VALUE = "text-base font-normal text-black";

  return (
    <Card className="border border-gray-300 bg-white" data-testid={`card-mppt-charger${testIdSuffix}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-black flex items-center gap-2" style={FONT}>
          {cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Charger State */}
          <div className="flex items-center justify-between">
            <span className={HEADING} style={FONT}>Charger State</span>
            <div className="text-right">
              <span className={`text-sm font-medium ${stateInfo.color}`} style={FONT}>{stateInfo.label}</span>
              <p className={`${LABEL} max-w-[200px]`} style={FONT}>{stateInfo.description}</p>
            </div>
          </div>

          {/* State Legend */}
          <div style={FONT}>
            <p className={`${LABEL} mb-0.5`} style={FONT}>Charger State Legend</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pl-2 text-xs">
              {Object.entries(CHARGER_STATES).filter(([k]) => [0, 3, 4, 5].includes(Number(k))).map(([code, info]) => (
                <div key={code} className="flex items-center gap-1">
                  <span className={`font-medium ${info.color}`} style={FONT}>{code}</span>
                  <span className="text-black" style={FONT}>= {info.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Solar Input */}
          <div className="border-t border-gray-100 pt-2">
            <p className={`${HEADING} mb-1.5`} style={FONT}>Solar Input</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className={VALUE} style={FONT}>
                  {solarVoltage !== null ? safeFixed(solarVoltage, 1) : '-'}
                </p>
                <p className={LABEL} style={FONT}>Voltage (V)</p>
              </div>
              <div>
                <p className={VALUE} style={FONT}>
                  {solarCurrent !== null ? safeFixed(solarCurrent * 1000, 0) : '-'}
                </p>
                <p className={LABEL} style={FONT}>Current (mA)</p>
              </div>
              <div>
                <p className={VALUE} style={FONT}>
                  {solarPower !== null ? safeFixed(solarPower, 1) : '-'}
                </p>
                <p className={LABEL} style={FONT}>Power (W)</p>
              </div>
            </div>
          </div>

          {/* Battery */}
          <div className="border-t border-gray-100 pt-2">
            <p className={`${HEADING} mb-1.5`} style={FONT}>Battery</p>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-normal text-black" style={FONT}>
                  {batteryVoltage !== null ? safeFixed(batteryVoltage, 2) : '-'}
                </span>
                <span className={LABEL} style={FONT}>V</span>
              </div>
              <span className={`text-xs font-medium ${batteryHealth.color}`} style={FONT}>
                {batteryHealth.label}
              </span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${batteryHealth.percentage}%`,
                  backgroundColor:
                    batteryHealth.percentage < 15 ? '#ef4444' :
                    batteryHealth.percentage < 30 ? '#f97316' :
                    batteryHealth.percentage < 60 ? '#eab308' :
                    '#22c55e',
                }}
              />
            </div>
          </div>

          {/* Power flow: where the harvested energy is actually going */}
          {flow.status !== "No data" && (
          <div className="border-t border-gray-100 pt-2">
            <div className="flex items-center justify-between mb-1.5">
              <p className={HEADING} style={FONT}>Power Flow</p>
              <span className={`text-sm font-medium ${flow.color}`} style={FONT}>{flow.status}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className={VALUE} style={FONT}>{flow.inputPower != null ? safeFixed(flow.inputPower, 1) : '-'}</p>
                <p className={LABEL} style={FONT}>Panel in (W)</p>
              </div>
              <div>
                <p className={VALUE} style={FONT}>{flow.loadPower != null ? safeFixed(flow.loadPower, 1) : '-'}</p>
                <p className={LABEL} style={FONT}>Load out (W)</p>
              </div>
              <div>
                <p className={`${VALUE} ${flow.color}`} style={FONT}>
                  {flow.netPower != null ? `${flow.netPower > 0 ? '+' : ''}${safeFixed(flow.netPower, 1)}` : '-'}
                </p>
                <p className={LABEL} style={FONT}>Net to battery (W)</p>
              </div>
            </div>
            {flow.batteryCurrent != null && (
              <p className={`${LABEL} mt-1`} style={FONT}>
                Estimated battery current {flow.netPower != null && flow.netPower > 0 ? '+' : ''}
                {safeFixed(flow.batteryCurrent, 2)} A, derived from panel input less load draw.
              </p>
            )}
            {headroom.value != null && (
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <p className={LABEL} style={FONT}>MPPT headroom (panel above battery)</p>
                <span className={`text-sm font-medium ${headroom.color}`} style={FONT}>
                  {safeFixed(headroom.value, 1)} V
                </span>
              </div>
            )}
            {headroom.value != null && (
              <p className={LABEL} style={FONT}>{headroom.note}</p>
            )}
          </div>
          )}

          {/* Load & MPPT Current */}
          <div className="border-t border-gray-100 pt-2">
            <p className={`${HEADING} mb-1.5`} style={FONT}>Load Output</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className={VALUE} style={FONT}>
                  {loadVoltage !== null ? safeFixed(loadVoltage, 2) : '-'}
                </p>
                <p className={LABEL} style={FONT}>Voltage (V)</p>
              </div>
              <div>
                <p className={VALUE} style={FONT}>
                  {loadCurrent !== null ? safeFixed(loadCurrent * 1000, 0) : '-'}
                </p>
                <p className={LABEL} style={FONT}>Current (mA)</p>
              </div>
              <div>
                <p className={VALUE} style={FONT}>
                  {loadVoltage !== null && loadCurrent !== null ? safeFixed(loadVoltage * loadCurrent, 2) : '-'}
                </p>
                <p className={LABEL} style={FONT}>Power (W)</p>
              </div>
            </div>
          </div>

          {/* Board Temperature & Mode */}
          {(boardTemp !== null && boardTemp !== undefined) && (
          <div className="border-t border-gray-100 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <p className={`${LABEL} mb-0.5`} style={FONT}>Board Temperature</p>
                <p className={VALUE} style={FONT}>
                  {safeFixed(boardTemp, 1)}°C
                </p>
                {boardTempStatus.note && (
                  <p className={`text-xs font-medium ${boardTempStatus.color}`} style={FONT}>{boardTempStatus.note}</p>
                )}
              </div>
              {mode !== null && mode !== undefined && (
              <div className="text-right">
                <p className={`${LABEL} mb-0.5`} style={FONT}>Mode</p>
                <p className={VALUE} style={FONT}>{mode}</p>
              </div>
              )}
            </div>
          </div>
          )}

          {/* Configuration Parameters */}
          {(bulkFloatVoltage != null || floatVoltage != null || currentLimit != null) && (
          <div className="border-t border-gray-100 pt-2">
            <p className={`${HEADING} mb-1.5`} style={FONT}>Configuration</p>
            <div className="grid grid-cols-3 gap-2">
              {bulkFloatVoltage != null && (
              <div>
                <p className={VALUE} style={FONT}>{safeFixed(bulkFloatVoltage, 1)}</p>
                <p className={LABEL} style={FONT}>Bulk/Float (V)</p>
              </div>
              )}
              {floatVoltage != null && (
              <div>
                <p className={VALUE} style={FONT}>{safeFixed(floatVoltage, 1)}</p>
                <p className={LABEL} style={FONT}>Float (V)</p>
              </div>
              )}
              {currentLimit != null && (
              <div>
                <p className={VALUE} style={FONT}>{safeFixed(currentLimit, 1)}</p>
                <p className={LABEL} style={FONT}>I Limit (A)</p>
              </div>
              )}
            </div>
            {(absorbTimeLimit != null || absorbFullCurrent != null || vCalSlope != null || iCalSlope != null) && (
            <div className="grid grid-cols-3 gap-2 mt-1">
              {absorbTimeLimit != null && (
              <div>
                <p className={VALUE} style={FONT}>{safeFixed(absorbTimeLimit, 1)}</p>
                <p className={LABEL} style={FONT}>Absorb Limit (h)</p>
              </div>
              )}
              {absorbFullCurrent != null && (
              <div>
                <p className={VALUE} style={FONT}>{safeFixed(absorbFullCurrent, 2)}</p>
                <p className={LABEL} style={FONT}>Absorb I (A)</p>
              </div>
              )}
              {vCalSlope != null && (
              <div>
                <p className={VALUE} style={FONT}>{safeFixed(vCalSlope, 4)}</p>
                <p className={LABEL} style={FONT}>V Cal Slope</p>
              </div>
              )}
              {iCalSlope != null && (
              <div>
                <p className={VALUE} style={FONT}>{safeFixed(iCalSlope, 4)}</p>
                <p className={LABEL} style={FONT}>I Cal Slope</p>
              </div>
              )}
            </div>
            )}
          </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
);
