import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch, queryClient } from "@/lib/queryClient";
import { safeFixed } from "@/lib/utils";
import { useLocation } from "wouter";
import { 
  MapPin, 
  AlertCircle,
  CheckCircle2,
  Clock,
  BarChart3,
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
  isActive: boolean;
  lastSyncTime: string | null;
  stationImage?: string | null;
  lastReading?: {
    temperature: number | null;
    humidity: number | null;
    windSpeed: number | null;
    timestamp: string;
  };
  recordCount?: number;
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
      
      // Fetch latest reading for each station
      const stationsWithData = await Promise.all(
        stationList.map(async (station: Station) => {
          try {
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
            const dataRes = await authFetch(
              `/api/stations/${station.id}/data?startTime=${startTime.toISOString()}&endTime=${endTime.toISOString()}`
            );
            if (dataRes.ok) {
              const data = await dataRes.json();
              const latestReading = data.length > 0 ? data[data.length - 1] : null;
              return {
                ...station,
                lastReading: latestReading ? {
                  temperature: latestReading.temperature,
                  humidity: latestReading.humidity,
                  windSpeed: latestReading.windSpeed,
                  timestamp: latestReading.timestamp
                } : undefined,
                recordCount: data.length,
                // Use collectedAt (when data was synced) instead of timestamp (datalogger clock)
                lastSyncTime: latestReading?.collectedAt || latestReading?.timestamp || station.lastSyncTime
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
    refetchInterval: 60000, // Refresh every minute
  });

  // Filter stations based on user permissions
  const accessibleStations = stations.filter(station => 
    isAdmin || canAccessStation(station.id)
  );

  const getConnectionBadge = (type: string) => {
    const labels: Record<string, string> = {
      pakbus: "PakBus",
      http_post: "HTTP POST",
      http: "HTTP",
      dropbox: "Dropbox",
      tcp_ip: "TCP/IP",
      lora: "LoRa",
      gsm: "GSM",
      "4g": "4G/LTE",
      mqtt: "MQTT",
    };
    return (
      <Badge 
        variant="outline" 
        className="bg-white text-black border border-black"
        style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
      >
        {labels[type] || type}
      </Badge>
    );
  };

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
    return `${Math.floor(diffMinutes / 1440)}d ago`;
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
              className="group cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 active:scale-[0.98]"
              onClick={() => onSelectStation(station.id)}
            >
              {/* Station Image */}
              <div className="relative">
                <StationImageDisplay image={station.stationImage} stationName={station.name} />
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
                    <Badge variant="outline" className="text-xs mt-1 bg-sky-50 text-sky-700 border-sky-200">
                      Campbell Scientific
                    </Badge>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {getConnectionBadge(station.connectionType)}
                    {station.isActive ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-gray-50 text-gray-500 text-xs">
                        Inactive
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                
                {/* Stats Footer */}
                <div className="flex items-center justify-between text-xs sm:text-sm text-muted-foreground pt-2 border-t">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                    <span>Last sync: {formatLastSync(station.lastSyncTime)}</span>
                  </div>
                  {station.recordCount !== undefined && (
                    <div className="flex items-center gap-1">
                      <BarChart3 className="h-3 w-3 sm:h-4 sm:w-4" />
                      <span>{station.recordCount.toLocaleString()} records</span>
                    </div>
                  )}
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
