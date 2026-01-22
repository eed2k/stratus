import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Maximize2, Minimize2, Navigation, ExternalLink, Search, Loader2, X } from "lucide-react";

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

  useEffect(() => {
    let isMounted = true;
    
    // Dynamically load Leaflet CSS
    const loadCss = () => {
      if (!document.querySelector('link[href*="leaflet.css"]')) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        // Try primary CDN first
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.crossOrigin = "anonymous";
        link.onerror = () => {
          // Fallback to cdnjs
          link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
        };
        document.head.appendChild(link);
      }
    };

    // Dynamically load Leaflet JS with retry and fallback
    const loadLeaflet = async (): Promise<void> => {
      loadCss();
      
      if ((window as any).L) {
        return Promise.resolve();
      }
      
      return new Promise<void>((resolve, reject) => {
        const tryLoad = (url: string, onFail: () => void) => {
          const script = document.createElement("script");
          script.src = url;
          script.crossOrigin = "anonymous";
          script.onload = () => {
            if ((window as any).L) {
              resolve();
            } else {
              onFail();
            }
          };
          script.onerror = onFail;
          document.head.appendChild(script);
        };
        
        // Try primary CDN
        tryLoad(
          "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
          () => {
            // Fallback to cdnjs
            tryLoad(
              "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
              () => reject(new Error("Failed to load Leaflet from all CDNs"))
            );
          }
        );
      });
    };

    const initMap = () => {
      if (!mapRef.current || !isMounted) return;
      
      // Clean up existing map first
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }

      try {
        const L = (window as any).L;
        if (!L) {
          setError("Leaflet not loaded");
          return;
        }
        
        // Create map with South Africa default view
        const map = L.map(mapRef.current, {
          center: [lat, lng],
          zoom: defaultZoom,
          zoomControl: true,
          attributionControl: true,
        });

        // Add OpenStreetMap tiles (free, no API key needed)
        // Using multiple subdomains for better reliability
        const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          minZoom: 1,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          subdomains: ['a', 'b', 'c'],
          crossOrigin: 'anonymous',
          updateWhenIdle: false,
          updateWhenZooming: false,
          keepBuffer: 4,
          tileSize: 256,
          zoomOffset: 0,
        });
        
        tileLayer.on('tileerror', (error: any) => {
          console.warn('Tile load error:', error);
        });
        
        tileLayer.addTo(map);

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
        // Multiple calls ensure tiles load properly
        const invalidateSizes = [100, 250, 500, 1000];
        invalidateSizes.forEach(delay => {
          setTimeout(() => {
            if (isMounted && map && map._container) {
              map.invalidateSize({ animate: false, pan: false });
            }
          }, delay);
        });
        
        // Also invalidate on window resize
        const handleResize = () => {
          if (map && map._container) {
            map.invalidateSize({ animate: false });
          }
        };
        window.addEventListener('resize', handleResize);
        
        setError(null);
        setIsLoading(false);
      } catch (err) {
        console.error("Map initialization error:", err);
        setError("Failed to initialize map");
        setIsLoading(false);
      }
    };

    loadLeaflet()
      .then(() => {
        // Small delay to ensure DOM is ready
        setTimeout(() => {
          if (isMounted) {
            initMap();
          }
        }, 100);
      })
      .catch((err) => {
        console.error("Failed to load Leaflet:", err);
        if (isMounted) {
          setError("Failed to load map library. Please check your internet connection.");
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, [lat, lng, defaultZoom, stationName, altitude]);

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
          <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
            <MapPin className="h-8 w-8 opacity-50" />
            <p className="text-sm text-center">{error}</p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => window.location.reload()}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading map...</p>
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
