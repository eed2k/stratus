import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { MapPin, Plus, Radio, Search, Trash2, Loader2, Wifi, Cable, Signal, Smartphone, Server, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { WeatherStation } from "@shared/schema";

interface ConnectionStatus {
  connected: boolean;
  lastConnected?: string;
  lastError?: string;
  isSimulation?: boolean;
}

type StationType = "campbell";
type ConnectionType = "serial" | "lora" | "gsm" | "ip" | "mqtt" | "4g" | "tcp_ip";

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
}

const initialFormData: StationFormData = {
  name: "",
  type: "campbell",
  location: "",
  latitude: "",
  longitude: "",
  altitude: "",
  connectionType: "serial",
  ipAddress: "",
  port: "6785",
  serialPort: "COM3",
  baudRate: "115200",
  loraFrequency: "868000000",
  gsmApn: "",
  apiKey: "",
  apiEndpoint: "",
  pollInterval: "60",
  // Campbell Scientific / LoggerNet defaults
  pakbusAddress: "1",
  securityCode: "0",
  dataTable: "OneMin",
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
};

export default function Stations() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState<StationFormData>(initialFormData);
  const [testingStation, setTestingStation] = useState<number | null>(null);
  const [availablePorts, setAvailablePorts] = useState<Array<{path: string; manufacturer?: string}>>([]);
  const [scanningPorts, setScanningPorts] = useState(false);
  const { toast } = useToast();

  // Listen for Electron menu events
  useEffect(() => {
    const handleOpenNewStation = () => {
      setDialogOpen(true);
    };
    
    const handleDiscoverStations = () => {
      scanSerialPorts();
    };

    window.addEventListener('open-new-station-dialog', handleOpenNewStation);
    window.addEventListener('discover-stations', handleDiscoverStations);
    
    return () => {
      window.removeEventListener('open-new-station-dialog', handleOpenNewStation);
      window.removeEventListener('discover-stations', handleDiscoverStations);
    };
  }, []);

  // Scan for available serial ports
  const scanSerialPorts = async () => {
    setScanningPorts(true);
    try {
      const response = await apiRequest("GET", "/api/station-setup/discover/serial");
      const data = await response.json();
      if (data.devices && data.devices.length > 0) {
        setAvailablePorts(data.devices);
        toast({
          title: "Ports Found",
          description: `Found ${data.devices.length} serial port(s)`,
        });
      } else {
        setAvailablePorts([]);
        toast({
          title: "No Ports Found",
          description: "No serial ports detected. Make sure your device is connected.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Scan Error",
        description: error.message || "Failed to scan for serial ports",
        variant: "destructive",
      });
    } finally {
      setScanningPorts(false);
    }
  };

  const { data: stations = [], isLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  const { data: connectionStatuses = {} } = useQuery<Record<number, ConnectionStatus>>({
    queryKey: ["/api/protocols/status"],
    refetchInterval: 30000,
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (stationId: number) => {
      setTestingStation(stationId);
      const response = await apiRequest("POST", `/api/protocols/test/${stationId}`);
      return response.json();
    },
    onSuccess: (data) => {
      setTestingStation(null);
      if (data.success) {
        toast({ 
          title: "Connection Successful", 
          description: data.isSimulation 
            ? "Connected in simulation mode (hardware not available)" 
            : data.message 
        });
      } else {
        toast({ title: "Connection Failed", description: data.message, variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/protocols/status"] });
    },
    onError: (error: any) => {
      setTestingStation(null);
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    },
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
        port: data.port ? parseInt(data.port) : 6785,
        serialPort: data.serialPort || null,
        baudRate: data.baudRate ? parseInt(data.baudRate) : 115200,
        apiKey: data.apiKey || null,
        apiEndpoint: data.apiEndpoint || null,
        pollInterval: data.pollInterval ? parseInt(data.pollInterval) : 60,
        protocol: "pakbus",
        // Campbell Scientific / LoggerNet fields
        pakbusAddress: data.pakbusAddress ? parseInt(data.pakbusAddress) : 1,
        securityCode: data.securityCode ? parseInt(data.securityCode) : 0,
        dataTable: data.dataTable || "OneMin",
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
      if (data.connectionType === "serial") {
        payload.connectionConfig = JSON.stringify({
          type: "serial",
          serialPort: data.serialPort,
          baudRate: parseInt(data.baudRate),
          pakbusAddress: parseInt(data.pakbusAddress) || 1,
          securityCode: parseInt(data.securityCode) || 0,
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
    return <Server className="h-5 w-5" />;
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
                Configure your weather station connection
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6 py-4">
              <Card className="border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Campbell Scientific Configuration</CardTitle>
                  <CardDescription>
                    Supports CR300, CR215, CR1000 dataloggers with RS232, TCP/IP, LoRa, or GSM connections
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
                        <SelectItem value="tcp_ip">
                          <div className="flex items-center gap-2">
                            <Wifi className="h-4 w-4" />
                            TCP/IP (Ethernet/WiFi)
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
                        <SelectItem value="4g">
                          <div className="flex items-center gap-2">
                            <Smartphone className="h-4 w-4" />
                            4G/LTE Cellular
                          </div>
                        </SelectItem>
                        <SelectItem value="mqtt">
                          <div className="flex items-center gap-2">
                            <Radio className="h-4 w-4" />
                            MQTT Protocol
                          </div>
                        </SelectItem>
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

                  {formData.connectionType === "serial" && (
                    <div className="space-y-4">
                      <div className="flex items-end gap-2">
                        <div className="flex-1 space-y-2">
                          <Label>Serial Port</Label>
                          {availablePorts.length > 0 ? (
                            <Select value={formData.serialPort} onValueChange={(v) => updateForm({ serialPort: v })}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a port" />
                              </SelectTrigger>
                              <SelectContent>
                                {availablePorts.map((port) => (
                                  <SelectItem key={port.path} value={port.path}>
                                    {port.path} {port.manufacturer ? `(${port.manufacturer})` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              placeholder="COM3 or /dev/ttyUSB0"
                              value={formData.serialPort}
                              onChange={(e) => updateForm({ serialPort: e.target.value })}
                            />
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={scanSerialPorts}
                          disabled={scanningPorts}
                        >
                          {scanningPorts ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          <span className="ml-2">Scan</span>
                        </Button>
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
                            type="number"
                            placeholder="1883"
                            value={formData.port}
                            onChange={(e) => updateForm({ port: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Subscribe Topic</Label>
                        <Input
                          placeholder="campbell/station/data"
                          value={formData.apiEndpoint}
                          onChange={(e) => updateForm({ apiEndpoint: e.target.value })}
                        />
                      </div>
                    </div>
                  )}

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

              {/* PakBus / LoggerNet Settings */}
              <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">PakBus / LoggerNet Settings</CardTitle>
                  <CardDescription>
                    Communication protocol settings for Campbell Scientific dataloggers
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>PakBus Address</Label>
                      <Input
                        type="number"
                        placeholder="1"
                        min="1"
                        max="4094"
                        value={formData.pakbusAddress}
                        onChange={(e) => updateForm({ pakbusAddress: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">1-4094 (default: 1)</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Security Code</Label>
                      <Input
                        type="number"
                        placeholder="0"
                        min="0"
                        max="65535"
                        value={formData.securityCode}
                        onChange={(e) => updateForm({ securityCode: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">0 = no security</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Data Table</Label>
                      <Select value={formData.dataTable} onValueChange={(v) => updateForm({ dataTable: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Public">Public</SelectItem>
                          <SelectItem value="OneMin">OneMin (1-minute)</SelectItem>
                          <SelectItem value="FiveMin">FiveMin (5-minute)</SelectItem>
                          <SelectItem value="FifteenMin">FifteenMin (15-minute)</SelectItem>
                          <SelectItem value="Hourly">Hourly</SelectItem>
                          <SelectItem value="Daily">Daily</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Datalogger Information */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Datalogger Information</CardTitle>
                  <CardDescription>
                    Hardware details for the Campbell Scientific datalogger
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Datalogger Model</Label>
                      <Select value={formData.dataloggerModel} onValueChange={(v) => updateForm({ dataloggerModel: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CR300">CR300</SelectItem>
                          <SelectItem value="CR310">CR310</SelectItem>
                          <SelectItem value="CR350">CR350</SelectItem>
                          <SelectItem value="CR1000X">CR1000X</SelectItem>
                          <SelectItem value="CR6">CR6</SelectItem>
                          <SelectItem value="CR1000">CR1000 (Legacy)</SelectItem>
                          <SelectItem value="CR3000">CR3000 (Legacy)</SelectItem>
                          <SelectItem value="CR800">CR800 (Legacy)</SelectItem>
                          <SelectItem value="CR850">CR850 (Legacy)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Serial Number</Label>
                      <Input
                        placeholder="e.g., 12345"
                        value={formData.dataloggerSerialNumber}
                        onChange={(e) => updateForm({ dataloggerSerialNumber: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Program Name</Label>
                    <Input
                      placeholder="e.g., CPU:WeatherStation.CR1X"
                      value={formData.dataloggerProgramName}
                      onChange={(e) => updateForm({ dataloggerProgramName: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Modem/Communication Hardware - Only show for GSM/4G connections */}
              {(formData.connectionType === "gsm" || formData.connectionType === "4g") && (
                <Card className="border-purple-200 bg-purple-50/50 dark:border-purple-800 dark:bg-purple-950/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Modem / Communication Hardware</CardTitle>
                    <CardDescription>
                      Cellular modem details for GSM/4G connections
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Modem Model</Label>
                        <Select value={formData.modemModel} onValueChange={(v) => updateForm({ modemModel: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select modem" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CELL215">CELL215</SelectItem>
                            <SelectItem value="CELL220">CELL220</SelectItem>
                            <SelectItem value="RV50X">RV50X (Sierra Wireless)</SelectItem>
                            <SelectItem value="RV55">RV55 (Sierra Wireless)</SelectItem>
                            <SelectItem value="COM320">COM320</SelectItem>
                            <SelectItem value="NL240">NL240 (Legacy)</SelectItem>
                            <SelectItem value="NL241">NL241 (Legacy)</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Modem Serial Number</Label>
                        <Input
                          placeholder="Modem S/N"
                          value={formData.modemSerialNumber}
                          onChange={(e) => updateForm({ modemSerialNumber: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Phone Number</Label>
                        <Input
                          placeholder="+27 XX XXX XXXX"
                          value={formData.modemPhoneNumber}
                          onChange={(e) => updateForm({ modemPhoneNumber: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>SIM Card Number (ICCID)</Label>
                        <Input
                          placeholder="SIM ICCID"
                          value={formData.simCardNumber}
                          onChange={(e) => updateForm({ simCardNumber: e.target.value })}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

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

              {/* Notes & Maintenance */}
              <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Notes & Site Info</CardTitle>
                  <CardDescription>
                    Hardware notes and site description
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Site Description</Label>
                    <textarea
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="Describe the station site, mounting details, sensor configuration..."
                      value={formData.siteDescription}
                      onChange={(e) => updateForm({ siteDescription: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <textarea
                      className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="Hardware notes, upgrades, sensor changes, issues..."
                      value={formData.notes}
                      onChange={(e) => updateForm({ notes: e.target.value })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Note: Calibration and maintenance records can be managed in the station dashboard after setup.
                  </p>
                </CardContent>
              </Card>

              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
                data-testid="button-save-station"
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Campbell Scientific Station
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
                : "Add your first Campbell Scientific weather station to get started."}
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
                {/* Connection Status */}
                {station.stationType !== 'demo' && (
                  <div className="flex items-center justify-between mt-2 pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs">
                      {connectionStatuses[station.id]?.connected ? (
                        <>
                          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                          <span className="text-green-600">Connected</span>
                          {connectionStatuses[station.id]?.isSimulation && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">Simulation</Badge>
                          )}
                        </>
                      ) : connectionStatuses[station.id]?.lastError ? (
                        <>
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-red-600 truncate max-w-[120px]" title={connectionStatuses[station.id]?.lastError}>
                            {connectionStatuses[station.id]?.lastError}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
                          <span className="text-muted-foreground">Not connected</span>
                        </>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testConnectionMutation.mutate(station.id)}
                      disabled={testingStation === station.id}
                      data-testid={`button-test-${station.id}`}
                      className="h-7 text-xs"
                    >
                      {testingStation === station.id ? (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-1" />
                      )}
                      Test
                    </Button>
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1" 
                    data-testid={`button-view-${station.id}`}
                    onClick={() => window.location.href = `/?station=${station.id}`}
                  >
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
