// Stratus Weather Server
// Full-screen loading gate shown while a dashboard's data is still arriving.
//
// The overlay reports real progress: callers pass how many of the essential
// queries have settled (`ready`) out of the total (`total`). The bar eases
// toward that ratio and only snaps to 100% and fades out once `done` is true,
// so the dashboard is never revealed half-populated. A hard safety timeout
// dismisses it regardless, so a stalled request can never trap the user behind
// the loader.

import { useEffect, useRef, useState } from "react";

interface DashboardLoadingOverlayProps {
  /** Number of essential queries that have settled. */
  ready: number;
  /** Total number of essential queries being waited on. */
  total: number;
  /** True once everything needed to render is available. */
  done: boolean;
  /** Milliseconds after which the overlay dismisses no matter what. */
  safetyTimeoutMs?: number;
}

export function DashboardLoadingOverlay({
  ready,
  total,
  done,
  safetyTimeoutMs = 15000,
}: DashboardLoadingOverlayProps) {
  const [visible, setVisible] = useState(true);
  const [pct, setPct] = useState(0);
  // Set when the safety timeout fires: we then drive the bar to 100% and let
  // the normal completion path dismiss it, so the user always sees 100% first.
  const [forced, setForced] = useState(false);

  const complete = done || forced;

  // Query-readiness target, held below 100% until everything is truly ready.
  const ratio = total > 0 ? ready / total : 0;
  const readinessTarget = Math.min(92, Math.round(ratio * 92));

  // Ease the displayed percentage upward. Until complete, the bar chases the
  // larger of (a) real query progress and (b) a gentle time-based floor that
  // creeps toward ~90% over ~12s, so a slow request never looks frozen at 0%.
  // Once complete it drives all the way to 100%, and only then does the overlay
  // fade - so the dashboard is never revealed before the bar reads 100%.
  const startRef = useRef<number>(Date.now());
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const timeFloor = Math.min(90, Math.round((elapsed / 12000) * 90));
      const target = complete ? 100 : Math.max(readinessTarget, timeFloor);
      setPct((p) => {
        if (p >= target) return p;
        const step = Math.max(1, Math.ceil((target - p) / 6));
        return Math.min(target, p + step);
      });
    }, 80);
    return () => clearInterval(id);
  }, [readinessTarget, complete, visible]);

  // Fade out only once complete AND the bar has visibly reached 100%.
  useEffect(() => {
    if (complete && pct >= 100) {
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [complete, pct]);

  // Safety valve: if a query stalls, stop waiting on data - but still drive the
  // bar to 100% and let the fade-out path above dismiss it, so the user never
  // sees it jump straight from a partial value into the dashboard.
  useEffect(() => {
    const t = setTimeout(() => setForced(true), safetyTimeoutMs);
    return () => clearTimeout(t);
  }, [safetyTimeoutMs]);

  // Reveal the dashboard only after the bar has visibly reached 100%.
  if (!visible) return null;

  const R = 46;
  const CIRC = 2 * Math.PI * R;
  const offset = CIRC * (1 - pct / 100);
  const fadingOut = complete && pct >= 100;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white transition-opacity duration-300"
      style={{ opacity: fadingOut ? 0 : 1 }}
      role="status"
      aria-live="polite"
      aria-label={`Loading dashboard, ${pct} percent`}
      data-testid="dashboard-loading-overlay"
    >
      {/* Circular progress ring with the percentage in the centre */}
      <div className="relative h-28 w-28">
        <svg className="h-28 w-28 -rotate-90" viewBox="0 0 112 112">
          <circle cx="56" cy="56" r={R} fill="none" stroke="#e5e7eb" strokeWidth="6" />
          {/* Slow continuous spin gives motion even before real progress arrives */}
          <g style={{ transformOrigin: "56px 56px", animation: "stratusSpin 1.4s linear infinite" }}>
            <circle
              cx="56"
              cy="56"
              r={R}
              fill="none"
              stroke="#1e3a5f"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${CIRC * 0.25} ${CIRC}`}
              opacity="0.25"
            />
          </g>
          {/* Determinate progress arc */}
          <circle
            cx="56"
            cy="56"
            r={R}
            fill="none"
            stroke="#1e3a5f"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.2s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-semibold text-[#1e3a5f] tabular-nums">{pct}%</span>
        </div>
      </div>

      <p
        className="mt-6 text-sm font-medium text-[#1e3a5f]"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        Loading dashboard&hellip; {pct}%
      </p>

      {/* Keyframes kept local so the component is self-contained. */}
      <style>{`
        @keyframes stratusSpin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
