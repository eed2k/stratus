import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MapPin, Plus, Radio, Search, Trash2, Loader2, Wifi, Cable, Signal, Smartphone, Server } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { WeatherStation } from "@shared/schema";

type StationType = "campbell" | "rika" | "generic";
type ConnectionType = "serial" | "lora" | "gsm" | "ip";

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
  serialPort: string;
  baudRate: string;
  loraFrequency: string;
  gsmApn: string;
  apiKey: string;
  apiEndpoint: string;
  pollInterval: string;
}

const initialFormData: StationFormData = {
  name: "",
  type: "generic",
  location: "",
  latitude: "",
  longitude: "",
  altitude: "",
  connectionType: "ip",
  ipAddress: "",
  port: "8080",
  serialPort: "COM3",
  baudRate: "115200",
  loraFrequency: "868000000",
  gsmApn: "",
  apiKey: "",
  apiEndpoint: "",
  pollInterval: "60",
};

export default function Stations() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState<StationFormData>(initialFormData);
  const { toast } = useToast();

  const { data: stations = [], isLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: StationFormData) => {
      const stationType = data.type === "campbell" ? "campbell_scientific" : data.type;
      const payload: any = {
        name: data.name,
        location: data.location || null,
        latitude: data.latitude ? parseFloat(data.latitude) : null,
        longitude: data.longitude ? parseFloat(data.longitude) : null,
        altitude: data.altitude ? parseFloat(data.altitude) : null,
        stationType: stationType,
        connectionType: data.connectionType,
        ipAddress: data.ipAddress || null,
        port: data.port ? parseInt(data.port) : 80,
        apiKey: data.apiKey || null,
        apiEndpoint: data.apiEndpoint || null,
        pollInterval: data.pollInterval ? parseInt(data.pollInterval) : 60,
        dataTable: "OneMin",
      };

      if (data.type === "rika") {
        payload.apiEndpoint = data.ipAddress ? `http://${data.ipAddress}:${data.port}/api/v1/data` : data.apiEndpoint;
        payload.connectionType = "http";
      } else if (data.type === "campbell") {
        payload.connectionType = data.connectionType;
        if (data.connectionType === "ip") {
          payload.connectionType = "http";
        }
      }

      return await apiRequest("POST", "/api/stations", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      setDialogOpen(false);
      setFormData(initialFormData);
      toast({ title: "Station added", description: "Weather station has been configured successfully." });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: "Failed to add station.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/stations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations"] });
      toast({ title: "Station deleted", description: "Weather station has been removed." });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Please log in again.", variant: "destructive" });
        setTimeout(() => { window.location.href = "/api/login"; }, 500);
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

  const getStationTypeIcon = (type: StationType) => {
    switch (type) {
      case "campbell": return <Server className="h-5 w-5" />;
      case "rika": return <Wifi className="h-5 w-5" />;
      default: return <Radio className="h-5 w-5" />;
    }
  };

  const getConnectionIcon = (type: ConnectionType) => {
    switch (type) {
      case "serial": return <Cable className="h-4 w-4" />;
      case "lora": return <Signal className="h-4 w-4" />;
      case "gsm": return <Smartphone className="h-4 w-4" />;
      case "ip": return <Wifi className="h-4 w-4" />;
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Weather Stations</h1>
          <p className="text-sm text-muted-foreground">
            Configure and manage Campbell Scientific and Rika weather stations
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-station">
              <Plus className="mr-2 h-4 w-4" />
              Add Station
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Weather Station</DialogTitle>
              <DialogDescription>
                Configure a Campbell Scientific or Rika weather station
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6 py-4">
              <Tabs value={formData.type} onValueChange={(v) => updateForm({ type: v as StationType })}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="campbell" className="flex items-center gap-2">
                    <Server className="h-4 w-4" />
                    Campbell
                  </TabsTrigger>
                  <TabsTrigger value="rika" className="flex items-center gap-2">
                    <Wifi className="h-4 w-4" />
                    Rika
                  </TabsTrigger>
                  <TabsTrigger value="generic" className="flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    Generic
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="campbell" className="space-y-4 mt-4">
                  <Card className="border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Campbell Scientific Configuration</CardTitle>
                      <CardDescription>
                        Supports CR300, CR215 dataloggers with RS232, LoRa, or GSM connections
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Connection Type</Label>
                        <Select value={formData.connectionType} onValueChange={(v) => updateForm({ connectionType: v as ConnectionType })}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="serial">
                              <div className="flex items-center gap-2">
                                <Cable className="h-4 w-4" />
                                Serial RS232
                              </div>
                            </SelectItem>
                            <SelectItem value="lora">
                              <div className="flex items-center gap-2">
                                <Signal className="h-4 w-4" />
                                LoRa Radio
                              </div>
                            </SelectItem>
                            <SelectItem value="gsm">
                              <div className="flex items-center gap-2">
                                <Smartphone className="h-4 w-4" />
                                GSM/GPRS
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {formData.connectionType === "serial" && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Serial Port</Label>
                            <Input
                              placeholder="COM3 or /dev/ttyUSB0"
                              value={formData.serialPort}
                              onChange={(e) => updateForm({ serialPort: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Baud Rate</Label>
                            <Select value={formData.baudRate} onValueChange={(v) => updateForm({ baudRate: v })}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="9600">9600</SelectItem>
                                <SelectItem value="19200">19200</SelectItem>
                                <SelectItem value="38400">38400</SelectItem>
                                <SelectItem value="57600">57600</SelectItem>
                                <SelectItem value="115200">115200</SelectItem>
                              </SelectContent>
                            </Select>
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
                              <SelectItem value="868000000">868 MHz (Europe)</SelectItem>
                              <SelectItem value="915000000">915 MHz (North America)</SelectItem>
                              <SelectItem value="433000000">433 MHz (Asia)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {formData.connectionType === "gsm" && (
                        <div className="space-y-2">
                          <Label>APN (Access Point Name)</Label>
                          <Input
                            placeholder="internet.provider.co.za"
                            value={formData.gsmApn}
                            onChange={(e) => updateForm({ gsmApn: e.target.value })}
                          />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="rika" className="space-y-4 mt-4">
                  <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Rika Station Configuration</CardTitle>
                      <CardDescription>
                        Connects via IP-based HTTP/REST API communication
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Station IP Address</Label>
                          <Input
                            placeholder="192.168.1.100"
                            value={formData.ipAddress}
                            onChange={(e) => updateForm({ ipAddress: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Port</Label>
                          <Input
                            placeholder="8080"
                            value={formData.port}
                            onChange={(e) => updateForm({ port: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>API Key (optional)</Label>
                        <Input
                          placeholder="Optional authentication key"
                          value={formData.apiKey}
                          onChange={(e) => updateForm({ apiKey: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Poll Interval (seconds)</Label>
                        <Input
                          type="number"
                          placeholder="60"
                          value={formData.pollInterval}
                          onChange={(e) => updateForm({ pollInterval: e.target.value })}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="generic" className="space-y-4 mt-4">
                  <Card className="border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Generic Station Configuration</CardTitle>
                      <CardDescription>
                        Configure a custom weather station with API endpoint
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>API Endpoint</Label>
                        <Input
                          placeholder="https://api.weatherstation.com/data"
                          value={formData.apiEndpoint}
                          onChange={(e) => updateForm({ apiEndpoint: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>API Key (optional)</Label>
                        <Input
                          placeholder="Your API key"
                          value={formData.apiKey}
                          onChange={(e) => updateForm({ apiKey: e.target.value })}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>

              <div className="border-t pt-4 space-y-4">
                <h3 className="font-medium">Station Details</h3>
                <div className="space-y-2">
                  <Label htmlFor="station-name">Station Name *</Label>
                  <Input
                    id="station-name"
                    placeholder="My Weather Station"
                    value={formData.name}
                    onChange={(e) => updateForm({ name: e.target.value })}
                    data-testid="input-station-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location Description</Label>
                  <Input
                    id="location"
                    placeholder="City, Country"
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
                      placeholder="-34.1234"
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
                      placeholder="18.5678"
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

              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
                data-testid="button-save-station"
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add {formData.type === "campbell" ? "Campbell Scientific" : formData.type === "rika" ? "Rika" : ""} Station
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredStations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Radio className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Stations Found</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
              {search 
                ? "No stations match your search." 
                : "Add your first Campbell Scientific or Rika weather station to get started."}
            </p>
            {!search && (
              <Button onClick={() => setDialogOpen(true)} data-testid="button-add-first-station">
                <Plus className="mr-2 h-4 w-4" />
                Add Station
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStations.map((station) => (
            <Card key={station.id} className="hover:shadow-lg transition-shadow" data-testid={`card-station-${station.id}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                    <Radio className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-medium">{station.name}</CardTitle>
                    {station.location && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {station.location}
                      </div>
                    )}
                  </div>
                </div>
                <Badge
                  variant={station.isActive ? "default" : "secondary"}
                  className={station.isActive ? "bg-green-600 text-white" : ""}
                >
                  {station.isActive ? "Active" : "Inactive"}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {station.latitude !== null && station.longitude !== null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Coordinates</span>
                      <span className="font-mono">
                        {station.latitude?.toFixed(3)}, {station.longitude?.toFixed(3)}
                      </span>
                    </div>
                  )}
                  {station.altitude !== null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Altitude</span>
                      <span className="font-mono">{station.altitude}m</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Created</span>
                    <span>{station.createdAt ? new Date(station.createdAt).toLocaleDateString() : "N/A"}</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" data-testid={`button-view-${station.id}`}>
                    View Data
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteMutation.mutate(station.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-${station.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
