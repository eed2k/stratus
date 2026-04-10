// Stratus Weather Server
// Created by Lukas Esterhuizen

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { safeFixed } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

// CDN sources for Leaflet (reuse same CDN list as StationMap)
const LEAFLET_CDNS = [
  { js: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", css: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" },
  { js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js", css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" },
  { js: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js", css: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css" },
];

async function ensureLeaflet(): Promise<void> {
  if ((window as any).L) return;
  for (const cdn of LEAFLET_CDNS) {
    try {
      // Load CSS
      if (!document.querySelector(`link[href="${cdn.css}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cdn.css;
        document.head.appendChild(link);
      }
      // Load JS
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = cdn.js;
        s.async = true;
        s.onload = () => ((window as any).L ? resolve() : reject(new Error("L not defined")));
        s.onerror = () => { s.remove(); reject(new Error("load failed")); };
        document.head.appendChild(s);
      });
      if ((window as any).L) return;
    } catch { /* try next CDN */ }
  }
  throw new Error("Failed to load Leaflet");
}

// Distance rings in km
const DISTANCE_RINGS = [5, 10, 15, 20, 25, 30, 35, 40];

interface LightningCardProps {
  lightningDistance?: number | null;
  lightningCount?: number | null;
  lightningEnergy?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

export function LightningCard({ lightningDistance, lightningCount, lightningEnergy, latitude, longitude }: LightningCardProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);
  const strikeCircleRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

  const hasCoords = latitude != null && longitude != null;
  const hasDistance = lightningDistance != null && lightningDistance > 0;
  const isDetected = hasDistance && lightningDistance! <= 40;

  // Initialise map
  useEffect(() => {
    if (!hasCoords || !mapRef.current) return;
    let mounted = true;

    (async () => {
      try {
        await ensureLeaflet();
        if (!mounted || !mapRef.current) return;

        const L = (window as any).L;

        // Clean previous
        if (mapInstanceRef.current) {
          try { mapInstanceRef.current.remove(); } catch { /* ignore */ }
          mapInstanceRef.current = null;
        }

        const map = L.map(mapRef.current, {
          center: [latitude, longitude],
          zoom: 10,
          zoomControl: true,
          attributionControl: false,
          fadeAnimation: false,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          subdomains: ["a", "b", "c"],
        }).addTo(map);

        // Station marker
        const stationIcon = L.divIcon({
          className: "",
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#1d4ed8;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        L.marker([latitude, longitude], { icon: stationIcon }).addTo(map);

        // Distance circles
        const circles: any[] = [];
        for (const km of DISTANCE_RINGS) {
          const circle = L.circle([latitude, longitude], {
            radius: km * 1000,
            color: "#64748b",
            weight: 1,
            opacity: 0.35,
            fillColor: "transparent",
            fill: false,
            dashArray: km % 10 === 0 ? undefined : "6 4",
            interactive: false,
          }).addTo(map);

          // Label every 10km
          if (km % 10 === 0 || km === 5 || km === 15 || km === 25 || km === 35) {
            const labelLatOffset = km / 111.32; // ~degrees per km
            L.marker([latitude! + labelLatOffset, longitude], {
              icon: L.divIcon({
                className: "",
                html: `<span style="font-size:10px;color:#64748b;white-space:nowrap;text-shadow:0 0 3px #fff,0 0 3px #fff;">${km} km</span>`,
                iconSize: [40, 14],
                iconAnchor: [20, 7],
              }),
              interactive: false,
            }).addTo(map);
          }
          circles.push(circle);
        }
        circlesRef.current = circles;

        // Fit to 40km circle bounds
        const outerBounds = circles[circles.length - 1].getBounds();
        map.fitBounds(outerBounds.pad(0.05));

        mapInstanceRef.current = map;

        // Invalidate size after layout
        [100, 300, 600].forEach(d => setTimeout(() => {
          if (mounted && map._container) map.invalidateSize({ animate: false });
        }, d));

        if (mounted) setMapReady(true);
      } catch (err) {
        console.error("[LightningCard] Map init error:", err);
      }
    })();

    return () => {
      mounted = false;
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.remove(); } catch { /* ignore */ }
        mapInstanceRef.current = null;
      }
    };
  }, [hasCoords, latitude, longitude]);

  // Update strike indicator when distance changes
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !hasCoords) return;
    const L = (window as any).L;
    const map = mapInstanceRef.current;

    // Remove previous strike circle
    if (strikeCircleRef.current) {
      try { map.removeLayer(strikeCircleRef.current); } catch { /* ignore */ }
      strikeCircleRef.current = null;
    }

    if (isDetected) {
      // Show blue strike circle at lightning distance
      const strikeCircle = L.circle([latitude, longitude], {
        radius: lightningDistance! * 1000,
        color: "#3b82f6",
        weight: 3,
        opacity: 0.9,
        fillColor: "#3b82f6",
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
      strikeCircleRef.current = strikeCircle;
    }
  }, [mapReady, lightningDistance, isDetected, hasCoords, latitude, longitude]);

  return (
    <Card className="border border-gray-300 bg-white" data-testid="card-lightning">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
          Lightning Proximity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Distance + status */}
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
            {isDetected ? (
              <span className="text-xs px-2 py-1 rounded-full font-medium bg-blue-100 text-blue-600 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                Detected
              </span>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full font-medium bg-green-100 text-green-700">
                Clear
              </span>
            )}
          </div>

          {/* Map */}
          {hasCoords ? (
            <div ref={mapRef} className="w-full rounded-md overflow-hidden border border-gray-200" style={{ height: 260 }} />
          ) : (
            <div className="flex items-center justify-center rounded-md border border-gray-200 bg-gray-50" style={{ height: 260 }}>
              <p className="text-xs text-gray-400">Station coordinates not set — map unavailable</p>
            </div>
          )}

          {/* Strike count + energy */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
            {lightningCount != null && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Strike Count</p>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{lightningCount}</p>
              </div>
            )}
            {lightningEnergy != null && (
              <div className="text-center">
                <p className="text-xs text-gray-500">Energy</p>
                <p className="text-sm font-normal text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>{safeFixed(lightningEnergy, 0)}</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
