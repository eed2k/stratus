// Stratus Weather System
// Created by Lukas Esterhuizen

import { useMemo, useRef, useCallback, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeFixed } from "@/lib/utils";
import { 
  WIND_DIRECTIONS, 
  getWindDescription,
  getWindUnitLabel,
  getSimplifiedClasses,
  type WindSpeedClass,
  type WindSpeedUnit,
} from "@/lib/windConstants";

interface WindRoseData {
  direction: number;
  speeds: number[];
}

interface WindRoseProps {
  data: WindRoseData[];
  speedClasses?: WindSpeedClass[];
  title?: string;
  maxWindSpeed?: number;
  showWMOInfo?: boolean;
  windSpeedUnit?: WindSpeedUnit;
}

/**
 * Calculate wind statistics from data
 */
const calculateWindStats = (data: WindRoseData[]) => {
  let totalObservations = 0;
  let calmObservations = 0;
  let dominantDirection = 0;
  let maxDirectionCount = 0;

  data.forEach((d, idx) => {
    const total = d.speeds.reduce((a, b) => a + b, 0);
    totalObservations += total;
    calmObservations += d.speeds[0] || 0; // First speed class is typically calm
    
    if (total > maxDirectionCount) {
      maxDirectionCount = total;
      dominantDirection = idx;
    }
  });

  return {
    totalObservations,
    calmPercentage: totalObservations > 0 ? safeFixed((calmObservations / totalObservations) * 100, 1) : "0",
    dominantDirection: WIND_DIRECTIONS[dominantDirection],
    dominantPercentage: totalObservations > 0 ? safeFixed((maxDirectionCount / totalObservations) * 100, 1) : "0",
  };
};

