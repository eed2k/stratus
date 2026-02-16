import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Search, Loader2, Camera, Cloud, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { WeatherStation } from "@shared/schema";
// Skeleton removed — using table layout
import { StationImageUpload } from "@/components/StationImageUpload";

interface StationWithReading extends WeatherStation {
  lastReading?: {
    temperature: number | null;
    humidity: number | null;
    windSpeed: number | null;
    timestamp: string;
  };
  lastSyncTime?: string | null;
}

type StationType = "campbell" | "rika";
type ConnectionType = "dropbox" | "lora" | "gsm" | "ip" | "mqtt" | "4g" | "tcp_ip" | "http_post" | "rikacloud";

interface StationFormData {
  name: string;
  type: StationType;
  location: string;
  latitude: string;
  longitude: string;
  altitude: string;
  connectionType: ConnectionType;
  ipAddress: string;
  port: string;
  loraFrequency: string;
  gsmApn: string;
  apiKey: string;
  apiEndpoint: string;
  pollInterval: string;
  // Dropbox sync configuration
  dropboxFolderPath: string;
  dropboxFilePattern: string;
  dropboxSyncInterval: string;
  // Campbell Scientific / LoggerNet specific
  pakbusAddress: string;
  securityCode: string;
  dataTable: string;
  dataloggerModel: string;
  dataloggerSerialNumber: string;
  dataloggerProgramName: string;
  // Modem/Communication hardware
  modemModel: string;
  modemSerialNumber: string;
  modemPhoneNumber: string;
  simCardNumber: string;
  // Notes and maintenance
  notes: string;
  lastCalibrationDate: string;
  nextCalibrationDate: string;
  siteDescription: string;
  // RikaCloud credentials
  rikaEmail: string;
  rikaPassword: string;
}

const initialFormData: StationFormData = {
  name: "",
  type: "campbell",
  location: "",
  latitude: "",
  longitude: "",
  altitude: "",
  connectionType: "dropbox",
  ipAddress: "",
  port: "6785",
  loraFrequency: "868000000",
  gsmApn: "",
  apiKey: "",
  apiEndpoint: "",
  pollInterval: "60",
  // Dropbox sync defaults
  dropboxFolderPath: "",
  dropboxFilePattern: "",
  dropboxSyncInterval: "3600",
  // Campbell Scientific / LoggerNet defaults
  pakbusAddress: "1",
  securityCode: "0",
  dataTable: "Table1",
  dataloggerModel: "",
  dataloggerSerialNumber: "",
  dataloggerProgramName: "",
  // Modem/Communication hardware
  modemModel: "",
  modemSerialNumber: "",
  modemPhoneNumber: "",
  simCardNumber: "",
  // Notes and maintenance
  notes: "",
  lastCalibrationDate: "",
  nextCalibrationDate: "",
  siteDescription: "",
  // RikaCloud credentials
  rikaEmail: "",
  rikaPassword: "",
};

