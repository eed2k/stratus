import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { WeatherStation } from "@shared/schema";

interface Alarm {
  id: number;
  stationId: number;
  name: string;
  parameter: string;
  condition: "above" | "below" | "equals" | "change";
  threshold: number;
  unit: string;
  enabled: boolean;
  notifyEmail: boolean;
  notifyPush: boolean;
  lastTriggered?: string;
  triggerCount: number;
}

interface AlarmEvent {
  id: number;
  alarmId: number;
  stationId: number;
  triggeredValue?: number;
  message?: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
}

const PARAMETERS = [
  { value: "temperature", label: "Temperature", unit: "°C" },
  { value: "humidity", label: "Humidity", unit: "%" },
  { value: "pressure", label: "Pressure", unit: "hPa" },
  { value: "windSpeed", label: "Wind Speed", unit: "km/h" },
  { value: "windGust", label: "Wind Gust", unit: "km/h" },
  { value: "rainfall", label: "Rainfall", unit: "mm" },
  { value: "solarRadiation", label: "Solar Radiation", unit: "W/m²" },
  { value: "batteryVoltage", label: "Battery Voltage", unit: "V" },
];

const CONDITIONS = [
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "equals", label: "Equals" },
  { value: "change", label: "Changes by" },
];

export default function Alarms() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAlarm, setEditingAlarm] = useState<Alarm | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    stationId: "",
    name: "",
    parameter: "temperature",
    condition: "above" as Alarm["condition"],
    threshold: "",
    enabled: true,
    notifyEmail: true,
    notifyPush: false,
  });

  const { data: stations = [] } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  const { data: alarms = [], isLoading } = useQuery<Alarm[]>({
    queryKey: ["/api/alarms"],
  });

  const { data: alarmEvents = [] } = useQuery<AlarmEvent[]>({
    queryKey: ["/api/alarm-events"],
  });

  const selectedParam = PARAMETERS.find((p) => p.value === formData.parameter);

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/alarms", {
        ...data,
        stationId: parseInt(data.stationId),
        threshold: parseFloat(data.threshold),
        unit: selectedParam?.unit || "",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alarms"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Alarm created", description: "The alarm has been configured." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create alarm.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Alarm> & { id: number }) => {
      return await apiRequest("PATCH", `/api/alarms/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alarms"] });
      toast({ title: "Alarm updated", description: "The alarm has been updated." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/alarms/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alarms"] });
      toast({ title: "Alarm deleted", description: "The alarm has been removed." });
    },
  });

  const resetForm = () => {
    setFormData({
      stationId: stations[0]?.id.toString() || "",
      name: "",
      parameter: "temperature",
      condition: "above",
      threshold: "",
      enabled: true,
      notifyEmail: true,
      notifyPush: false,
    });
    setEditingAlarm(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.stationId || !formData.name || !formData.threshold) {
      toast({ title: "Validation Error", description: "Please fill all required fields.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const handleEdit = (alarm: Alarm) => {
    setEditingAlarm(alarm);
    setFormData({
      stationId: alarm.stationId.toString(),
      name: alarm.name,
      parameter: alarm.parameter,
      condition: alarm.condition,
      threshold: alarm.threshold.toString(),
      enabled: alarm.enabled,
      notifyEmail: alarm.notifyEmail,
      notifyPush: alarm.notifyPush,
    });
    setDialogOpen(true);
  };

  const handleToggleEnabled = (alarm: Alarm) => {
    updateMutation.mutate({ id: alarm.id, enabled: !alarm.enabled });
  };

  const getStationName = (stationId: number) => {
    return stations.find((s) => s.id === stationId)?.name || "Unknown";
  };

  const formatCondition = (alarm: Alarm) => {
    const condLabel = CONDITIONS.find((c) => c.value === alarm.condition)?.label || alarm.condition;
    return `${condLabel} ${alarm.threshold} ${alarm.unit}`;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Alarm Management</h1>
          <p className="text-muted-foreground">Configure alerts for weather conditions</p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-alarm">Create Alarm</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingAlarm ? "Edit Alarm" : "Create New Alarm"}</DialogTitle>
              <DialogDescription>
                Configure alert thresholds for weather parameters
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Station</Label>
                <Select
                  value={formData.stationId}
                  onValueChange={(v) => setFormData((f) => ({ ...f, stationId: v }))}
                >
                  <SelectTrigger data-testid="select-alarm-station">
                    <SelectValue placeholder="Select station" />
                  </SelectTrigger>
                  <SelectContent>
                    {stations.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Alarm Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., High Temperature Warning"
                  data-testid="input-alarm-name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Parameter</Label>
                  <Select
                    value={formData.parameter}
                    onValueChange={(v) => setFormData((f) => ({ ...f, parameter: v }))}
                  >
                    <SelectTrigger data-testid="select-alarm-parameter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARAMETERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Condition</Label>
                  <Select
                    value={formData.condition}
                    onValueChange={(v: Alarm["condition"]) => setFormData((f) => ({ ...f, condition: v }))}
                  >
                    <SelectTrigger data-testid="select-alarm-condition">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Threshold ({selectedParam?.unit})</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.threshold}
                  onChange={(e) => setFormData((f) => ({ ...f, threshold: e.target.value }))}
                  placeholder="Enter value"
                  data-testid="input-alarm-threshold"
                />
              </div>

              <div className="space-y-3">
                <Label>Notifications</Label>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Email Notifications</span>
                  <Switch
                    checked={formData.notifyEmail}
                    onCheckedChange={(v) => setFormData((f) => ({ ...f, notifyEmail: v }))}
                    data-testid="switch-notify-email"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Push Notifications</span>
                  <Switch
                    checked={formData.notifyPush}
                    onCheckedChange={(v) => setFormData((f) => ({ ...f, notifyPush: v }))}
                    data-testid="switch-notify-push"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-alarm">
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-save-alarm">
                  {createMutation.isPending ? "Saving..." : editingAlarm ? "Update" : "Create"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-muted-foreground">Loading alarms...</p>
            </CardContent>
          </Card>
        ) : alarms.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground mb-4">No alarms configured yet</p>
              <p className="text-sm text-muted-foreground">
                Create alarms to receive notifications when weather conditions exceed your thresholds.
              </p>
            </CardContent>
          </Card>
        ) : (
          alarms.map((alarm) => (
            <Card key={alarm.id} data-testid={`card-alarm-${alarm.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{alarm.name}</CardTitle>
                    <CardDescription>{getStationName(alarm.stationId)}</CardDescription>
                  </div>
                  <Switch
                    checked={alarm.enabled}
                    onCheckedChange={() => handleToggleEnabled(alarm)}
                    data-testid={`switch-alarm-enabled-${alarm.id}`}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant={alarm.enabled ? "default" : "secondary"} className="text-sm">
                    {PARAMETERS.find((p) => p.value === alarm.parameter)?.label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatCondition(alarm)}
                  </span>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {alarm.notifyEmail && <span>Email</span>}
                  {alarm.notifyPush && <span>Push</span>}
                  {alarm.lastTriggered && (
                    <span>Last: {new Date(alarm.lastTriggered).toLocaleDateString()}</span>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(alarm)}
                    data-testid={`button-edit-alarm-${alarm.id}`}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMutation.mutate(alarm.id)}
                    data-testid={`button-delete-alarm-${alarm.id}`}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alarm History</CardTitle>
          <CardDescription>Recent alarm events</CardDescription>
        </CardHeader>
        <CardContent>
          {alarmEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No alarm events recorded yet. Events will appear here when alarms are triggered.
            </p>
          ) : (
            <div className="space-y-3">
              {alarmEvents.slice(0, 10).map((event) => {
                const alarm = alarms.find((a) => a.id === event.alarmId);
                return (
                  <div key={event.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{alarm?.name || `Alarm #${event.alarmId}`}</p>
                      <p className="text-sm text-muted-foreground">
                        {event.message || `Triggered at ${event.triggeredValue}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant={event.acknowledged ? "secondary" : "destructive"}>
                      {event.acknowledged ? "Acknowledged" : "Active"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
