// Stratus Weather System
// Created by Lukas Esterhuizen

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch, queryClient } from "@/lib/queryClient";
import { safeFixed } from "@/lib/utils";
import { useLocation } from "wouter";
import { 
  MapPin, 
  AlertCircle,
  CheckCircle2,
  Settings,
  ArrowRight,
  Camera
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
  assignedStations?: number[];
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
      <div className="container mx-auto p-6 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">
            Stratus Weather
          </h1>
          <p className="text-muted-foreground">Loading stations...</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
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
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
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
          <h1 className="text-3xl font-bold">Welcome to Stratus Weather</h1>
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
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="text-center space-y-2 pt-4 sm:pt-8">
          <h1 className="text-2xl sm:text-3xl font-bold">
            Stratus Weather
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Select a station to view its dashboard
          </p>
        </div>

        {/* Station Cards */}
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {accessibleStations.map(station => (
            <Card 
              key={station.id} 
              className="group cursor-pointer transition-all border-2 border-border shadow-md hover:shadow-xl hover:border-primary active:scale-[0.98]"
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setImageDialogStation(station);
                      }}
                    >
                      <Camera className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </div>
                )}
              </div>
              
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1 min-w-0">
                    <CardTitle className="text-lg sm:text-xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                      <span className="truncate">{station.name}</span>
                    </CardTitle>
                    {station.location && (
                      <CardDescription className="flex items-center gap-1 text-xs sm:text-sm">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{station.location}</span>
                      </CardDescription>
                    )}
                    {(station.latitude !== null && station.longitude !== null) && (
                      <CardDescription className="text-xs text-muted-foreground">
                        {safeFixed(station.latitude, 4)}°, {safeFixed(station.longitude, 4)}°
                        {station.altitude ? ` • ${station.altitude}m` : ''}
                      </CardDescription>
                    )}
                    <Badge variant="outline" className="text-xs mt-1 border-blue-300 text-blue-700 bg-blue-50">
                      {station.dataloggerModel || (station.stationType ? station.stationType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : station.connectionType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}
                    </Badge>
                    {station.ingestId && (
                      <Badge variant="outline" className="text-xs mt-1 border-amber-300 text-amber-700 bg-amber-50 font-mono">
                        ID: {station.ingestId}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {station.name?.toUpperCase().includes('MPPT TEST') ? null : station.isActive ? (
                      <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-gray-300 text-gray-600 bg-transparent text-xs">
                        Inactive
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                
                {/* Stats Footer */}
                <div className="flex items-center justify-between text-xs sm:text-sm text-muted-foreground pt-2 border-t">
                  {station.name?.toUpperCase().includes('MPPT TEST') ? (
                    <div>
                      <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 text-xs font-normal" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        MPPT Demo Station
                      </Badge>
                    </div>
                  ) : formatLastSync(station.lastSyncTime) ? (
                    <>
                      <div>
                        <Badge variant="outline" className="border-black text-black bg-transparent text-xs font-normal" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                          {formatTimeSince(station.lastSyncTime)} &middot; {formatLastSync(station.lastSyncTime)}
                        </Badge>
                      </div>

                    </>
                  ) : station.lastReading?.timestamp ? (
                    <div>
                      <Badge variant="outline" className="border-black text-black bg-transparent text-xs font-normal" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                        {formatTimeSince(new Date(station.lastReading.timestamp).toISOString())} &middot; {formatLastSync(new Date(station.lastReading.timestamp).toISOString())}
                      </Badge>
                    </div>
                  ) : null}
                </div>

                {/* View Button */}
                <Button 
                  className="w-full group-hover:bg-primary transition-colors" 
                  variant="outline"
                >
                  View Dashboard
                  <ArrowRight className="h-4 w-4 ml-2 transition-transform group-hover:translate-x-1" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Admin Actions */}
        {isAdmin && (
          <div className="text-center pt-4">
            <Button variant="ghost" onClick={() => setLocation("/stations")}>
              <Settings className="h-4 w-4 mr-2" />
              Manage Stations
            </Button>
          </div>
        )}
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
