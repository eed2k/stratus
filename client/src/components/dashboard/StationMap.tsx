// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useEffect, useRef, useState, useCallback, Component, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Navigation, ExternalLink, Search, Loader2, X, RefreshCw } from "lucide-react";
import { safeFixed } from "@/lib/utils";

// BULLETPROOF LEAFLET LOADER - Multiple CDNs, retries, fallbacks

// CDN sources for Leaflet (in order of preference)
const LEAFLET_CDNS = [
  {
    js: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    css: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  },
  {
    js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
    css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"
  },
  {
    js: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js",
    css: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css"
  }
];

// Critical Leaflet CSS inline (subset for basic functionality)
const LEAFLET_CRITICAL_CSS = `
.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-pane>svg,.leaflet-pane>canvas,.leaflet-zoom-box,.leaflet-image-layer,.leaflet-layer{position:absolute;left:0;top:0}.leaflet-container{overflow:hidden;background:#ddd}.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-user-drag:none}.leaflet-tile::selection{background:0 0}.leaflet-safari .leaflet-tile{image-rendering:-webkit-optimize-contrast}.leaflet-safari .leaflet-tile-container{width:1600px;height:1600px;-webkit-transform-origin:0 0}.leaflet-marker-icon,.leaflet-marker-shadow{display:block}.leaflet-container .leaflet-overlay-pane svg{max-width:none!important;max-height:none!important}.leaflet-container .leaflet-marker-pane img,.leaflet-container .leaflet-shadow-pane img,.leaflet-container .leaflet-tile-pane img,.leaflet-container img.leaflet-image-layer,.leaflet-container .leaflet-tile{max-width:none!important;max-height:none!important;width:auto;padding:0}.leaflet-container img.leaflet-tile{mix-blend-mode:plus-lighter}.leaflet-container.leaflet-touch-zoom{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y}.leaflet-container.leaflet-touch-drag{-ms-touch-action:pinch-zoom;touch-action:none;touch-action:pinch-zoom}.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom{-ms-touch-action:none;touch-action:none}.leaflet-container{-webkit-tap-highlight-color:transparent}.leaflet-container a{-webkit-tap-highlight-color:rgba(51,181,229,.4)}.leaflet-tile{filter:inherit;visibility:hidden}.leaflet-tile-loaded{visibility:inherit}.leaflet-zoom-box{width:0;height:0;-moz-box-sizing:border-box;box-sizing:border-box;z-index:800}.leaflet-overlay-pane svg{-moz-user-select:none}.leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}.leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}.leaflet-map-pane canvas{z-index:100}.leaflet-map-pane svg{z-index:200}.leaflet-control{position:relative;z-index:800;pointer-events:visiblePainted;pointer-events:auto}.leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{float:left;clear:both}.leaflet-right .leaflet-control{float:right}.leaflet-top .leaflet-control{margin-top:10px}.leaflet-bottom .leaflet-control{margin-bottom:10px}.leaflet-left .leaflet-control{margin-left:10px}.leaflet-right .leaflet-control{margin-right:10px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{font:bold 18px 'Lucida Console',Monaco,monospace;text-indent:1px}.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{font-size:22px}.leaflet-control-zoom-out{font-size:20px}.leaflet-touch .leaflet-control-zoom-out{font-size:24px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{display:block;width:30px;height:30px;line-height:30px;text-align:center;text-decoration:none;color:#000;background:#fff}.leaflet-control-zoom-in:hover,.leaflet-control-zoom-out:hover{background:#f4f4f4}.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{width:34px;height:34px;line-height:34px}.leaflet-control-zoom-disabled{cursor:default;background:#f4f4f4;color:#bbb}.leaflet-control-attribution{background:#fff;background:rgba(255,255,255,.8);margin:0}.leaflet-control-attribution,.leaflet-control-scale-line{padding:0 5px;color:#000000;line-height:1.4}.leaflet-control-attribution a{text-decoration:none}.leaflet-control-attribution a:hover,.leaflet-control-attribution a:focus{text-decoration:underline}.leaflet-attribution-flag{display:inline!important;vertical-align:baseline!important;width:1em;height:.6667em}.leaflet-left .leaflet-control-scale{margin-left:5px}.leaflet-bottom .leaflet-control-scale{margin-bottom:5px}.leaflet-control-scale-line{border:2px solid #777;border-top:none;line-height:1.1;padding:2px 5px 1px;white-space:nowrap;-moz-box-sizing:border-box;box-sizing:border-box;background:rgba(255,255,255,.8);text-shadow:1px 1px #fff}.leaflet-control-scale-line:not(:first-child){border-top:2px solid #777;border-bottom:none;margin-top:-2px}.leaflet-control-scale-line:not(:first-child):not(:last-child){border-bottom:2px solid #777}.leaflet-touch .leaflet-control-attribution,.leaflet-touch .leaflet-control-layers,.leaflet-touch .leaflet-bar{box-shadow:none}.leaflet-touch .leaflet-control-layers,.leaflet-touch .leaflet-bar{border:2px solid rgba(0,0,0,.2);background-clip:padding-box}.leaflet-popup{position:absolute;text-align:center;margin-bottom:20px}.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}.leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;min-height:1px}.leaflet-popup-content p{margin:17px 0}.leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;-webkit-transform:rotate(45deg);-moz-transform:rotate(45deg);-ms-transform:rotate(45deg);transform:rotate(45deg)}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;color:#000000;box-shadow:0 3px 14px rgba(0,0,0,.4)}.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:0 0}.leaflet-container a.leaflet-popup-close-button:hover,.leaflet-container a.leaflet-popup-close-button:focus{color:#585858}.leaflet-popup-scrolled{overflow:auto}.leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,.65);border-radius:4px}.leaflet-bar a{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000}.leaflet-bar a,.leaflet-control-layers-toggle{background-position:50% 50%;background-repeat:no-repeat;display:block}.leaflet-bar a:hover,.leaflet-bar a:focus{background-color:#f4f4f4}.leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.leaflet-bar a:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px;border-bottom:none}.leaflet-bar a.leaflet-disabled{cursor:default;background-color:#f4f4f4;color:#bbb}.leaflet-touch .leaflet-bar a{width:30px;height:30px;line-height:30px}.leaflet-touch .leaflet-bar a:first-child{border-top-left-radius:2px;border-top-right-radius:2px}.leaflet-touch .leaflet-bar a:last-child{border-bottom-left-radius:2px;border-bottom-right-radius:2px}
`;

