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
}

function getChargerStateLabel(state: number | null): { label: string; color: string } {
  if (state === null || state === undefined) return { label: "Unknown", color: "text-gray-400" };
  switch (Math.round(state)) {
    case 0: return { label: "Off", color: "text-gray-500" };
    case 1: return { label: "Bulk", color: "text-yellow-500" };
    case 2: return { label: "Absorption", color: "text-orange-500" };
    case 3: return { label: "Float", color: "text-green-500" };
    case 4: return { label: "Equalize", color: "text-blue-500" };
    default: return { label: `State ${state}`, color: "text-gray-500" };
  }
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
  mpptAbsiAvg,
}: MpptChargerCardProps) {
  const stateInfo = getChargerStateLabel(chargerState);
  const batteryHealth = getBatteryHealth(batteryVoltage);
  const isSolarActive = (solarVoltage ?? 0) > 1;

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-mppt-charger">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black flex items-center gap-2" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          MPPT Solar Charge Controller
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            isSolarActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {isSolarActive ? 'Active' : 'Night'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Charger State */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Charger State</span>
            <span className={`text-sm font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
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
                  {solarCurrent !== null ? safeFixed(solarCurrent, 0) : '–'}
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
                  {loadCurrent !== null ? safeFixed(loadCurrent, 0) : '–'}
                </p>
                <p className="text-xs text-gray-500">Current (mA)</p>
              </div>
              <div>
                <p className="text-lg font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {mpptAbsiAvg !== null ? safeFixed(mpptAbsiAvg, 0) : '–'}
                </p>
                <p className="text-xs text-gray-500">MPPT Avg (mA)</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
