import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cpu,
  Radio,
  Thermometer,
  Wind,
  Droplets,
  Sun,
  Gauge,
  Plus,
  User,
  Users,
  Mail,
  Phone,
  Wrench,
  Edit,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { WeatherStation, Sensor } from "@shared/schema";

interface StationHardwareProps {
  stationId: number;
}

const SENSOR_ICONS: Record<string, typeof Thermometer> = {
  temperature: Thermometer,
  humidity: Droplets,
  wind: Wind,
  pressure: Gauge,
  solar: Sun,
  rain: Droplets,
};

const COMMON_LOGGERS = [
  "Campbell Scientific CR1000X",
  "Campbell Scientific CR1000XE",
  "Campbell Scientific CR6",
  "Campbell Scientific CR300",
  "Campbell Scientific CR310",
  "Campbell Scientific CR800",
  "Campbell Scientific CR850",
  "Campbell Scientific CR3000",
  "Rika RK900-01",
  "Davis Vantage Pro2",
];

const COMMON_SENSORS = [
  { name: "RM Young 05103 Wind Monitor", type: "wind", manufacturer: "RM Young" },
  { name: "RM Young Response One Pro", type: "wind", manufacturer: "RM Young" },
  { name: "RM Young 41342 Temperature Probe", type: "temperature", manufacturer: "RM Young" },
  { name: "Vaisala HMP155", type: "humidity", manufacturer: "Vaisala" },
  { name: "Vaisala PTB330", type: "pressure", manufacturer: "Vaisala" },
  { name: "Apogee SP-110 Pyranometer", type: "solar", manufacturer: "Apogee" },
  { name: "Kipp & Zonen CMP11", type: "solar", manufacturer: "Kipp & Zonen" },
  { name: "Texas Electronics TE525", type: "rain", manufacturer: "Texas Electronics" },
  { name: "Campbell Scientific CS215", type: "humidity", manufacturer: "Campbell Scientific" },
  { name: "Campbell Scientific 107 Temperature Probe", type: "temperature", manufacturer: "Campbell Scientific" },
];