// Global state to track loading
let leafletLoadPromise: Promise<void> | null = null;
let leafletLoaded = false;

// Inject critical CSS immediately
function injectCriticalCSS(): void {
  if (document.getElementById('leaflet-critical-css')) return;
  const style = document.createElement('style');
  style.id = 'leaflet-critical-css';
  style.textContent = LEAFLET_CRITICAL_CSS;
  document.head.appendChild(style);
}

// Load CSS from CDN
function loadCSS(url: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.querySelector(`link[href="${url}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // Don't fail on CSS error, we have inline fallback
    document.head.appendChild(link);
  });
}

// Load script with timeout
function loadScript(url: string, timeout: number = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Script timeout: ${url}`));
    }, timeout);

    // Remove any failed attempts
    const oldScript = document.querySelector(`script[src="${url}"]`);
    if (oldScript) oldScript.remove();

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    
    script.onload = () => {
      clearTimeout(timer);
      if ((window as any).L) {
        resolve();
      } else {
        reject(new Error('Leaflet not defined after load'));
      }
    };
    
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error(`Failed to load: ${url}`));
    };
    
    document.head.appendChild(script);
  });
}

// Main loader with retry and fallback logic
async function loadLeafletLibrary(): Promise<void> {
  // Already loaded
  if ((window as any).L && leafletLoaded) {
    return Promise.resolve();
  }

  // Already loading
  if (leafletLoadPromise) {
    return leafletLoadPromise;
  }

  // Inject critical CSS immediately
  injectCriticalCSS();

  leafletLoadPromise = (async () => {
    for (const cdn of LEAFLET_CDNS) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          // Load CSS in parallel (don't wait, we have inline fallback)
          loadCSS(cdn.css);
          
          // Load JS
          await loadScript(cdn.js, 10000);
          
          if ((window as any).L) {
            leafletLoaded = true;
            return;
          }
        } catch (err) {
          console.warn(`[Map] CDN attempt ${attempt + 1} failed:`, cdn.js, err);
          // Small delay before retry
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    
    throw new Error('All CDNs failed to load Leaflet');
  })();

  try {
    await leafletLoadPromise;
  } catch (err) {
    leafletLoadPromise = null; // Allow retry
    throw err;
  }
}

// ERROR BOUNDARY
interface MapErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface MapErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  constructor(props: MapErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): MapErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('[StationMap] Error boundary caught:', error);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-normal">Station Location</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center h-64 text-amber-600 gap-2">
              <p className="text-sm text-center">Map failed to load</p>
              <p className="text-xs text-black text-center max-w-xs">
                {this.state.error?.message || 'Unknown error'}
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="mt-2"
              >
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

interface LocationSearchResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  importance: number;
}

