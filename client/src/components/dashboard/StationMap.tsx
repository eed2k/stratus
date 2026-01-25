import { useEffect, useRef, useState, useCallback, Component, ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Maximize2, Minimize2, Navigation, ExternalLink, Search, Loader2, X, AlertTriangle, RefreshCw } from "lucide-react";

// ============================================================================
// BULLETPROOF LEAFLET LOADER - Multiple CDNs, retries, fallbacks
// ============================================================================

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
.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,.leaflet-pane>svg,.leaflet-pane>canvas,.leaflet-zoom-box,.leaflet-image-layer,.leaflet-layer{position:absolute;left:0;top:0}.leaflet-container{overflow:hidden;background:#ddd}.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow{-webkit-user-select:none;-moz-user-select:none;user-select:none;-webkit-user-drag:none}.leaflet-tile::selection{background:0 0}.leaflet-safari .leaflet-tile{image-rendering:-webkit-optimize-contrast}.leaflet-safari .leaflet-tile-container{width:1600px;height:1600px;-webkit-transform-origin:0 0}.leaflet-marker-icon,.leaflet-marker-shadow{display:block}.leaflet-container .leaflet-overlay-pane svg{max-width:none!important;max-height:none!important}.leaflet-container .leaflet-marker-pane img,.leaflet-container .leaflet-shadow-pane img,.leaflet-container .leaflet-tile-pane img,.leaflet-container img.leaflet-image-layer,.leaflet-container .leaflet-tile{max-width:none!important;max-height:none!important;width:auto;padding:0}.leaflet-container img.leaflet-tile{mix-blend-mode:plus-lighter}.leaflet-container.leaflet-touch-zoom{-ms-touch-action:pan-x pan-y;touch-action:pan-x pan-y}.leaflet-container.leaflet-touch-drag{-ms-touch-action:pinch-zoom;touch-action:none;touch-action:pinch-zoom}.leaflet-container.leaflet-touch-drag.leaflet-touch-zoom{-ms-touch-action:none;touch-action:none}.leaflet-container{-webkit-tap-highlight-color:transparent}.leaflet-container a{-webkit-tap-highlight-color:rgba(51,181,229,.4)}.leaflet-tile{filter:inherit;visibility:hidden}.leaflet-tile-loaded{visibility:inherit}.leaflet-zoom-box{width:0;height:0;-moz-box-sizing:border-box;box-sizing:border-box;z-index:800}.leaflet-overlay-pane svg{-moz-user-select:none}.leaflet-pane{z-index:400}.leaflet-tile-pane{z-index:200}.leaflet-overlay-pane{z-index:400}.leaflet-shadow-pane{z-index:500}.leaflet-marker-pane{z-index:600}.leaflet-tooltip-pane{z-index:650}.leaflet-popup-pane{z-index:700}.leaflet-map-pane canvas{z-index:100}.leaflet-map-pane svg{z-index:200}.leaflet-control{position:relative;z-index:800;pointer-events:visiblePainted;pointer-events:auto}.leaflet-top,.leaflet-bottom{position:absolute;z-index:1000;pointer-events:none}.leaflet-top{top:0}.leaflet-right{right:0}.leaflet-bottom{bottom:0}.leaflet-left{left:0}.leaflet-control{float:left;clear:both}.leaflet-right .leaflet-control{float:right}.leaflet-top .leaflet-control{margin-top:10px}.leaflet-bottom .leaflet-control{margin-bottom:10px}.leaflet-left .leaflet-control{margin-left:10px}.leaflet-right .leaflet-control{margin-right:10px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{font:bold 18px 'Lucida Console',Monaco,monospace;text-indent:1px}.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{font-size:22px}.leaflet-control-zoom-out{font-size:20px}.leaflet-touch .leaflet-control-zoom-out{font-size:24px}.leaflet-control-zoom-in,.leaflet-control-zoom-out{display:block;width:30px;height:30px;line-height:30px;text-align:center;text-decoration:none;color:#000;background:#fff}.leaflet-control-zoom-in:hover,.leaflet-control-zoom-out:hover{background:#f4f4f4}.leaflet-touch .leaflet-control-zoom-in,.leaflet-touch .leaflet-control-zoom-out{width:34px;height:34px;line-height:34px}.leaflet-control-zoom-disabled{cursor:default;background:#f4f4f4;color:#bbb}.leaflet-control-attribution{background:#fff;background:rgba(255,255,255,.8);margin:0}.leaflet-control-attribution,.leaflet-control-scale-line{padding:0 5px;color:#333;line-height:1.4}.leaflet-control-attribution a{text-decoration:none}.leaflet-control-attribution a:hover,.leaflet-control-attribution a:focus{text-decoration:underline}.leaflet-attribution-flag{display:inline!important;vertical-align:baseline!important;width:1em;height:.6667em}.leaflet-left .leaflet-control-scale{margin-left:5px}.leaflet-bottom .leaflet-control-scale{margin-bottom:5px}.leaflet-control-scale-line{border:2px solid #777;border-top:none;line-height:1.1;padding:2px 5px 1px;white-space:nowrap;-moz-box-sizing:border-box;box-sizing:border-box;background:rgba(255,255,255,.8);text-shadow:1px 1px #fff}.leaflet-control-scale-line:not(:first-child){border-top:2px solid #777;border-bottom:none;margin-top:-2px}.leaflet-control-scale-line:not(:first-child):not(:last-child){border-bottom:2px solid #777}.leaflet-touch .leaflet-control-attribution,.leaflet-touch .leaflet-control-layers,.leaflet-touch .leaflet-bar{box-shadow:none}.leaflet-touch .leaflet-control-layers,.leaflet-touch .leaflet-bar{border:2px solid rgba(0,0,0,.2);background-clip:padding-box}.leaflet-popup{position:absolute;text-align:center;margin-bottom:20px}.leaflet-popup-content-wrapper{padding:1px;text-align:left;border-radius:12px}.leaflet-popup-content{margin:13px 24px 13px 20px;line-height:1.3;font-size:13px;min-height:1px}.leaflet-popup-content p{margin:17px 0}.leaflet-popup-tip-container{width:40px;height:20px;position:absolute;left:50%;margin-top:-1px;margin-left:-20px;overflow:hidden;pointer-events:none}.leaflet-popup-tip{width:17px;height:17px;padding:1px;margin:-10px auto 0;pointer-events:auto;-webkit-transform:rotate(45deg);-moz-transform:rotate(45deg);-ms-transform:rotate(45deg);transform:rotate(45deg)}.leaflet-popup-content-wrapper,.leaflet-popup-tip{background:#fff;color:#333;box-shadow:0 3px 14px rgba(0,0,0,.4)}.leaflet-container a.leaflet-popup-close-button{position:absolute;top:0;right:0;border:none;text-align:center;width:24px;height:24px;font:16px/24px Tahoma,Verdana,sans-serif;color:#757575;text-decoration:none;background:0 0}.leaflet-container a.leaflet-popup-close-button:hover,.leaflet-container a.leaflet-popup-close-button:focus{color:#585858}.leaflet-popup-scrolled{overflow:auto}.leaflet-bar{box-shadow:0 1px 5px rgba(0,0,0,.65);border-radius:4px}.leaflet-bar a{background-color:#fff;border-bottom:1px solid #ccc;width:26px;height:26px;line-height:26px;display:block;text-align:center;text-decoration:none;color:#000}.leaflet-bar a,.leaflet-control-layers-toggle{background-position:50% 50%;background-repeat:no-repeat;display:block}.leaflet-bar a:hover,.leaflet-bar a:focus{background-color:#f4f4f4}.leaflet-bar a:first-child{border-top-left-radius:4px;border-top-right-radius:4px}.leaflet-bar a:last-child{border-bottom-left-radius:4px;border-bottom-right-radius:4px;border-bottom:none}.leaflet-bar a.leaflet-disabled{cursor:default;background-color:#f4f4f4;color:#bbb}.leaflet-touch .leaflet-bar a{width:30px;height:30px;line-height:30px}.leaflet-touch .leaflet-bar a:first-child{border-top-left-radius:2px;border-top-right-radius:2px}.leaflet-touch .leaflet-bar a:last-child{border-bottom-left-radius:2px;border-bottom-right-radius:2px}
`;

// Global state to track loading
let leafletLoadPromise: Promise<void> | null = null;
let leafletLoaded = false;
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 3;

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
            console.log('[Map] Leaflet loaded from:', cdn.js);
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

// ============================================================================
// ERROR BOUNDARY
// ============================================================================
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
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm text-center">Map failed to load</p>
              <p className="text-xs text-muted-foreground text-center max-w-xs">
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
}

/**
 * OpenStreetMap component using Leaflet.js
 * Free and open source map with no API key required
 * Uses Nominatim for location search (OpenStreetMap geocoding)
 * Default view: South Africa
 */
export function StationMap({
  latitude,
  longitude,
  stationName = "Weather Station",
  altitude,
  zoom = 13,
  onLocationSelect,
  editable = false,
}: StationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  
  // Location search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Default to South Africa (center) if no coordinates provided
  const lat = latitude ?? -30.5595; // Central South Africa
  const lng = longitude ?? 22.9375;
  const hasCoordinates = latitude !== undefined && longitude !== undefined;
  
  // Default zoom for South Africa overview vs specific location
  const defaultZoom = hasCoordinates ? zoom : 5;

  // Nominatim search function with South Africa bias
  const searchLocation = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      // Search with South Africa country bias and viewbox
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}` +
        `&format=json` +
        `&limit=8` +
        `&countrycodes=za` + // Bias to South Africa
        `&viewbox=16.45,-34.85,32.89,-22.13` + // South Africa bounding box
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

  // Main map initialization effect
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

        // Add OpenStreetMap tiles with error handling
        const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          minZoom: 1,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
          subdomains: ['a', 'b', 'c'],
          crossOrigin: 'anonymous',
          errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        });
        
        tileLayer.addTo(map);

        // Custom marker
        const stationIcon = L.divIcon({
          className: "custom-station-marker",
          html: `<div style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);border:2px solid white;"><svg style="transform:rotate(45deg);width:16px;height:16px;color:white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32],
        });

        const marker = L.marker([lat, lng], { icon: stationIcon }).addTo(map);
        
        marker.bindPopup(`
          <div style="min-width:180px;font-family:system-ui,sans-serif;">
            <strong style="font-size:14px;color:#1e40af;">${stationName}</strong>
            <hr style="margin:6px 0;border:none;border-top:1px solid #e5e7eb;">
            <div style="font-size:12px;color:#4b5563;">
              <div>Lat: ${lat.toFixed(5)}°</div>
              <div>Lng: ${lng.toFixed(5)}°</div>
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

        // Additional invalidateSize calls for reliability
        [100, 300, 600].forEach(delay => {
          setTimeout(() => {
            if (isMounted && map && map._container) {
              map.invalidateSize({ animate: false });
            }
          }, delay);
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

  // Handle expand/collapse - just invalidate size
  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 150);
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
          <CardTitle className="text-lg font-normal">
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
        
        {/* Location Search Bar */}
        {(editable || onLocationSelect) && (
          <div className="relative mt-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search location in South Africa..."
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
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
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
                    <div className="text-xs text-muted-foreground truncate">
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
            {/* Static map fallback image */}
            <div className="relative w-full h-40 rounded-lg overflow-hidden bg-muted">
              <img 
                src={`https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${Math.min(defaultZoom, 12)}&size=400x200&markers=${lat},${lng},red-pushpin`}
                alt="Station location"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
                <MapPin className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </div>
            <p className="text-sm text-muted-foreground text-center">{error}</p>
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
              <div className="absolute inset-0 flex flex-col items-center justify-center h-64 text-muted-foreground gap-2 bg-background z-10">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm">Loading map...</p>
              </div>
            )}
            {/* Map container - always rendered so ref is available */}
            <div
              ref={mapRef}
              className={`w-full rounded-lg border transition-all duration-300 ${
                isExpanded ? "h-[500px]" : "h-64"
              }`}
              style={{ minHeight: isExpanded ? "500px" : "256px" }}
            />
          </div>
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

// Exported wrapper component with error boundary
export function StationMapWithErrorBoundary(props: StationMapProps) {
  return (
    <MapErrorBoundary onError={(err) => console.error('[StationMap] Render error:', err)}>
      <StationMap {...props} />
    </MapErrorBoundary>
  );
}
