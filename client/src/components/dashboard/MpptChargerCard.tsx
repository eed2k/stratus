import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

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
}

// Victron MPPT charger state codes
const CHARGER_STATES: Record<number, { label: string; color: string; description: string }> = {
  0: { label: "Off", color: "text-gray-500", description: "No charging — panel voltage too low or charger disabled" },
  2: { label: "Fault", color: "text-red-500", description: "Charger fault detected" },
  3: { label: "Bulk", color: "text-yellow-500", description: "Maximum current charging — battery below ~80% SOC" },
  4: { label: "Absorption", color: "text-orange-500", description: "Constant voltage (14.4V) — battery ~80-100% SOC" },
  5: { label: "Float", color: "text-green-500", description: "Maintenance voltage (13.8V) — battery fully charged" },
  6: { label: "Storage", color: "text-blue-400", description: "Reduced voltage — battery in long-term storage mode" },
  7: { label: "Equalize", color: "text-blue-500", description: "Controlled overcharge to balance cells" },
  252: { label: "Ext. Control", color: "text-purple-500", description: "Charger controlled by external device" },
};

function getChargerStateLabel(state: number | null): { label: string; color: string; description: string } {
  if (state === null || state === undefined) return { label: "Unknown", color: "text-gray-400", description: "No data available" };
  const rounded = Math.round(state);
  return CHARGER_STATES[rounded] || { label: `State ${state}`, color: "text-gray-500", description: "Unknown charger state" };
}

function getBatteryHealth(voltage: number | null): { label: string; color: string; percentage: number } {
  if (voltage === null || voltage === undefined || voltage === 0) {
    return { label: "No Data", color: "text-gray-400", percentage: 0 };
  }
  // 12V lead-acid battery range: 11.5V (empty) - 14.4V (full charge)
  const min = 11.5;
  const max = 14.4;
  const pct = Math.min(100, Math.max(0, ((voltage - min) / (max - min)) * 100));
  if (pct < 15) return { label: "Critical", color: "text-red-500", percentage: pct };
  if (pct < 30) return { label: "Low", color: "text-orange-500", percentage: pct };
  if (pct < 60) return { label: "Fair", color: "text-yellow-500", percentage: pct };
  if (pct < 85) return { label: "Good", color: "text-green-500", percentage: pct };
  return { label: "Full", color: "text-emerald-500", percentage: pct };
}

export function MpptChargerCard({
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
}: MpptChargerCardProps) {
  const stateInfo = getChargerStateLabel(chargerState);
  const batteryHealth = getBatteryHealth(batteryVoltage);
  const cardTitle = label || 'MPPT Solar Charge Controller';

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-mppt-charger">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black flex items-center gap-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          {cardTitle}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Charger State */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Charger State</span>
            <div className="text-right">
              <span className={`text-sm font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
              <p className="text-[10px] text-gray-400 max-w-[200px]">{stateInfo.description}</p>
            </div>
          </div>

          {/* State Legend */}
          <div className="text-[10px] text-gray-400">
            <p className="text-[10px] text-gray-500 mb-0.5">Charger State Legend</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pl-2">
              {Object.entries(CHARGER_STATES).filter(([k]) => [0, 3, 4, 5].includes(Number(k))).map(([code, info]) => (
                <div key={code} className="flex items-center gap-1">
                  <span className={`font-medium ${info.color}`}>{code}</span>
                  <span>= {info.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Solar Input */}
          <div className="border-t border-gray-100 pt-2">
            <p className="text-xs text-gray-400 mb-1.5">Solar Input</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {solarVoltage !== null ? safeFixed(solarVoltage, 1) : '–'}
                </p>
                <p className="text-xs text-gray-500">Voltage (V)</p>
              </div>
              <div>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {solarCurrent !== null ? safeFixed(solarCurrent * 1000, 0) : '–'}
                </p>
                <p className="text-xs text-gray-500">Current (mA)</p>
              </div>
              <div>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {solarPower !== null ? safeFixed(solarPower, 1) : '–'}
                </p>
                <p className="text-xs text-gray-500">Power (W)</p>
              </div>
            </div>
          </div>

          {/* Battery */}
          <div className="border-t border-gray-100 pt-2">
            <p className="text-xs text-gray-400 mb-1.5">Battery</p>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {batteryVoltage !== null ? safeFixed(batteryVoltage, 2) : '–'}
                </span>
                <span className="text-xs text-gray-500">V</span>
              </div>
              <span className={`text-xs font-medium ${batteryHealth.color}`}>
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

          {/* Load & MPPT Current */}
          <div className="border-t border-gray-100 pt-2">
            <p className="text-xs text-gray-400 mb-1.5">Load Output</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {loadVoltage !== null ? safeFixed(loadVoltage, 2) : '–'}
                </p>
                <p className="text-xs text-gray-500">Voltage (V)</p>
              </div>
              <div>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {loadCurrent !== null ? safeFixed(loadCurrent * 1000, 0) : '–'}
                </p>
                <p className="text-xs text-gray-500">Current (mA)</p>
              </div>
              <div>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {loadVoltage !== null && loadCurrent !== null ? safeFixed(loadVoltage * loadCurrent, 2) : '–'}
                </p>
                <p className="text-xs text-gray-500">Power (W)</p>
              </div>
            </div>
          </div>

          {/* Board Temperature & Mode */}
          {(boardTemp !== null && boardTemp !== undefined) && (
          <div className="border-t border-gray-100 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Board Temperature</p>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(boardTemp, 1)}°C
                </p>
              </div>
              {mode !== null && mode !== undefined && (
              <div className="text-right">
                <p className="text-xs text-gray-400 mb-0.5">Mode</p>
                <p className="text-sm font-medium text-black">{mode}</p>
              </div>
              )}
            </div>
          </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
