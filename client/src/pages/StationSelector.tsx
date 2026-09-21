// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch, queryClient } from "@/lib/queryClient";
import { safeFixed } from "@/lib/utils";
import { useLocation } from "wouter";
import { 
  MapPin, 
  Settings,
  ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StationImageDisplay, StationImageUpload } from "@/components/StationImageUpload";

interface Station {
  id: number;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  connectionType: string;
  stationType?: string | null;
  dataloggerModel?: string | null;
  isActive: boolean;
  lastSyncTime: string | null;
  stationImage?: string | null;
  ingestId?: string | null;
  lastReading?: {
    temperature: number | null;
    humidity: number | null;
    windSpeed: number | null;
    timestamp: string;
  };
}

interface StationSelectorProps {
  isAdmin: boolean;
  canAccessStation: (stationId: number) => boolean;
  onSelectStation: (stationId: number) => void;
}

export default function StationSelector({ isAdmin, canAccessStation, onSelectStation }: StationSelectorProps) {
  const [, setLocation] = useLocation();
  const [imageDialogStation, setImageDialogStation] = useState<Station | null>(null);

  const { data: stations = [], isLoading, error } = useQuery<Station[]>({
    queryKey: ["/api/stations"],
    queryFn: async () => {
      const res = await authFetch("/api/stations");
      if (!res.ok) throw new Error("Failed to fetch stations");
      const stationList = await res.json();
      
      // Fetch latest reading for each station (single record, not 24h range)
      const stationsWithData = await Promise.all(
        stationList.map(async (station: Station) => {
          try {
            const dataRes = await authFetch(
              `/api/stations/${station.id}/data/latest`
            );
            if (dataRes.ok) {
              const latestReading = await dataRes.json();
              const hasData = latestReading && latestReading.timestamp;
              return {
                ...station,
                lastReading: hasData ? {
                  temperature: latestReading.temperature,
                  humidity: latestReading.humidity,
                  windSpeed: latestReading.windSpeed,
                  timestamp: latestReading.timestamp
                } : undefined,
                // Prefer station.lastConnected (actual sync time), then collectedAt, then datalogger timestamp
                lastSyncTime: (station as any).lastConnected || (station as any).lastConnectionTime || latestReading?.collectedAt || latestReading?.timestamp || station.lastSyncTime
              };
            }
          } catch (e) {
            console.error("Error fetching station data:", e);
          }
          return station;
        })
      );
      
      return stationsWithData;
    },
    refetchInterval: 30000, // Refresh every 30 seconds for live preview
    refetchOnWindowFocus: true, // Refresh when tab regains focus
    staleTime: 20000, // Consider data fresh for 20 seconds
  });

  // Filter stations based on user permissions
  const accessibleStations = stations.filter(station => 
    isAdmin || canAccessStation(station.id)
  ).sort((a, b) => a.id - b.id);

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return null; // Return null instead of "Never"
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const formatTimeSince = (timestamp: string | null) => {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ${diffMin % 60}m ago`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays}d ${diffHrs % 24}h ago`;
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 pt-3 space-y-4">
        <div className="text-center">
          <p className="text-muted-foreground">Loading stations...</p>
        </div>
        {/* Same column count as the loaded grid, so the layout does not jump
            when the stations arrive. */}
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Error Loading Stations</h1>
          <p className="text-muted-foreground">Please try again later</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (accessibleStations.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground max-w-md mx-auto">
            {isAdmin 
              ? "No weather stations configured yet. Set up your first station to get started."
              : "You don't have access to any stations. Contact your administrator."}
          </p>
          {isAdmin && (
            <Button onClick={() => setLocation("/stations")}>
              <Settings className="h-4 w-4 mr-2" />
              Configure Stations
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto p-4 sm:p-6 pt-2 sm:pt-3 space-y-3 sm:space-y-4">
        {/* Station Cards */}
        {/*
          Four cards per row on a large screen. Going from three columns to four
          makes each card 75% of its previous width, which is the arithmetic
          consequence of fitting a fourth one in the same container; a literal
          65% would leave a visible gap at the end of every row.

          `items-stretch` plus `h-full` on the card keeps every block in a row the
          same height even when one station has a longer name or location that
          wraps to a second line.
        */}
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-stretch">
          {accessibleStations.map(station => (
            <Card 
              key={station.id} 
              className="group flex h-full flex-col cursor-pointer transition-all border border-border rounded-none shadow-none hover:shadow-md active:scale-[0.98]"
              onClick={() => onSelectStation(station.id)}
            >
              {/* Station Image */}
              <div className="relative">
                <StationImageDisplay image={station.stationImage} stationName={station.name} lastSyncTime={station.lastSyncTime} />
                {isAdmin && (
                  <div className="absolute top-2 right-2 flex gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 px-1.5 py-0 min-w-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setImageDialogStation(station);
                      }}
                    >
                      <span className="text-sm leading-none">Edit</span>
                    </Button>
                  </div>
                )}
              </div>
              
              <CardHeader className="pb-1 pt-3 px-3">
                <div className="flex items-start justify-between">
                  {/*
                    `truncate` goes on the block element, never on an inner span.

                    It was on a nested <span> before, and that is why long
                    location strings ran out past the edge of the card on both
                    web and mobile. Tailwind's `truncate` is three properties:
                    overflow:hidden, text-overflow:ellipsis and
                    white-space:nowrap. On an INLINE element only the nowrap
                    takes effect, because an inline box has no width of its own
                    to overflow and ellipsis needs a constrained block box. So
                    the text was told not to wrap and then not clipped, which is
                    the worst of both and put it outside the block.

                    CardTitle and CardDescription are both divs, so putting the
                    class on them gives a real block box, and the flex parent
                    already carries min-w-0 so it is allowed to shrink below its
                    content width. `title` keeps the full string reachable on
                    hover once it is cut.
                  */}
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <CardTitle
                      className="text-base sm:text-lg font-normal truncate"
                      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
                      title={station.name}
                    >
                      {station.name}
                    </CardTitle>
                    {station.location && (
                      <CardDescription
                        className="text-xs sm:text-sm truncate"
                        title={station.location}
                      >
                        Location: {station.location}
                      </CardDescription>
                    )}
                    {/* Coordinates and height above mean sea level are two
                        different facts, so each gets its own labelled line
                        rather than being run together with a bullet. Same size
                        as the location line above, and text-foreground rather
                        than text-muted-foreground: nothing on the card is grey. */}
                    {(station.latitude !== null && station.longitude !== null) && (
                      <CardDescription className="text-xs sm:text-sm text-foreground">
                        Coordinates: {safeFixed(station.latitude, 4)}°, {safeFixed(station.longitude, 4)}°
                      </CardDescription>
                    )}
                    {station.altitude !== null && station.altitude !== undefined && (
                      <CardDescription className="text-xs sm:text-sm text-foreground">
                        AMSL: {station.altitude}m
                      </CardDescription>
                    )}
                    {station.ingestId && (
                      <Badge variant="outline" className="text-xs mt-1 border-amber-300 text-amber-700 bg-amber-50 font-mono">
                        ID: {station.ingestId}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  </div>
                </div>
              </CardHeader>
              
              {/* flex-1 with the button pinned to the end keeps every "View
                  Dashboard" on the same baseline across a row, whatever the
                  metadata above it does. */}
              <CardContent className="flex flex-1 flex-col justify-end space-y-3 px-3 pb-3">

                {/* Stats Footer */}
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs sm:text-sm pt-2 border-t">
                  {station.name?.toUpperCase().includes('MPPT TEST') ? (
                    <div>
                      <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-xs font-normal" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        MPPT Demo Station
                      </Badge>
                    </div>
                  ) : formatLastSync(station.lastSyncTime) ? (
                    <>
                      <div>
                        {/* No outline: the sync time is a plain reading, not a
                            status chip, and a border around it competed with the
                            card's own edge. */}
                        {/* Same size as the location and coordinate lines above.
                            It was a step smaller, which made the freshness of the
                            data look like a footnote when it is the first thing
                            an operator checks. */}
                        <span className="text-black text-xs sm:text-sm font-normal" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                          Last Synced: {formatTimeSince(station.lastSyncTime)} &middot; {formatLastSync(station.lastSyncTime)}
                        </span>
                      </div>

                    </>
                  ) : station.lastReading?.timestamp ? (
                    <div>
                      <span className="text-black text-xs sm:text-sm font-normal" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        Last Synced: {formatTimeSince(new Date(station.lastReading.timestamp).toISOString())} &middot; {formatLastSync(new Date(station.lastReading.timestamp).toISOString())}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Full width with the label centred: the whole card is already
                    clickable, so the button reads as the card's action rather than
                    as one control sitting inside it. */}
                <Button 
                  className="w-full justify-center group-hover:bg-primary transition-colors" 
                  variant="outline"
                  size="sm"
                >
                  View Station Dashboard
                  <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

      </div>

      {/* Image Upload Dialog */}
      <Dialog open={!!imageDialogStation} onOpenChange={(open) => !open && setImageDialogStation(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {imageDialogStation?.name} - Station Image
            </DialogTitle>
          </DialogHeader>
          {imageDialogStation && (
            <StationImageUpload
              stationId={imageDialogStation.id}
              currentImage={imageDialogStation.stationImage}
              stationName={imageDialogStation.name}
              onImageChange={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
                setImageDialogStation(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