export const WindRose = memo(function WindRose({ 
  data, 
  speedClasses, 
  title = "Wind Rose", 
  maxWindSpeed,
  showWMOInfo = true,
  windSpeedUnit = 'ms',
}: WindRoseProps) {
  const unitLabel = getWindUnitLabel(windSpeedUnit);
  // Calculate max wind speed from data if not provided
  const calculatedMaxSpeed = useMemo(() => {
    if (maxWindSpeed !== undefined) return maxWindSpeed;
    
    let maxSpeed = 0;
    const classes = getSimplifiedClasses(windSpeedUnit);
    data.forEach(d => {
      d.speeds.forEach((count, idx) => {
        if (count > 0) {
          const classMax = classes[idx]?.max || 100;
          if (classMax !== Infinity && classMax > maxSpeed) {
            maxSpeed = classMax;
          }
        }
      });
    });
    return maxSpeed || 50;
  }, [data, maxWindSpeed, windSpeedUnit]);

  // Use WMO simplified classes by default
  const activeSpeedClasses = useMemo(() => {
    return speedClasses || getSimplifiedClasses(windSpeedUnit);
  }, [speedClasses, windSpeedUnit]);

  // Calculate wind statistics
  const windStats = useMemo(() => calculateWindStats(data), [data]);

  const maxValue = useMemo(() => {
    let max = 0;
    data.forEach(d => {
      const total = d.speeds.reduce((a, b) => a + b, 0);
      if (total > max) max = total;
    });
    return max || 1;
  }, [data]);

  const size = 320;
  const center = size / 2;
  const maxRadius = size / 2 - 40;

  const cardRef = useRef<HTMLDivElement>(null);

  const handleExportImage = useCallback(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    // Use html2canvas-style approach via SVG foreignObject
    const svgEl = cardEl.querySelector('svg[data-windrose]') as SVGSVGElement | null;
    if (!svgEl) return;

    // Clone the SVG and inline computed styles
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    
    // Get computed styles for text elements to resolve CSS variables
    const origTexts = svgEl.querySelectorAll('text');
    const cloneTexts = clone.querySelectorAll('text');
    origTexts.forEach((orig, i) => {
      const computed = window.getComputedStyle(orig);
      cloneTexts[i].setAttribute('fill', computed.fill || computed.color || '#000');
      cloneTexts[i].setAttribute('font-size', computed.fontSize);
      cloneTexts[i].setAttribute('font-family', computed.fontFamily);
    });

    // Get computed stroke colors for circles
    const origCircles = svgEl.querySelectorAll('circle');
    const cloneCircles = clone.querySelectorAll('circle');
    origCircles.forEach((orig, i) => {
      const computed = window.getComputedStyle(orig);
      if (cloneCircles[i].getAttribute('stroke') === 'currentColor') {
        cloneCircles[i].setAttribute('stroke', computed.color || '#666');
      }
      if (cloneCircles[i].getAttribute('fill') === 'currentColor') {
        cloneCircles[i].setAttribute('fill', computed.color || '#ccc');
      }
    });

    // Remove CSS classes that won't work outside DOM
    clone.querySelectorAll('[class]').forEach(el => {
      el.removeAttribute('class');
    });

    // Add extra height for title
    const titlePadding = 36;
    const exportHeight = size + titlePadding;

    // Set explicit size with extra height for title
    clone.setAttribute('width', String(size));
    clone.setAttribute('height', String(exportHeight));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    // Shift all existing content down to make room for title
    const contentGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    contentGroup.setAttribute('transform', `translate(0, ${titlePadding})`);
    while (clone.firstChild) {
      contentGroup.appendChild(clone.firstChild);
    }
    clone.appendChild(contentGroup);

    // Add white background (full export size, inserted before content)
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', String(size));
    bg.setAttribute('height', String(exportHeight));
    bg.setAttribute('fill', 'white');
    clone.insertBefore(bg, clone.firstChild);

    // Add title text in the padding area
    const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    titleText.setAttribute('x', String(center));
    titleText.setAttribute('y', '24');
    titleText.setAttribute('text-anchor', 'middle');
    titleText.setAttribute('font-size', '14');
    titleText.setAttribute('font-family', 'Arial, sans-serif');
    titleText.setAttribute('fill', '#000');
    titleText.textContent = title;
    clone.insertBefore(titleText, clone.children[1]);

    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2; // 2x resolution
      canvas.width = size * scale;
      canvas.height = exportHeight * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, size, exportHeight);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, 'image/png');
    };
    img.src = url;
  }, [title, size, center]);

  const polarToCart = (angle: number, radius: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad),
    };
  };

  const createWedge = (dirIndex: number, innerRadius: number, outerRadius: number) => {
    const angleStart = dirIndex * 22.5 - 11.25;
    const angleEnd = dirIndex * 22.5 + 11.25;

    const p1 = polarToCart(angleStart, innerRadius);
    const p2 = polarToCart(angleStart, outerRadius);
    const p3 = polarToCart(angleEnd, outerRadius);
    const p4 = polarToCart(angleEnd, innerRadius);

    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${outerRadius} ${outerRadius} 0 0 1 ${p3.x} ${p3.y} L ${p4.x} ${p4.y} A ${innerRadius} ${innerRadius} 0 0 0 ${p1.x} ${p1.y} Z`;
  };

  return (
    <Card ref={cardRef} data-testid="card-wind-rose">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal">{title}</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleExportImage}
              title="Export as image"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              PNG
            </Button>
            {showWMOInfo && (
              <Badge variant="outline" className="text-xs">WMO/Beaufort</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <svg data-windrose width={size} height={size} className="overflow-visible">
          {/* Concentric circles with percentage labels */}
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <g key={ratio}>
              <circle
                cx={center}
                cy={center}
                r={maxRadius * ratio}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.1}
                strokeWidth={1}
              />
              <text
                x={center + 5}
                y={center - maxRadius * ratio + 12}
                className="fill-muted-foreground text-[10px]"
              >
                {safeFixed(ratio * 100, 0)}%
              </text>
            </g>
          ))}

          {/* Direction labels */}
          {WIND_DIRECTIONS.map((dir, i) => {
            const angle = i * 22.5;
            const pos = polarToCart(angle, maxRadius + 20);
            return (
              <text
                key={dir}
                x={pos.x}
                y={pos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground text-xs font-normal"
              >
                {dir}
              </text>
            );
          })}

          {/* Wind rose petals */}
          {data.map((d, dirIndex) => {
            let currentRadius = 0;
            return d.speeds.map((count, speedIndex) => {
              const roundedCount = Number(safeFixed(count, 3));
              const innerRadius = currentRadius;
              const height = (roundedCount / maxValue) * maxRadius;
              currentRadius += height;

              if (roundedCount === 0) return null;

              return (
                <path
                  key={`${dirIndex}-${speedIndex}`}
                  d={createWedge(dirIndex, innerRadius, currentRadius)}
                  fill={activeSpeedClasses[speedIndex]?.color || "#3b82f6"}
                  stroke="white"
                  strokeWidth={0.5}
                  opacity={0.85}
                />
              );
            });
          })}

          {/* Center calm circle */}
          <circle
            cx={center}
            cy={center}
            r={8}
            fill="currentColor"
            className="text-muted-foreground/30"
          />
        </svg>

        {/* Wind Statistics */}
        {showWMOInfo && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-center w-full">
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Dominant</div>
              <div className="font-normal">{windStats.dominantDirection} ({windStats.dominantPercentage}%)</div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-muted-foreground">Calm</div>
              <div className="font-normal">{windStats.calmPercentage}%</div>
            </div>
          </div>
        )}

        {/* Max wind speed and current classification */}
        <div className="mt-2 text-center text-xs text-muted-foreground">
          Max: {safeFixed(calculatedMaxSpeed, 1)} {unitLabel} ({getWindDescription(calculatedMaxSpeed, windSpeedUnit)})
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {activeSpeedClasses.map((sc) => (
            <div key={sc.label} className="flex items-center gap-1 text-[10px]">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: sc.color }}
              />
              <span className="text-muted-foreground">{sc.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
);

// Re-export constants from shared module for backward compatibility
export { WMO_SPEED_CLASSES, WMO_SIMPLIFIED_CLASSES, getWindDescription } from "@/lib/windConstants";
