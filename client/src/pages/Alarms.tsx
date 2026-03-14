// Stratus Weather System
// Created by Lukas Esterhuizen

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
import { authFetch } from "@/lib/queryClient";
import { AlertTriangle, Trash2, Check } from "lucide-react";
import type { WeatherStation } from "@shared/schema";
import { getWindUnitLabel, type WindSpeedUnit } from "@/lib/windConstants";

interface Alarm {
  id: number;
  stationId: number;
  name: string;
  parameter: string;
  condition: "above" | "below" | "equals" | "change" | "stale" | "no_charge";
  threshold: number;
  staleMinutes?: number;
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
  // Core weather
  { value: "temperature", label: "Temperature", unit: "°C" },
  { value: "humidity", label: "Humidity", unit: "%" },
  { value: "dewPoint", label: "Dew Point", unit: "°C" },
  { value: "pressure", label: "Pressure (Station)", unit: "hPa" },
  { value: "windSpeed", label: "Wind Speed", unit: "m/s" },
  { value: "windGust", label: "Wind Gust", unit: "m/s" },
  { value: "windDirection", label: "Wind Direction", unit: "°" },
  { value: "rainfall", label: "Rainfall", unit: "mm" },
  { value: "solarRadiation", label: "Solar Radiation", unit: "W/m²" },
  { value: "uvIndex", label: "UV Index", unit: "" },
  // Power & equipment
  { value: "batteryVoltage", label: "Battery Voltage", unit: "V" },
  { value: "panelTemperature", label: "Panel Temperature", unit: "°C" },
  // Agriculture & soil
  { value: "evapotranspiration", label: "Evapotranspiration (ETo)", unit: "mm/day" },
  { value: "soilTemperature", label: "Soil Temperature", unit: "°C" },
  { value: "soilMoisture", label: "Soil Moisture", unit: "%" },
  // Air quality
  { value: "pm10", label: "PM10", unit: "µg/m³" },
  { value: "pm25", label: "PM2.5", unit: "µg/m³" },
  // Fire danger
  { value: "fireDangerIndex", label: "Fire Danger Index (FDI)", unit: "" },
  // Water & sensors
  { value: "waterLevel", label: "Water Level", unit: "mm" },
  { value: "temperatureSwitch", label: "Temperature Switch", unit: "mV" },
  { value: "levelSwitch", label: "Level Switch", unit: "On/Off" },
  { value: "temperatureSwitchOutlet", label: "Temp Switch Outlet", unit: "mV" },
  { value: "levelSwitchStatus", label: "Level Switch Status", unit: "" },
  { value: "lightning", label: "Lightning", unit: "strikes" },
  { value: "chargerVoltage", label: "Charger Voltage", unit: "V" },
];

const CONDITIONS = [
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "equals", label: "Equals" },
  { value: "change", label: "Changes by" },
  { value: "stale", label: "No data for" },
  { value: "no_charge", label: "Battery not charging" },
];

