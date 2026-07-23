// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useMemo, useRef, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeFixed } from "@/lib/utils";
import { WIND_DIRECTIONS } from "@/lib/windConstants";

export interface WindPowerRoseData {
  direction: number;          // degrees (0, 22.5, 45, ...)
  totalPower: number;         // sum of W/m² for this bin
  meanPower: number;          // average W/m² for this bin
  count: number;              // number of readings
  energyContribution: number; // fraction of total energy (0-1)
}

interface WindPowerRoseProps {
  data: WindPowerRoseData[];
  title?: string;
}

/**
 * Process raw historical data into wind power rose bins.
 * Call this in the parent and pass the result as `data`.
 */
export function processWindPowerRoseData(
  historicalData: { windDirection?: number | null; windSpeed?: number | null }[],
  airDensity: number = 1.225,
  windUnit: 'ms' | 'kmh' = 'ms',
): WindPowerRoseData[] {
  const bins: { totalPower: number; count: number }[] = Array.from({ length: 16 }, () => ({ totalPower: 0, count: 0 }));

  historicalData.forEach(d => {
    if (d.windDirection == null || d.windSpeed == null || d.windSpeed <= 0) return;
    const speedMs = windUnit === 'kmh' ? d.windSpeed / 3.6 : d.windSpeed;
    const power = 0.5 * airDensity * Math.pow(speedMs, 3); // W/m²
    const idx = Math.round(d.windDirection / 22.5) % 16;
    bins[idx].totalPower += power;
    bins[idx].count++;
  });

  const grandTotal = bins.reduce((s, b) => s + b.totalPower, 0) || 1;

  return bins.map((b, i) => ({
    direction: i * 22.5,
    totalPower: Math.round(b.totalPower * 10) / 10,
    meanPower: b.count > 0 ? Math.round((b.totalPower / b.count) * 10) / 10 : 0,
    count: b.count,
    energyContribution: b.totalPower / grandTotal,
  }));
}

/* ── Power density colour scale (W/m²) ── */
const POWER_CLASSES = [
  { min: 0,   max: 50,   label: '0–50 W/m²',   color: '#93c5fd' },
  { min: 50,  max: 150,  label: '50–150',        color: '#3b82f6' },
  { min: 150, max: 300,  label: '150–300',       color: '#16a34a' },
  { min: 300, max: 500,  label: '300–500',       color: '#f59e0b' },
  { min: 500, max: 1000, label: '500–1 000',     color: '#ef4444' },
  { min: 1000, max: Infinity, label: '>1 000',   color: '#7c3aed' },
];

function powerColor(meanPower: number): string {
  for (const pc of POWER_CLASSES) {
    if (meanPower < pc.max) return pc.color;
  }
  return POWER_CLASSES[POWER_CLASSES.length - 1].color;
}

