import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Maximize2, Minimize2, Navigation, ExternalLink } from "lucide-react";

interface StationMapProps {
  latitude?: number;
  longitude?: number;
  stationName?: string;
  altitude?: number;
  zoom?: number;
}

/**
 * OpenStreetMap component using Leaflet.js
 * Free and open source map with no API key required
 */
export function StationMap({
  latitude,
  longitude,
  stationName = "Weather Station",
  altitude,
  zoom = 13,
}: StationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to a central location if no coordinates provided
  const lat = latitude ?? -33.9249; // Default: Cape Town
  const lng = longitude ?? 18.4241;
  const hasCoordinates = latitude !== undefined && longitude !== undefined;

  useEffect(() => {
    // Dynamically load Leaflet CSS
    if (!document.querySelector('link[href*="leaflet.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
      link.crossOrigin = "";
      document.head.appendChild(link);
    }

    // Dynamically load Leaflet JS
    const loadLeaflet = async () => {
      if (!(window as any).L) {
        const script = document.createElement("script");
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
        script.crossOrigin = "";
        
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Leaflet"));
          document.head.appendChild(script);
        });
      }
      
      initMap();
    };

    const initMap = () => {
      if (!mapRef.current || mapInstanceRef.current) return;

      try {
        const L = (window as any).L;
        
        // Create map
        const map = L.map(mapRef.current, {
          center: [lat, lng],
          zoom: zoom,
          zoomControl: true,
          attributionControl: true,
        });

        // Add OpenStreetMap tiles (free, no API key needed)
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        // Custom marker icon
        const stationIcon = L.divIcon({
          className: "custom-station-marker",
          html: `
            <div style="
              background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
              width: 36px;
              height: 36px;
              border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg);
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 3px 10px rgba(0,0,0,0.3);
              border: 3px solid white;
            ">
              <svg 
                style="transform: rotate(45deg); width: 18px; height: 18px; color: white;" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                stroke-width="2"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
          `,
          iconSize: [36, 36],
          iconAnchor: [18, 36],
          popupAnchor: [0, -36],
        });

        // Add marker
        const marker = L.marker([lat, lng], { icon: stationIcon }).addTo(map);
        
        // Popup content
        const popupContent = `
          <div style="min-width: 200px; font-family: system-ui, sans-serif;">
            <strong style="font-size: 14px; color: #1e40af;">${stationName}</strong>
            <hr style="margin: 8px 0; border: none; border-top: 1px solid #e5e7eb;">
            <div style="font-size: 12px; color: #4b5563;">
              <div style="margin-bottom: 4px;">
                <span style="color: #6b7280;">Latitude:</span> ${lat.toFixed(6)}°
              </div>
              <div style="margin-bottom: 4px;">
                <span style="color: #6b7280;">Longitude:</span> ${lng.toFixed(6)}°
              </div>
              ${altitude !== undefined ? `
                <div>
                  <span style="color: #6b7280;">Altitude:</span> ${altitude} m
                </div>
              ` : ''}
            </div>
          </div>
        `;
        
        marker.bindPopup(popupContent);

        mapInstanceRef.current = map;
        markerRef.current = marker;

        // Invalidate size after render to fix display issues
        setTimeout(() => {
          map.invalidateSize();
        }, 100);
      } catch (err) {
        console.error("Map initialization error:", err);
        setError("Failed to initialize map");
      }
    };

    loadLeaflet().catch((err) => {
      console.error("Failed to load Leaflet:", err);
      setError("Failed to load map library");
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  // Update map when coordinates change
  useEffect(() => {
    if (mapInstanceRef.current && markerRef.current) {
      const map = mapInstanceRef.current;
      const marker = markerRef.current;
      
      map.setView([lat, lng], zoom);
      marker.setLatLng([lat, lng]);
    }
  }, [lat, lng, zoom]);

  // Handle expand/collapse
  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.invalidateSize();
      }, 100);
    }
  }, [isExpanded]);

  const openInMaps = () => {
    window.open(
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=${zoom}`,
      "_blank"
    );
  };

  const centerOnStation = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], zoom);
    }
  };

  if (!hasCoordinates) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-normal flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Station Location
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <MapPin className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm text-center">
              No location coordinates configured.
              <br />
              Add latitude and longitude in station settings.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`transition-all duration-300 ${isExpanded ? "col-span-full" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Station Location
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {lat.toFixed(4)}°, {lng.toFixed(4)}°
            </Badge>
            <Button variant="ghost" size="icon" onClick={centerOnStation} title="Center on station">
              <Navigation className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={openInMaps} title="Open in OpenStreetMap">
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center justify-center h-64 text-red-500">
            <p>{error}</p>
          </div>
        ) : (
          <div
            ref={mapRef}
            className={`w-full rounded-lg border transition-all duration-300 ${
              isExpanded ? "h-[500px]" : "h-64"
            }`}
            style={{ minHeight: isExpanded ? "500px" : "256px" }}
          />
        )}
        {altitude !== undefined && (
          <div className="mt-2 text-xs text-muted-foreground text-center">
            Altitude: {altitude} m above sea level
          </div>
        )}
      </CardContent>
    </Card>
  );
}