export function StationHardware({ stationId }: StationHardwareProps) {
  const [addSensorOpen, setAddSensorOpen] = useState(false);
  const [editPersonnelOpen, setEditPersonnelOpen] = useState(false);
  const [newSensor, setNewSensor] = useState({
    name: "",
    manufacturer: "",
    model: "",
    serialNumber: "",
    measurementType: "temperature",
    installationHeight: "",
    notes: "",
  });
  const [personnel, setPersonnel] = useState({
    installationTeam: "",
    stationAdmin: "",
    stationAdminEmail: "",
    stationAdminPhone: "",
  });

  const { data: station } = useQuery<WeatherStation>({
    queryKey: ["/api/stations", stationId],
  });

  const { data: sensors = [] } = useQuery<Sensor[]>({
    queryKey: ["/api/stations", stationId, "sensors"],
  });

  const addSensorMutation = useMutation({
    mutationFn: async (sensorData: typeof newSensor) => {
      return apiRequest(`/api/stations/${stationId}/sensors`, {
        method: "POST",
        body: JSON.stringify({
          ...sensorData,
          stationId,
          installationHeight: sensorData.installationHeight
            ? parseFloat(sensorData.installationHeight)
            : null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations", stationId, "sensors"] });
      setAddSensorOpen(false);
      setNewSensor({
        name: "",
        manufacturer: "",
        model: "",
        serialNumber: "",
        measurementType: "temperature",
        installationHeight: "",
        notes: "",
      });
    },
  });

  const updatePersonnelMutation = useMutation({
    mutationFn: async (personnelData: typeof personnel) => {
      return apiRequest(`/api/stations/${stationId}`, {
        method: "PATCH",
        body: JSON.stringify(personnelData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations", stationId] });
      setEditPersonnelOpen(false);
    },
  });

  const handleQuickAddSensor = (sensor: typeof COMMON_SENSORS[0]) => {
    setNewSensor({
      name: sensor.name,
      manufacturer: sensor.manufacturer,
      model: sensor.name,
      serialNumber: "",
      measurementType: sensor.type,
      installationHeight: "",
      notes: "",
    });
  };

  const openEditPersonnel = () => {
    if (station) {
      setPersonnel({
        installationTeam: station.installationTeam || "",
        stationAdmin: station.stationAdmin || "",
        stationAdminEmail: station.stationAdminEmail || "",
        stationAdminPhone: station.stationAdminPhone || "",
      });
    }
    setEditPersonnelOpen(true);
  };

  const getSensorIcon = (type: string) => {
    const Icon = SENSOR_ICONS[type] || Wrench;
    return <Icon className="h-4 w-4" />;
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="hardware" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="hardware" data-testid="tab-hardware">
            <Cpu className="h-4 w-4 mr-2" />
            Hardware
          </TabsTrigger>
          <TabsTrigger value="personnel" data-testid="tab-personnel">
            <Users className="h-4 w-4 mr-2" />
            Personnel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hardware" className="space-y-4 mt-4">
          {/* Datalogger Section */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  Datalogger
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {station?.stationType || "Campbell Scientific"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Model</p>
                  <p className="text-sm font-medium">
                    {station?.dataloggerModel || "CR1000XE"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Serial Number</p>
                  <p className="text-sm font-medium">
                    {station?.dataloggerSerialNumber || "Not specified"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Firmware</p>
                  <p className="text-sm font-medium">
                    {station?.dataloggerFirmwareVersion || "OS 12.01"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Program</p>
                  <p className="text-sm font-medium">
                    {station?.dataloggerProgramName || "WeatherStation.CR1X"}
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Connection:</span>
                  <Badge variant="secondary" className="text-xs">
                    {station?.connectionType?.toUpperCase() || "HTTP"}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {station?.protocol?.toUpperCase() || "PakBus"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sensors Section */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  Sensors
                </CardTitle>
                <Dialog open={addSensorOpen} onOpenChange={setAddSensorOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-sensor">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Sensor
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add Sensor</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-2 block">
                          Quick Add Common Sensors
                        </Label>
                        <div className="flex flex-wrap gap-1">
                          {COMMON_SENSORS.slice(0, 4).map((sensor) => (
                            <Badge
                              key={sensor.name}
                              variant="outline"
                              className="cursor-pointer text-xs hover-elevate"
                              onClick={() => handleQuickAddSensor(sensor)}
                              data-testid={`badge-sensor-${sensor.type}`}
                            >
                              {sensor.name.split(" ").slice(0, 2).join(" ")}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-3">
                        <div>
                          <Label htmlFor="sensor-name">Sensor Name</Label>
                          <Input
                            id="sensor-name"
                            value={newSensor.name}
                            onChange={(e) =>
                              setNewSensor({ ...newSensor, name: e.target.value })
                            }
                            placeholder="e.g., RM Young Response One Pro"
                            data-testid="input-sensor-name"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label htmlFor="manufacturer">Manufacturer</Label>
                            <Input
                              id="manufacturer"
                              value={newSensor.manufacturer}
                              onChange={(e) =>
                                setNewSensor({ ...newSensor, manufacturer: e.target.value })
                              }
                              placeholder="e.g., RM Young"
                              data-testid="input-manufacturer"
                            />
                          </div>
                          <div>
                            <Label htmlFor="serial">Serial Number</Label>
                            <Input
                              id="serial"
                              value={newSensor.serialNumber}
                              onChange={(e) =>
                                setNewSensor({ ...newSensor, serialNumber: e.target.value })
                              }
                              placeholder="e.g., SN12345"
                              data-testid="input-serial"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label htmlFor="type">Measurement Type</Label>
                            <Select
                              value={newSensor.measurementType}
                              onValueChange={(val) =>
                                setNewSensor({ ...newSensor, measurementType: val })
                              }
                            >
                              <SelectTrigger data-testid="select-sensor-type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="temperature">Temperature</SelectItem>
                                <SelectItem value="humidity">Humidity</SelectItem>
                                <SelectItem value="wind">Wind</SelectItem>
                                <SelectItem value="pressure">Pressure</SelectItem>
                                <SelectItem value="solar">Solar Radiation</SelectItem>
                                <SelectItem value="rain">Rainfall</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label htmlFor="height">Height (m)</Label>
                            <Input
                              id="height"
                              type="number"
                              value={newSensor.installationHeight}
                              onChange={(e) =>
                                setNewSensor({
                                  ...newSensor,
                                  installationHeight: e.target.value,
                                })
                              }
                              placeholder="e.g., 10"
                              data-testid="input-height"
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="notes">Notes</Label>
                          <Textarea
                            id="notes"
                            value={newSensor.notes}
                            onChange={(e) =>
                              setNewSensor({ ...newSensor, notes: e.target.value })
                            }
                            placeholder="Additional notes..."
                            className="resize-none"
                            data-testid="input-sensor-notes"
                          />
                        </div>
                      </div>
                      <Button
                        className="w-full"
                        onClick={() => addSensorMutation.mutate(newSensor)}
                        disabled={!newSensor.name || addSensorMutation.isPending}
                        data-testid="button-submit-sensor"
                      >
                        {addSensorMutation.isPending ? "Adding..." : "Add Sensor"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {sensors.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No sensors configured. Add sensors to track your hardware.
                </p>
              ) : (
                <div className="space-y-2">
                  {sensors.map((sensor) => (
                    <div
                      key={sensor.id}
                      className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                      data-testid={`sensor-item-${sensor.id}`}
                    >
                      <div className="flex items-center gap-2">
                        {getSensorIcon(sensor.measurementType)}
                        <div>
                          <p className="text-sm font-medium">{sensor.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {sensor.manufacturer} {sensor.serialNumber && `- ${sensor.serialNumber}`}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {sensor.measurementType}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="personnel" className="space-y-4 mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Station Personnel
                </CardTitle>
                <Dialog open={editPersonnelOpen} onOpenChange={setEditPersonnelOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openEditPersonnel}
                      data-testid="button-edit-personnel"
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit Personnel</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="installation-team">Installation Team</Label>
                        <Input
                          id="installation-team"
                          value={personnel.installationTeam}
                          onChange={(e) =>
                            setPersonnel({ ...personnel, installationTeam: e.target.value })
                          }
                          placeholder="e.g., Weather Systems Inc."
                          data-testid="input-installation-team"
                        />
                      </div>
                      <div>
                        <Label htmlFor="station-admin">Station Administrator</Label>
                        <Input
                          id="station-admin"
                          value={personnel.stationAdmin}
                          onChange={(e) =>
                            setPersonnel({ ...personnel, stationAdmin: e.target.value })
                          }
                          placeholder="e.g., John Smith"
                          data-testid="input-station-admin"
                        />
                      </div>
                      <div>
                        <Label htmlFor="admin-email">Administrator Email</Label>
                        <Input
                          id="admin-email"
                          type="email"
                          value={personnel.stationAdminEmail}
                          onChange={(e) =>
                            setPersonnel({ ...personnel, stationAdminEmail: e.target.value })
                          }
                          placeholder="e.g., admin@example.com"
                          data-testid="input-admin-email"
                        />
                      </div>
                      <div>
                        <Label htmlFor="admin-phone">Administrator Phone</Label>
                        <Input
                          id="admin-phone"
                          type="tel"
                          value={personnel.stationAdminPhone}
                          onChange={(e) =>
                            setPersonnel({ ...personnel, stationAdminPhone: e.target.value })
                          }
                          placeholder="e.g., +1 555-123-4567"
                          data-testid="input-admin-phone"
                        />
                      </div>
                      <Button
                        className="w-full"
                        onClick={() => updatePersonnelMutation.mutate(personnel)}
                        disabled={updatePersonnelMutation.isPending}
                        data-testid="button-save-personnel"
                      >
                        {updatePersonnelMutation.isPending ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
                <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Installation Team</p>
                  <p className="text-sm font-medium">
                    {station?.installationTeam || "Not specified"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-md bg-muted/50">
                <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Station Administrator</p>
                  <p className="text-sm font-medium">
                    {station?.stationAdmin || "Not specified"}
                  </p>
                  {station?.stationAdminEmail && (
                    <div className="flex items-center gap-1 mt-1">
                      <Mail className="h-3 w-3 text-muted-foreground" />
                      <a
                        href={`mailto:${station.stationAdminEmail}`}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        {station.stationAdminEmail}
                      </a>
                    </div>
                  )}
                  {station?.stationAdminPhone && (
                    <div className="flex items-center gap-1 mt-1">
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      <a
                        href={`tel:${station.stationAdminPhone}`}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        {station.stationAdminPhone}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