export default function Stations() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"stations" | "setup">("stations");
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [selectedStation, setSelectedStation] = useState<StationWithReading | null>(null);
  const [deleteStation, setDeleteStation] = useState<StationWithReading | null>(null);
  const [formData, setFormData] = useState<StationFormData>(initialFormData);
  const { toast } = useToast();

  // Listen for Electron menu events
  useEffect(() => {
    const handleOpenNewStation = () => {
      setActiveTab("setup");
    };

    window.addEventListener('open-new-station-dialog', handleOpenNewStation);
    
    return () => {
      window.removeEventListener('open-new-station-dialog', handleOpenNewStation);
    };
  }, []);

  const { data: stations = [], isLoading } = useQuery<StationWithReading[]>({
    queryKey: ["/api/stations"],
    queryFn: async () => {
      const res = await authFetch("/api/stations");
      if (!res.ok) throw new Error("Failed to fetch stations");
      const stationList = await res.json();
      
      // Fetch latest reading for each station (single record, not 24h range)
      const stationsWithData = await Promise.all(
        stationList.map(async (station: WeatherStation) => {
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
                // Prefer station.lastConnectionTime (actual Dropbox sync time persisted by server)
                // then fall back to data import time (collectedAt), then datalogger timestamp
                lastSyncTime: (station as any).lastConnected || station.lastConnectionTime || latestReading?.collectedAt || latestReading?.timestamp || null
              } as StationWithReading;
            }
          } catch (e) {
            console.error("Error fetching station data:", e);
          }
          return station;
        })
      );
      
      return stationsWithData;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    refetchOnWindowFocus: true, // Refresh when tab regains focus
  });

  const createMutation = useMutation({
    mutationFn: async (data: StationFormData) => {
      // Set station type based on connection type (Rika uses its own type)
      const stationType = data.connectionType === "rikacloud" ? "rika" : (data.type === "campbell" ? "campbell_scientific" : data.type);
      const payload: any = {
        name: data.name,
        location: data.location || null,
        latitude: data.latitude ? parseFloat(data.latitude) : null,
        longitude: data.longitude ? parseFloat(data.longitude) : null,
        altitude: data.altitude ? parseFloat(data.altitude) : null,
        stationType: stationType,
        connectionType: data.connectionType,
        ipAddress: data.ipAddress || null,
        port: data.port ? parseInt(data.port) : 6785,
        apiKey: data.apiKey || null,
        apiEndpoint: data.apiEndpoint || null,
        pollInterval: data.pollInterval ? parseInt(data.pollInterval) : 60,
        protocol: "pakbus",
        // Campbell Scientific / LoggerNet fields
        pakbusAddress: data.pakbusAddress ? parseInt(data.pakbusAddress) : 1,
        securityCode: data.securityCode ? parseInt(data.securityCode) : 0,
        dataTable: data.dataTable || "Table1",
        dataloggerModel: data.dataloggerModel || null,
        dataloggerSerialNumber: data.dataloggerSerialNumber || null,
        dataloggerProgramName: data.dataloggerProgramName || null,
        // Modem/Communication hardware
        modemModel: data.modemModel || null,
        modemSerialNumber: data.modemSerialNumber || null,
        modemPhoneNumber: data.modemPhoneNumber || null,
        simCardNumber: data.simCardNumber || null,
        // Notes and maintenance
        notes: data.notes || null,
        lastCalibrationDate: data.lastCalibrationDate ? new Date(data.lastCalibrationDate) : null,
        nextCalibrationDate: data.nextCalibrationDate ? new Date(data.nextCalibrationDate) : null,
        siteDescription: data.siteDescription || null,
      };

      // Campbell Scientific specific handling - connection config for each type
      if (data.connectionType === "dropbox") {
        payload.connectionConfig = JSON.stringify({
          type: "dropbox",
          folderPath: data.dropboxFolderPath,
          filePattern: data.dropboxFilePattern ? (data.dropboxFilePattern.includes('*') || data.dropboxFilePattern.includes('?') || data.dropboxFilePattern.includes('.') ? data.dropboxFilePattern : data.dropboxFilePattern + '*') : undefined,
          syncInterval: parseInt(data.dropboxSyncInterval) || 3600,
        });
      } else if (data.connectionType === "http_post") {
        payload.connectionConfig = JSON.stringify({
          type: "http_post",
          apiEndpoint: data.apiEndpoint,
          apiKey: data.apiKey,
        });
      } else if (data.connectionType === "tcp_ip") {
        payload.connectionConfig = JSON.stringify({
          type: "tcp",
          host: data.ipAddress,
          port: parseInt(data.port) || 6785,
          pakbusAddress: parseInt(data.pakbusAddress) || 1,
          securityCode: parseInt(data.securityCode) || 0,
        });
      } else if (data.connectionType === "lora") {
        payload.connectionConfig = JSON.stringify({
          type: "lora",
          frequency: data.loraFrequency,
          pakbusAddress: parseInt(data.pakbusAddress) || 1,
          securityCode: parseInt(data.securityCode) || 0,
        });
      } else if (data.connectionType === "gsm" || data.connectionType === "4g") {
        payload.connectionConfig = JSON.stringify({
          type: data.connectionType,
          apn: data.gsmApn,
          modemModel: data.modemModel,
          phoneNumber: data.modemPhoneNumber,
          simCard: data.simCardNumber,
          pakbusAddress: parseInt(data.pakbusAddress) || 1,
          securityCode: parseInt(data.securityCode) || 0,
        });
      } else if (data.connectionType === "mqtt") {
        payload.port = data.port ? parseInt(data.port) : 1883;
        payload.protocol = "mqtt";
        payload.connectionConfig = JSON.stringify({
          broker: data.ipAddress,
          port: parseInt(data.port) || 1883,
          topic: data.apiEndpoint,
          username: data.apiKey?.split(":")[0] || null,
          password: data.apiKey?.split(":")[1] || null,
          useTls: payload.port === 8883,
        });
      } else if (data.connectionType === "rikacloud") {
        // RikaCloud HTTP API (READ-ONLY) - e.g., https://cloud-en.rikacloud.com/service/user/api/getDeviceData/{device_id}
        payload.protocol = "http";
        payload.connectionConfig = JSON.stringify({
          type: "rikacloud",
          apiEndpoint: data.apiEndpoint,
          apiKey: data.apiKey,
          rikaEmail: data.rikaEmail,
          rikaPassword: data.rikaPassword,
          pollInterval: parseInt(data.pollInterval) || 60,
        });
      }

      return await apiRequest("POST", "/api/stations", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      setActiveTab("stations");
      setFormData(initialFormData);
      toast({ title: "Station added", description: "Weather station has been configured successfully." });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorised", description: "Please log in again.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: "Failed to add station.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (stationId: number) => {
      return await apiRequest("DELETE", `/api/stations/${stationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      setDeleteStation(null);
      toast({ title: "Station deleted", description: "The station and all its data have been removed." });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorised", description: "Please log in again.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/"; }, 500);
        return;
      }
      toast({ title: "Error", description: "Failed to delete station.", variant: "destructive" });
    },
  });

  const filteredStations = stations.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.location && s.location.toLowerCase().includes(search.toLowerCase()))
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Validation Error", description: "Station name is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const updateForm = (updates: Partial<StationFormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };

  const formatLastSync = (timestamp: string | null | undefined) => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
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

  // Station Setup Form - inlined to avoid re-mount on every parent render
  const stationSetupContent = (
    <div className="space-y-6">
      <Card className="border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20">
        <CardHeader>
          <CardTitle>Add New Weather Station</CardTitle>
          <CardDescription>
            Configure a new weather station connection
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <Card className="border-sky-200 bg-white dark:bg-sky-950/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Station Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Connection Type</Label>
                  <Select value={formData.connectionType} onValueChange={(v) => updateForm({ connectionType: v as ConnectionType })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dropbox">Dropbox Sync (Campbell Scientific)</SelectItem>
                      <SelectItem value="rikacloud">RikaCloud HTTP API (Rika Weather Stations)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(formData.connectionType === "tcp_ip" || formData.connectionType === "ip") && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Datalogger IP Address</Label>
                      <Input
                        placeholder="192.168.4.14"
                        value={formData.ipAddress}
                        onChange={(e) => updateForm({ ipAddress: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Port</Label>
                      <Input
                        placeholder="6785"
                        value={formData.port}
                        onChange={(e) => updateForm({ port: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {formData.connectionType === "dropbox" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Dropbox Folder Path</Label>
                      <Input
                        placeholder="Dropbox folder path"
                        value={formData.dropboxFolderPath}
                        onChange={(e) => updateForm({ dropboxFolderPath: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        The folder path in Dropbox where data files are stored
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>File Pattern (optional)</Label>
                      <Input
                        placeholder="Filename pattern"
                        value={formData.dropboxFilePattern}
                        onChange={(e) => updateForm({ dropboxFilePattern: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave blank to import all .dat files in the folder. Enter a station prefix (e.g. <code>Inteltronics_SAWS_TestBed_5263</code>) to match all tables, or use wildcards like <code>*Table5m*</code> for specific tables.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Sync Interval (seconds)</Label>
                      <Select value={formData.dropboxSyncInterval} onValueChange={(v) => updateForm({ dropboxSyncInterval: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="300">5 minutes</SelectItem>
                          <SelectItem value="600">10 minutes</SelectItem>
                          <SelectItem value="900">15 minutes</SelectItem>
                          <SelectItem value="1800">30 minutes</SelectItem>
                          <SelectItem value="3600">1 hour</SelectItem>
                          <SelectItem value="7200">2 hours</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        How often Stratus checks Dropbox for new data files
                      </p>
                    </div>
                  </div>
                )}

                {formData.connectionType === "http_post" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>API Endpoint (auto-generated)</Label>
                      <Input
                        placeholder="/api/campbell/data/{station-id}"
                        value={formData.apiEndpoint}
                        disabled
                      />
                      <p className="text-xs text-muted-foreground">
                        Endpoint URL will be generated after station is created. Configure your datalogger to POST data to this URL.
                      </p>
                    </div>
                  </div>
                )}

                {formData.connectionType === "lora" && (
                  <div className="space-y-2">
                    <Label>LoRa Frequency (Hz)</Label>
                    <Select value={formData.loraFrequency} onValueChange={(v) => updateForm({ loraFrequency: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="868000000">868 MHz (Europe/Africa)</SelectItem>
                        <SelectItem value="915000000">915 MHz (North America)</SelectItem>
                        <SelectItem value="433000000">433 MHz (Asia)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {(formData.connectionType === "gsm" || formData.connectionType === "4g") && (
                  <div className="space-y-2">
                    <Label>APN (Access Point Name)</Label>
                    <Input
                      placeholder="internet.provider.co.za"
                      value={formData.gsmApn}
                      onChange={(e) => updateForm({ gsmApn: e.target.value })}
                    />
                  </div>
                )}

                {formData.connectionType === "mqtt" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>MQTT Broker Address</Label>
                        <Input
                          placeholder="192.168.1.100"
                          value={formData.ipAddress}
                          onChange={(e) => updateForm({ ipAddress: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Port</Label>
                        <Input
                          placeholder="1883"
                          value={formData.port}
                          onChange={(e) => updateForm({ port: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Topic</Label>
                      <Input
                        placeholder="weather/station1"
                        value={formData.apiEndpoint}
                        onChange={(e) => updateForm({ apiEndpoint: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Credentials (optional)</Label>
                      <Input
                        placeholder="username:password"
                        value={formData.apiKey}
                        onChange={(e) => updateForm({ apiKey: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {formData.connectionType === "rikacloud" && (
                  <div className="space-y-4">
                    <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                      <strong>Read-only integration:</strong> Stratus only fetches (reads) data from RikaCloud. It will never write, modify, or delete any data on your RikaCloud account. Your station continues sending data to RikaCloud as normal.
                    </div>
                    <div className="space-y-2">
                      <Label>RikaCloud Account</Label>
                      <Input
                        placeholder="Account username"
                        value={formData.rikaEmail}
                        onChange={(e) => updateForm({ rikaEmail: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Your RikaCloud account username
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>RikaCloud Password</Label>
                      <Input
                        type="password"
                        placeholder="Your RikaCloud password"
                        value={formData.rikaPassword}
                        onChange={(e) => updateForm({ rikaPassword: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Device Data URL (optional)</Label>
                      <Input
                        placeholder="https://cloud.rikacloud.com"
                        value={formData.apiEndpoint}
                        onChange={(e) => updateForm({ apiEndpoint: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave blank to use the default (<code className="text-xs">cloud.rikacloud.com</code>). Stratus will auto-discover your farm and sensor data.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Poll Interval</Label>
                      <Select value={formData.pollInterval} onValueChange={(v) => updateForm({ pollInterval: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="60">1 minute</SelectItem>
                          <SelectItem value="300">5 minutes</SelectItem>
                          <SelectItem value="600">10 minutes</SelectItem>
                          <SelectItem value="1800">30 minutes</SelectItem>
                          <SelectItem value="3600">1 hour</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Station Details */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Station Name *</Label>
                <Input
                  id="name"
                  placeholder="Station name"
                  value={formData.name}
                  onChange={(e) => updateForm({ name: e.target.value })}
                  required
                  data-testid="input-station-name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="location">Location Description</Label>
                <Input
                  id="location"
                  placeholder="Location description"
                  value={formData.location}
                  onChange={(e) => updateForm({ location: e.target.value })}
                  data-testid="input-location"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="latitude">Latitude</Label>
                  <Input
                    id="latitude"
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={formData.latitude}
                    onChange={(e) => updateForm({ latitude: e.target.value })}
                    data-testid="input-latitude"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="longitude">Longitude</Label>
                  <Input
                    id="longitude"
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={formData.longitude}
                    onChange={(e) => updateForm({ longitude: e.target.value })}
                    data-testid="input-longitude"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="altitude">Altitude (m)</Label>
                  <Input
                    id="altitude"
                    type="number"
                    placeholder="0"
                    value={formData.altitude}
                    onChange={(e) => updateForm({ altitude: e.target.value })}
                    data-testid="input-altitude"
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
              Note: Site description, notes, calibration and maintenance records can be configured in the station dashboard admin panel after setup.
            </p>

            <Button
              type="submit"
              className="w-full"
              disabled={createMutation.isPending}
              data-testid="button-save-station"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Station
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Weather Stations</h1>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "stations" | "setup")} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="stations">
            Active Stations
          </TabsTrigger>
          <TabsTrigger value="setup">
            Add New Station
          </TabsTrigger>
        </TabsList>

        {/* Active Stations Tab */}
        <TabsContent value="stations" className="space-y-4 mt-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search stations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              data-testid="input-search-stations"
            />
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading stations...</div>
          ) : filteredStations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Cloud className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Stations Found</h3>
                <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                  {search 
                    ? "No stations match your search." 
                    : "Add your first weather station to get started."}
                </p>
                {!search && (
                  <Button onClick={() => setActiveTab("setup")} data-testid="button-add-first-station">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Station
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Station Name</th>
                    <th className="text-left p-3 font-medium hidden sm:table-cell">Location</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Last Sync</th>
                    <th className="text-center p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredStations.map((station) => (
                    <tr key={station.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-station-${station.id}`}>
                      <td className="p-3 font-medium">{station.name}</td>
                      <td className="p-3 text-muted-foreground hidden sm:table-cell">
                        {station.location || '—'}
                      </td>
                      <td className="p-3 text-muted-foreground hidden md:table-cell">
                        {formatLastSync(station.lastSyncTime)}
                      </td>
                      <td className="p-3 text-center">
                        {station.isActive ? (
                          <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 text-xs">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="border-gray-300 text-gray-600 bg-transparent text-xs">Inactive</Badge>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.location.href = `/dashboard/${station.id}`}
                            data-testid={`button-view-${station.id}`}
                          >
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setSelectedStation(station);
                              setImageDialogOpen(true);
                            }}
                            title="Upload station image"
                          >
                            <Camera className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteStation(station)}
                            title="Delete station"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Add New Station Tab */}
        <TabsContent value="setup" className="mt-4">
          {stationSetupContent}
        </TabsContent>
      </Tabs>

      {/* Delete Station Confirmation */}
      <AlertDialog open={!!deleteStation} onOpenChange={(open) => !open && setDeleteStation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>Delete Station</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteStation?.name}</strong>? This will permanently remove the station and all its weather data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteStation && deleteMutation.mutate(deleteStation.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Station Image Upload Dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Station Image
            </DialogTitle>
            <DialogDescription>
              Upload or change the image for {selectedStation?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedStation && (
            <StationImageUpload
              stationId={selectedStation.id}
              currentImage={selectedStation.stationImage}
              stationName={selectedStation.name}
              onImageChange={() => {
                setImageDialogOpen(false);
                queryClient.invalidateQueries({ queryKey: ['/api/stations'] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