export const WindPowerRose = memo(function WindPowerRose({ data, title = "Wind Power Rose" }: WindPowerRoseProps) {
  const size = 320;
  const center = size / 2;
  const maxRadius = size / 2 - 40;

  const cardRef = useRef<HTMLDivElement>(null);

  // The petal length is proportional to energy contribution
  const maxContribution = useMemo(() => Math.max(...data.map(d => d.energyContribution), 0.01), [data]);

  // Stats
  const stats = useMemo(() => {
    const maxBin = data.reduce((best, d) => d.energyContribution > best.energyContribution ? d : best, data[0]);
    const totalMeanPower = data.reduce((s, d) => s + d.totalPower, 0) / Math.max(data.reduce((s, d) => s + d.count, 0), 1);
    return {
      dominantDirection: WIND_DIRECTIONS[data.indexOf(maxBin)] || 'N',
      dominantPct: safeFixed(maxBin.energyContribution * 100, 1),
      overallMeanPower: safeFixed(totalMeanPower, 1),
    };
  }, [data]);

  const polarToCart = (angle: number, radius: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
  };

  const createWedge = (dirIndex: number, innerR: number, outerR: number) => {
    const aS = dirIndex * 22.5 - 11.25;
    const aE = dirIndex * 22.5 + 11.25;
    const p1 = polarToCart(aS, innerR);
    const p2 = polarToCart(aS, outerR);
    const p3 = polarToCart(aE, outerR);
    const p4 = polarToCart(aE, innerR);
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${outerR} ${outerR} 0 0 1 ${p3.x} ${p3.y} L ${p4.x} ${p4.y} A ${innerR} ${innerR} 0 0 0 ${p1.x} ${p1.y} Z`;
  };

  /* ── Export PNG ── */
  const handleExportImage = useCallback(() => {
    const svgEl = cardRef.current?.querySelector('svg[data-windpowerrose]') as SVGSVGElement | null;
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    const origTexts = svgEl.querySelectorAll('text');
    const cloneTexts = clone.querySelectorAll('text');
    origTexts.forEach((orig, i) => {
      const cs = window.getComputedStyle(orig);
      cloneTexts[i].setAttribute('fill', cs.fill || cs.color || '#000');
      cloneTexts[i].setAttribute('font-size', cs.fontSize);
      cloneTexts[i].setAttribute('font-family', cs.fontFamily);
    });
    const origCircles = svgEl.querySelectorAll('circle');
    const cloneCircles = clone.querySelectorAll('circle');
    origCircles.forEach((orig, i) => {
      const cs = window.getComputedStyle(orig);
      if (cloneCircles[i].getAttribute('stroke') === 'currentColor') cloneCircles[i].setAttribute('stroke', cs.color || '#666');
      if (cloneCircles[i].getAttribute('fill') === 'currentColor') cloneCircles[i].setAttribute('fill', cs.color || '#ccc');
    });
    clone.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));
    const titlePad = 36;
    const exportH = size + titlePad;
    clone.setAttribute('width', String(size));
    clone.setAttribute('height', String(exportH));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const cg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cg.setAttribute('transform', `translate(0, ${titlePad})`);
    while (clone.firstChild) cg.appendChild(clone.firstChild);
    clone.appendChild(cg);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', String(size)); bg.setAttribute('height', String(exportH)); bg.setAttribute('fill', 'white');
    clone.insertBefore(bg, clone.firstChild);
    const tt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tt.setAttribute('x', String(center)); tt.setAttribute('y', '24'); tt.setAttribute('text-anchor', 'middle');
    tt.setAttribute('font-size', '14'); tt.setAttribute('font-family', 'Arial, sans-serif'); tt.setAttribute('fill', '#000');
    tt.textContent = title;
    clone.insertBefore(tt, clone.children[1]);
    const svgData = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = size * scale; canvas.height = exportH * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, size, exportH);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
        a.click(); URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  }, [title, size, center]);

  return (
    <Card ref={cardRef} data-testid="card-wind-power-rose">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-black hover:text-foreground" onClick={handleExportImage} title="Export as image">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              PNG
            </Button>
            <Badge variant="outline" className="text-xs">W/m²</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg data-windpowerrose width={size} height={size} className="overflow-visible">
          {/* Concentric circles */}
          {[0.25, 0.5, 0.75, 1].map(ratio => (
            <g key={ratio}>
              <circle cx={center} cy={center} r={maxRadius * ratio} fill="none" stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />
              <text x={center + 5} y={center - maxRadius * ratio + 12} className="fill-muted-foreground text-xs">
                {safeFixed(ratio * maxContribution * 100, 0)}%
              </text>
            </g>
          ))}

          {/* Direction labels */}
          {WIND_DIRECTIONS.map((dir, i) => {
            const pos = polarToCart(i * 22.5, maxRadius + 20);
            return (
              <text key={dir} x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-xs font-normal">
                {dir}
              </text>
            );
          })}

          {/* Power petals - single wedge per direction coloured by mean power */}
          {data.map((d, i) => {
            const outerR = Math.max(2, (d.energyContribution / maxContribution) * maxRadius);
            if (d.count === 0) return null;
            return (
              <path
                key={i}
                d={createWedge(i, 0, outerR)}
                fill={powerColor(d.meanPower)}
                stroke="white"
                strokeWidth={0.5}
                opacity={0.85}
              >
                <title>{WIND_DIRECTIONS[i]}: {safeFixed(d.energyContribution * 100, 1)}% energy, avg {safeFixed(d.meanPower, 0)} W/m² ({d.count} readings)</title>
              </path>
            );
          })}

          {/* Centre dot */}
          <circle cx={center} cy={center} r={8} fill="currentColor" className="text-black/30" />
        </svg>

        {/* Stats */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-center w-full">
          <div className="rounded bg-muted/50 p-2">
            <div className="text-black">Dominant</div>
            <div className="font-normal">{stats.dominantDirection} ({stats.dominantPct}%)</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-black">Overall Avg</div>
            <div className="font-normal">{stats.overallMeanPower} W/m²</div>
          </div>
          <div className="rounded bg-muted/50 p-2">
            <div className="text-black">Readings</div>
            <div className="font-normal">{data.reduce((s, d) => s + d.count, 0)}</div>
          </div>
        </div>

        {/* Legend - W/m² power density by wind direction */}
        <p className="mt-3 text-xs text-black text-center" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Petal length = energy contribution (%). Colour = mean wind power density (W/m²) per direction.
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {POWER_CLASSES.map(pc => (
            <div key={pc.label} className="flex items-center gap-1 text-xs">
              <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: pc.color }} />
              <span className="text-black">{pc.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
});
