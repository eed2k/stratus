// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";

interface LightningCardProps {
  lightningDistance?: number | null;
  lightningCount?: number | null;
  lightningEnergy?: number | null;
}

type LightningZone = 'clear' | 'watch' | 'warning' | 'danger';

function getZone(distance: number | null | undefined): { zone: LightningZone; label: string; color: string; bgRing: string } {
  if (distance == null || distance <= 0) return { zone: 'clear', label: 'Clear', color: '#22c55e', bgRing: '#dcfce7' };
  if (distance <= 8) return { zone: 'danger', label: 'Danger', color: '#ef4444', bgRing: '#fee2e2' };
  if (distance <= 15) return { zone: 'warning', label: 'Warning', color: '#f97316', bgRing: '#ffedd5' };
  if (distance <= 30) return { zone: 'watch', label: 'Watch', color: '#eab308', bgRing: '#fef9c3' };
  return { zone: 'clear', label: 'Clear', color: '#22c55e', bgRing: '#dcfce7' };
}

export function LightningCard({ lightningDistance, lightningCount, lightningEnergy }: LightningCardProps) {
  const { zone, label, color, bgRing } = getZone(lightningDistance);
  const hasDistance = lightningDistance != null && lightningDistance > 0;

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-lightning">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Lightning Proximity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Zone badge + distance */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              {hasDistance ? (
                <>
                  <span className="text-3xl font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                    {safeFixed(lightningDistance!, 1)}
                  </span>
                  <span className="text-sm font-normal text-gray-500">km</span>
                </>
              ) : (
                <span className="text-xl font-normal text-gray-400" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  No strikes detected
                </span>
              )}
            </div>
            <span
              className="text-xs px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: color + '20', color }}
            >
              {label}
            </span>
          </div>

          {/* Concentric ring visualisation */}
          <div className="flex items-center justify-center py-2">
            <div className="relative w-32 h-32">
              {/* 30 km ring */}
              <div
                className="absolute inset-0 rounded-full border-2 border-dashed flex items-center justify-center"
                style={{ borderColor: zone === 'watch' || zone === 'warning' || zone === 'danger' ? '#eab308' : '#e5e7eb' }}
              >
                <span className="absolute -top-2 text-[9px] text-gray-400">30 km</span>
              </div>
              {/* 15 km ring */}
              <div
                className="absolute rounded-full border-2 border-dashed flex items-center justify-center"
                style={{
                  top: '16.7%', left: '16.7%', width: '66.7%', height: '66.7%',
                  borderColor: zone === 'warning' || zone === 'danger' ? '#f97316' : '#e5e7eb',
                }}
              />
              {/* 8 km ring */}
              <div
                className="absolute rounded-full border-2 flex items-center justify-center"
                style={{
                  top: '33.3%', left: '33.3%', width: '33.3%', height: '33.3%',
                  borderColor: zone === 'danger' ? '#ef4444' : '#e5e7eb',
                  backgroundColor: zone === 'danger' ? bgRing : 'transparent',
                }}
              >
                <span className="text-[9px] text-gray-400">8 km</span>
              </div>
              {/* Station dot at centre */}
              <div
                className="absolute rounded-full"
                style={{
                  top: '50%', left: '50%', width: '8px', height: '8px',
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: color,
                }}
              />
              {/* Strike indicator on the appropriate ring */}
              {hasDistance && lightningDistance! <= 30 && (
                <div
                  className="absolute rounded-full animate-pulse"
                  style={{
                    width: '6px', height: '6px',
                    backgroundColor: '#fbbf24',
                    boxShadow: '0 0 6px 2px #fbbf24',
                    top: `${50 - (Math.min(lightningDistance!, 30) / 30) * 50}%`,
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              )}
            </div>
          </div>

          {/* Strike count and energy */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            {lightningCount != null && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Strike Count</p>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {lightningCount}
                </p>
              </div>
            )}
            {lightningEnergy != null && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Energy</p>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  {safeFixed(lightningEnergy, 0)}
                </p>
              </div>
            )}
          </div>

          {/* Safety recommendations based on zone */}
          {zone !== 'clear' && (
            <div className="pt-2 border-t border-gray-200">
              <p className="text-xs text-gray-700" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                {zone === 'danger' && 'SEEK SHELTER IMMEDIATELY. Lightning within 8 km. Suspend outdoor activities.'}
                {zone === 'warning' && 'Prepare to take shelter. Lightning within 15 km and approaching.'}
                {zone === 'watch' && 'Lightning detected within 30 km. Monitor conditions closely.'}
              </p>
            </div>
          )}

          <p className="text-xs text-gray-400 italic pt-2 border-t border-gray-200" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Lightning zones: Danger (&lt;8 km), Warning (8–15 km), Watch (15–30 km). 
            The 30/30 rule: seek shelter if flash-to-bang is &lt;30 seconds; wait 30 minutes after last strike.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