interface StationMapProps {
  latitude?: number;
  longitude?: number;
  stationName?: string;
  altitude?: number;
  zoom?: number;
  onLocationSelect?: (lat: number, lng: number, name: string) => void;
  editable?: boolean;
  windDirection?: number;
  windSpeed?: number;
}

/**
 * Station location map: Leaflet, Esri World Imagery, satellite only.
 *
 * Shared by the main dashboard (client/src/pages/Dashboard.tsx) and the public
 * shared dashboard (client/src/pages/SharedDashboard.tsx), so both show a site
 * identically. No API key and no npm dependency: Leaflet is loaded from a CDN at
 * runtime and the imagery is Esri's public tile service.
 *
 * There is one basemap by design. See the tile layer below for why the street
 * option went.
 *
 * Nominatim still provides location SEARCH when the map is editable. That is a
 * geocoder, not a basemap, and is unaffected by the satellite-only rule.
 *
 * Falls back to a South Africa overview when the station has no coordinates.
 */
export function StationMap({
  latitude,
  longitude,
  stationName = "Weather Station",
  altitude,
  zoom = 13,
  onLocationSelect,
  editable = false,
  windDirection,
  windSpeed,
}: StationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const windArrowRef = useRef<any>(null);
  // No activeLayerRef any more: satellite is the only basemap, so there is
  // nothing to track and openInMaps has one destination.
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  
  // Location search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Default to Southern Africa (center) if no coordinates provided
  const lat = latitude ?? -25.0; // Southern Africa
  const lng = longitude ?? 22.0;
  const hasCoordinates = latitude !== undefined && longitude !== undefined;
  
  // Default zoom for South Africa overview vs specific location
  const defaultZoom = hasCoordinates ? zoom : 5;

  // Nominatim search function with Southern Africa bias
  const searchLocation = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      // Search with Southern Africa bias (SA + Namibia + neighbors)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}` +
        `&format=json` +
        `&limit=8` +
        `&countrycodes=za,na,bw,mz,zw,sz,ls` + // Southern Africa countries
        `&viewbox=11.7,-35.0,40.8,-16.5` + // Southern Africa bounding box
        `&bounded=0` + // Allow results outside but prefer inside
        `&addressdetails=1`,
        {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'StratusWeatherServer/1.0',
          },
        }
      );
      
      if (!response.ok) throw new Error('Search failed');
      
      const data: LocationSearchResult[] = await response.json();
      setSearchResults(data);
      setShowResults(data.length > 0);
    } catch (err) {
      console.error('Location search error:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  const handleSearchInput = useCallback((value: string) => {
    setSearchQuery(value);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      searchLocation(value);
    }, 300);
  }, [searchLocation]);

  // Handle location selection
  const handleSelectLocation = useCallback((result: LocationSearchResult) => {
    const selectedLat = parseFloat(result.lat);
    const selectedLng = parseFloat(result.lon);
    
    // Update map view
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([selectedLat, selectedLng], 14);
      
      // Update marker position
      if (markerRef.current) {
        markerRef.current.setLatLng([selectedLat, selectedLng]);
        markerRef.current.openPopup();
      }
    }
    
    // Notify parent component
    if (onLocationSelect) {
      onLocationSelect(selectedLat, selectedLng, result.display_name);
    }
    
    // Clear search
    setShowResults(false);
    setSearchQuery(result.display_name.split(',')[0]); // Just show first part
  }, [onLocationSelect]);

  // Clear search
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setShowResults(false);
  }, []);

  // Retry loading map
  const retryLoadMap = useCallback(() => {
    setError(null);
    setIsLoading(true);
    setRetryCount(prev => prev + 1);
  }, []);

  // Main map Initialization effect
  useEffect(() => {
    let isMounted = true;
    let initTimeout: NodeJS.Timeout | null = null;

    const initMap = () => {
      if (!mapRef.current || !isMounted) return;
      
      // Clean up existing map
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
        mapInstanceRef.current = null;
        markerRef.current = null;
      }

      try {
        const L = (window as any).L;
        if (!L) {
          throw new Error("Leaflet library not available");
        }
        
        // Create map
        const map = L.map(mapRef.current, {
          center: [lat, lng],
          zoom: defaultZoom,
          zoomControl: true,
          attributionControl: true,
          fadeAnimation: false,
          zoomAnimation: true,
        });

        /**
         * Satellite only. Esri World Imagery, the same source the PDF report
         * draws, so the dashboard and a filed report show the same picture of a
         * site.
         *
         * The street basemap and the layers control that switched to it were
         * removed. A weather station is identified by its coordinates, which are
         * printed beside this map to six decimals, and what the reader cannot
         * get from those numbers is what the ground around the mast looks like:
         * the exposure that explains the wind and radiation readings. That is
         * the satellite view. The street layer answered a question nothing on
         * this dashboard asks.
         *
         * Raw tile.openstreetmap.org is deliberately still not used anywhere:
         * their usage policy forbids production use and returns HTTP 403 for
         * flagged referrers. Esri permits web embedding, is CORS enabled and
         * needs no key.
         */
        const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
          maxZoom: 19,
          minZoom: 1,
          attribution: '&copy; <a href="https://www.esri.com">Esri</a>',
          crossOrigin: 'anonymous',
          errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        });

        satelliteLayer.addTo(map);

        /**
         * Station location pin.
         *
         * Red with a white ring, matching MAP_PIN_COLOUR in
         * server/services/pdfReportService.ts so the dashboard pin and the
         * report pin are recognisably the same marker.
         *
         * It used to be a blue gradient, which was chosen against a white page
         * rather than against imagery. Now that satellite is the only basemap
         * the pin is always over aerial photography, where blue competes with
         * water, shadow and dark scrub. The white ring is what guarantees it
         * reads over whatever happens to be underneath, which on a mast site
         * could be dark bush, bright sand or a pale roof.
         */
        const stationIcon = L.divIcon({
          className: "custom-station-marker",
          html: `<div style="background:#ef4444;width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.45);border:3px solid white;"><svg style="transform:rotate(45deg);width:15px;height:15px;color:white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32],
        });

        const marker = L.marker([lat, lng], { icon: stationIcon }).addTo(map);
        
        marker.bindPopup(`
          <div style="min-width:180px;font-family:Arial,Helvetica,sans-serif;">
            <strong style="font-size:14px;color:#1e40af;">${stationName}</strong>
            <hr style="margin:6px 0;border:none;border-top:1px solid #e5e7eb;">
            <div style="font-size:12px;color:#000000;">
              <div>Lat: ${safeFixed(lat, 5)}°</div>
              <div>Lng: ${safeFixed(lng, 5)}°</div>
              ${altitude !== undefined ? `<div>Alt: ${altitude}m</div>` : ''}
            </div>
          </div>
        `);

        mapInstanceRef.current = map;
        markerRef.current = marker;

        // Ensure map renders correctly
        requestAnimationFrame(() => {
          if (isMounted && map && map._container) {
            map.invalidateSize({ animate: false });
          }
        });

        setError(null);
        setIsLoading(false);
      } catch (err: any) {
        console.error("[Map] Init error:", err);
        setError(err.message || "Failed to initialize map");
        setIsLoading(false);
      }
    };

    // Start loading
    setIsLoading(true);
    
    loadLeafletLibrary()
      .then(() => {
        // Small delay for DOM readiness
        initTimeout = setTimeout(() => {
          if (isMounted) initMap();
        }, 50);
      })
      .catch((err) => {
        console.error("[Map] Load error:", err);
        if (isMounted) {
          setError("Could not load map. Check your internet connection.");
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      if (initTimeout) clearTimeout(initTimeout);
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (e) {
          // Ignore
        }
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, [lat, lng, defaultZoom, stationName, altitude, retryCount]);

  // When loading overlay disappears, ensure map renders correctly
  useEffect(() => {
    if (!isLoading && mapInstanceRef.current) {
      // Invalidate after overlay removal to fix any rendering issues
      const t = setTimeout(() => {
        mapInstanceRef.current?.invalidateSize({ animate: false });
      }, 100);
      return () => clearTimeout(t);
    }
  }, [isLoading]);

  // ResizeObserver to catch any container size changes (responsive layout, etc.)
  useEffect(() => {
    const el = mapRef.current;
    if (!el || !mapInstanceRef.current) return;
    const observer = new ResizeObserver(() => {
      const m = mapInstanceRef.current;
      if (!m) return;
      m.invalidateSize({ animate: false });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLoading]);

  // Wind direction arrow overlay (fixed top-left corner of map)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const container = mapRef.current;
    if (!container || !map || windDirection == null) {
      // Remove existing arrow if wind direction is unavailable
      if (windArrowRef.current) {
        try { windArrowRef.current.remove(); } catch { /* ignore */ }
        windArrowRef.current = null;
      }
      return;
    }

    // Remove previous arrow
    if (windArrowRef.current) {
      try { windArrowRef.current.remove(); } catch { /* ignore */ }
      windArrowRef.current = null;
    }

    // Meteorological wind direction: direction wind is coming FROM
    const arrowRotation = windDirection;
    const dirLabel = (() => {
      const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
      return dirs[Math.round(windDirection / 22.5) % 16];
    })();

    const speedLabel = windSpeed != null ? `${safeFixed(windSpeed, 1)} m/s` : '-';

    // Create a fixed-position overlay in the top-left corner
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;top:10px;left:50px;z-index:1000;display:flex;flex-direction:column;align-items:center;pointer-events:none;background:rgba(255,255,255,0.85);border-radius:8px;padding:4px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.2);';
    overlay.innerHTML = `
      <span style="font-size:12px;font-weight:700;color:#1e3a5f;white-space:nowrap;">${dirLabel}</span>
      <svg width="48" height="48" viewBox="0 0 48 48" style="transform:rotate(${arrowRotation}deg);">
        <path d="M24 4 L30 20 L26 20 L26 42 L22 42 L22 20 L18 20 Z" fill="#1e3a5f" stroke="#142a45" stroke-width="1" stroke-linejoin="round"/>
      </svg>
      <span style="font-size:10px;font-weight:600;color:#000000;white-space:nowrap;">${speedLabel}</span>
    `;
    container.style.position = 'relative';
    container.appendChild(overlay);
    windArrowRef.current = overlay;

    return () => {
      if (windArrowRef.current) {
        try { windArrowRef.current.remove(); } catch { /* ignore */ }
        windArrowRef.current = null;
      }
    };
  }, [windDirection, windSpeed, lat, lng, isLoading]);

  /**
   * Open the site in Google Maps, in satellite view.
   *
   * The `data=!3m1!1e1` fragment is what selects satellite, so the external view
   * matches the one on the dashboard. There is no longer a street branch here,
   * because there is no longer a street layer to be looking at.
   */
  const openInMaps = () => {
    window.open(
      `https://www.google.com/maps/@${lat},${lng},${zoom}z/data=!3m1!1e1`,
      "_blank"
    );
  };

  const centerOnStation = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lat, lng], defaultZoom);
    }
  };

  if (!hasCoordinates && !editable) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-normal">
              Station Location
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-64 text-black">
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
    <Card className="transition-shadow duration-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-normal">
            Station Location
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {safeFixed(lat, 4)}°, {safeFixed(lng, 4)}°
            </Badge>
            <Button variant="ghost" size="icon" onClick={centerOnStation} title="Center on station">
              <Navigation className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={openInMaps} title="Open in Google Maps (satellite)">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Location Search Bar */}
        {(editable || onLocationSelect) && (
          <div className="relative mt-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black" />
              <Input
                placeholder="Search location..."
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowResults(true)}
                className="pl-9 pr-8"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                  onClick={clearSearch}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
              {isSearching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-black" />
              )}
            </div>
            
            {/* Search Results Dropdown */}
            {showResults && searchResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
                {searchResults.map((result) => (
                  <button
                    key={result.place_id}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors border-b border-border last:border-b-0"
                    onClick={() => handleSelectLocation(result)}
                  >
                    <div className="font-medium truncate">{result.display_name.split(',')[0]}</div>
                    <div className="text-xs text-black truncate">
                      {result.display_name.split(',').slice(1, 3).join(',')}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            {/*
              No fallback image here.

              This used to embed a staticmap.openstreetmap.de render, which was a
              street map with a pushpin. It went for two reasons: it contradicted
              the satellite-only rule the rest of this component now follows, and
              that host is a volunteer service with no availability guarantee, so
              the fallback for a failed map was itself liable to fail. The
              coordinates are shown in the card header and repeated in the Station
              Details panel beside this map, so nothing is lost by saying plainly
              that the map did not load and offering the retry.
            */}
            <MapPin className="h-10 w-10 text-black/40" />
            <p className="text-sm text-black text-center">{error}</p>
            <p className="text-xs text-black text-center">
              {safeFixed(lat, 5)}&deg;, {safeFixed(lng, 5)}&deg;
            </p>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={retryLoadMap}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Retry
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={openInMaps}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Open in Browser
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative">
            {/* Loading overlay */}
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center h-64 text-black gap-2 bg-background z-10">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Loading map...</p>
              </div>
            )}
            {/* Map container - always rendered so ref is available */}
            <div
              ref={mapRef}
              className="w-full rounded-lg border h-64"
              style={{ minHeight: "256px" }}
            />
          </div>
        )}
        {altitude !== undefined && (
          <div className="mt-2 text-xs text-black text-center">
            Altitude: {altitude} m above sea level
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Exported wrapper component with error boundary
export function StationMapWithErrorBoundary(props: StationMapProps) {
  return (
    <MapErrorBoundary onError={(err) => console.error('[StationMap] Render error:', err)}>
      <StationMap {...props} />
    </MapErrorBoundary>
  );
}