const STALE_PRESETS = [
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "360", label: "6 hours" },
  { value: "720", label: "12 hours" },
  { value: "1440", label: "24 hours" },
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
    staleMinutes: "120",
    enabled: true,
    notifyEmail: true,
    notifyPush: false,
  });

  const { data: stations = [] } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  // Battery charging daily check — fetch 24h data for each station
  const { data: batteryAlerts = [] } = useQuery<Array<{ stationId: number; stationName: string; maxV: number; minV: number }>>({
    queryKey: ["/api/battery-charging-check", stations.map(s => s.id).join(",")],
    queryFn: async () => {
      const alerts: Array<{ stationId: number; stationName: string; maxV: number; minV: number }> = [];
      for (const station of stations) {
        try {
          const res = await authFetch(`/api/stations/${station.id}/weather?range=24h`);
          if (!res.ok) continue;
          const data = await res.json();
          const records = Array.isArray(data) ? data : [];
          const voltages = records
            .map((r: any) => r.batteryVoltage ?? r.data?.batteryVoltage)
            .filter((v: any) => v != null && v > 0) as number[];
          if (voltages.length < 2) continue;
          const maxV = Math.max(...voltages);
          const minV = Math.min(...voltages);
          const didCharge = maxV > 13.0 || (maxV - minV) > 0.3;
          if (!didCharge) {
            alerts.push({ stationId: station.id, stationName: station.name, maxV, minV });
          }
        } catch { /* skip */ }
      }
      return alerts;
    },
    enabled: stations.length > 0,
    refetchInterval: 5 * 60 * 1000, // Check every 5 minutes
  });

  const { data: alarms = [], isLoading } = useQuery<Alarm[]>({
    queryKey: ["/api/alarms"],
  });

  const { data: alarmEvents = [] } = useQuery<AlarmEvent[]>({
    queryKey: ["/api/alarm-events"],
  });

  const selectedStation = stations.find((s) => s.id.toString() === formData.stationId);
  const stationWindUnit = (selectedStation as any)?.windSpeedUnit;
  const windUnitLabel = getWindUnitLabel((stationWindUnit as WindSpeedUnit) || 'ms');
  const selectedParam = PARAMETERS.find((p) => p.value === formData.parameter);
  const effectiveUnit = (formData.parameter === 'windSpeed' || formData.parameter === 'windGust') ? windUnitLabel : selectedParam?.unit;

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/alarms", {
        ...data,
        stationId: parseInt(data.stationId),
        threshold: data.condition === "stale" ? 0 : parseFloat(data.threshold),
        staleMinutes: data.condition === "stale" ? parseInt(data.staleMinutes) : undefined,
        unit: data.condition === "stale" ? "min" : (effectiveUnit || ""),
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
      const res = await apiRequest("DELETE", `/api/alarms/${id}`);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alarms"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alarm-events"] });
      toast({ title: "Alarm deleted", description: "The alarm has been removed." });
    },
    onError: (error: Error) => {
      console.error("Delete alarm error:", error);
      toast({ title: "Error", description: error.message || "Failed to delete alarm.", variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      stationId: stations[0]?.id.toString() || "",
      name: "",
      parameter: "temperature",
      condition: "above",
      threshold: "",
      staleMinutes: "120",
      enabled: true,
      notifyEmail: true,
      notifyPush: false,
    });
    setEditingAlarm(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.stationId || !formData.name || (formData.condition !== "stale" && formData.condition !== "no_charge" && !formData.threshold)) {
      toast({ title: "Validation Error", description: "Please fill all required fields.", variant: "destructive" });
      return;
    }
    
    const alarmData = {
      ...formData,
      stationId: parseInt(formData.stationId),
      threshold: formData.condition === "stale" ? 0 : parseFloat(formData.threshold || "1"),
      staleMinutes: formData.condition === "stale" ? parseInt(formData.staleMinutes) : undefined,
      unit: formData.condition === "stale" ? "min" : formData.condition === "no_charge" ? "V" : (effectiveUnit || ""),
      parameter: formData.condition === "no_charge" ? "batteryVoltage" : formData.parameter,
    };
    
    if (editingAlarm) {
      // Update existing alarm
      updateMutation.mutate({ id: editingAlarm.id, ...alarmData }, {
        onSuccess: () => {
          setDialogOpen(false);
          resetForm();
        }
      });
    } else {
      // Create new alarm
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (alarm: Alarm) => {
    setEditingAlarm(alarm);
    setFormData({
      stationId: alarm.stationId.toString(),
      name: alarm.name,
      parameter: alarm.parameter,
      condition: alarm.condition,
      threshold: alarm.threshold.toString(),
      staleMinutes: alarm.staleMinutes?.toString() || "120",
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
    if (alarm.condition === "stale") {
      const mins = alarm.staleMinutes || 120;
      if (mins >= 1440) return `No data for ${mins / 1440}d`;
      if (mins >= 60) return `No data for ${mins / 60}h`;
      return `No data for ${mins}min`;
    }
    if (alarm.condition === "no_charge") {
      return `Battery not charging (< ${alarm.threshold}V increase in 24h)`;
    }
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
                  placeholder="Alarm name"
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
                    onValueChange={(v: Alarm["condition"]) => setFormData((f) => ({ 
                      ...f, 
                      condition: v,
                      // Auto-select batteryVoltage parameter and set default threshold for no_charge
                      ...(v === "no_charge" ? { parameter: "batteryVoltage", threshold: f.threshold || "1" } : {})
                    }))}
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

              {formData.condition === "stale" ? (
              <div className="space-y-2">
                <Label>Alert if no data received for</Label>
                <Select
                  value={formData.staleMinutes}
                  onValueChange={(v) => setFormData((f) => ({ ...f, staleMinutes: v }))}
                >
                  <SelectTrigger data-testid="select-stale-minutes">
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    {STALE_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Triggers when the station has not sent any data within this timeframe
                </p>
              </div>
              ) : formData.condition === "no_charge" ? (
              <div className="space-y-2">
                <Label>Minimum voltage increase (V) over 24h</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.threshold || "1"}
                  onChange={(e) => setFormData((f) => ({ ...f, threshold: e.target.value }))}
                  placeholder="1.0"
                  data-testid="input-alarm-threshold"
                />
                <p className="text-xs text-muted-foreground">
                  Alert when battery voltage has not increased by at least this amount over the past 24 hours (indicates solar panel may not be charging)
                </p>
              </div>
              ) : (
              <div className="space-y-2">
                <Label>Threshold ({effectiveUnit})</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.threshold}
                  onChange={(e) => setFormData((f) => ({ ...f, threshold: e.target.value }))}
                  placeholder="Enter value"
                  data-testid="input-alarm-threshold"
                />
              </div>
              )}

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

      {/* System Battery Charging Alerts — dashboard-only, no email */}
      {batteryAlerts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Battery Charging Alert
            </CardTitle>
            <CardDescription className="text-amber-600">
              No charging activity detected in the last 24 hours for the following stations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {batteryAlerts.map((alert) => (
                <div key={alert.stationId} className="flex items-center justify-between p-2 rounded bg-white/60 border border-amber-100">
                  <span className="text-sm font-medium text-amber-900">{alert.stationName}</span>
                  <span className="text-xs text-amber-600">
                    Range: {alert.minV.toFixed(2)}V – {alert.maxV.toFixed(2)}V — Check solar panel or charge controller
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
                    <span>Last: {new Date(alarm.lastTriggered).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</span>
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
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete alarm "${alarm.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(alarm.id);
                      }
                    }}
                    data-testid={`button-delete-alarm-${alarm.id}`}
                  >
                    {deleteMutation.isPending ? "Deleting..." : "Delete"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Alarm History</CardTitle>
              <CardDescription>Events from the last 30 days</CardDescription>
            </div>
            {alarmEvents.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (window.confirm('Delete all alarm events older than 30 days?')) {
                    try {
                      await apiRequest('POST', '/api/alarm-events/cleanup', { days: 30 });
                      queryClient.invalidateQueries({ queryKey: ['/api/alarm-events'] });
                      toast({ title: 'Cleanup complete', description: 'Old events removed.' });
                    } catch {
                      toast({ title: 'Error', description: 'Failed to cleanup events.', variant: 'destructive' });
                    }
                  }
                }}
              >
                Cleanup Old Events
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {alarmEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No alarm events recorded yet. Events will appear here when alarms are triggered.
            </p>
          ) : (
            <div className="space-y-3">
              {alarmEvents.map((event) => {
                const alarm = alarms.find((a) => a.id === event.alarmId);
                const stationName = getStationName(event.stationId);
                return (
                  <div key={event.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{alarm?.name || `Alarm #${event.alarmId}`}</p>
                        <Badge variant="outline" className="text-xs">
                          {stationName}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {event.message || `Triggered at ${event.triggeredValue}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <Badge variant={event.acknowledged ? "secondary" : "destructive"}>
                        {event.acknowledged ? "Acknowledged" : "Active"}
                      </Badge>
                      {!event.acknowledged && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-green-600"
                          onClick={async () => {
                            try {
                              await apiRequest('POST', `/api/alarm-events/${event.id}/acknowledge`);
                              queryClient.invalidateQueries({ queryKey: ['/api/alarm-events'] });
                              toast({ title: 'Acknowledged', description: 'Alarm event acknowledged.' });
                            } catch {
                              toast({ title: 'Error', description: 'Failed to acknowledge event.', variant: 'destructive' });
                            }
                          }}
                          title="Acknowledge event"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={async () => {
                          try {
                            await apiRequest('DELETE', `/api/alarm-events/${event.id}`);
                            queryClient.invalidateQueries({ queryKey: ['/api/alarm-events'] });
                          } catch {
                            toast({ title: 'Error', description: 'Failed to delete event.', variant: 'destructive' });
                          }
                        }}
                        title="Delete event"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
